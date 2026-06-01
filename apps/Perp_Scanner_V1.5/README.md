# Bitunix Perp Scanner

A Bitunix-only perpetual futures scanner. It polls the official public futures API, stores snapshots locally, and alerts on new listings, missing symbols, contract parameter changes, funding extremes, price moves, and volume/liquidity thresholds.

## What It Uses

Official Bitunix futures REST endpoints:

- `GET /api/v1/futures/market/trading_pairs`
- `GET /api/v1/futures/market/tickers`
- `GET /api/v1/futures/market/funding_rate/batch`
- Optional per-symbol kline support via `GET /api/v1/futures/market/kline`

The public docs currently expose tickers, funding, klines, depth, and websocket channels. I did not find official public endpoints for open interest, long/short ratios, top-trader ratios, or liquidation maps, so those are not fabricated here.

## Quick Start

```bash
python3 -m bitunix_scanner scan --ai
python3 -m bitunix_scanner dashboard --once
```

Open `http://127.0.0.1:8765` for the dashboard.

Desktop mode, with an independent Electron zoom setting and detachable widget windows:

```bash
npm install
npm run electron
```

Electron starts the same local Python dashboard, defaults to a 70% view zoom, and adds a View menu with 70/80/90/100% presets. In Layout mode, widget headers and the Widgets menu include Detach controls that open a focused widget window.

Click any symbol, or press Enter in the dashboard symbol search, to open a detail page:

```text
http://127.0.0.1:8765/symbol/BTCUSDT
```

The detail page includes contract stats, Bitunix REST order book depth with quote-volume bars, and live public websocket time-and-sales/depth streams.
It also includes local Bitunix market-pressure stats. CoinGlass liquidation data is optional and requires `COINGLASS_API_KEY`.

## Commands

```bash
python3 -m bitunix_scanner scan
python3 -m bitunix_scanner watch --interval 60
python3 -m bitunix_scanner markets --limit 50
python3 -m bitunix_scanner alerts --limit 50
python3 -m bitunix_scanner brief
python3 -m bitunix_scanner dashboard --host 127.0.0.1 --port 8765 --interval 60 --once
```

## Configuration

Set environment variables as needed:

```bash
BITUNIX_DB=data/bitunix_scanner.sqlite3
ALERTS_JSONL=data/alerts.jsonl
SCAN_INTERVAL_SECONDS=60
ALERT_ON_FIRST_RUN=false
ALERT_COOLDOWN_SECONDS=3600
PRICE_CHANGE_PCT_THRESHOLD=12
FUNDING_RATE_ABS_THRESHOLD=0.01
QUOTE_VOLUME_THRESHOLD=50000000
LOW_VOLUME_THRESHOLD=25000
WEBHOOK_URLS=https://example.com/webhook
AI_PROVIDER=rules
```

For an optional OpenAI-generated brief:

```bash
AI_PROVIDER=openai
OPENAI_API_KEY=...
OPENAI_MODEL=...
```

If `OPENAI_API_KEY` or `OPENAI_MODEL` is missing, the scanner falls back to local rule-based briefs.

Optional CoinGlass liquidation panel:

```bash
COINGLASS_API_KEY=...
```

Optional Bitunix trading order ticket:

```bash
BITUNIX_API_KEY=...
BITUNIX_SECRET_KEY=...
TRADING_ENABLED=false
TRADING_DRY_RUN=true
```

The order ticket always dry-runs unless `TRADING_ENABLED=true` and `TRADING_DRY_RUN=false` are both set.
The margin/liquidation calculator is an estimate for fast sizing decisions. Real liquidation can differ because exchange maintenance tiers, fees, funding, cross-margin balances, position mode, and open PnL are account-specific.

Agent/OpenClaw-style read endpoints:

```text
GET  /api/agent/symbols
GET  /api/agent/context?symbol=BTCUSDT
POST /api/agent/flow
```

The browser posts live tape-derived flow data to `/api/agent/flow`, including CVD, volume-by-price, recent large blocks, and recent trades. Agents should treat order placement as high risk and use the dry-run order endpoint unless live trading is explicitly enabled.

See `OPENCLAW_AGENT.md` for the local handoff prompt, endpoint contract, and quick checks.
