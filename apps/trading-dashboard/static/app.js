const DEFAULT_PANES = [
  { market: 'crypto', symbol: 'BTC', timeframe: '15m', indicators: ['volume'] },
  { market: 'crypto', symbol: 'ETH', timeframe: '5m', indicators: ['volume', 'vwap'] },
  { market: 'india', symbol: 'RELIANCE', timeframe: '1d', indicators: ['volume'] },
  { market: 'us', symbol: 'AAPL', timeframe: '1h', indicators: ['volume'] },
  { market: 'crypto', symbol: 'SOL', timeframe: '1h', indicators: ['volume'] },
  { market: 'us', symbol: 'TSLA', timeframe: '1d', indicators: ['volume'] },
  { market: 'india', symbol: 'TCS', timeframe: '1d', indicators: ['volume'] },
  { market: 'crypto', symbol: 'BNB', timeframe: '30m', indicators: ['volume'] },
];

const WATCHLIST = [
  ['BTC', 'Crypto', '+1.8%'], ['ETH', 'Crypto', '+0.9%'], ['SOL', 'Crypto', '-0.4%'],
  ['AAPL', 'US Stock', '+0.5%'], ['TSLA', 'US Stock', '-1.1%'], ['RELIANCE', 'India', '+0.2%'],
];

let layout = Number(localStorage.getItem('trading-dashboard-layout') || 4);
let paneState = JSON.parse(localStorage.getItem('trading-dashboard-panes') || 'null') || DEFAULT_PANES;
const charts = new Map();

const grid = document.querySelector('#chartGrid');
const template = document.querySelector('#paneTemplate');

function saveState() {
  localStorage.setItem('trading-dashboard-layout', String(layout));
  localStorage.setItem('trading-dashboard-panes', JSON.stringify(paneState));
}

function renderWatchlist() {
  const list = document.querySelector('#watchlist');
  list.innerHTML = WATCHLIST.map(([symbol, market, move]) => `
    <div class="watch-item">
      <span><strong>${symbol}</strong><br><small>${market}</small></span>
      <span class="${move.startsWith('+') ? 'up' : 'down'}">${move}</span>
    </div>
  `).join('');
}

function renderLayoutButtons() {
  document.querySelectorAll('[data-layout]').forEach((button) => {
    button.classList.toggle('active', Number(button.dataset.layout) === layout);
    button.addEventListener('click', () => {
      layout = Number(button.dataset.layout);
      saveState();
      renderDashboard();
    });
  });
}

async function renderStatus() {
  const strip = document.querySelector('#statusStrip');
  try {
    const response = await fetch('/api/status');
    const status = await response.json();
    strip.innerHTML = Object.values(status).map((item) => `
      <span class="status ${item.open ? 'live' : ''}">${item.label}</span>
    `).join('');
  } catch {
    strip.innerHTML = '<span class="status">Market status unavailable</span>';
  }
}

function renderDashboard() {
  grid.className = `chart-grid layout-${layout}`;
  grid.innerHTML = '';
  charts.clear();
  paneState = [...paneState, ...DEFAULT_PANES].slice(0, 8);

  for (let index = 0; index < layout; index += 1) {
    const pane = template.content.firstElementChild.cloneNode(true);
    pane.dataset.index = String(index);
    grid.appendChild(pane);
    wirePane(pane, index);
  }
  saveState();
}

function wirePane(pane, index) {
  const state = paneState[index] || DEFAULT_PANES[index];
  const market = pane.querySelector('.market-select');
  const symbol = pane.querySelector('.symbol-input');
  const timeframe = pane.querySelector('.timeframe-select');
  const checks = [...pane.querySelectorAll('.indicator-menu input')];

  market.value = state.market;
  symbol.value = state.symbol;
  timeframe.value = state.timeframe;
  checks.forEach((check) => { check.checked = state.indicators.includes(check.value); });

  const update = () => {
    paneState[index] = {
      market: market.value,
      symbol: symbol.value.toUpperCase().trim() || defaultSymbol(market.value),
      timeframe: timeframe.value,
      indicators: checks.filter((check) => check.checked).map((check) => check.value),
    };
    symbol.value = paneState[index].symbol;
    saveState();
    loadPane(pane, paneState[index]);
  };

  market.addEventListener('change', () => {
    symbol.value = defaultSymbol(market.value);
    update();
  });
  symbol.addEventListener('change', update);
  symbol.addEventListener('keydown', (event) => { if (event.key === 'Enter') update(); });
  timeframe.addEventListener('change', update);
  checks.forEach((check) => check.addEventListener('change', update));
  loadPane(pane, state);
}

function defaultSymbol(market) {
  return { crypto: 'BTC', us: 'AAPL', india: 'RELIANCE' }[market] || 'BTC';
}

async function loadPane(pane, state) {
  pane.querySelector('.pane-title').textContent = `${state.symbol} · ${state.timeframe}`;
  pane.querySelector('.last-price').textContent = 'Loading…';
  pane.querySelector('.pane-error').hidden = true;
  pane.querySelector('.chart-stack').innerHTML = '';

  try {
    const params = new URLSearchParams({ market: state.market, symbol: state.symbol, timeframe: state.timeframe });
    const response = await fetch(`/api/candles?${params}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    renderPaneCharts(pane, payload.candles, state.indicators, payload.source);
  } catch (error) {
    pane.querySelector('.pane-error').hidden = false;
    pane.querySelector('.pane-error').textContent = `Could not load data: ${error.message}`;
  }
}

function renderPaneCharts(pane, candles, indicators, source) {
  const stack = pane.querySelector('.chart-stack');
  const rows = ['price'];
  if (indicators.includes('volume')) rows.push('volume');
  if (indicators.includes('rsi')) rows.push('rsi');
  if (indicators.includes('macd')) rows.push('macd');
  if (indicators.includes('williams')) rows.push('williams');
  stack.style.gridTemplateRows = `minmax(12rem, 1fr) ${rows.slice(1).map(() => '5.6rem').join(' ')}`;

  rows.forEach((row) => {
    const area = document.createElement('div');
    area.className = `chart-area ${row}`;
    stack.appendChild(area);
  });

  const priceChart = makeChart(stack.querySelector('.price'));
  const candleSeries = priceChart.addCandlestickSeries({
    upColor: '#22c55e', downColor: '#ef4444', borderUpColor: '#22c55e', borderDownColor: '#ef4444', wickUpColor: '#86efac', wickDownColor: '#fca5a5',
  });
  candleSeries.setData(candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));

  if (indicators.includes('bollinger')) addBollinger(priceChart, candles);
  if (indicators.includes('vwap')) addVwap(priceChart, candles);
  if (indicators.includes('fvg')) addFairValueGaps(priceChart, candles);
  if (indicators.includes('profile')) renderVolumeProfile(pane, candles);
  else clearVolumeProfile(pane);

  renderSubCharts(stack, rows, candles);
  const last = candles[candles.length - 1];
  pane.querySelector('.last-price').textContent = last ? last.close.toLocaleString(undefined, { maximumFractionDigits: 4 }) : 'No data';
  pane.querySelector('.data-source').textContent = source;
  priceChart.timeScale().fitContent();
  charts.set(pane.dataset.index, priceChart);
}

function makeChart(element) {
  const chart = LightweightCharts.createChart(element, {
    autoSize: true,
    layout: { background: { color: '#0d1320' }, textColor: '#8ca0b8' },
    grid: { vertLines: { color: '#172033' }, horzLines: { color: '#172033' } },
    rightPriceScale: { borderColor: '#223044' },
    timeScale: { borderColor: '#223044', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  });
  return chart;
}

function renderSubCharts(stack, rows, candles) {
  if (rows.includes('volume')) {
    const chart = makeChart(stack.querySelector('.volume'));
    const series = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: '' });
    series.setData(candles.map((c) => ({ time: c.time, value: c.volume, color: c.close >= c.open ? 'rgba(34,197,94,.45)' : 'rgba(239,68,68,.45)' })));
    chart.timeScale().fitContent();
  }
  if (rows.includes('rsi')) addLinePane(stack.querySelector('.rsi'), candles, rsi(candles.map((c) => c.close), 14), '#a78bfa', 'RSI');
  if (rows.includes('macd')) addMacdPane(stack.querySelector('.macd'), candles);
  if (rows.includes('williams')) addLinePane(stack.querySelector('.williams'), candles, williams(candles, 14), '#fbbf24', 'Williams %R');
}

function addLinePane(element, candles, values, color) {
  const chart = makeChart(element);
  const series = chart.addLineSeries({ color, lineWidth: 2 });
  series.setData(values.map((value, index) => value == null ? null : { time: candles[index].time, value }).filter(Boolean));
  chart.timeScale().fitContent();
}

function addMacdPane(element, candles) {
  const chart = makeChart(element);
  const values = macd(candles.map((c) => c.close));
  chart.addLineSeries({ color: '#38bdf8', lineWidth: 2 }).setData(values.macd.map((value, index) => value == null ? null : { time: candles[index].time, value }).filter(Boolean));
  chart.addLineSeries({ color: '#f59e0b', lineWidth: 2 }).setData(values.signal.map((value, index) => value == null ? null : { time: candles[index].time, value }).filter(Boolean));
  chart.addHistogramSeries({ color: 'rgba(148,163,184,.55)' }).setData(values.histogram.map((value, index) => value == null ? null : { time: candles[index].time, value }).filter(Boolean));
  chart.timeScale().fitContent();
}

function addBollinger(chart, candles) {
  const closes = candles.map((c) => c.close);
  const bands = bollinger(closes, 20, 2);
  [['upper', '#60a5fa'], ['middle', '#94a3b8'], ['lower', '#60a5fa']].forEach(([key, color]) => {
    const series = chart.addLineSeries({ color, lineWidth: key === 'middle' ? 1 : 2 });
    series.setData(bands[key].map((value, index) => value == null ? null : { time: candles[index].time, value }).filter(Boolean));
  });
}

function addVwap(chart, candles) {
  const series = chart.addLineSeries({ color: '#f472b6', lineWidth: 2 });
  series.setData(vwap(candles).map((value, index) => ({ time: candles[index].time, value })));
}

function addFairValueGaps(chart, candles) {
  const bullish = chart.addHistogramSeries({ color: 'rgba(34,197,94,.32)', priceScaleId: 'right' });
  const bearish = chart.addHistogramSeries({ color: 'rgba(239,68,68,.32)', priceScaleId: 'right' });
  bullish.setData(candles.map((c, i) => i >= 2 && c.low > candles[i - 2].high ? { time: c.time, value: c.low } : null).filter(Boolean));
  bearish.setData(candles.map((c, i) => i >= 2 && c.high < candles[i - 2].low ? { time: c.time, value: c.high } : null).filter(Boolean));
}

function renderVolumeProfile(pane, candles) {
  clearVolumeProfile(pane);
  const prices = candles.flatMap((c) => [c.high, c.low]);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const buckets = Array.from({ length: 18 }, (_, i) => ({ index: i, volume: 0 }));
  candles.forEach((c) => {
    const index = Math.min(17, Math.max(0, Math.floor(((c.close - min) / (max - min || 1)) * 18)));
    buckets[index].volume += c.volume;
  });
  const maxVolume = Math.max(...buckets.map((b) => b.volume), 1);
  buckets.forEach((bucket) => {
    const bar = document.createElement('div');
    bar.className = 'volume-profile-bar';
    bar.style.top = `${20 + (17 - bucket.index) * 3.4}%`;
    bar.style.width = `${8 + (bucket.volume / maxVolume) * 34}%`;
    pane.appendChild(bar);
  });
  [['VAH', 31], ['POC', 50], ['VAL', 69]].forEach(([label, top]) => {
    const line = document.createElement('div');
    line.className = 'volume-profile-line';
    line.style.top = `${top}%`;
    line.textContent = label;
    pane.appendChild(line);
  });
}

function clearVolumeProfile(pane) {
  pane.querySelectorAll('.volume-profile-bar, .volume-profile-line').forEach((item) => item.remove());
}

function sma(values, period) {
  return values.map((_, index) => index < period - 1 ? null : values.slice(index - period + 1, index + 1).reduce((a, b) => a + b, 0) / period);
}

function ema(values, period) {
  const k = 2 / (period + 1);
  const output = [];
  values.reduce((previous, value, index) => {
    const next = index === 0 ? value : value * k + previous * (1 - k);
    output.push(next);
    return next;
  }, values[0]);
  return output;
}

function bollinger(values, period, multiplier) {
  const middle = sma(values, period);
  const upper = [];
  const lower = [];
  values.forEach((_, index) => {
    if (index < period - 1) { upper.push(null); lower.push(null); return; }
    const window = values.slice(index - period + 1, index + 1);
    const mean = middle[index];
    const variance = window.reduce((sum, value) => sum + (value - mean) ** 2, 0) / period;
    const deviation = Math.sqrt(variance);
    upper.push(mean + deviation * multiplier);
    lower.push(mean - deviation * multiplier);
  });
  return { upper, middle, lower };
}

function vwap(candles) {
  let cumulativePriceVolume = 0;
  let cumulativeVolume = 0;
  return candles.map((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    cumulativePriceVolume += typical * c.volume;
    cumulativeVolume += c.volume;
    return cumulativePriceVolume / Math.max(cumulativeVolume, 1);
  });
}

function rsi(values, period) {
  return values.map((value, index) => {
    if (index < period) return null;
    const window = values.slice(index - period + 1, index + 1);
    let gains = 0;
    let losses = 0;
    window.forEach((current, i) => {
      if (i === 0) return;
      const delta = current - window[i - 1];
      if (delta >= 0) gains += delta; else losses -= delta;
    });
    const rs = gains / Math.max(losses, 0.0001);
    return 100 - (100 / (1 + rs));
  });
}

function macd(values) {
  const fast = ema(values, 12);
  const slow = ema(values, 26);
  const macdLine = values.map((_, index) => fast[index] - slow[index]);
  const signal = ema(macdLine, 9);
  const histogram = macdLine.map((value, index) => value - signal[index]);
  return { macd: macdLine, signal, histogram };
}

function williams(candles, period) {
  return candles.map((candle, index) => {
    if (index < period - 1) return null;
    const window = candles.slice(index - period + 1, index + 1);
    const highest = Math.max(...window.map((c) => c.high));
    const lowest = Math.min(...window.map((c) => c.low));
    return ((highest - candle.close) / Math.max(highest - lowest, 0.0001)) * -100;
  });
}

renderWatchlist();
renderLayoutButtons();
renderStatus();
renderDashboard();
setInterval(renderStatus, 60_000);
setInterval(() => {
  [...document.querySelectorAll('.chart-pane')].forEach((pane) => loadPane(pane, paneState[Number(pane.dataset.index)]));
}, 30_000);
