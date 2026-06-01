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

    data, source = fetch_binance_candles(pair, timeframe)
    if not data:
        data = generate_demo_candles(symbol, timeframe)
        source = "demo"

    return {
        "symbol": symbol,
        "ticker": pair,
        "timeframe": timeframe,
        "source": source,
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


def fetch_binance_candles(pair: str, interval: str) -> tuple[list[dict[str, float | int]], str]:
    query = urllib.parse.urlencode({"symbol": pair, "interval": interval, "limit": CANDLE_LIMIT})
    url = f"https://api.binance.com/api/v3/klines?{query}"
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            rows = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError, ValueError):
        return [], "unavailable"

    candles_out: list[dict[str, float | int]] = []
    for row in rows:
        try:
            volume = float(row[5])
            taker_buy = float(row[9])  # taker buy base volume = market buys
            taker_sell = max(volume - taker_buy, 0.0)
            candles_out.append(
                {
                    "time": int(row[0] // 1000),
                    "open": round(float(row[1]), 6),
                    "high": round(float(row[2]), 6),
                    "low": round(float(row[3]), 6),
                    "close": round(float(row[4]), 6),
                    "volume": round(volume, 4),
                    "buyVolume": round(taker_buy, 4),
                    "sellVolume": round(taker_sell, 4),
                    "delta": round(taker_buy - taker_sell, 4),
                    "trades": int(row[8]),
                }
            )
        except (IndexError, TypeError, ValueError):
            continue
    return candles_out, "binance"


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
