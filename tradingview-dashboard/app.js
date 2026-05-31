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
  highlightWatchlist();
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
  highlightWatchlist();
  persist();
}

function setLayout(layout) {
  if (!(layout in LAYOUT_PANES)) return;
  state.layout = layout;
  render();
  persist();
}

function setChartInterval(interval) {
  state.interval = interval;
  render();
  persist();
}

function setPreset(preset) {
  state.preset = preset;
  render();
  persist();
}

function setSymbol(rawSymbol) {
  const symbol = rawSymbol.trim().toUpperCase();
  if (!symbol) return;
  state.symbols[state.active] = symbol;
  render();
  persist();
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
  setChartInterval(btn.dataset.interval);
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
   Watchlist (persisted in localStorage, live prices via Bitunix)
   ============================================================ */
const WL_KEY = "tv_watchlist_v1";
const DEFAULT_WATCHLIST = ["BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT"];

let watchlist = loadWatchlist();

function loadWatchlist() {
  try {
    const saved = JSON.parse(localStorage.getItem(WL_KEY));
    if (Array.isArray(saved) && saved.length) return saved;
  } catch (_) { /* ignore */ }
  return DEFAULT_WATCHLIST.slice();
}

function saveWatchlist() {
  localStorage.setItem(WL_KEY, JSON.stringify(watchlist));
}

/* TradingView symbols may include an exchange prefix (BINANCE:BTCUSDT);
   Bitunix uses the bare ticker (BTCUSDT). Strip the prefix for prices. */
function bitunixSymbol(tv) {
  return tv.includes(":") ? tv.split(":")[1] : tv;
}

function renderWatchlist() {
  const list = document.getElementById("wl-list");
  list.innerHTML = "";
  watchlist.forEach((sym) => {
    const li = document.createElement("li");
    li.className = "wl-item";

    const symBtn = document.createElement("button");
    symBtn.className = "wl-item__sym";
    symBtn.textContent = sym;
    symBtn.title = "Load in active chart";
    symBtn.addEventListener("click", () => setSymbol(sym));

    const px = document.createElement("span");
    px.className = "wl-item__px";
    px.dataset.sym = bitunixSymbol(sym);
    px.textContent = "—";

    const rm = document.createElement("button");
    rm.className = "wl-item__rm";
    rm.textContent = "×";
    rm.title = "Remove";
    rm.addEventListener("click", () => {
      watchlist = watchlist.filter((s) => s !== sym);
      saveWatchlist();
      renderWatchlist();
    });

    li.append(symBtn, px, rm);
    list.appendChild(li);
  });
  highlightWatchlist();
}

/* Mark the watchlist row whose symbol is loaded in the focused chart. */
function highlightWatchlist() {
  const activeSym = bitunixSymbol((state.symbols[state.active] || "").toUpperCase());
  document.querySelectorAll(".wl-item").forEach((li) => {
    const px = li.querySelector(".wl-item__px");
    li.classList.toggle("is-active", !!px && px.dataset.sym === activeSym);
  });
}

function addWatch(rawSymbol) {
  const sym = rawSymbol.trim().toUpperCase();
  if (!sym || watchlist.includes(sym)) return;
  watchlist.push(sym);
  saveWatchlist();
  renderWatchlist();
  refreshPrices();
}

function formatPrice(n) {
  if (!isFinite(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (n >= 1)    return n.toFixed(2);
  if (n >= 0.01) return n.toFixed(4);
  return n.toPrecision(4);
}

async function refreshPrices() {
  const symbols = [...new Set(watchlist.map(bitunixSymbol))];
  if (!symbols.length) return;
  try {
    const res = await fetch("/api/bitunix/tickers?symbols=" + encodeURIComponent(symbols.join(",")));
    if (!res.ok) throw new Error("bad status");
    const json = await res.json();
    const data = json.data || [];
    const map = Object.create(null);
    data.forEach((t) => { map[t.symbol] = t; });

    document.querySelectorAll(".wl-item__px").forEach((el) => {
      const t = map[el.dataset.sym];
      if (!t) { el.textContent = "—"; el.className = "wl-item__px"; return; }
      const last = parseFloat(t.lastPrice != null ? t.lastPrice : t.last);
      const open = parseFloat(t.open);
      const chg = open ? ((last - open) / open) * 100 : 0;
      el.textContent = formatPrice(last);
      el.className = "wl-item__px " + (chg >= 0 ? "up" : "down");
      el.title = (chg >= 0 ? "+" : "") + chg.toFixed(2) + "% (24h)";
    });
    setSource("live · Bitunix");
    setConn(data.length ? "ok" : "backend",
      data.length ? "Live data · Bitunix" : "Backend up · Bitunix unreachable");
  } catch (_) {
    setSource("offline — start the backend");
    setConn("off", "Backend offline — run npm start");
  }
}

function setSource(text) {
  const el = document.getElementById("wl-source");
  if (el) el.textContent = text;
}

function setConn(level, title) {
  const el = document.getElementById("conn");
  if (!el) return;
  el.className = "conn conn--" + level;
  el.title = title;
}

/* ============================================================
   Bitunix account (read-only)
   ============================================================ */
function num(v) { const n = parseFloat(v); return isFinite(n) ? n : 0; }
function fmtUsd(n) {
  return num(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function signClass(n) { return num(n) >= 0 ? "up" : "down"; }

function setAccountMessage(html) {
  document.getElementById("acct-body").innerHTML =
    '<div class="account__status">' + html + "</div>";
}

async function refreshAccount() {
  const body = document.getElementById("acct-body");
  try {
    const res = await fetch("/api/bitunix/account");
    const json = await res.json();

    if (!json.ok) {
      if (json.reason === "no-keys") {
        setAccountMessage(
          "Not connected.<br>Add your keys to <code>.env</code>:<br>" +
          "<code>BITUNIX_API_KEY</code> &amp; <code>BITUNIX_API_SECRET</code>, then restart."
        );
      } else {
        setAccountMessage("Bitunix error: " + (json.error || "unknown"));
      }
      return;
    }

    const a = json.account || {};
    const pnl = num(a.crossUnrealizedPNL) + num(a.isolationUnrealizedPNL);
    const positions = json.positions || [];

    let html = "";
    html += row("Available", fmtUsd(a.available) + " " + (a.marginCoin || "USDT"));
    html += row("Margin", fmtUsd(a.margin) + " " + (a.marginCoin || "USDT"));
    html += row("Unrealized PnL", (pnl >= 0 ? "+" : "") + fmtUsd(pnl), signClass(pnl));

    if (positions.length) {
      html += '<div class="account__pos-head">Positions (' + positions.length + ")</div>";
      positions.forEach((p) => {
        const sym = p.symbol || p.marginCoin || "—";
        const side = (p.side || p.holdSide || "").toString().toUpperCase();
        const qty = p.qty != null ? p.qty : (p.size != null ? p.size : p.total);
        const ppnl = num(p.unrealizedPNL != null ? p.unrealizedPNL : p.unrealizedPnl);
        html +=
          '<div class="account__pos">' +
            '<div><span class="account__pos-sym">' + sym + "</span>" +
              '<div class="account__pos-meta">' + (side || "") + (qty != null ? " · " + qty : "") + "</div></div>" +
            '<div class="account__pos-pnl ' + signClass(ppnl) + '">' +
              (ppnl >= 0 ? "+" : "") + fmtUsd(ppnl) + "</div>" +
          "</div>";
      });
    } else {
      html += '<div class="account__pos-head">No open positions</div>';
    }

    body.innerHTML = html;
  } catch (_) {
    setAccountMessage("Backend offline. Run <code>npm start</code>.");
  }

  function row(label, value, cls) {
    return (
      '<div class="account__row"><span class="account__label">' + label + "</span>" +
      '<span class="account__value ' + (cls || "") + '">' + value + "</span></div>"
    );
  }
}

/* ---- Wire up watchlist + account controls ---- */
document.getElementById("wl-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = document.getElementById("wl-input");
  addWatch(input.value);
  input.value = "";
});
document.getElementById("acct-refresh").addEventListener("click", refreshAccount);

/* ============================================================
   UI state persistence (layout, interval, preset, symbols)
   ============================================================ */
const STATE_KEY = "tv_ui_state_v1";

function persist() {
  localStorage.setItem(STATE_KEY, JSON.stringify({
    layout: state.layout,
    interval: state.interval,
    preset: state.preset,
    active: state.active,
    symbols: state.symbols,
  }));
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(STATE_KEY));
    if (s && typeof s === "object") {
      if (s.layout in LAYOUT_PANES) state.layout = s.layout;
      if (typeof s.interval === "string") state.interval = s.interval;
      if (s.preset in PRESETS) state.preset = s.preset;
      if (Number.isInteger(s.active)) state.active = s.active;
      if (Array.isArray(s.symbols) && s.symbols.length) state.symbols = s.symbols;
    }
  } catch (_) { /* ignore */ }
}

/* Reflect the loaded state in the toolbar controls. */
function syncToolbar() {
  document.querySelectorAll("#layout-seg .seg__btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.layout === state.layout));
  document.querySelectorAll("#interval-seg .seg__btn").forEach((b) =>
    b.classList.toggle("is-active", b.dataset.interval === state.interval));
  const preset = document.getElementById("preset-select");
  if (preset) preset.value = state.preset;
}

/* ============================================================
   Symbol autocomplete (Bitunix trading pairs)
   ============================================================ */
async function loadSymbolSuggestions() {
  try {
    const res = await fetch("/api/bitunix/symbols");
    if (!res.ok) return;
    const json = await res.json();
    const dl = document.getElementById("symbol-suggestions");
    const frag = document.createDocumentFragment();
    (json.symbols || []).forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s;
      frag.appendChild(opt);
    });
    dl.appendChild(frag);
  } catch (_) { /* offline — autocomplete simply stays empty */ }
}

/* ============================================================
   Boot
   ============================================================ */
loadState();
syncToolbar();
render();
renderWatchlist();
loadSymbolSuggestions();
refreshPrices();
refreshAccount();
setInterval(refreshPrices, 8000);   // live watchlist prices
setInterval(refreshAccount, 15000); // account/positions
