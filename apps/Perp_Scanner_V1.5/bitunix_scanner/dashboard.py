from __future__ import annotations

import json
import mimetypes
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

from .ai import build_brief
from .coinglass import CoinglassClient
from .scanner import BitunixScanner
from .state import ScannerStore


PACKAGE_DIR = Path(__file__).resolve().parent
TEMPLATE_DIR = PACKAGE_DIR / "templates"
STATIC_DIR = PACKAGE_DIR / "static"


def _read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _asset_url(name: str) -> str:
    path = STATIC_DIR / name
    version = int(path.stat().st_mtime) if path.exists() else int(time.time())
    return f"/static/{name}?v={version}"


def render_home_html() -> str:
    return (
        _read_text(TEMPLATE_DIR / "home.html")
        .replace("__HOME_CSS__", _asset_url("home.css"))
        .replace("__HOME_WIDGETS_JS__", _asset_url("home-widgets.js"))
        .replace("__SYMBOL_WIDGETS_JS__", _asset_url("symbol-widgets.js"))
        .replace("__HOME_JS__", _asset_url("home.js"))
    )


def render_symbol_html(symbol: str) -> str:
    symbol_json = json.dumps(symbol)
    return (
        _read_text(TEMPLATE_DIR / "symbol.html")
        .replace("__SYMBOL__", symbol)
        .replace("__SYMBOL_JSON__", symbol_json)
        .replace("__SYMBOL_CSS__", _asset_url("symbol.css"))
        .replace("__HOME_WIDGETS_JS__", _asset_url("home-widgets.js"))
        .replace("__SYMBOL_WIDGETS_JS__", _asset_url("symbol-widgets.js"))
        .replace("__SYMBOL_JS__", _asset_url("symbol.js"))
    )


def _kline_number(row: dict[str, Any], *keys: str) -> float:
    for key in keys:
        if key in row and row[key] not in (None, ""):
            try:
                return float(row[key])
            except (TypeError, ValueError):
                return 0.0
    return 0.0


def _normalize_kline_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for row in rows:
        ts = int(_kline_number(row, "time", "ts", "t", "openTime", "startTime"))
        if ts > 10_000_000_000:
            ts //= 1000
        item = {
            "ts": ts,
            "open": _kline_number(row, "open", "o"),
            "high": _kline_number(row, "high", "h"),
            "low": _kline_number(row, "low", "l"),
            "close": _kline_number(row, "close", "c"),
            "quote_volume": _kline_number(row, "quoteVol", "quote_volume", "quoteVolume"),
            "base_volume": _kline_number(row, "baseVol", "base_volume", "baseVolume"),
        }
        if item["ts"] and item["open"] and item["high"] and item["low"] and item["close"]:
            normalized.append(item)
    return sorted(normalized, key=lambda item: item["ts"])


def build_impulse_history(rows: list[dict[str, Any]], current_price: float, threshold_pct: float) -> dict[str, Any]:
    candles = _normalize_kline_rows(rows)
    if not candles:
        return {"threshold_pct": threshold_pct, "rows": [], "impulses": [], "active": None, "best": None}

    impulses: list[dict[str, Any]] = []
    anchor = {"price": candles[0]["low"], "ts": candles[0]["ts"], "index": 0}
    active: dict[str, Any] | None = None
    reset_drawdown_pct = -55.0

    def finalize(candidate: dict[str, Any]) -> dict[str, Any]:
        price_now = current_price or candles[-1]["close"]
        if price_now > float(candidate["high_price"]):
            candidate["high_price"] = price_now
            candidate["high_ts"] = candles[-1]["ts"]
            candidate["high_index"] = len(candles) - 1
            candidate["pullback_low_price"] = price_now
            candidate["pullback_low_ts"] = candles[-1]["ts"]
            candidate["pullback_low_index"] = len(candles) - 1
        pullback_low = float(candidate.get("pullback_low_price") or candidate["high_price"])
        high_price = float(candidate["high_price"])
        start_price = float(candidate["start_price"])
        candidate["move_pct"] = ((high_price - start_price) / start_price) * 100 if start_price else 0.0
        candidate["current_price"] = price_now
        candidate["off_high_pct"] = ((price_now - high_price) / high_price) * 100 if high_price else 0.0
        candidate["drawdown_pct"] = ((pullback_low - high_price) / high_price) * 100 if high_price else 0.0
        candidate["rebound_pct"] = ((price_now - pullback_low) / pullback_low) * 100 if pullback_low else 0.0
        candidate["age_days"] = max(0.0, (candles[-1]["ts"] - int(candidate["start_ts"])) / 86400)
        candidate["days_since_high"] = max(0.0, (candles[-1]["ts"] - int(candidate["high_ts"])) / 86400)
        if candidate["off_high_pct"] >= -2:
            candidate["state"] = "pressing high"
        elif candidate["rebound_pct"] >= 25 and candidate["off_high_pct"] > candidate["drawdown_pct"] / 2:
            candidate["state"] = "reclaiming"
        elif candidate["drawdown_pct"] <= -50:
            candidate["state"] = "deep retrace"
        else:
            candidate["state"] = "pullback"
        return candidate

    for index, candle in enumerate(candles):
        if active is None:
            if candle["low"] < anchor["price"]:
                anchor = {"price": candle["low"], "ts": candle["ts"], "index": index}
            move_pct = ((candle["high"] - anchor["price"]) / anchor["price"]) * 100 if anchor["price"] else 0.0
            if move_pct >= threshold_pct:
                active = {
                    "start_price": anchor["price"],
                    "start_ts": anchor["ts"],
                    "start_index": anchor["index"],
                    "trigger_ts": candle["ts"],
                    "trigger_index": index,
                    "high_price": candle["high"],
                    "high_ts": candle["ts"],
                    "high_index": index,
                    "pullback_low_price": candle["high"],
                    "pullback_low_ts": candle["ts"],
                    "pullback_low_index": index,
                }
            continue

        if candle["high"] >= float(active["high_price"]):
            active["high_price"] = candle["high"]
            active["high_ts"] = candle["ts"]
            active["high_index"] = index
            active["pullback_low_price"] = candle["high"]
            active["pullback_low_ts"] = candle["ts"]
            active["pullback_low_index"] = index
            continue

        if candle["low"] < float(active["pullback_low_price"]):
            active["pullback_low_price"] = candle["low"]
            active["pullback_low_ts"] = candle["ts"]
            active["pullback_low_index"] = index

        high_price = float(active["high_price"])
        drawdown_pct = ((float(active["pullback_low_price"]) - high_price) / high_price) * 100 if high_price else 0.0
        if drawdown_pct <= reset_drawdown_pct and candle["close"] <= high_price * 0.65:
            impulses.append(finalize(active))
            anchor = {
                "price": float(active["pullback_low_price"]),
                "ts": int(active["pullback_low_ts"]),
                "index": int(active["pullback_low_index"]),
            }
            active = None
            move_pct = ((candle["high"] - anchor["price"]) / anchor["price"]) * 100 if anchor["price"] else 0.0
            if move_pct >= threshold_pct:
                active = {
                    "start_price": anchor["price"],
                    "start_ts": anchor["ts"],
                    "start_index": anchor["index"],
                    "trigger_ts": candle["ts"],
                    "trigger_index": index,
                    "high_price": candle["high"],
                    "high_ts": candle["ts"],
                    "high_index": index,
                    "pullback_low_price": candle["high"],
                    "pullback_low_ts": candle["ts"],
                    "pullback_low_index": index,
                }

    if active:
        impulses.append(finalize(active))

    best = max(impulses, key=lambda item: float(item.get("move_pct") or 0), default=None)
    return {
        "threshold_pct": threshold_pct,
        "rows": candles,
        "impulses": impulses[-8:],
        "active": impulses[-1] if impulses else None,
        "best": best,
    }



class DashboardServer:
    def __init__(self, store: ScannerStore, scanner: BitunixScanner, ai_provider: str, openai_model: str) -> None:
        self.store = store
        self.scanner = scanner
        self.ai_provider = ai_provider
        self.openai_model = openai_model
        self.coinglass = CoinglassClient(timeout_seconds=scanner.config.request_timeout_seconds)
        self.agent_flows: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()
        self.cache_lock = threading.Lock()
        self._brief_cache: dict[str, Any] = {"text": "", "ts": 0.0}
        self._markets_cache: dict[str, Any] = {"data": [], "limit": 0, "ts": 0.0}

    def run_scan(self) -> dict[str, Any]:
        with self.lock:
            result = self.scanner.scan_once()
        with self.cache_lock:
            self._markets_cache = {"data": [], "limit": 0, "ts": 0.0}
        return {"ts": result.ts, "markets": result.market_count, "alerts": result.alert_count}

    @staticmethod
    def normalize_symbol(value: str) -> str:
        return "".join(char for char in value.upper() if char.isalnum())

    def resolve_symbol(self, query: str) -> str | None:
        wanted = self.normalize_symbol(query)
        markets = self.latest_markets(limit=1000)
        candidates: list[tuple[int, int, str]] = []
        for market in markets:
            symbol = self.normalize_symbol(str(market.get("symbol", "")))
            base = self.normalize_symbol(str(market.get("base", "")))
            quote = self.normalize_symbol(str(market.get("quote", "")))
            base_quote = f"{base}{quote}"
            quote_rank = {"USDT": 0, "USDC": 1, "USD": 2}.get(quote, 3)
            if wanted == symbol:
                return str(market["symbol"])
            if wanted == base:
                candidates.append((1, quote_rank, str(market["symbol"])))
            elif wanted == base_quote:
                candidates.append((2, quote_rank, str(market["symbol"])))
            elif symbol.startswith(wanted) or base.startswith(wanted):
                candidates.append((3, quote_rank, str(market["symbol"])))
            elif wanted.startswith(base) and base:
                candidates.append((4, quote_rank, str(market["symbol"])))
            elif wanted in symbol or wanted in base_quote:
                candidates.append((5, quote_rank, str(market["symbol"])))
        if not candidates:
            return None
        return sorted(candidates)[0][2]

    def latest_market(self, symbol: str) -> dict[str, Any] | None:
        resolved = self.resolve_symbol(symbol)
        if not resolved:
            return None
        for market in self.latest_markets(limit=1000):
            if str(market.get("symbol", "")).upper() == resolved:
                market["resolved_symbol"] = resolved
                return market
        return None

    def latest_markets(self, limit: int = 250) -> list[dict[str, Any]]:
        now = time.time()
        with self.cache_lock:
            cached = self._markets_cache
            if cached["data"] and int(cached["limit"]) >= limit and now - float(cached["ts"]) < 20:
                return list(cached["data"][:limit])
        try:
            data = self.store.latest_markets(limit=limit)
        except Exception:  # noqa: BLE001 - keep the UI alive during brief SQLite write locks.
            with self.cache_lock:
                return list(self._markets_cache["data"][:limit])
        with self.cache_lock:
            self._markets_cache = {"data": data, "limit": limit, "ts": now}
        return data

    def depth(self, symbol: str, limit: str) -> dict[str, Any]:
        resolved = self.resolve_symbol(symbol) or symbol
        payload = self.scanner.client.get_depth(resolved, limit)
        payload["symbol"] = resolved
        return payload

    def kline(self, symbol: str, interval: str, limit: int) -> dict[str, Any]:
        resolved = self.resolve_symbol(symbol) or symbol
        allowed = {"1m", "5m", "15m", "30m", "1h", "2h", "4h", "6h", "12h", "1d", "1w"}
        if interval not in allowed:
            raise RuntimeError(f"unsupported interval {interval}")
        rows = self.scanner.client.get_kline(resolved, interval=interval, limit=max(1, min(limit, 200)))
        return {"symbol": resolved, "interval": interval, "rows": rows}

    def impulse_history(self, symbol: str, limit: int, threshold_pct: float) -> dict[str, Any]:
        resolved = self.resolve_symbol(symbol) or symbol
        rows = self.scanner.client.get_kline(resolved, interval="1d", limit=max(20, min(limit, 200)))
        market = self.latest_market(resolved) or {}
        current_price = float(market.get("last_price") or 0)
        payload = build_impulse_history(rows, current_price, max(5.0, min(threshold_pct, 5000.0)))
        payload["symbol"] = resolved
        payload["current_price"] = current_price
        payload["source"] = "Bitunix 1d candles"
        return payload

    def live_watchlist(self, symbols: list[str]) -> dict[str, Any]:
        wanted: list[str] = []
        seen: set[str] = set()
        for symbol in symbols[:100]:
            normalized = self.normalize_symbol(symbol)
            if normalized and normalized not in seen:
                seen.add(normalized)
                wanted.append(normalized)
        ts = int(time.time() * 1000)
        if not wanted:
            return {"ts": ts, "source": "empty", "markets": []}

        cached = {self.normalize_symbol(str(item.get("symbol", ""))): dict(item) for item in self.latest_markets(limit=1000)}
        rows = [dict(cached.get(symbol, {"symbol": symbol, "status": "OPEN"})) for symbol in wanted]
        try:
            tickers = self.scanner.client.get_tickers()
        except Exception as exc:  # noqa: BLE001 - detached widgets should keep rendering stale values.
            return {"ts": ts, "source": "cache", "error": str(exc), "markets": rows}

        ticker_map = {
            self.normalize_symbol(str(item.get("symbol", ""))): item
            for item in tickers
            if isinstance(item, dict)
        }
        for row in rows:
            ticker = ticker_map.get(self.normalize_symbol(str(row.get("symbol", ""))))
            if not ticker:
                continue
            last_price = self._number(ticker, ("lastPrice", "last"))
            mark_price = self._number(ticker, ("markPrice",))
            open_price = self._number(ticker, ("open",))
            high_price = self._number(ticker, ("high",))
            low_price = self._number(ticker, ("low",))
            quote_volume = self._number(ticker, ("quoteVol", "quoteVolume", "quote_volume"))
            base_volume = self._number(ticker, ("baseVol", "baseVolume", "base_volume"))
            best_bid = self._number(ticker, ("bid", "bd", "bestBid"))
            best_ask = self._number(ticker, ("ask", "ak", "bestAsk"))
            if last_price:
                row["last_price"] = last_price
            if mark_price:
                row["mark_price"] = mark_price
            if open_price:
                row["open_price"] = open_price
            if high_price:
                row["high_price"] = high_price
            if low_price:
                row["low_price"] = low_price
            if quote_volume:
                row["quote_volume"] = quote_volume
            if base_volume:
                row["base_volume"] = base_volume
            if best_bid:
                row["best_bid"] = best_bid
            if best_ask:
                row["best_ask"] = best_ask
            open_for_change = float(row.get("open_price") or 0)
            last_for_change = float(row.get("last_price") or 0)
            if open_for_change and last_for_change:
                row["price_change_pct"] = ((last_for_change - open_for_change) / open_for_change) * 100
            row["ticker_payload"] = ticker
            row["live_updated_at"] = ts
        return {"ts": ts, "source": "Bitunix tickers", "markets": rows}

    @staticmethod
    def _number(item: dict[str, Any], keys: tuple[str, ...]) -> float:
        for key in keys:
            if key in item and item[key] not in (None, ""):
                try:
                    return float(item[key])
                except (TypeError, ValueError):
                    return 0.0
        return 0.0

    @staticmethod
    def _data_rows(payload: dict[str, Any]) -> list[dict[str, Any]]:
        data = payload.get("data")
        if isinstance(data, list):
            return [item for item in data if isinstance(item, dict)]
        if isinstance(data, dict):
            for key in ("list", "data", "items", "result"):
                rows = data.get(key)
                if isinstance(rows, list):
                    return [item for item in rows if isinstance(item, dict)]
            return [data]
        return []

    def coinglass_liquidations(self, symbol: str, range_: str) -> dict[str, Any]:
        market = self.latest_market(symbol)
        if not market:
            raise RuntimeError(f"{symbol.upper()} not found")
        coin = str(market.get("base") or symbol).upper()
        exchange_payload = self.coinglass.liquidation_exchange_list(coin, range_)
        rows = self._data_rows(exchange_payload)
        exchanges: list[dict[str, Any]] = []
        for row in rows:
            exchange = str(row.get("exchange") or row.get("exchangeName") or row.get("name") or "")
            long_value = self._number(
                row,
                (
                    "long",
                    "longLiquidation",
                    "longLiquidationUsd",
                    "longLiquidationUSDT",
                    "long_liquidation_usd",
                    "longVolUsd",
                ),
            )
            short_value = self._number(
                row,
                (
                    "short",
                    "shortLiquidation",
                    "shortLiquidationUsd",
                    "shortLiquidationUSDT",
                    "short_liquidation_usd",
                    "shortVolUsd",
                ),
            )
            total = self._number(row, ("total", "totalLiquidation", "totalLiquidationUsd", "liquidationUsd"))
            if not total:
                total = long_value + short_value
            exchanges.append(
                {
                    "exchange": exchange,
                    "long": long_value,
                    "short": short_value,
                    "total": total,
                }
            )
        exchanges.sort(key=lambda item: item["total"], reverse=True)
        totals = {
            "long": sum(item["long"] for item in exchanges),
            "short": sum(item["short"] for item in exchanges),
            "total": sum(item["total"] for item in exchanges),
        }
        return {
            "coin": coin,
            "range": range_,
            "totals": totals,
            "exchanges": exchanges,
            "source": "CoinGlass V4",
        }

    def api_config(self) -> dict[str, Any]:
        config = self.scanner.config
        trading_configured = bool(config.bitunix_api_key and config.bitunix_secret_key)
        return {
            "bitunix_market_data": True,
            "coinglass_configured": bool(config.coinglass_api_key),
            "trading_configured": trading_configured,
            "trading_enabled": config.trading_enabled,
            "trading_dry_run": config.trading_dry_run,
            "trading_live": trading_configured and config.trading_enabled and not config.trading_dry_run,
        }

    def update_agent_flow(self, payload: dict[str, Any]) -> dict[str, Any]:
        symbol = str(payload.get("symbol") or "").upper()
        resolved = self.resolve_symbol(symbol)
        if not resolved:
            raise RuntimeError(f"{symbol} not found")
        payload["symbol"] = resolved
        payload["server_ts"] = int(time.time() * 1000)
        self.agent_flows[resolved] = payload
        return {"ok": True, "symbol": resolved, "server_ts": payload["server_ts"]}

    def agent_context(self, symbol: str) -> dict[str, Any]:
        resolved = self.resolve_symbol(symbol)
        if not resolved:
            raise RuntimeError(f"{symbol.upper()} not found")
        market = self.latest_market(resolved)
        depth: dict[str, Any]
        try:
            depth = self.depth(resolved, "15")
        except Exception as exc:  # noqa: BLE001 - agent can still use market/flow context.
            depth = {"error": str(exc)}
        return {
            "symbol": resolved,
            "market": market,
            "depth": depth,
            "flow": self.agent_flows.get(resolved, {}),
            "recent_alerts": [
                alert for alert in self.store.recent_alerts(100) if alert.get("symbol") == resolved
            ][:20],
            "api_config": self.api_config(),
            "capabilities": {
                "read_market": True,
                "read_depth": True,
                "read_browser_flow": True,
                "dry_run_orders": True,
                "live_orders": self.api_config()["trading_live"],
            },
            "safety": {
                "order_endpoint": "/api/trading/place-order",
                "browser_safety_lock": "safetyLock=true rejects live order submission",
                "live_trading_requires": ["BITUNIX_API_KEY", "BITUNIX_SECRET_KEY", "TRADING_ENABLED=true", "TRADING_DRY_RUN=false"],
            },
        }

    def place_order(self, payload: dict[str, Any]) -> dict[str, Any]:
        config = self.scanner.config
        symbol = str(payload.get("symbol") or "").upper()
        resolved = self.resolve_symbol(symbol)
        if not resolved:
            raise RuntimeError(f"{symbol} not found")
        order_type = str(payload.get("orderType") or "LIMIT").upper()
        side = str(payload.get("side") or "").upper()
        qty = str(payload.get("qty") or "").strip()
        price = str(payload.get("price") or "").strip()
        trade_side = str(payload.get("tradeSide") or "OPEN").upper()
        effect = str(payload.get("effect") or "GTC").upper()
        if side not in {"BUY", "SELL"}:
            raise RuntimeError("side must be BUY or SELL")
        if order_type not in {"LIMIT", "MARKET"}:
            raise RuntimeError("orderType must be LIMIT or MARKET")
        if trade_side not in {"OPEN", "CLOSE"}:
            raise RuntimeError("tradeSide must be OPEN or CLOSE")
        if not qty:
            raise RuntimeError("qty is required")
        order: dict[str, Any] = {
            "symbol": resolved,
            "side": side,
            "qty": qty,
            "tradeSide": trade_side,
            "orderType": order_type,
            "reduceOnly": bool(payload.get("reduceOnly")),
            "clientId": f"bitunix_scanner_{int(time.time() * 1000)}",
        }
        if order_type == "LIMIT":
            if not price:
                raise RuntimeError("price is required for LIMIT orders")
            order["price"] = price
            order["effect"] = effect
        trading_configured = bool(config.bitunix_api_key and config.bitunix_secret_key)
        live = trading_configured and config.trading_enabled and not config.trading_dry_run
        if not live:
            return {
                "dry_run": True,
                "message": "Order was not sent. Configure BITUNIX_API_KEY, BITUNIX_SECRET_KEY, TRADING_ENABLED=true, and TRADING_DRY_RUN=false for live orders.",
                "order": order,
            }
        if payload.get("safetyLock"):
            raise RuntimeError("safety lock is enabled; live order submission is blocked")
        if not payload.get("confirm"):
            raise RuntimeError("confirmation checkbox is required for live order submission")
        result = self.scanner.client.place_order(config.bitunix_api_key, config.bitunix_secret_key, order)
        return {"dry_run": False, "order": order, "result": result}

    def handler(self) -> type[BaseHTTPRequestHandler]:
        dashboard = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, fmt: str, *args: Any) -> None:
                return

            def send_no_cache_headers(self) -> None:
                self.send_header("Cache-Control", "no-store, no-cache, max-age=0, must-revalidate")
                self.send_header("Pragma", "no-cache")
                self.send_header("Expires", "0")

            def send_json(self, payload: Any, status: int = 200) -> None:
                body = json.dumps(payload, sort_keys=True).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_no_cache_headers()
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def send_html(self, html: str | None = None, write_body: bool = True) -> None:
                body = (html if html is not None else render_home_html()).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_no_cache_headers()
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if write_body:
                    self.wfile.write(body)

            def send_static(self, path: str, write_body: bool = True) -> None:
                name = path.removeprefix("/static/")
                if not name or ".." in name or name.startswith("/"):
                    self.send_response(404)
                    self.send_no_cache_headers()
                    self.end_headers()
                    return
                file_path = STATIC_DIR / name
                if not file_path.is_file():
                    self.send_response(404)
                    self.send_no_cache_headers()
                    self.end_headers()
                    return
                body = file_path.read_bytes()
                content_type = mimetypes.guess_type(str(file_path))[0] or "application/octet-stream"
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Cache-Control", "public, max-age=31536000, immutable")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                if write_body:
                    self.wfile.write(body)

            def do_HEAD(self) -> None:
                parsed = urlparse(self.path)
                if parsed.path.startswith("/static/"):
                    self.send_static(parsed.path, write_body=False)
                    return
                if parsed.path == "/" or parsed.path.startswith("/symbol/"):
                    html = render_home_html()
                    if parsed.path.startswith("/symbol/"):
                        symbol = unquote(parsed.path.removeprefix("/symbol/")).upper()
                        html = render_symbol_html(dashboard.resolve_symbol(symbol) or symbol)
                    self.send_html(html, write_body=False)
                    return
                self.send_response(404)
                self.send_no_cache_headers()
                self.end_headers()

            def do_GET(self) -> None:
                try:
                    self._do_GET_inner()
                except Exception as exc:  # noqa: BLE001
                    try:
                        self.send_json({"error": f"Internal server error: {exc}"}, 500)
                    except Exception:  # noqa: BLE001
                        pass

            def _do_GET_inner(self) -> None:
                parsed = urlparse(self.path)
                path = parsed.path
                params = parse_qs(parsed.query)
                if path.startswith("/static/"):
                    self.send_static(path)
                    return
                if path == "/":
                    self.send_html(render_home_html())
                    return
                if path.startswith("/symbol/"):
                    symbol = unquote(path.removeprefix("/symbol/")).upper()
                    if not symbol:
                        self.send_json({"error": "missing symbol"}, 400)
                        return
                    symbol = dashboard.resolve_symbol(symbol) or symbol
                    self.send_html(render_symbol_html(symbol))
                    return
                if path == "/api/markets":
                    requested = int((params.get("limit") or ["250"])[0] or "250")
                    self.send_json(dashboard.latest_markets(max(1, min(requested, 1000))))
                    return
                if path == "/api/live-watchlist":
                    symbols: list[str] = []
                    for value in params.get("symbols", []):
                        symbols.extend(item for item in value.split(",") if item.strip())
                    self.send_json(dashboard.live_watchlist(symbols))
                    return
                if path == "/api/config":
                    self.send_json(dashboard.api_config())
                    return
                if path == "/api/agent/context":
                    symbol = (params.get("symbol") or [""])[0].upper()
                    if not symbol:
                        self.send_json({"error": "missing symbol"}, 400)
                        return
                    try:
                        self.send_json(dashboard.agent_context(symbol))
                    except Exception as exc:  # noqa: BLE001 - agent-readable error.
                        self.send_json({"error": str(exc)}, 404)
                    return
                if path == "/api/agent/symbols":
                    self.send_json(
                        {
                            "symbols": [
                                {
                                    "symbol": market.get("symbol"),
                                    "base": market.get("base"),
                                    "quote": market.get("quote"),
                                    "status": market.get("status"),
                                    "price_change_pct": market.get("price_change_pct"),
                                    "scan_price_change_pct": market.get("scan_price_change_pct"),
                                    "range_15m_pct": market.get("range_15m_pct"),
                                    "quote_volume": market.get("quote_volume"),
                                }
                                for market in dashboard.latest_markets(limit=1000)
                            ]
                        }
                    )
                    return
                if path == "/api/market":
                    symbol = (params.get("symbol") or [""])[0].upper()
                    market = dashboard.latest_market(symbol)
                    if not market:
                        self.send_json({"error": f"{symbol} not found"}, 404)
                        return
                    self.send_json(market)
                    return
                if path == "/api/kline":
                    symbol = (params.get("symbol") or [""])[0].upper()
                    interval = (params.get("interval") or ["1d"])[0]
                    try:
                        limit = int((params.get("limit") or ["2"])[0])
                    except ValueError:
                        limit = 2
                    if not symbol:
                        self.send_json({"error": "missing symbol"}, 400)
                        return
                    try:
                        self.send_json(dashboard.kline(symbol, interval, limit))
                    except Exception as exc:  # noqa: BLE001 - surface API failures in dashboard.
                        self.send_json({"error": str(exc)}, 502)
                    return
                if path == "/api/impulse":
                    symbol = (params.get("symbol") or [""])[0].upper()
                    try:
                        limit = int((params.get("limit") or ["180"])[0])
                    except ValueError:
                        limit = 180
                    try:
                        threshold = float((params.get("threshold") or ["25"])[0])
                    except ValueError:
                        threshold = 25.0
                    if not symbol:
                        self.send_json({"error": "missing symbol"}, 400)
                        return
                    try:
                        self.send_json(dashboard.impulse_history(symbol, limit, threshold))
                    except Exception as exc:  # noqa: BLE001 - surface API failures in dashboard.
                        self.send_json({"error": str(exc)}, 502)
                    return
                if path == "/api/depth":
                    symbol = (params.get("symbol") or [""])[0].upper()
                    limit = (params.get("limit") or ["50"])[0]
                    if not symbol:
                        self.send_json({"error": "missing symbol"}, 400)
                        return
                    try:
                        self.send_json(dashboard.depth(symbol, limit))
                    except Exception as exc:  # noqa: BLE001 - surface API failures in dashboard.
                        self.send_json({"error": str(exc)}, 502)
                    return
                if path == "/api/coinglass/liquidations":
                    symbol = (params.get("symbol") or [""])[0].upper()
                    range_ = (params.get("range") or ["4h"])[0]
                    if range_ not in {"1h", "4h", "12h", "24h"}:
                        range_ = "4h"
                    if not symbol:
                        self.send_json({"error": "missing symbol"}, 400)
                        return
                    try:
                        self.send_json(dashboard.coinglass_liquidations(symbol, range_))
                    except Exception as exc:  # noqa: BLE001 - return key/API status to panel.
                        self.send_json({"error": str(exc)}, 502)
                    return
                if path == "/api/alerts":
                    self.send_json(dashboard.store.recent_alerts())
                    return
                if path == "/api/brief":
                    now = time.time()
                    cache = dashboard._brief_cache
                    if not cache["text"] or now - cache["ts"] > 120:
                        markets = dashboard.latest_markets(limit=250)
                        alerts = dashboard.store.recent_alerts()
                        cache["text"] = build_brief(markets, alerts, dashboard.ai_provider, dashboard.openai_model)
                        cache["ts"] = now
                    self.send_json({"text": cache["text"]})
                    return
                self.send_json({"error": "not found"}, 404)

            def do_POST(self) -> None:
                parsed = urlparse(self.path)
                if parsed.path == "/api/scan":
                    self.send_json(dashboard.run_scan())
                    return
                if parsed.path == "/api/trading/place-order":
                    try:
                        length = int(self.headers.get("Content-Length", "0"))
                        body = self.rfile.read(length).decode("utf-8") if length else "{}"
                        payload = json.loads(body)
                        self.send_json(dashboard.place_order(payload))
                    except Exception as exc:  # noqa: BLE001 - return order validation/API errors.
                        self.send_json({"error": str(exc)}, 400)
                    return
                if parsed.path == "/api/agent/flow":
                    try:
                        length = int(self.headers.get("Content-Length", "0"))
                        body = self.rfile.read(length).decode("utf-8") if length else "{}"
                        payload = json.loads(body)
                        self.send_json(dashboard.update_agent_flow(payload))
                    except Exception as exc:  # noqa: BLE001 - keep browser flow non-fatal.
                        self.send_json({"error": str(exc)}, 400)
                    return
                self.send_json({"error": "not found"}, 404)

        return Handler


def start_background_scanner(scanner: BitunixScanner, interval_seconds: int) -> threading.Thread:
    def loop() -> None:
        while True:
            time.sleep(interval_seconds)
            try:
                scanner.scan_once()
            except Exception as exc:  # noqa: BLE001 - keep dashboard alive and visible.
                print(f"Background scan failed: {exc}")

    thread = threading.Thread(target=loop, daemon=True)
    thread.start()
    return thread


def serve(
    store: ScannerStore,
    scanner: BitunixScanner,
    host: str,
    port: int,
    ai_provider: str,
    openai_model: str,
) -> None:
    dashboard = DashboardServer(store, scanner, ai_provider, openai_model)
    httpd = ThreadingHTTPServer((host, port), dashboard.handler())
    print(f"Bitunix scanner dashboard running at http://{host}:{port}")
    httpd.serve_forever()
