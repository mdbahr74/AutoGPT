from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


def rule_based_brief(markets: list[dict[str, Any]], alerts: list[dict[str, Any]]) -> str:
    if not markets:
        return "No market snapshot is available yet."

    top_funding = sorted(markets, key=lambda item: abs(float(item.get("funding_rate") or 0)), reverse=True)[:5]
    top_movers = sorted(markets, key=lambda item: abs(float(item.get("price_change_pct") or 0)), reverse=True)[:5]
    top_volume = sorted(markets, key=lambda item: float(item.get("quote_volume") or 0), reverse=True)[:5]
    open_count = sum(1 for item in markets if item.get("status") == "OPEN")

    lines = [
        f"Bitunix scan covers {len(markets)} futures markets; {open_count} are OPEN.",
        "Largest absolute funding: "
        + ", ".join(f"{item['symbol']} {float(item.get('funding_rate') or 0):.3%}" for item in top_funding),
        "Largest 24h moves: "
        + ", ".join(f"{item['symbol']} {float(item.get('price_change_pct') or 0):.2f}%" for item in top_movers),
        "Highest 24h quote volume: "
        + ", ".join(f"{item['symbol']} {float(item.get('quote_volume') or 0):,.0f}" for item in top_volume),
    ]

    fresh_alerts = alerts[:5]
    if fresh_alerts:
        lines.append(
            "Most recent alerts: "
            + "; ".join(f"{item['symbol']} {item['kind']} ({item['level']})" for item in fresh_alerts)
        )
    return "\n".join(lines)


def openai_brief(markets: list[dict[str, Any]], alerts: list[dict[str, Any]], model: str) -> str:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return rule_based_brief(markets, alerts) + "\n\nOPENAI_API_KEY is not set, so this used local rules."
    if not model:
        return rule_based_brief(markets, alerts) + "\n\nOPENAI_MODEL is not set, so this used local rules."

    payload = {
        "model": model,
        "input": [
            {
                "role": "system",
                "content": (
                    "You are a crypto perpetual futures scanner analyst. Use only the supplied "
                    "Bitunix API-derived data. Be concise, flag risk, and avoid trade guarantees."
                ),
            },
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "markets": markets[:80],
                        "recent_alerts": alerts[:30],
                    },
                    sort_keys=True,
                ),
            },
        ],
        "max_output_tokens": 550,
    }
    request = urllib.request.Request(
        "https://api.openai.com/v1/responses",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            data = json.loads(response.read().decode("utf-8"))
    except (urllib.error.HTTPError, urllib.error.URLError, json.JSONDecodeError) as exc:
        return rule_based_brief(markets, alerts) + f"\n\nOpenAI brief failed: {exc}"

    output_text = data.get("output_text")
    if output_text:
        return str(output_text)
    chunks: list[str] = []
    for item in data.get("output", []):
        for content in item.get("content", []):
            if content.get("type") in {"output_text", "text"} and content.get("text"):
                chunks.append(str(content["text"]))
    return "\n".join(chunks).strip() or rule_based_brief(markets, alerts)


def build_brief(
    markets: list[dict[str, Any]],
    alerts: list[dict[str, Any]],
    provider: str = "rules",
    model: str = "",
) -> str:
    if provider == "openai":
        return openai_brief(markets, alerts, model)
    return rule_based_brief(markets, alerts)
