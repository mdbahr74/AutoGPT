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
- **Watchlist** (left sidebar) with live last-price + 24h change from Bitunix.
  Click a row to load it in the active chart; add/remove symbols; persists in
  your browser.
- **Bitunix account panel** (read-only): available balance, margin, unrealized
  PnL, and open positions.
- Dark theme tuned to match TradingView's colors.

## Run it

Needs **Node 18+** (for the backend that signs Bitunix requests and serves the
app). No npm packages to install — the backend is zero-dependency.

```bash
cd tradingview-dashboard
npm start          # or: node server.js
# then open http://localhost:5173
```

### Connect Bitunix (optional, for account + watchlist prices)

1. Create **read-only** API keys in your Bitunix account.
2. Copy `.env.example` to `.env` and fill them in:
   ```bash
   cp .env.example .env
   ```
   ```ini
   BITUNIX_API_KEY=your_key
   BITUNIX_API_SECRET=your_secret
   ```
3. Restart the server. The account panel will populate.

> The secret stays on the backend and is used only to **sign** requests — it is
> never sent to the browser. The watchlist's live prices use Bitunix's *public*
> market data and work even without keys. Charts come from TradingView and work
> regardless.

`.env` is git-ignored so your keys are never committed.

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
