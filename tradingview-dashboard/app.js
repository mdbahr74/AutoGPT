/* ============================================================
   TradingView Plus replacement — multi-chart dashboard
   ------------------------------------------------------------
   Uses TradingView's free Advanced Chart widget (tv.js) so every
   chart looks and behaves EXACTLY like TradingView: real data,
   every drawing tool, and the full indicator library via the "fx"
   button. Multi-chart layouts (the paid "Plus" feature) are
   recreated by placing several free widgets in a CSS grid.
   ============================================================ */

"use strict";

/* ---- How many panes each layout shows -------------------------------- */
const LAYOUT_PANES = { "1": 1, "2h": 2, "2v": 2, "3": 3, "4": 4 };

/* ---- Indicator presets ----------------------------------------------- */
/* Study IDs are the classic tv.js "@tv-basicstudies" identifiers, which
   the free widget loads automatically. Users can still add ANY indicator
   from TradingView's full library using the chart's "fx" button.        */
const PRESETS = {
  default:    ["RSI@tv-basicstudies", "MACD@tv-basicstudies", "Volume@tv-basicstudies"],
  trend:      ["MAExp@tv-basicstudies", "MAExp@tv-basicstudies", "IchimokuCloud@tv-basicstudies"],
  momentum:   ["RSI@tv-basicstudies", "MACD@tv-basicstudies", "Stochastic@tv-basicstudies"],
  volatility: ["BB@tv-basicstudies", "ATR@tv-basicstudies", "Volume@tv-basicstudies"],
  clean:      [],
};

/* ---- App state ------------------------------------------------------- */
const state = {
  layout: "1",
  interval: "D",
  preset: "default",
  active: 0, // index of the focused pane (symbol box controls this one)
  // One symbol per pane; sensible defaults across asset classes.
  symbols: ["BINANCE:BTCUSDT", "NASDAQ:AAPL", "BINANCE:ETHUSDT", "FOREXCOM:SPXUSD"],
};

const grid = document.getElementById("grid");

/* ============================================================
   Rendering
   ============================================================ */
function render() {
  const panes = LAYOUT_PANES[state.layout];

  // Reset the grid class + contents.
  grid.className = "grid grid--" + state.layout;
  grid.innerHTML = "";

  if (state.active >= panes) state.active = 0;

  for (let i = 0; i < panes; i++) {
    const cell = document.createElement("div");
    cell.className = "cell" + (i === state.active ? " is-active" : "");
    cell.dataset.index = String(i);

    const mount = document.createElement("div");
    mount.className = "cell__widget";
    mount.id = "tv-widget-" + i;
    cell.appendChild(mount);
    grid.appendChild(cell);

    // Clicking a pane makes it the active one (symbol box targets it).
    cell.addEventListener("mousedown", () => setActive(i));

    createWidget(mount.id, state.symbols[i]);
  }

  syncSymbolInput();
}

function createWidget(containerId, symbol) {
  if (typeof TradingView === "undefined" || !TradingView.widget) {
    console.error("tv.js failed to load — check your network connection.");
    return;
  }
  // eslint-disable-next-line no-new
  new TradingView.widget({
    container_id: containerId,
    symbol: symbol,
    interval: state.interval,
    autosize: true,
    timezone: "Etc/UTC",
    theme: "dark",
    style: "1",              // candlesticks
    locale: "en",
    toolbar_bg: "#131722",
    enable_publishing: false,
    allow_symbol_change: true,
    hide_side_toolbar: false, // keep the drawing tools
    withdateranges: true,
    details: false,
    studies: PRESETS[state.preset].slice(),
    // Subtle theme overrides to match the surrounding UI.
    overrides: {
      "paneProperties.background": "#131722",
      "paneProperties.backgroundType": "solid",
    },
  });
}

/* ============================================================
   State updates
   ============================================================ */
function setActive(index) {
  state.active = index;
  document.querySelectorAll(".cell").forEach((c) => {
    c.classList.toggle("is-active", Number(c.dataset.index) === index);
  });
  syncSymbolInput();
}

function setLayout(layout) {
  if (!(layout in LAYOUT_PANES)) return;
  state.layout = layout;
  render();
}

function setInterval(interval) {
  state.interval = interval;
  render();
}

function setPreset(preset) {
  state.preset = preset;
  render();
}

function setSymbol(rawSymbol) {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return;
  state.symbols[state.active] = symbol;
  render();
}

function syncSymbolInput() {
  const input = document.getElementById("symbol-input");
  input.value = state.symbols[state.active] || "";
}

/* ============================================================
   Wire up the toolbar
   ============================================================ */
function activate(group, btn) {
  group.querySelectorAll(".seg__btn").forEach((b) => b.classList.remove("is-active"));
  btn.classList.add("is-active");
}

// Layout buttons
const layoutSeg = document.getElementById("layout-seg");
layoutSeg.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg__btn");
  if (!btn) return;
  activate(layoutSeg, btn);
  setLayout(btn.dataset.layout);
});

// Interval buttons
const intervalSeg = document.getElementById("interval-seg");
intervalSeg.addEventListener("click", (e) => {
  const btn = e.target.closest(".seg__btn");
  if (!btn) return;
  activate(intervalSeg, btn);
  setInterval(btn.dataset.interval);
});

// Indicator preset
document.getElementById("preset-select").addEventListener("change", (e) => {
  setPreset(e.target.value);
});

// Symbol search form
document.getElementById("symbol-form").addEventListener("submit", (e) => {
  e.preventDefault();
  setSymbol(document.getElementById("symbol-input").value);
});

/* ============================================================
   Boot
   ============================================================ */
render();
