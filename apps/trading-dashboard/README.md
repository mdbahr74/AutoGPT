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

### Data sources

The backend tries these in order and tags each pane with the one it used:

1. **`binance`** — Binance.com. Real taker-buy delta, but **geo-blocked in the
   US** (returns 403), so US users fall through to the next source.
2. **`binance.us`** — Binance.US. Same real delta, US-legal, fewer coins.
3. **`bybit` / `bybit-perp`** — Bybit spot, then linear perps (covers almost
   everything, including small-cap perps). Bybit klines have no taker split, so
   delta is **estimated** from each candle's close location (`Δ est` in the
   readout) until live trade-stream delta lands in a later stage.
4. **`demo`** — deterministic offline candles so the UI still runs with no
   network. Tagged `demo` in amber.

## Roadmap

- Live websocket so the current candle and delta tick in real time.
- Profile refinements (developing value area, naked POCs across sessions).

## Notes

This app intentionally avoids TradingView branding and proprietary assets. It
uses the open-source Lightweight Charts library for chart rendering.
