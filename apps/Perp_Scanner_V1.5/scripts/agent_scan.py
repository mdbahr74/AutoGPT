#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import sys
import time
import urllib.parse
import urllib.request
from typing import Any

BASE_URL = "http://127.0.0.1:8765"


def get_json(path: str, timeout: int = 15) -> dict[str, Any]:
    url = BASE_URL + path
    with urllib.request.urlopen(url, timeout=timeout) as response:  # noqa: S310 local-only URL
        return json.loads(response.read().decode("utf-8"))


def n(item: dict[str, Any], key: str) -> float:
    try:
        value = item.get(key)
        return float(value) if value not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


def compact_usd(value: float) -> str:
    sign = "-" if value < 0 else ""
    value = abs(value)
    if value >= 1_000_000_000:
        return f"{sign}${value / 1_000_000_000:.2f}B"
    if value >= 1_000_000:
        return f"{sign}${value / 1_000_000:.2f}M"
    if value >= 1_000:
        return f"{sign}${value / 1_000:.1f}K"
    return f"{sign}${value:.0f}"


def pct(value: float) -> str:
    return f"{value:+.2f}%"


def classify(market: dict[str, Any]) -> tuple[str, list[str], float]:
    move = n(market, "price_change_pct")
    scan = n(market, "scan_price_change_pct")
    spark = n(market, "sparkline_change_pct")
    range15 = n(market, "range_15m_pct")
    vol = n(market, "quote_volume")
    vol_delta = n(market, "scan_quote_volume_delta")
    reasons: list[str] = []
    setup = "active"

    abs_move = abs(move)
    vol_score = math.log10(max(vol, 1)) * 2.2
    score = abs_move * 1.8 + range15 * 6.0 + abs(scan) * 7.0 + max(0.0, vol_score)
    if vol_delta > 0:
        score += math.log10(max(vol_delta, 1)) * 1.2

    if move >= 20 and (scan < -0.25 or spark < -0.5):
        setup = "momentum pullback"
        score += 35 + min(45, move * 0.25) + min(25, abs(scan) * 6)
        reasons.append("daily green + short-term red")
    elif move <= -12 and (scan > 0.25 or spark > 0.5):
        setup = "washout bounce"
        score += 30 + min(35, abs(move) * 0.25) + min(25, scan * 6)
        reasons.append("daily red + short-term green")
    elif move >= 20:
        setup = "rocket"
        score += 18
        reasons.append("large 24h gainer")
    elif move <= -12:
        setup = "washout"
        score += 15
        reasons.append("large 24h loser")

    if range15 >= 2:
        reasons.append("wide 15m range")
        score += 10
    if vol >= 5_000_000:
        reasons.append("strong quote volume")
        score += 10
    elif vol < 250_000:
        reasons.append("thin volume caution")
        score -= 18
    if abs(scan) >= 1:
        reasons.append("fresh scan move")
    if not reasons:
        reasons.append("active but no clean mismatch")
    return setup, reasons, score


def enrich_flow(symbol: str) -> dict[str, Any]:
    try:
        return get_json("/api/agent/context?" + urllib.parse.urlencode({"symbol": symbol}), timeout=10)
    except Exception as exc:  # noqa: BLE001 local scanner may not have symbol page open
        return {"error": str(exc)}


def flow_line(context: dict[str, Any]) -> str:
    flow = context.get("flow") or {}
    if not flow:
        return "Flow: no fresh browser tape yet"
    age = ""
    server_ts = flow.get("server_ts")
    if server_ts:
        seconds = max(0, int(time.time() - (float(server_ts) / 1000)))
        age = f", age {seconds}s"
    cvd = float(flow.get("cvd_quote") or 0)
    buy = float(flow.get("buy_quote") or 0)
    sell = float(flow.get("sell_quote") or 0)
    blocks = len(flow.get("large_blocks") or [])
    return f"Flow: CVD {compact_usd(cvd)}, buy {compact_usd(buy)}, sell {compact_usd(sell)}, blocks {blocks}{age}"


def build_scan(mode: str, limit: int) -> str:
    symbols = get_json("/api/agent/symbols").get("symbols") or []
    ranked = []
    for market in symbols:
        setup, reasons, score = classify(market)
        market = dict(market)
        market["setup"] = setup
        market["reasons"] = reasons
        market["score"] = score
        ranked.append(market)
    ranked.sort(key=lambda item: item["score"], reverse=True)
    picks = ranked[:limit]

    title = "Bitunix Quick Scout" if mode == "quick" else "Bitunix Detailed Scout"
    lines = [f"{title} - {time.strftime('%H:%M:%S')}", ""]
    if not picks:
        return f"{title}: no candidates returned by scanner."

    for idx, item in enumerate(picks, start=1):
        symbol = str(item.get("symbol"))
        move = n(item, "price_change_pct")
        scan = n(item, "scan_price_change_pct")
        spark = n(item, "sparkline_change_pct")
        range15 = n(item, "range_15m_pct")
        vol = n(item, "quote_volume")
        setup = item["setup"]
        reasons = ", ".join(item["reasons"][:3])
        lines.append(
            f"{idx}. {symbol} - {setup} | 24h {pct(move)} | short {pct(scan)} | spark {pct(spark)} | 15m {range15:.2f}% | vol {compact_usd(vol)}"
        )
        lines.append(f"   Read: {reasons}")
        if mode == "detailed" and idx <= 6:
            context = enrich_flow(symbol)
            lines.append(f"   {flow_line(context)}")
            alerts = context.get("recent_alerts") or [] if isinstance(context, dict) else []
            if alerts:
                lines.append(f"   Alert: {alerts[0].get('title', 'recent alert')}")
    lines.append("")
    lines.append("Rule: notify only when daily move and short-term action create a real look. Analysis only, no live order unless Matt explicitly says take it.")
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description="Bitunix OpenClaw scout scan")
    parser.add_argument("mode", choices=["quick", "detailed"], nargs="?", default="quick")
    parser.add_argument("--limit", type=int, default=5)
    args = parser.parse_args()
    print(build_scan(args.mode, args.limit))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
