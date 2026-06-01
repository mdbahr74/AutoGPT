# OpenClaw Bitunix Scout Agent

This is the scheduled agent setup for Matt's Bitunix-only perp scanner.

## Running Scanner

Expected local scanner URL:

```text
http://127.0.0.1:8765
```

Current dashboard command:

```bash
cd '/mnt/Data_1/home/matt/Projects/Working on_Backup/Bitunix_Scanner_V1'
python3 -m bitunix_scanner dashboard --host 127.0.0.1 --port 8765
```

## Local Scan Command

Quick scan:

```bash
python3 scripts/agent_scan.py quick --limit 5
```

Detailed scan:

```bash
python3 scripts/agent_scan.py detailed --limit 8
```

## Scheduled Jobs

Created OpenClaw cron jobs:

- `Bitunix Scout - quick 15m`
  - Job ID: `d7a39b3d-5fe4-4c0d-9d4c-7e2d70a6c306`
  - Schedule: every 15 minutes, Detroit time
  - Command: `python3 scripts/agent_scan.py quick --limit 5`

- `Bitunix Scout - detailed 30m`
  - Job ID: `b6163783-f023-4576-9af7-49142fff982d`
  - Schedule: minute 0 and 30 every hour, Detroit time
  - Command: `python3 scripts/agent_scan.py detailed --limit 8`

Both jobs are analysis-only and include the safety rule: no live order unless Matt explicitly asks and scanner context says `live_orders=true`.

## Discord Delivery

Jobs are configured with best-effort announce delivery:

```text
channel: discord
to: bitunix-signals
```

If OpenClaw cannot resolve `bitunix-signals`, update the cron delivery target to the exact Discord channel ID/name once the channel exists.

## Discord Chat Behavior

The point of the Discord channel is not only notifications. Matt should be able to chat about a symbol or signal and have the agent pull live context from this scanner.

Expected behavior:

1. Matt asks about a symbol, e.g. `what is LAB doing?` or replies to a scout alert.
2. Agent extracts the symbol.
3. Agent calls `/api/agent/context?symbol=LABUSDT`.
4. Agent answers using order-flow/tape context first:
   - CVD
   - buy/sell quote volume
   - recent large prints
   - volume-by-price
   - short-term pullback vs 24h move
   - liquidations when CoinGlass is configured
5. Agent should keep APEX-style structured analysis as a secondary layer, not the default.

## Future Trade Rule Flow

The future direction is:

1. Scout finds a candidate.
2. Agent explains setup and risk from Bitunix order-flow context.
3. Matt can chat in Discord about the signal.
4. Matt may say something like "take it".
5. Agent must verify:
   - explicit current instruction from Matt
   - `live_orders=true`
   - scanner/order endpoint is configured
   - trade rules pass
   - risk size is within configured limits
   - order type is clear: market, limit, or staged plan
6. Only then prepare/submit an order.

Until trade rules are implemented, the agent is signal-only.

## APEX Relationship

APEX remains useful, but for a different job:

- APEX: structured trade planning, chart review, broader analysis, cleaner thesis-building.
- Bitunix Scout: spontaneous mover detection, order-flow/tape reading, Discord discussion, fast local context.

Future integrations worth borrowing from APEX:

- wallet/whale tracking
- richer market context
- CoinGlass liquidations
- more formal trade-rule validation before any `take it` action
