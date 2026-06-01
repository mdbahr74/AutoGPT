from __future__ import annotations

import hashlib
import json
import secrets
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from typing import Any

from .models import PerpMarket


class BitunixApiError(RuntimeError):
    pass


class BitunixClient:
    base_url = "https://fapi.bitunix.com"

    def __init__(self, timeout_seconds: int = 15) -> None:
        self.timeout_seconds = timeout_seconds

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        query = ""
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            query = "?" + urllib.parse.urlencode(clean)
        url = f"{self.base_url}{path}{query}"
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "bitunix-perp-scanner/0.1",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise BitunixApiError(f"HTTP {exc.code} from Bitunix: {body}") from exc
        except urllib.error.URLError as exc:
            raise BitunixApiError(f"Bitunix request failed: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise BitunixApiError("Bitunix returned invalid JSON") from exc

        if payload.get("code") != 0:
            raise BitunixApiError(f"Bitunix API error: {payload}")
        return payload

    @staticmethod
    def _query_signature_string(params: dict[str, Any] | None) -> str:
        if not params:
            return ""
        return "".join(f"{key}{params[key]}" for key in sorted(params))

    @staticmethod
    def _body_string(body: dict[str, Any] | None) -> str:
        if not body:
            return ""
        return json.dumps(body, separators=(",", ":"), ensure_ascii=False)

    @staticmethod
    def _sha256(value: str) -> str:
        return hashlib.sha256(value.encode("utf-8")).hexdigest()

    def signed_json(
        self,
        method: str,
        path: str,
        api_key: str,
        secret_key: str,
        params: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        query = ""
        if params:
            clean = {k: v for k, v in params.items() if v is not None}
            query = "?" + urllib.parse.urlencode(clean)
        body_text = self._body_string(body)
        nonce = secrets.token_hex(16)
        timestamp = str(int(time.time() * 1000))
        query_text = self._query_signature_string(params)
        digest = self._sha256(nonce + timestamp + api_key + query_text + body_text)
        sign = self._sha256(digest + secret_key)
        request = urllib.request.Request(
            f"{self.base_url}{path}{query}",
            data=body_text.encode("utf-8") if body_text else None,
            headers={
                "Accept": "application/json",
                "Content-Type": "application/json",
                "api-key": api_key,
                "nonce": nonce,
                "timestamp": timestamp,
                "sign": sign,
                "language": "en-US",
                "User-Agent": "bitunix-perp-scanner/0.1",
            },
            method=method.upper(),
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            response_body = exc.read().decode("utf-8", errors="replace")
            raise BitunixApiError(f"HTTP {exc.code} from Bitunix: {response_body}") from exc
        except urllib.error.URLError as exc:
            raise BitunixApiError(f"Bitunix request failed: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise BitunixApiError("Bitunix returned invalid JSON") from exc
        if payload.get("code") != 0:
            raise BitunixApiError(f"Bitunix API error: {payload}")
        return payload

    def get_trading_pairs(self) -> list[dict[str, Any]]:
        return list(self.get_json("/api/v1/futures/market/trading_pairs").get("data") or [])

    def get_tickers(self) -> list[dict[str, Any]]:
        return list(self.get_json("/api/v1/futures/market/tickers").get("data") or [])

    def get_funding_rates(self) -> list[dict[str, Any]]:
        return list(self.get_json("/api/v1/futures/market/funding_rate/batch").get("data") or [])

    def get_kline(
        self,
        symbol: str,
        interval: str = "5m",
        limit: int = 100,
        price_type: str = "LAST_PRICE",
    ) -> list[dict[str, Any]]:
        return list(
            self.get_json(
                "/api/v1/futures/market/kline",
                {
                    "symbol": symbol,
                    "interval": interval,
                    "limit": min(limit, 200),
                    "type": price_type,
                },
            ).get("data")
            or []
        )

    def get_depth(self, symbol: str, limit: str = "50") -> dict[str, Any]:
        return dict(
            self.get_json(
                "/api/v1/futures/market/depth",
                {
                    "symbol": symbol.upper(),
                    "limit": limit,
                },
            ).get("data")
            or {}
        )

    def place_order(
        self,
        api_key: str,
        secret_key: str,
        order: dict[str, Any],
    ) -> dict[str, Any]:
        return self.signed_json(
            "POST",
            "/api/v1/futures/trade/place_order",
            api_key=api_key,
            secret_key=secret_key,
            body=order,
        )

    def scan_all_markets(self) -> list[PerpMarket]:
        # Parallelize API calls instead of sequential requests
        with ThreadPoolExecutor(max_workers=3) as executor:
            pairs_future = executor.submit(self.get_trading_pairs)
            tickers_future = executor.submit(self.get_tickers)
            fundings_future = executor.submit(self.get_funding_rates)
            
            pairs = pairs_future.result()
            tickers = {item.get("symbol"): item for item in tickers_future.result()}
            fundings = {item.get("symbol"): item for item in fundings_future.result()}
        
        markets = [
            PerpMarket.from_api(pair, tickers.get(pair.get("symbol")), fundings.get(pair.get("symbol")))
            for pair in pairs
            if pair.get("symbol")
        ]
        return sorted(markets, key=lambda item: item.symbol)
