# Local Trading Dashboard

A locally runnable, TradingView-inspired multi-chart dashboard built from the video requirements in `docs/trading-dashboard-requirements.md`.

## Features

- Dark responsive grid with 1, 2, 4, 6, or 8 simultaneous chart panes.
- Per-pane market selector for crypto, US stocks, and Indian stocks.
- Per-pane symbol and timeframe controls from 1 minute through 1 month.
- Candlestick charts rendered with TradingView Lightweight Charts.
- Multiple indicators can be enabled at once: Bollinger Bands, RSI, MACD, VWAP, Volume, Williams %R, Volume Profile, and Fair Value Gap.
- Crypto data comes from Binance public klines by default, with Yahoo Finance/yfinance fallback for stocks and Indian tickers.
- Market status chips for crypto, US market, and Indian market.

## Run locally

From this directory:

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Then open <http://127.0.0.1:5000>.

> Internet access is required for live market data and the CDN-hosted chart library. If a provider is unavailable, the backend returns deterministic demo candles so the UI still runs.

## Notes

This app intentionally avoids TradingView branding and proprietary assets. It uses the open-source Lightweight Charts library for chart rendering.
