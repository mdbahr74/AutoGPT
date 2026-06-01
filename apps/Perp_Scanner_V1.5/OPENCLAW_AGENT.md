# OpenClaw Agent Handoff

This scanner is now usable as a read-only local market/tape context source for an OpenClaw trading agent.

## Local Base URL

```text
http://127.0.0.1:8765
```

## Agent Read Endpoints

```text
GET /api/agent/symbols
GET /api/agent/context?symbol=BTCUSDT
```

`/api/agent/context` returns:

- `market`: latest scanner/ticker snapshot
- `depth`: compact 15-level order book snapshot
- `flow`: browser-posted live tape state
  - `cvd_quote`
  - `buy_quote`
  - `sell_quote`
  - `trade_flow_pct`
  - `block_threshold_usd`
  - `large_blocks`
  - `volume_by_price`
  - `recent_trades`
- `recent_alerts`: latest scanner alerts for the symbol
- `api_config`: market/trading/key status
- `capabilities`: safe capability flags
- `safety`: live order requirements

## Browser Flow Requirement

The tape-derived flow data comes from the live symbol page. Open the page for any symbol the agent should track:

```text
http://127.0.0.1:8765/symbol/BTCUSDT?v=16
```

The page posts flow snapshots to:

```text
POST /api/agent/flow
```

If the symbol page is not open, the agent can still read market/depth/alerts, but `flow` may be empty or stale.

## Suggested Agent Instructions

Use this when wiring an OpenClaw trading/order-flow agent:

```text
You are a Bitunix futures tape-reading assistant. Use the local scanner endpoint
http://127.0.0.1:8765/api/agent/context?symbol=<SYMBOL> as your primary context.

Prioritize tape and flow over the order book during price discovery:
- CVD quote direction and slope
- buy vs sell quote volume
- recent large prints relative to the configured block threshold
- volume-by-price concentration, absorption, and failed continuation
- recent trade intensity and side clustering
- scanner alerts, 15m range, 24h move, funding, and quote volume

Treat the order book as secondary context unless it shows clear liquidity walls,
spoof-like pulling, or repeated absorption around a level.

Never place live orders unless the human explicitly asks and the context says
live_orders=true. Prefer analysis, risk notes, and dry-run order payloads.
```

## Quick Checks

```bash
curl -sS http://127.0.0.1:8765/api/agent/symbols | jq '.symbols[:5]'
curl -sS 'http://127.0.0.1:8765/api/agent/context?symbol=BTCUSDT' | jq '{symbol, flow: .flow, live_orders: .capabilities.live_orders}'
```
