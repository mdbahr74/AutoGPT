# Trading Dashboard App Requirements

This document captures requirements derived from the supplied video transcript for a TradingView-inspired local web app. The goal is to build a similar feature set and appearance without copying proprietary branding, logos, or paid assets.

## Product goal

Build a locally runnable web application that displays configurable, simultaneous live trading charts for crypto, US stocks, and Indian stocks. The app should support multiple chart panes, multiple timeframes, unlimited indicators for an MVP, and premium-style analysis overlays such as fair value gaps and volume profile.

## Core user problems

The app is intended to address limitations commonly found in free charting tiers:

1. Only one chart can be opened at a time.
2. Premium indicators such as fair value gap and volume profile are unavailable.
3. More than two indicators cannot be added to a single chart.

## Target experience

The application should open in a browser on localhost and show a dark, professional multi-chart trading dashboard. Users can choose the number of charts, select a market category and symbol per pane, switch timeframes independently, and toggle multiple indicators.

## Supported chart layouts

Users should be able to configure the number of visible chart panes:

- 1 chart
- 2 charts
- 4 charts by default
- 6 charts
- 8 charts

The layout should be responsive and resize cleanly with the browser window. It should support viewing the same instrument across different timeframes or different instruments across the same screen.

## Markets and data sources

### Markets

The app should support:

- Crypto
- US stocks
- Indian stocks, including NSE and BSE tickers

### Data providers

Initial implementation should use free/open data sources where possible:

- Hyperliquid WebSocket/API for live crypto prices and candles.
- Yahoo Finance, via `yfinance` or Yahoo chart endpoints, for US and Indian stock market data.

The data layer should be pluggable so future providers can be added, such as:

- Alpaca for US stocks
- Zerodha for Indian stocks
- Upstox for Indian stocks
- Binance for crypto
- Coinbase for crypto

### Market status indicators

The UI should show provider/market status labels such as:

- `HL Live` for live Hyperliquid crypto data
- `US Market Closed` or live/open status
- `Indian Market Closed` or live/open status

## Chart pane controls

Each chart pane should include controls for:

1. Market type selection, such as crypto, US stock, or Indian stock.
2. Symbol search/input.
3. Timeframe selection.
4. Indicator selection.
5. Current/last price display.
6. Live or closed market status where applicable.

Example interactions from the transcript:

- Select Indian stocks and search for `Reliance`.
- Select crypto and search for `BTC`, `SOL`, or `ETH`.
- Select US stocks and search for `AAPL` or `TSLA`.
- Display the same symbol, such as Ethereum, on 5 minute, 1 hour, and daily charts simultaneously.

## Timeframes

The timeframe selector should include:

- 1 minute
- 5 minutes
- 15 minutes
- 30 minutes
- 1 hour
- Daily
- Weekly or longer intervals up to 1 month

The transcript explicitly mentions timeframe options from 1 minute through 1 month.

## Chart rendering

Use TradingView Lightweight Charts or a similar open-source financial charting engine.

Required chart features:

- Candlestick rendering
- Live candle updates for crypto
- Delayed or latest available candles for closed stock markets
- Crosshair support
- Zoom and pan
- Responsive chart resizing
- Dark theme styling
- Loading and error states per pane

## Indicators

The app should allow adding more than two indicators at once on a chart.

### Common indicators

Initial supported indicators should include:

- Bollinger Bands
- RSI
- MACD
- VWAP
- Volume
- Williams %R

### Premium-style overlays

The app should include premium-style analysis tools:

- Volume Profile
- Fair Value Gap

### Indicator behavior

Users should be able to toggle indicators on and off from an indicator menu. Multiple indicators should be visible at the same time. Overlay indicators should render on the price chart, while oscillator indicators can render in separate panes or compact sub-panels.

## Volume profile requirements

The volume profile feature should show:

- Horizontal volume distribution by price level
- Value area high (VAH)
- Point of control (POC)
- Value area low (VAL)

The transcript refers to visible `VH`, `P`, and `V` style labels/lines, interpreted here as VAH, POC, and VAL.

## Fair value gap requirements

The fair value gap overlay should identify and render price gaps:

- Green bars/regions for bullish fair value gaps in uptrends
- Red bars/regions for bearish fair value gaps in downtrends
- Regions overlaid directly on the price chart

## Appearance requirements

The visual style should be a dark trading terminal dashboard:

- Dark page background
- Thin borders between chart panes
- Compact top controls inside each pane
- High contrast bullish/bearish candle colors
- Clear chart titles and price labels
- Minimal, data-dense interface suitable for day trading

Avoid using TradingView logos, trademarks, copied icons, or proprietary styling assets.

## Local development requirements

The app should run locally on a developer laptop with no deployment required.

Expected local behavior:

1. Install dependencies.
2. Start a local backend/data process if required.
3. Start the browser dashboard on a localhost port, such as port `5000`.
4. Keep the server running while the user opens the dashboard.

## Suggested architecture

### Frontend

- Plain HTML/CSS/JavaScript or a lightweight framework.
- TradingView Lightweight Charts for chart rendering.
- Responsive CSS grid for 1/2/4/6/8 pane layouts.

### Backend

- Python backend for Yahoo Finance integration and API normalization.
- WebSocket or polling bridge for crypto data.
- REST endpoints for historical candles and symbol lookup.

### Data abstraction

Create provider interfaces for:

- Symbol search
- Historical candles
- Live candle subscriptions
- Market status

This should make it easy to swap Hyperliquid/Yahoo Finance for broker or exchange APIs later.

## Future enhancements

The transcript mentions possible extensions:

- Price alert script
- Backtesting engine
- AI agent that watches a watchlist continuously
- Telegram alerts for shortlisted symbols
- Crypto screener
- US and Indian stock screener

These should be treated as future roadmap items after the charting MVP is complete.

## MVP acceptance criteria

The MVP is complete when:

1. The app runs locally in a browser.
2. It defaults to four chart panes.
3. The user can switch layouts between 1, 2, 4, 6, and 8 panes.
4. Each pane can independently choose market, symbol, and timeframe.
5. Crypto charts stream or poll live prices.
6. US and Indian stock charts load latest available data.
7. Users can add at least Bollinger Bands, RSI, MACD, VWAP, Volume, and Williams %R.
8. Users can enable Volume Profile and see VAH/POC/VAL-style levels.
9. Users can enable Fair Value Gap and see bullish/bearish regions.
10. The UI uses a dark, responsive multi-chart dashboard layout.
