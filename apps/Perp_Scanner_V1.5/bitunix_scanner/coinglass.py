from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from typing import Any


class CoinglassApiError(RuntimeError):
    pass


class CoinglassClient:
    base_url = "https://open-api-v4.coinglass.com"

    def __init__(self, api_key: str | None = None, timeout_seconds: int = 15) -> None:
        self.api_key = api_key if api_key is not None else os.getenv("COINGLASS_API_KEY", "")
        self.timeout_seconds = timeout_seconds

    @property
    def configured(self) -> bool:
        return bool(self.api_key)

    def get_json(self, path: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        if not self.api_key:
            raise CoinglassApiError("Set COINGLASS_API_KEY to load CoinGlass liquidation data.")
        query = ""
        if params:
            clean = {k: v for k, v in params.items() if v not in (None, "")}
            query = "?" + urllib.parse.urlencode(clean)
        request = urllib.request.Request(
            f"{self.base_url}{path}{query}",
            headers={
                "Accept": "application/json",
                "CG-API-KEY": self.api_key,
                "User-Agent": "bitunix-perp-scanner/0.1",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            raise CoinglassApiError(f"CoinGlass HTTP {exc.code}: {body}") from exc
        except urllib.error.URLError as exc:
            raise CoinglassApiError(f"CoinGlass request failed: {exc.reason}") from exc
        except json.JSONDecodeError as exc:
            raise CoinglassApiError("CoinGlass returned invalid JSON") from exc
        code = str(payload.get("code", "0"))
        if code not in {"0", "200"}:
            raise CoinglassApiError(f"CoinGlass API error: {payload}")
        return payload

    def liquidation_exchange_list(self, coin: str, range_: str = "4h") -> dict[str, Any]:
        return self.get_json(
            "/api/futures/liquidation/exchange-list",
            {
                "symbol": coin.upper(),
                "range": range_,
            },
        )

    def liquidation_history(
        self,
        coin: str,
        interval: str = "5m",
        limit: int = 48,
        exchange_list: str = "Bitunix",
    ) -> dict[str, Any]:
        return self.get_json(
            "/api/futures/liquidation/aggregated-history",
            {
                "exchange_list": exchange_list,
                "symbol": coin.upper(),
                "interval": interval,
                "limit": min(max(limit, 1), 1000),
            },
        )
