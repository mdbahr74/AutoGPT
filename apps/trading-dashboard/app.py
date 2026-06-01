from __future__ import annotations

import hashlib
import json
import math
import random
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent

# Crypto-only order-flow terminal. Binance is the single source of truth because
# it exposes taker-buy volume per candle, which lets us compute real buy/sell
# delta for free. Timeframe keys map straight onto Binance kline intervals.
BINANCE_INTERVALS = {"1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w", "1M"}
DEFAULT_TIMEFRAME = "15m"
CANDLE_LIMIT = 600

# A small starter list. The symbol box accepts any Binance USDT pair, so this is
# just for the watchlist / quick-pick defaults.
CRYPTO_SYMBOLS = {
    "BTC": "BTCUSDT",
    "ETH": "ETHUSDT",
    "SOL": "SOLUSDT",
    "BNB": "BNBUSDT",
    "XRP": "XRPUSDT",
    "DOGE": "DOGEUSDT",
    "AVAX": "AVAXUSDT",
    "LINK": "LINKUSDT",
}
DEFAULT_SYMBOL = "BTC"


class TradingDashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/":
            self.send_file(ROOT / "templates" / "index.html", "text/html; charset=utf-8")
            return
        if parsed.path == "/api/symbols":
            self.send_json(get_symbols())
            return
        if parsed.path == "/api/candles":
            params = urllib.parse.parse_qs(parsed.query)
            self.send_json(get_candles(params))
            return
        super().do_GET()

    def send_json(self, payload: Any) -> None:
        encoded = json.dumps(payload).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def send_file(self, path: Path, content_type: str) -> None:
        encoded = path.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[{datetime.now().isoformat(timespec='seconds')}] {format % args}")


def get_symbols() -> dict[str, list[dict[str, str]]]:
    return {
        "crypto": [
            {"label": label, "ticker": ticker}
            for label, ticker in sorted(CRYPTO_SYMBOLS.items())
        ]
    }


def get_candles(params: dict[str, list[str]]) -> dict[str, Any]:
    symbol = first(params, "symbol", DEFAULT_SYMBOL).upper().strip()
    timeframe = first(params, "timeframe", DEFAULT_TIMEFRAME)
    if timeframe not in BINANCE_INTERVALS:
        timeframe = DEFAULT_TIMEFRAME
    pair = normalize_pair(symbol)

    # Try sources in order. Binance.com has real taker-buy delta but geo-blocks
    # the US; Binance.US is the US-legal mirror (same data, fewer coins); Bybit
    # covers almost everything incl. perps but klines have no taker split, so we
    # estimate delta from where each candle closes in its range.
    data: list[dict[str, float | int]] = []
    source = ""
    delta_real = True
    for fetcher in (fetch_binance_com, fetch_binance_us, fetch_bybit_spot, fetch_bybit_perp):
        data, source, delta_real = fetcher(pair, timeframe)
        if data:
            break
    if not data:
        data = generate_demo_candles(symbol, timeframe)
        source, delta_real = "demo", False

    return {
        "symbol": symbol,
        "ticker": pair,
        "timeframe": timeframe,
        "source": source,
        "deltaReal": delta_real,
        "candles": data,
    }


def first(params: dict[str, list[str]], key: str, fallback: str) -> str:
    values = params.get(key) or []
    return values[0] if values else fallback


def normalize_pair(symbol: str) -> str:
    """Turn a user symbol into a Binance USDT pair (BTC -> BTCUSDT)."""
    if symbol in CRYPTO_SYMBOLS:
        return CRYPTO_SYMBOLS[symbol]
    cleaned = symbol.replace("-", "").replace("/", "").replace("USD", "USDT")
    if cleaned.endswith(("USDT", "USDC", "BUSD", "FDUSD")):
        return cleaned
    return f"{cleaned}USDT"


BYBIT_INTERVALS = {
    "1m": "1", "5m": "5", "15m": "15", "30m": "30",
    "1h": "60", "4h": "240", "1d": "D", "1w": "W", "1M": "M",
}


def http_get_json(url: str) -> Any:
    request = urllib.request.Request(url, headers={"User-Agent": "order-flow-terminal/1.0"})
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.loads(response.read().decode("utf-8"))


def estimate_split(volume: float, high: float, low: float, close: float) -> tuple[float, float]:
    """When an exchange doesn't expose taker-buy volume, approximate buy/sell
    pressure from where price closed in the candle's range (close near the high
    = buyers in control). Not true delta, but a standard proxy."""
    span = high - low
    buy_fraction = (close - low) / span if span > 0 else 0.5
    buy_fraction = min(1.0, max(0.0, buy_fraction))
    return volume * buy_fraction, volume * (1 - buy_fraction)


def fetch_binance_com(pair: str, interval: str) -> tuple[list, str, bool]:
    return _fetch_binance(pair, interval, "https://api.binance.com", "binance")


def fetch_binance_us(pair: str, interval: str) -> tuple[list, str, bool]:
    return _fetch_binance(pair, interval, "https://api.binance.us", "binance.us")


def _fetch_binance(pair: str, interval: str, host: str, label: str) -> tuple[list, str, bool]:
    query = urllib.parse.urlencode({"symbol": pair, "interval": interval, "limit": CANDLE_LIMIT})
    try:
        rows = http_get_json(f"{host}/api/v3/klines?{query}")
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return [], label, True
    candles_out: list[dict[str, float | int]] = []
    for row in rows:
        try:
            volume = float(row[5])
            taker_buy = float(row[9])  # real taker-buy base volume = market buys
            taker_sell = max(volume - taker_buy, 0.0)
            candles_out.append({
                "time": int(row[0] // 1000),
                "open": round(float(row[1]), 6), "high": round(float(row[2]), 6),
                "low": round(float(row[3]), 6), "close": round(float(row[4]), 6),
                "volume": round(volume, 4),
                "buyVolume": round(taker_buy, 4), "sellVolume": round(taker_sell, 4),
                "delta": round(taker_buy - taker_sell, 4), "trades": int(row[8]),
            })
        except (IndexError, TypeError, ValueError):
            continue
    return candles_out, label, True


def fetch_bybit_spot(pair: str, interval: str) -> tuple[list, str, bool]:
    return _fetch_bybit(pair, interval, "spot", "bybit")


def fetch_bybit_perp(pair: str, interval: str) -> tuple[list, str, bool]:
    return _fetch_bybit(pair, interval, "linear", "bybit-perp")


def _fetch_bybit(pair: str, interval: str, category: str, label: str) -> tuple[list, str, bool]:
    query = urllib.parse.urlencode({
        "category": category, "symbol": pair,
        "interval": BYBIT_INTERVALS.get(interval, "15"), "limit": min(CANDLE_LIMIT, 1000),
    })
    try:
        payload = http_get_json(f"https://api.bybit.com/v5/market/kline?{query}")
        rows = (payload.get("result") or {}).get("list") or []
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError, AttributeError):
        return [], label, False
    candles_out: list[dict[str, float | int]] = []
    for row in rows:  # Bybit returns [start, open, high, low, close, volume, turnover]
        try:
            high, low, close = float(row[2]), float(row[3]), float(row[4])
            volume = float(row[5])
            buy_vol, sell_vol = estimate_split(volume, high, low, close)
            candles_out.append({
                "time": int(int(row[0]) // 1000),
                "open": round(float(row[1]), 6), "high": round(high, 6),
                "low": round(low, 6), "close": round(close, 6),
                "volume": round(volume, 4),
                "buyVolume": round(buy_vol, 4), "sellVolume": round(sell_vol, 4),
                "delta": round(buy_vol - sell_vol, 4), "trades": 0,
            })
        except (IndexError, TypeError, ValueError):
            continue
    candles_out.sort(key=lambda c: c["time"])  # Bybit is newest-first
    return candles_out, label, False


def generate_demo_candles(symbol: str, timeframe: str, count: int = 320) -> list[dict[str, float | int]]:
    """Deterministic offline candles (with synthetic delta) so the UI still works
    when Binance is unreachable. Clearly labelled 'demo' in the UI."""
    seed = int(hashlib.sha256(f"{symbol}:{timeframe}".encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)
    seconds = timeframe_to_seconds(timeframe)
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = now - timedelta(seconds=seconds * count)
    price = 40 + (seed % 4000)
    candles_out: list[dict[str, float | int]] = []
    for index in range(count):
        drift = math.sin(index / 17) * 0.4
        change = rng.uniform(-1.6, 1.8) + drift
        open_price = price
        close_price = max(1, open_price + change)
        high_price = max(open_price, close_price) + rng.uniform(0.2, 2.8)
        low_price = max(0.1, min(open_price, close_price) - rng.uniform(0.2, 2.5))
        volume = rng.uniform(20_000, 900_000)
        # Bias buy pressure toward up candles to make delta look plausible.
        buy_ratio = 0.5 + (0.18 if close_price >= open_price else -0.18) + rng.uniform(-0.08, 0.08)
        buy_ratio = min(0.9, max(0.1, buy_ratio))
        buy_volume = volume * buy_ratio
        sell_volume = volume - buy_volume
        candles_out.append(
            {
                "time": int((start + timedelta(seconds=seconds * index)).timestamp()),
                "open": round(open_price, 4),
                "high": round(high_price, 4),
                "low": round(low_price, 4),
                "close": round(close_price, 4),
                "volume": round(volume, 2),
                "buyVolume": round(buy_volume, 2),
                "sellVolume": round(sell_volume, 2),
                "delta": round(buy_volume - sell_volume, 2),
                "trades": rng.randint(200, 5000),
            }
        )
        price = close_price
    return candles_out


def timeframe_to_seconds(timeframe: str) -> int:
    return {
        "1m": 60,
        "5m": 300,
        "15m": 900,
        "30m": 1800,
        "1h": 3600,
        "4h": 14400,
        "1d": 86400,
        "1w": 604800,
        "1M": 2_592_000,
    }.get(timeframe, 900)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 5000), TradingDashboardHandler)
    print("Crypto order-flow terminal running at http://127.0.0.1:5000")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
        server.server_close()


if __name__ == "__main__":
    main()
