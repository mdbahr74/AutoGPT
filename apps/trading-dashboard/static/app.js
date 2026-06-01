'use strict';

/*
 * Crypto order-flow terminal.
 *
 * Everything is built around price-action + volume, the way an order-flow
 * trader works: a clean candle chart with a volume profile (VRVP + fixed
 * daily), session VWAP, moving averages and order-block zones, plus a
 * time-synced cumulative-delta pane underneath. No oscillators.
 */

const DEFAULT_PANES = [
  { symbol: 'BTC', timeframe: '15m', studies: ['vrvp', 'vwap', 'cvd'] },
  { symbol: 'ETH', timeframe: '5m', studies: ['vrvp', 'vwap', 'cvd'] },
  { symbol: 'SOL', timeframe: '1h', studies: ['vrvp', 'cvd'] },
  { symbol: 'BTC', timeframe: '1d', studies: ['vrvp', 'daily', 'cvd'] },
  { symbol: 'ETH', timeframe: '1h', studies: ['vrvp', 'cvd'] },
  { symbol: 'BNB', timeframe: '30m', studies: ['vrvp', 'cvd'] },
  { symbol: 'XRP', timeframe: '15m', studies: ['vrvp', 'cvd'] },
  { symbol: 'AVAX', timeframe: '1h', studies: ['vrvp', 'cvd'] },
];

const REFRESH_MS = 20_000;
const PROFILE_BUCKETS = 90;          // vertical resolution of the volume profile
const VALUE_AREA = 0.70;             // 70% value area, like TradingView
const COLORS = {
  buy: 'rgba(34, 197, 94, 0.55)',
  sell: 'rgba(239, 68, 68, 0.55)',
  poc: '#f59e0b',
  va: 'rgba(245, 158, 11, 0.65)',
  obBull: 'rgba(34, 197, 94, 0.14)',
  obBear: 'rgba(239, 68, 68, 0.14)',
};

let layout = Number(localStorage.getItem('ofterm-layout') || 4);
let paneState = JSON.parse(localStorage.getItem('ofterm-panes') || 'null') || DEFAULT_PANES;

const grid = document.querySelector('#chartGrid');
const template = document.querySelector('#paneTemplate');
const panes = []; // live Pane controllers, one per visible slot

function saveState() {
  localStorage.setItem('ofterm-layout', String(layout));
  localStorage.setItem('ofterm-panes', JSON.stringify(paneState));
}

/* ------------------------------------------------------------------ layout */

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

function renderDashboard() {
  grid.className = `chart-grid layout-${layout}`;
  grid.innerHTML = '';
  panes.forEach((pane) => pane.destroy());
  panes.length = 0;
  paneState = [...paneState, ...DEFAULT_PANES].slice(0, 8);

  for (let index = 0; index < layout; index += 1) {
    const element = template.content.firstElementChild.cloneNode(true);
    element.dataset.index = String(index);
    grid.appendChild(element);
    panes.push(new Pane(element, index));
  }
  saveState();
}

/* -------------------------------------------------------------- indicators */

function ema(values, period) {
  const k = 2 / (period + 1);
  let prev;
  return values.map((value, index) => {
    prev = index === 0 ? value : value * k + prev * (1 - k);
    return prev;
  });
}

function sessionVwap(candles) {
  // Resets at each UTC midnight, matching the common "session VWAP" anchor.
  let day = null;
  let cumPV = 0;
  let cumV = 0;
  return candles.map((c) => {
    const candleDay = Math.floor(c.time / 86400);
    if (candleDay !== day) { day = candleDay; cumPV = 0; cumV = 0; }
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumV += c.volume;
    return { time: c.time, value: cumPV / Math.max(cumV, 1e-9) };
  });
}

function cumulativeDelta(candles) {
  let running = 0;
  return candles.map((c) => {
    running += c.delta;
    return { time: c.time, value: running };
  });
}

// Detect simple order blocks: the last opposing candle before an impulse that
// breaks the prior swing. Returns price boxes anchored from their candle to now.
function orderBlocks(candles, lookback = 3, impulse = 0.004) {
  const blocks = [];
  for (let i = 2; i < candles.length - lookback; i += 1) {
    const next = candles[i + lookback];
    const move = (next.close - candles[i].close) / candles[i].close;
    const bullish = candles[i].close < candles[i].open && move > impulse;
    const bearish = candles[i].close > candles[i].open && move < -impulse;
    if (bullish || bearish) {
      blocks.push({
        time: candles[i].time,
        top: candles[i].high,
        bottom: candles[i].low,
        bullish,
      });
    }
  }
  return blocks.slice(-12); // keep the chart readable
}

/* ----------------------------------------------------------- volume profile */

// Distribute each candle's volume across the price buckets it spans, splitting
// into buy/sell using the taker-buy ratio. This is the same approach a charting
// engine uses when it doesn't have tick data.
function buildProfile(candles, bucketCount = PROFILE_BUCKETS) {
  if (!candles.length) return null;
  let min = Infinity;
  let max = -Infinity;
  candles.forEach((c) => { min = Math.min(min, c.low); max = Math.max(max, c.high); });
  if (!(max > min)) max = min + 1;
  const span = max - min;
  const size = span / bucketCount;
  const buy = new Array(bucketCount).fill(0);
  const sell = new Array(bucketCount).fill(0);

  candles.forEach((c) => {
    const lo = Math.max(0, Math.floor((c.low - min) / size));
    const hi = Math.min(bucketCount - 1, Math.floor((c.high - min) / size));
    const spanCount = hi - lo + 1;
    const buyPer = (c.buyVolume || c.volume / 2) / spanCount;
    const sellPer = (c.sellVolume || c.volume / 2) / spanCount;
    for (let b = lo; b <= hi; b += 1) { buy[b] += buyPer; sell[b] += sellPer; }
  });

  const total = buy.map((v, i) => v + sell[i]);
  const grandTotal = total.reduce((a, b) => a + b, 0);

  // Point of control + 70% value area expanded outward from the POC.
  let pocIndex = 0;
  total.forEach((v, i) => { if (v > total[pocIndex]) pocIndex = i; });
  let covered = total[pocIndex];
  let lower = pocIndex;
  let upper = pocIndex;
  while (covered < grandTotal * VALUE_AREA && (lower > 0 || upper < bucketCount - 1)) {
    const below = lower > 0 ? total[lower - 1] : -1;
    const above = upper < bucketCount - 1 ? total[upper + 1] : -1;
    if (above >= below) { upper += 1; covered += Math.max(above, 0); }
    else { lower -= 1; covered += Math.max(below, 0); }
  }

  const priceOf = (index) => min + (index + 0.5) * size;
  return {
    min, max, size, buy, sell, total,
    maxBucket: Math.max(...total, 1),
    poc: priceOf(pocIndex),
    vah: priceOf(upper),
    val: priceOf(lower),
  };
}

/* ------------------------------------------------------------------- charts */

function makeChart(element, options = {}) {
  return LightweightCharts.createChart(element, {
    autoSize: true,
    layout: { background: { color: '#0d1320' }, textColor: '#8ca0b8', fontSize: 11 },
    grid: { vertLines: { color: '#151f31' }, horzLines: { color: '#151f31' } },
    rightPriceScale: { borderColor: '#223044', scaleMargins: { top: 0.08, bottom: 0.08 } },
    timeScale: { borderColor: '#223044', timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
    ...options,
  });
}

class Pane {
  constructor(element, index) {
    this.element = element;
    this.index = index;
    this.candles = [];
    this.priceLines = [];
    this.syncing = false;
    this.refreshTimer = null;

    this.symbolInput = element.querySelector('.symbol-input');
    this.timeframeSelect = element.querySelector('.timeframe-select');
    this.checks = [...element.querySelectorAll('.indicator-menu input')];
    this.canvas = element.querySelector('.profile-canvas');
    this.priceEl = element.querySelector('.chart-area.price');
    this.cvdEl = element.querySelector('.chart-area.cvd');

    const state = paneState[index] || DEFAULT_PANES[index];
    this.symbolInput.value = state.symbol;
    this.timeframeSelect.value = state.timeframe;
    this.checks.forEach((c) => { c.checked = state.studies.includes(c.value); });

    this.buildCharts();
    this.wireControls();
    this.load();
  }

  get studies() {
    return this.checks.filter((c) => c.checked).map((c) => c.value);
  }

  buildCharts() {
    this.priceChart = makeChart(this.priceEl);
    this.candleSeries = this.priceChart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef4444',
      borderUpColor: '#22c55e', borderDownColor: '#ef4444',
      wickUpColor: '#86efac', wickDownColor: '#fca5a5',
    });
    this.vwapSeries = this.priceChart.addLineSeries({ color: '#f472b6', lineWidth: 2, priceLineVisible: false, lastValueVisible: false });
    this.ma20Series = this.priceChart.addLineSeries({ color: '#38bdf8', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });
    this.ma50Series = this.priceChart.addLineSeries({ color: '#a78bfa', lineWidth: 1, priceLineVisible: false, lastValueVisible: false });

    this.cvdChart = makeChart(this.cvdEl, {
      rightPriceScale: { borderColor: '#223044', scaleMargins: { top: 0.15, bottom: 0.15 } },
    });
    this.cvdSeries = this.cvdChart.addBaselineSeries({
      baseValue: { type: 'price', price: 0 },
      topLineColor: '#22c55e', topFillColor1: 'rgba(34,197,94,.28)', topFillColor2: 'rgba(34,197,94,.02)',
      bottomLineColor: '#ef4444', bottomFillColor1: 'rgba(239,68,68,.02)', bottomFillColor2: 'rgba(239,68,68,.28)',
      lineWidth: 2, priceLineVisible: false,
    });
    this.volumeSeries = this.cvdChart.addHistogramSeries({
      priceFormat: { type: 'volume' }, priceScaleId: 'vol', lastValueVisible: false,
    });
    this.cvdChart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });

    this.syncTimeScales();
    this.redrawProfile = this.redrawProfile.bind(this);
    this.priceChart.timeScale().subscribeVisibleLogicalRangeChange(this.redrawProfile);
    this.resizeObserver = new ResizeObserver(this.redrawProfile);
    this.resizeObserver.observe(this.priceEl);
  }

  // Lock the cumulative-delta pane to the price pane: shared time axis + crosshair.
  syncTimeScales() {
    const price = this.priceChart.timeScale();
    const cvd = this.cvdChart.timeScale();
    price.subscribeVisibleLogicalRangeChange((range) => {
      if (this.syncing || !range) return;
      this.syncing = true; cvd.setVisibleLogicalRange(range); this.syncing = false;
    });
    cvd.subscribeVisibleLogicalRangeChange((range) => {
      if (this.syncing || !range) return;
      this.syncing = true; price.setVisibleLogicalRange(range); this.syncing = false;
    });
    const syncCrosshair = (from, to, series) => from.subscribeCrosshairMove((param) => {
      if (this.syncing) return;
      this.syncing = true;
      if (param.time === undefined) to.clearCrosshairPosition();
      else to.setCrosshairPosition(0, param.time, series);
      this.syncing = false;
    });
    syncCrosshair(this.priceChart, this.cvdChart, this.cvdSeries);
    syncCrosshair(this.cvdChart, this.priceChart, this.candleSeries);
  }

  wireControls() {
    const update = () => {
      const symbol = this.symbolInput.value.toUpperCase().trim() || 'BTC';
      this.symbolInput.value = symbol;
      paneState[this.index] = { symbol, timeframe: this.timeframeSelect.value, studies: this.studies };
      saveState();
      this.load();
    };
    this.symbolInput.addEventListener('change', update);
    this.symbolInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') update(); });
    this.timeframeSelect.addEventListener('change', update);
    this.checks.forEach((c) => c.addEventListener('change', () => {
      paneState[this.index] = {
        symbol: this.symbolInput.value, timeframe: this.timeframeSelect.value, studies: this.studies,
      };
      saveState();
      this.applyStudies();
    }));
  }

  async load() {
    const symbol = this.symbolInput.value.toUpperCase().trim() || 'BTC';
    const timeframe = this.timeframeSelect.value;
    this.element.querySelector('.pane-title').textContent = `${symbol} · ${timeframe}`;
    this.element.querySelector('.pane-error').hidden = true;
    try {
      const params = new URLSearchParams({ symbol, timeframe });
      const response = await fetch(`/api/candles?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      this.candles = payload.candles || [];
      this.candleSeries.setData(this.candles.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
      this.applyStudies();
      this.priceChart.timeScale().fitContent();
      this.updateMeta(payload.source);
    } catch (error) {
      const box = this.element.querySelector('.pane-error');
      box.hidden = false;
      box.textContent = `Could not load data: ${error.message}`;
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => this.load(), REFRESH_MS);
  }

  applyStudies() {
    const studies = this.studies;
    const closes = this.candles.map((c) => c.close);

    this.vwapSeries.setData(studies.includes('vwap') ? sessionVwap(this.candles) : []);
    if (studies.includes('ma')) {
      const e20 = ema(closes, 20); const e50 = ema(closes, 50);
      this.ma20Series.setData(this.candles.map((c, i) => ({ time: c.time, value: e20[i] })));
      this.ma50Series.setData(this.candles.map((c, i) => ({ time: c.time, value: e50[i] })));
    } else {
      this.ma20Series.setData([]); this.ma50Series.setData([]);
    }

    const showCvd = studies.includes('cvd');
    const showVol = studies.includes('volume');
    this.cvdSeries.setData(showCvd ? cumulativeDelta(this.candles) : []);
    this.volumeSeries.setData(showVol ? this.candles.map((c) => ({
      time: c.time, value: c.volume, color: c.delta >= 0 ? COLORS.buy : COLORS.sell,
    })) : []);
    this.cvdEl.style.display = showCvd || showVol ? '' : 'none';
    this.element.classList.toggle('no-bottom', !(showCvd || showVol));

    this.drawOrderBlocks(studies.includes('orderblocks'));
    this.redrawProfile();
  }

  drawOrderBlocks(enabled) {
    this.candleSeries.setMarkers([]);
    this.obBlocks = enabled ? orderBlocks(this.candles) : [];
    this.redrawProfile(); // order blocks share the canvas overlay
  }

  updateMeta(source) {
    const last = this.candles[this.candles.length - 1];
    this.element.querySelector('.last-price').textContent = last
      ? last.close.toLocaleString(undefined, { maximumFractionDigits: 6 }) : 'No data';
    const profile = buildProfile(this.candles);
    const stats = this.element.querySelector('.pane-stats');
    if (profile) {
      stats.textContent = `POC ${profile.poc.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
    }
    const tag = this.element.querySelector('.data-source');
    tag.textContent = source;
    tag.classList.toggle('demo', source === 'demo');
  }

  /* -------- canvas overlay: volume profile (VRVP + daily) + order blocks ---- */

  redrawProfile() {
    const canvas = this.canvas;
    const ctx = canvas.getContext('2d');
    const width = this.priceEl.clientWidth;
    const height = this.priceEl.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    if (!this.candles.length) return;

    const studies = this.studies;
    if (this.obBlocks && this.obBlocks.length) this.paintOrderBlocks(ctx, width);
    if (studies.includes('daily')) this.paintDailyProfiles(ctx, width);
    if (studies.includes('vrvp')) this.paintVrvp(ctx, width);
  }

  visibleCandles() {
    const range = this.priceChart.timeScale().getVisibleLogicalRange();
    if (!range) return this.candles;
    const from = Math.max(0, Math.floor(range.from));
    const to = Math.min(this.candles.length, Math.ceil(range.to) + 1);
    return this.candles.slice(from, to);
  }

  paintVrvp(ctx, width) {
    const profile = buildProfile(this.visibleCandles());
    if (!profile) return;
    const maxBarWidth = Math.min(width * 0.32, 180);
    const priceToY = (p) => this.candleSeries.priceToCoordinate(p);

    profile.total.forEach((_, i) => {
      const yTop = priceToY(profile.min + (i + 1) * profile.size);
      const yBottom = priceToY(profile.min + i * profile.size);
      if (yTop == null || yBottom == null) return;
      const h = Math.max(1, yBottom - yTop - 1);
      const buyW = (profile.buy[i] / profile.maxBucket) * maxBarWidth;
      const sellW = (profile.sell[i] / profile.maxBucket) * maxBarWidth;
      ctx.fillStyle = COLORS.sell;
      ctx.fillRect(width - sellW, yTop, sellW, h);
      ctx.fillStyle = COLORS.buy;
      ctx.fillRect(width - sellW - buyW, yTop, buyW, h);
    });

    this.paintProfileLevels(ctx, width, profile, priceToY);
  }

  paintDailyProfiles(ctx, width) {
    // One compact profile per UTC day, anchored at the day's left edge.
    const byDay = new Map();
    this.candles.forEach((c) => {
      const day = Math.floor(c.time / 86400);
      if (!byDay.has(day)) byDay.set(day, []);
      byDay.get(day).push(c);
    });
    const ts = this.priceChart.timeScale();
    byDay.forEach((dayCandles) => {
      const profile = buildProfile(dayCandles, 40);
      if (!profile) return;
      const x0 = ts.timeToCoordinate(dayCandles[0].time);
      const x1 = ts.timeToCoordinate(dayCandles[dayCandles.length - 1].time);
      if (x0 == null) return;
      const dayWidth = Math.max(8, Math.min((x1 ?? width) - x0, width * 0.18));
      profile.total.forEach((v, i) => {
        const yTop = this.candleSeries.priceToCoordinate(profile.min + (i + 1) * profile.size);
        const yBottom = this.candleSeries.priceToCoordinate(profile.min + i * profile.size);
        if (yTop == null || yBottom == null) return;
        const w = (v / profile.maxBucket) * dayWidth;
        ctx.fillStyle = 'rgba(124, 162, 211, 0.22)';
        ctx.fillRect(x0, yTop, w, Math.max(1, yBottom - yTop - 1));
      });
      const yPoc = this.candleSeries.priceToCoordinate(profile.poc);
      if (yPoc != null && x1 != null) {
        ctx.strokeStyle = 'rgba(245, 158, 11, 0.5)';
        ctx.beginPath(); ctx.moveTo(x0, yPoc); ctx.lineTo(x1, yPoc); ctx.stroke();
      }
    });
  }

  paintProfileLevels(ctx, width, profile, priceToY) {
    const levels = [['POC', profile.poc, COLORS.poc], ['VAH', profile.vah, COLORS.va], ['VAL', profile.val, COLORS.va]];
    ctx.font = '10px ui-sans-serif, system-ui';
    levels.forEach(([label, price, color]) => {
      const y = priceToY(price);
      if (y == null) return;
      ctx.strokeStyle = color;
      ctx.setLineDash(label === 'POC' ? [] : [4, 3]);
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.fillText(label, 6, y - 2);
    });
  }

  paintOrderBlocks(ctx, width) {
    const ts = this.priceChart.timeScale();
    this.obBlocks.forEach((block) => {
      const x = ts.timeToCoordinate(block.time);
      const yTop = this.candleSeries.priceToCoordinate(block.top);
      const yBottom = this.candleSeries.priceToCoordinate(block.bottom);
      if (x == null || yTop == null || yBottom == null) return;
      ctx.fillStyle = block.bullish ? COLORS.obBull : COLORS.obBear;
      ctx.fillRect(x, yTop, width - x, yBottom - yTop);
    });
  }

  destroy() {
    clearTimeout(this.refreshTimer);
    if (this.resizeObserver) this.resizeObserver.disconnect();
    if (this.priceChart) this.priceChart.remove();
    if (this.cvdChart) this.cvdChart.remove();
  }
}

/* -------------------------------------------------------------------- boot */

renderLayoutButtons();
renderDashboard();
