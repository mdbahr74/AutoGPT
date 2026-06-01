# Bitunix Scanner Concept

Matt's intended direction: a Bitunix-only perp scanner focused on finding active trade opportunities from the actual exchange he uses most.

## Core Idea

Use Bitunix as the source of truth. List every Bitunix perpetual contract, rank the ones with unusually large daily moves, then monitor short-term pullbacks and order-flow conditions to decide whether anything is worth looking at.

This should not become a generic crypto dashboard. The value is fast discovery of Bitunix-listed perps that are moving now, especially when they are in price discovery or making violent pullbacks after large moves.

This is intentionally different from APEX. APEX is still useful for more structured trade planning, chart review, and broader context. This scanner/agent should be more spontaneous and order-flow-first: keep watching Bitunix movers, let Matt chat about a symbol in Discord, and answer from the live scanner/tape context directly.

## Main Scan Types

### 1. Big Daily Movers

Find all Bitunix perps with major 24h movement:

- strong 24h % gainers
- strong 24h % losers
- high quote volume
- fresh/new listings or recently active symbols
- large 15m range compared with normal behavior
- funding extremes when available

Goal: quickly answer, "What is alive on Bitunix right now?"

### 2. Short-Term Pullbacks After Big Moves

This is the key scanner behavior Matt described from the UI: the table may show a perp is up huge on the day, but the hover popup / mini sparkline / short-term columns show it is currently red. That contrast is often the interesting part.

For symbols already up/down heavily on the day, look for pullbacks on short windows:

- up huge on 24h, but short-term scan delta is red
- green daily move with red hover/mini-chart/sparkline
- high 15m range while the current pullback is still controlled
- moved up big on the day, now pulling back 1m/5m/15m
- moved down big on the day, now bouncing or squeezing
- pullback into volume-by-price concentration
- CVD diverging from price
- large prints appearing during pullback
- buy/sell flow changing near local high/low

Goal: find tradeable reset areas rather than chasing the first vertical candle. The agent should explicitly score the mismatch: `daily green + short-term red` or `daily red + short-term green`.

### 3. Tape / Flow Confirmation

For top candidates, use live symbol pages to collect tape-derived state:

- CVD quote
- buy quote volume vs sell quote volume
- large block count
- repeated large prints by side
- volume-by-price profile
- recent trade clustering
- aggressive buy/sell bursts
- absorption signs near a level

In price discovery, Time & Sales and flow matter more than a full-size order book. The order book should stay compact unless it shows clear walls, pulls, or absorption.

## Agent Loop

An OpenClaw agent should periodically:

1. Poll `/api/agent/symbols`.
2. Rank all Bitunix perps by opportunity score.
3. Identify symbols with:
   - large daily move
   - high volume
   - short-term pullback
   - high 15m range
   - funding/alert anomaly if available
4. For top symbols, poll `/api/agent/context?symbol=<SYMBOL>`.
5. If a live symbol page is open, use flow data too.
6. Return a short watchlist, not a wall of noise.

## Suggested Ranking Score

Start simple:

```text
score =
  abs(24h_move_pct) weight
+ quote_volume_rank weight
+ 15m_range_pct weight
+ abs(scan_move_pct) weight
+ alert_bonus
+ flow_bonus if tape data exists
```

Then split into two modes:

### Momentum / Rocket Mode

Looks for:

- big 24h gain
- strong quote volume
- pullback not full collapse
- CVD still positive or recovering
- large buy prints returning
- price holding above high-volume areas

### Washout / Bounce Mode

Looks for:

- big 24h loss
- panic volume
- selling slowing down
- CVD divergence
- large buy absorption
- failed breakdown or reclaim

## Agent Output Format

The agent should keep this tight:

```text
Bitunix Watchlist

1. SYMBOL - reason
   Move: +X%  15m range: Y%  Volume: $Z
   Pullback: -A% from recent scan/high
   Flow: CVD +/-, large blocks buy/sell, notable volume-by-price level
   Read: momentum continuation / pullback bounce / avoid

2. SYMBOL - reason
...

Nothing worth forcing if edge is weak.
```

## Safety

- Scanner and agent should be analysis-first.
- No live orders unless Matt explicitly asks.
- Dry-run order payloads are okay for planning.
- If live trading is enabled, agent must still require explicit human confirmation.

## Next Build Steps

1. Add scanner-side candidate scoring for big movers plus pullbacks.
2. Add `/api/agent/candidates` with ranked Bitunix-only opportunities.
3. Add mode filters: `rocket`, `washout`, `pullback`, `all`.
4. Add stale-flow detection so the agent knows whether live tape is fresh.
5. Add an OpenClaw polling job/agent that checks every 5-15 minutes during active trading windows.
6. Add Discord chat affordance: Matt can ask about a symbol/signals channel and the agent should pull `/api/agent/context?symbol=...` before answering.
7. Set up CoinGlass liquidation data for liquidation context.
8. Add APEX-style extras where they fit, especially wallet/whale tracking and richer market context, without turning this into the structured APEX workflow.
9. Add audio/tape improvements for big blocks and repeated sweeps.
