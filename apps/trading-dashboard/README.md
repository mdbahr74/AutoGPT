# Crypto Order-Flow Terminal

A locally runnable, TradingView-inspired multi-chart terminal focused on
**order flow**: volume profile, cumulative delta, VWAP, moving averages, and
order blocks. No oscillators.

## Features

- Dark responsive grid with 1, 2, 4, 6, or 8 simultaneous chart panes.
- Per-pane symbol (any Binance USDT pair) and timeframe (1m → 1M).
- Candlestick charts rendered with TradingView Lightweight Charts.
- **Volume profile** with real Point of Control (POC) and 70% value area
  (VAH / VAL):
  - **VRVP** – visible-range profile that recomputes as you scroll/zoom.
  - **Fixed daily profiles** – a compact profile anchored to each UTC day.
- **Session VWAP** (resets each UTC day) and **moving averages** (EMA 20 / 50).
- **Order blocks** – bullish/bearish zones drawn from price action.
- **Cumulative delta** in a time-synced bottom pane (locked crosshair + axis to
  the price chart), plus optional buy/sell-colored volume.

## Why crypto only

Real buy/sell **delta** requires knowing which trades hit the bid vs the ask.
Binance exposes taker-buy volume per candle for free, so delta and cumulative
delta are computed from real data. Equity feeds do not provide this for free,
so this terminal is crypto-focused on purpose.

## Run locally

From this directory:

```bash
python app.py
```

Then open <http://127.0.0.1:5000>. No dependencies are required — the backend
uses only the Python standard library.

> Internet access is required for live Binance data and the CDN-hosted chart
> library. If Binance is unreachable, the backend returns deterministic demo
> candles (with synthetic delta) so the UI still runs; panes are tagged `demo`.

## Roadmap

- Live websocket so the current candle and delta tick in real time.
- Profile refinements (developing value area, naked POCs across sessions).

## Notes

This app intentionally avoids TradingView branding and proprietary assets. It
uses the open-source Lightweight Charts library for chart rendering.
