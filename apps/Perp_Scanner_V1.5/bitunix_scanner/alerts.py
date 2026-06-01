from __future__ import annotations

import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

from .config import ScannerConfig
from .models import Alert, PerpMarket


PARAMETER_KEYS = {
    "symbolStatus": "status",
    "minTradeVolume": "minimum trade volume",
    "maxLimitOrderVolume": "maximum limit order volume",
    "maxMarketOrderVolume": "maximum market order volume",
    "basePrecision": "base precision",
    "quotePrecision": "quote precision",
    "maxLeverage": "maximum leverage",
    "minLeverage": "minimum leverage",
    "defaultLeverage": "default leverage",
    "defaultMarginMode": "default margin mode",
    "priceProtectScope": "price protection scope",
}


def evaluate_market_alerts(
    market: PerpMarket,
    previous_symbol: dict[str, Any] | None,
    initialized: bool,
    config: ScannerConfig,
    ts: int,
) -> list[Alert]:
    alerts: list[Alert] = []

    if previous_symbol is None:
        if initialized or config.alert_on_first_run:
            alerts.append(
                Alert(
                    ts=ts,
                    level="critical",
                    kind="new_listing",
                    symbol=market.symbol,
                    title=f"New Bitunix perp listed: {market.symbol}",
                    message=(
                        f"{market.symbol} is now in Bitunix futures with max leverage "
                        f"{market.max_leverage}x and status {market.status}."
                    ),
                    payload={"market": market.to_snapshot(), "fingerprint": "first_seen"},
                )
            )
    else:
        previous_pair = previous_symbol.get("pair") or {}
        for key, label in PARAMETER_KEYS.items():
            old = previous_pair.get(key)
            new = market.pair_payload.get(key)
            if old != new:
                level = "warning"
                if key in {"symbolStatus", "maxLeverage", "priceProtectScope"}:
                    level = "critical"
                alerts.append(
                    Alert(
                        ts=ts,
                        level=level,
                        kind="parameter_change",
                        symbol=market.symbol,
                        title=f"{market.symbol} {label} changed",
                        message=f"{label.title()} changed from {old!r} to {new!r}.",
                        payload={
                            "field": key,
                            "old": old,
                            "new": new,
                            "fingerprint": f"{key}:{old}->{new}",
                        },
                    )
                )

    if abs(market.funding_rate) >= config.funding_rate_abs_threshold:
        direction = "positive" if market.funding_rate > 0 else "negative"
        alerts.append(
            Alert(
                ts=ts,
                level="warning",
                kind="funding_extreme",
                symbol=market.symbol,
                title=f"{market.symbol} funding is {market.funding_rate:.4%}",
                message=(
                    f"Funding is unusually {direction} at {market.funding_rate:.4%} "
                    f"on a {market.funding_interval_hours}h interval."
                ),
                payload={
                    "funding_rate": market.funding_rate,
                    "funding_interval_hours": market.funding_interval_hours,
                    "next_funding_time": market.next_funding_time,
                    "fingerprint": direction,
                },
            )
        )

    if abs(market.price_change_pct) >= config.price_change_pct_threshold:
        direction = "up" if market.price_change_pct > 0 else "down"
        alerts.append(
            Alert(
                ts=ts,
                level="warning",
                kind="price_move",
                symbol=market.symbol,
                title=f"{market.symbol} moved {market.price_change_pct:.2f}% in 24h",
                message=(
                    f"Last price {market.last_price:g} is {direction} "
                    f"{abs(market.price_change_pct):.2f}% from the 24h open."
                ),
                payload={
                    "last_price": market.last_price,
                    "open_price": market.open_price,
                    "price_change_pct": market.price_change_pct,
                    "fingerprint": direction,
                },
            )
        )

    if config.quote_volume_threshold > 0 and market.quote_volume >= config.quote_volume_threshold:
        alerts.append(
            Alert(
                ts=ts,
                level="info",
                kind="volume_surge",
                symbol=market.symbol,
                title=f"{market.symbol} volume above threshold",
                message=f"24h quote volume is {market.quote_volume:,.0f} {market.quote}.",
                payload={
                    "quote_volume": market.quote_volume,
                    "threshold": config.quote_volume_threshold,
                    "fingerprint": "high_volume",
                },
            )
        )

    if (
        config.low_volume_threshold > 0
        and market.status == "OPEN"
        and 0 < market.quote_volume <= config.low_volume_threshold
    ):
        alerts.append(
            Alert(
                ts=ts,
                level="info",
                kind="low_liquidity",
                symbol=market.symbol,
                title=f"{market.symbol} has thin 24h volume",
                message=f"24h quote volume is only {market.quote_volume:,.0f} {market.quote}.",
                payload={
                    "quote_volume": market.quote_volume,
                    "threshold": config.low_volume_threshold,
                    "fingerprint": "low_volume",
                },
            )
        )

    return alerts


class AlertSink:
    def emit(self, alert: Alert) -> None:
        raise NotImplementedError


class ConsoleSink(AlertSink):
    def emit(self, alert: Alert) -> None:
        print(f"[{alert.level.upper()}] {alert.title} - {alert.message}", file=sys.stderr)


class JsonlSink(AlertSink):
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)

    def emit(self, alert: Alert) -> None:
        with self.path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(alert.to_dict(), sort_keys=True) + "\n")


class WebhookSink(AlertSink):
    def __init__(self, urls: tuple[str, ...], timeout_seconds: int = 10) -> None:
        self.urls = urls
        self.timeout_seconds = timeout_seconds

    def emit(self, alert: Alert) -> None:
        if not self.urls:
            return
        body = json.dumps({"text": alert.title, "alert": alert.to_dict()}).encode("utf-8")
        for url in self.urls:
            request = urllib.request.Request(
                url,
                data=body,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            try:
                urllib.request.urlopen(request, timeout=self.timeout_seconds).close()
            except (urllib.error.HTTPError, urllib.error.URLError) as exc:
                print(f"Webhook failed for {url}: {exc}", file=sys.stderr)


def build_sinks(config: ScannerConfig) -> list[AlertSink]:
    return [
        ConsoleSink(),
        JsonlSink(config.alerts_jsonl),
        WebhookSink(config.webhook_urls, config.request_timeout_seconds),
    ]
