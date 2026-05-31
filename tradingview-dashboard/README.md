# Charts — a free "TradingView Plus" replacement

A self-hosted, multi-chart trading dashboard that recreates the paid
**TradingView Plus** multi-chart layouts and advanced indicators — for free.

## Why this matches TradingView exactly

It embeds **TradingView's own free Advanced Chart widget** in each pane. So
every chart *is* a real TradingView chart: identical look, live data, all
drawing tools, and the **entire indicator library** (via the chart's `fx`
button). The only thing TradingView charges for in *Plus* is showing several
charts at once — which we recreate by tiling multiple free widgets in a grid.

> If you've tried to "clone" TradingView with a charting library before and it
> never looked right, this is why: those libraries can't reproduce TradingView's
> proprietary UI. Embedding the real widget does.

## Features

- **Opens as a single full-screen chart** (your chosen default).
- **Layout switcher** in the toolbar: 1 chart, 2 (rows/columns), 3, or 2×2.
- **Per-pane symbols** — click a pane to focus it, then type a symbol.
- **Interval buttons**: 1m / 5m / 15m / 1h / 4h / 1D / 1W.
- **Indicator presets**: Default, Trend, Momentum, Volatility, Clean — and you
  can add *any* indicator directly on the chart with the `fx` button.
- Dark theme tuned to match TradingView's colors.

## Run it

No build step, no dependencies. Just serve the folder (the TradingView script
needs http/https, not `file://`):

```bash
cd tradingview-dashboard
python3 -m http.server 5173
# then open http://localhost:5173
```

Or with Node:

```bash
npx serve tradingview-dashboard
```

## Usage

| Action                | How                                                        |
| --------------------- | --------------------------------------------------------- |
| Change symbol         | Click a pane to focus it, type in the search box, Enter   |
| Switch layout         | Toolbar layout buttons (top right)                        |
| Change timeframe      | Toolbar interval buttons                                   |
| Swap indicator set    | "Indicators" dropdown                                      |
| Add any indicator     | Click the `fx` button inside any chart                    |
| Draw / annotate       | Use the left toolbar inside any chart                      |

Symbols use TradingView's `EXCHANGE:TICKER` format, e.g. `BINANCE:BTCUSDT`,
`NASDAQ:AAPL`, `FOREXCOM:SPXUSD`, `COINBASE:ETHUSD`.

## Customize

- **Default symbols / layout / interval** → top of `app.js` (`state` object).
- **Indicator presets** → `PRESETS` in `app.js`.
- **Colors / theme** → CSS variables at the top of `styles.css`.

## Note

Uses TradingView's free embeddable widgets under their terms of service. This is
a personal dashboard around those widgets, not a redistribution of TradingView's
paid product.
