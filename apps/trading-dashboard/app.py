from __future__ import annotations

import hashlib
import json
import math
import random
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, time, timedelta, timezone
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent

TIMEFRAME_MAP: dict[str, dict[str, str]] = {
    "1m": {"interval": "1m", "range": "1d"},
    "5m": {"interval": "5m", "range": "5d"},
    "15m": {"interval": "15m", "range": "5d"},
    "30m": {"interval": "30m", "range": "1mo"},
    "1h": {"interval": "60m", "range": "1mo"},
    "1d": {"interval": "1d", "range": "6mo"},
    "1w": {"interval": "1wk", "range": "2y"},
    "1M": {"interval": "1mo", "range": "5y"},
}

CRYPTO_SYMBOLS = {
    "BTC": "BTC-USD",
    "ETH": "ETH-USD",
    "SOL": "SOL-USD",
    "BNB": "BNB-USD",
    "XRP": "XRP-USD",
    "DOGE": "DOGE-USD",
}
US_SYMBOLS = {
    "AAPL": "AAPL",
    "TSLA": "TSLA",
    "MSFT": "MSFT",
    "NVDA": "NVDA",
    "AMZN": "AMZN",
    "GOOGL": "GOOGL",
}
INDIA_SYMBOLS = {
    "RELIANCE": "RELIANCE.NS",
    "TCS": "TCS.NS",
    "INFY": "INFY.NS",
    "HDFCBANK": "HDFCBANK.NS",
    "ICICIBANK": "ICICIBANK.NS",
    "SBIN": "SBIN.NS",
}

SYMBOLS = {
    "crypto": CRYPTO_SYMBOLS,
    "us": US_SYMBOLS,
    "india": INDIA_SYMBOLS,
}
MARKET_DEFAULTS = {"crypto": "BTC", "us": "AAPL", "india": "RELIANCE"}


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
        if parsed.path == "/api/status":
            self.send_json(get_status())
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
        market: [
            {"label": label, "ticker": ticker}
            for label, ticker in sorted(market_symbols.items())
        ]
        for market, market_symbols in SYMBOLS.items()
    }


def get_status() -> dict[str, dict[str, bool | str]]:
    now = datetime.now(timezone.utc)
    return {
        "crypto": {"label": "HL Live", "open": True},
        "us": market_status(now, "us"),
        "india": market_status(now, "india"),
    }


def get_candles(params: dict[str, list[str]]) -> dict[str, Any]:
    market = first(params, "market", "crypto").lower()
    symbol = first(params, "symbol", MARKET_DEFAULTS.get(market, "BTC")).upper().strip()
    timeframe = first(params, "timeframe", "15m")
    normalized = normalize_symbol(market, symbol)
    config = TIMEFRAME_MAP.get(timeframe, TIMEFRAME_MAP["15m"])

    if market == "crypto":
        data, source = fetch_binance_candles(symbol, config)
        if not data:
            data, source = fetch_yahoo_candles(normalized, config)
    else:
        data, source = fetch_yahoo_candles(normalized, config)
    if not data:
        data = generate_demo_candles(symbol, timeframe)
        source = "demo"

    return {
        "market": market,
        "symbol": symbol,
        "ticker": normalized,
        "timeframe": timeframe,
        "source": source,
        "candles": data,
    }


def first(params: dict[str, list[str]], key: str, fallback: str) -> str:
    values = params.get(key) or []
    return values[0] if values else fallback


def normalize_symbol(market: str, symbol: str) -> str:
    table = SYMBOLS.get(market, {})
    if symbol in table:
        return table[symbol]
    if market == "crypto":
        return f"{symbol}-USD" if "-" not in symbol else symbol
    if market == "india" and not symbol.endswith((".NS", ".BO")):
        return f"{symbol}.NS"
    return symbol


def fetch_binance_candles(symbol: str, config: dict[str, str]) -> tuple[list[dict[str, float | int]], str]:
    pair = f"{symbol.replace('-USD', '').replace('USD', '')}USDT"
    query = urllib.parse.urlencode({"symbol": pair, "interval": config["interval"].replace("60m", "1h"), "limit": 240})
    url = f"https://api.binance.com/api/v3/klines?{query}"
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            rows = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return [], "unavailable"

    candles_out: list[dict[str, float | int]] = []
    for row in rows:
        try:
            candles_out.append(
                {
                    "time": int(row[0] / 1000),
                    "open": round(float(row[1]), 4),
                    "high": round(float(row[2]), 4),
                    "low": round(float(row[3]), 4),
                    "close": round(float(row[4]), 4),
                    "volume": round(float(row[5]), 2),
                }
            )
        except (IndexError, TypeError, ValueError):
            continue
    return candles_out, "binance"


def fetch_yahoo_candles(ticker: str, config: dict[str, str]) -> tuple[list[dict[str, float | int]], str]:
    query = urllib.parse.urlencode(
        {
            "range": config["range"],
            "interval": config["interval"],
            "includePrePost": "false",
            "events": "div,splits",
        }
    )
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{urllib.parse.quote(ticker)}?{query}"
    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return [], "unavailable"

    result = ((payload.get("chart") or {}).get("result") or [None])[0]
    if not result:
        return [], "unavailable"

    timestamps = result.get("timestamp") or []
    quote = (((result.get("indicators") or {}).get("quote") or [None])[0]) or {}
    opens = quote.get("open") or []
    highs = quote.get("high") or []
    lows = quote.get("low") or []
    closes = quote.get("close") or []
    volumes = quote.get("volume") or []

    candles_out: list[dict[str, float | int]] = []
    for index, timestamp in enumerate(timestamps[-260:]):
        values = [get_number(opens, index), get_number(highs, index), get_number(lows, index), get_number(closes, index)]
        if any(value is None for value in values):
            continue
        open_price, high_price, low_price, close_price = values
        candles_out.append(
            {
                "time": int(timestamp),
                "open": round(float(open_price), 4),
                "high": round(float(high_price), 4),
                "low": round(float(low_price), 4),
                "close": round(float(close_price), 4),
                "volume": round(float(get_number(volumes, index) or 0), 2),
            }
        )
    return candles_out, "yahoo"


def get_number(values: list[Any], index: int) -> float | int | None:
    if index >= len(values):
        return None
    value = values[index]
    if value is None:
        return None
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(numeric):
        return None
    return numeric


def market_status(now: datetime, market: str) -> dict[str, bool | str]:
    if market == "us":
        local_hour = (now.hour - 4) % 24
        is_weekday = now.weekday() < 5
        open_now = is_weekday and time(9, 30) <= time(local_hour, now.minute) <= time(16, 0)
        return {"label": "US Market Live" if open_now else "US Market Closed", "open": open_now}

    local_hour = (now.hour + 5) % 24
    local_minute = (now.minute + 30) % 60
    if now.minute >= 30:
        local_hour = (local_hour + 1) % 24
    is_weekday = now.weekday() < 5
    open_now = is_weekday and time(9, 15) <= time(local_hour, local_minute) <= time(15, 30)
    return {"label": "Indian Market Live" if open_now else "Indian Market Closed", "open": open_now}


def generate_demo_candles(symbol: str, timeframe: str, count: int = 180) -> list[dict[str, float | int]]:
    seed = int(hashlib.sha256(f"{symbol}:{timeframe}".encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)
    seconds = timeframe_to_seconds(timeframe)
    now = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    start = now - timedelta(seconds=seconds * count)
    price = 40 + (seed % 400)
    candles_out: list[dict[str, float | int]] = []
    for index in range(count):
        drift = math.sin(index / 13) * 0.35
        change = rng.uniform(-1.6, 1.8) + drift
        open_price = price
        close_price = max(1, open_price + change)
        high_price = max(open_price, close_price) + rng.uniform(0.2, 2.8)
        low_price = max(0.1, min(open_price, close_price) - rng.uniform(0.2, 2.5))
        volume = rng.randint(20_000, 900_000)
        candles_out.append(
            {
                "time": int((start + timedelta(seconds=seconds * index)).timestamp()),
                "open": round(open_price, 4),
                "high": round(high_price, 4),
                "low": round(low_price, 4),
                "close": round(close_price, 4),
                "volume": volume,
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
        "1d": 86400,
        "1w": 604800,
        "1M": 2_592_000,
    }.get(timeframe, 900)


def main() -> None:
    server = ThreadingHTTPServer(("127.0.0.1", 5000), TradingDashboardHandler)
    print("Trading dashboard running at http://127.0.0.1:5000")
    server.serve_forever()


if __name__ == "__main__":
    main()
