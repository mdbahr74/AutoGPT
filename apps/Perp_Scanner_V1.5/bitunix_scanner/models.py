from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


def as_float(value: Any, default: float = 0.0) -> float:
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def as_int(value: Any, default: int = 0) -> int:
    if value in (None, ""):
        return default
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


@dataclass(slots=True)
class PerpMarket:
    symbol: str
    base: str = ""
    quote: str = ""
    status: str = ""
    min_trade_volume: float = 0.0
    max_limit_order_volume: float = 0.0
    max_market_order_volume: float = 0.0
    base_precision: int = 0
    quote_precision: int = 0
    min_leverage: int = 0
    max_leverage: int = 0
    default_leverage: int = 0
    default_margin_mode: str = ""
    price_protect_scope: float = 0.0
    mark_price: float = 0.0
    last_price: float = 0.0
    open_price: float = 0.0
    high_price: float = 0.0
    low_price: float = 0.0
    quote_volume: float = 0.0
    base_volume: float = 0.0
    funding_rate: float = 0.0
    funding_interval_hours: int = 0
    next_funding_time: int = 0
    pair_payload: dict[str, Any] = field(default_factory=dict)
    ticker_payload: dict[str, Any] = field(default_factory=dict)
    funding_payload: dict[str, Any] = field(default_factory=dict)

    @property
    def price_change_pct(self) -> float:
        if self.open_price == 0:
            return 0.0
        return ((self.last_price - self.open_price) / self.open_price) * 100.0

    @property
    def spread_basis_points(self) -> float:
        bid = as_float(self.ticker_payload.get("bid") or self.ticker_payload.get("bd"))
        ask = as_float(self.ticker_payload.get("ask") or self.ticker_payload.get("ak"))
        if bid <= 0 or ask <= 0:
            return 0.0
        midpoint = (bid + ask) / 2
        return ((ask - bid) / midpoint) * 10_000

    @classmethod
    def from_api(
        cls,
        pair: dict[str, Any],
        ticker: dict[str, Any] | None = None,
        funding: dict[str, Any] | None = None,
    ) -> "PerpMarket":
        ticker = ticker or {}
        funding = funding or {}
        return cls(
            symbol=str(pair.get("symbol", "")),
            base=str(pair.get("base", "")),
            quote=str(pair.get("quote", "")),
            status=str(pair.get("symbolStatus", "")),
            min_trade_volume=as_float(pair.get("minTradeVolume")),
            max_limit_order_volume=as_float(pair.get("maxLimitOrderVolume")),
            max_market_order_volume=as_float(pair.get("maxMarketOrderVolume")),
            base_precision=as_int(pair.get("basePrecision")),
            quote_precision=as_int(pair.get("quotePrecision")),
            min_leverage=as_int(pair.get("minLeverage")),
            max_leverage=as_int(pair.get("maxLeverage")),
            default_leverage=as_int(pair.get("defaultLeverage")),
            default_margin_mode=str(pair.get("defaultMarginMode", "")),
            price_protect_scope=as_float(pair.get("priceProtectScope")),
            mark_price=as_float(funding.get("markPrice") or ticker.get("markPrice")),
            last_price=as_float(ticker.get("lastPrice") or ticker.get("last") or funding.get("lastPrice")),
            open_price=as_float(ticker.get("open")),
            high_price=as_float(ticker.get("high")),
            low_price=as_float(ticker.get("low")),
            quote_volume=as_float(ticker.get("quoteVol")),
            base_volume=as_float(ticker.get("baseVol")),
            funding_rate=as_float(funding.get("fundingRate")),
            funding_interval_hours=as_int(funding.get("fundingInterval")),
            next_funding_time=as_int(funding.get("nextFundingTime")),
            pair_payload=pair,
            ticker_payload=ticker,
            funding_payload=funding,
        )

    def to_snapshot(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "base": self.base,
            "quote": self.quote,
            "status": self.status,
            "last_price": self.last_price,
            "mark_price": self.mark_price,
            "open_price": self.open_price,
            "high_price": self.high_price,
            "low_price": self.low_price,
            "quote_volume": self.quote_volume,
            "base_volume": self.base_volume,
            "price_change_pct": self.price_change_pct,
            "funding_rate": self.funding_rate,
            "funding_interval_hours": self.funding_interval_hours,
            "next_funding_time": self.next_funding_time,
            "min_trade_volume": self.min_trade_volume,
            "max_market_order_volume": self.max_market_order_volume,
            "max_limit_order_volume": self.max_limit_order_volume,
            "min_leverage": self.min_leverage,
            "max_leverage": self.max_leverage,
            "default_leverage": self.default_leverage,
            "default_margin_mode": self.default_margin_mode,
            "price_protect_scope": self.price_protect_scope,
            "base_precision": self.base_precision,
            "quote_precision": self.quote_precision,
            "pair_payload": self.pair_payload,
            "ticker_payload": self.ticker_payload,
            "funding_payload": self.funding_payload,
        }


@dataclass(slots=True)
class Alert:
    ts: int
    level: str
    kind: str
    symbol: str
    title: str
    message: str
    payload: dict[str, Any] = field(default_factory=dict)

    @property
    def fingerprint(self) -> str:
        payload_key = self.payload.get("fingerprint")
        if payload_key:
            return f"{self.kind}:{self.symbol}:{payload_key}"
        return f"{self.kind}:{self.symbol}:{self.title}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "ts": self.ts,
            "level": self.level,
            "kind": self.kind,
            "symbol": self.symbol,
            "title": self.title,
            "message": self.message,
            "payload": self.payload,
        }
