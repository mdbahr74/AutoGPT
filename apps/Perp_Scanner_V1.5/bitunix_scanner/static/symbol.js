    let symbol = window.BITUNIX_SYMBOL || '';
    const wsUrl = 'wss://fapi.bitunix.com/public/';
    const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 8 });
    const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });
    const pct = value => `${Number(value || 0).toFixed(2)}%`;
    const pctRate = value => `${(Number(value || 0) * 100).toFixed(4)}%`;
    const cacheBust = path => `${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`;
    let market = null;
    let book = { asks: [], bids: [] };
    let trades = [];
    let socket = null;
    let streamReconnectTimer = null;
    let apiConfig = {};
    let selectedSide = 'BUY';
    let selectedOrderType = 'LIMIT';
    let leverage = 25;
    let audioEnabled = false;
    let audioContext = null;
    let lastBlockSoundAt = 0;
    let cvdQuote = 0;
    let buyQuoteTotal = 0;
    let sellQuoteTotal = 0;
    let volumeByPrice = new Map();
    let tapeHistory = [];
    let activeImpulse = null;
    let blockTrades = [];
    let lastAgentPost = 0;
    let lastTradePrice = 0;
    let watchMarkets = [];
    let watchSymbols = [];
    let watchlistStore = { active: 'Default', lists: { Default: [] } };
    let watchLiveUpdatedAt = 0;
    let watchlistLoading = false;
    let dailyCandle = null;
    let frameCandle = null;
    let impulseHistory = null;
    let bookmapRenderPending = false;
    let lastBookmapRender = 0;
    let liquidityFrames = [];
    let liquidityRenderPending = false;
    let lastLiquidityFrame = 0;
    let liquidityHover = null;
    let tradeRenderPending = false;
    let bookRenderPending = false;
    let lastTradeRender = 0;
    let lastBookRender = 0;
    let resizeQuietUntil = 0;
    let pendingBookLabel = 'Live';
    let symbolSwitchToken = 0;
    let streamWatchdogTimer = null;
    const dashboardWidgets = window.BITUNIX_DASHBOARD_WIDGETS || [];
    const detailWidgets = window.BITUNIX_DETAIL_WIDGETS || [];
    const snapshotFields = [
      { id: 'last', label: 'Last' },
      { id: 'move24', label: '24h Move' },
      { id: 'dailyMove', label: 'Daily Open Move' },
      { id: 'frameMove', label: 'Timeframe Move' },
      { id: 'sessionDelta', label: 'Session Delta' },
      { id: 'sessionFlow', label: 'Session Flow' },
      { id: 'spread', label: 'Spread' },
      { id: 'bookImbalance', label: 'Book Imbalance' },
      { id: 'funding', label: 'Funding' },
      { id: 'volume24', label: '24h Quote Volume' },
      { id: 'range15', label: '15m Range' },
      { id: 'scanMove', label: 'Scan Move' },
      { id: 'dailyRange', label: 'Daily Range' },
      { id: 'dailyHighLow', label: 'Daily Low / High' },
      { id: 'sessionVol', label: 'Session Tape Vol' },
      { id: 'largeBlocks', label: 'Large Blocks' },
      { id: 'poc', label: 'Tape POC' },
      { id: 'impulseMove', label: 'Impulse Move' },
      { id: 'impulseVwap', label: 'Impulse VWAP' },
      { id: 'impulseHvn', label: 'Lower HVN' },
      { id: 'leverage', label: 'Max Leverage' }
    ];
    const watchColumns = [
      { key: 'symbol', label: 'Symbol', render: item => `<a class="watch-symbol ${normalize(item.symbol) === symbol ? 'active' : ''}" href="/symbol/${encodeURIComponent(item.symbol)}" style="${tickerGlowStyle(item.scan_price_change_pct)}">${watchEscape(item.symbol)}</a>` },
      { key: 'last_price', label: 'Last', render: item => Number(item.last_price || 0) ? fmt.format(item.last_price || 0) : '-' },
      { key: 'mark_price', label: 'Mark', render: item => Number(item.mark_price || 0) ? fmt.format(item.mark_price || 0) : '-' },
      { key: 'best_bid', label: 'Bid', td: () => 'class="pos"', render: item => Number(item.best_bid || 0) ? fmt.format(item.best_bid || 0) : '-' },
      { key: 'best_ask', label: 'Ask', td: () => 'class="neg"', render: item => Number(item.best_ask || 0) ? fmt.format(item.best_ask || 0) : '-' },
      { key: 'price_change_pct', label: '24h', td: item => `class="heat ${cls(item.price_change_pct)}" style="${heatStyle(item.price_change_pct, 60)}"`, render: item => pct(item.price_change_pct) },
      { key: 'range_15m_pct', label: '15m', td: item => `class="heat warn" style="${rangeHeatStyle(item.range_15m_pct)}"`, render: item => pct(item.range_15m_pct) },
      { key: 'scan_price_change_pct', label: 'Scan', td: item => `class="heat ${cls(item.scan_price_change_pct)}" style="${heatStyle(item.scan_price_change_pct, 8)}"`, render: item => pct(item.scan_price_change_pct) },
      { key: 'funding_rate', label: 'Funding', td: item => `class="${cls(item.funding_rate)}"`, render: item => `${(Number(item.funding_rate || 0) * 100).toFixed(4)}%` },
      { key: 'quote_volume', label: 'Vol', td: item => `class="heat pos" style="${volumeHeatStyle(item.quote_volume)}"`, render: item => compact.format(item.quote_volume || 0) },
      { key: 'quote_volume_15m_delta', label: 'Vol Δ', td: item => `class="heat pos" style="${volumeDeltaHeatStyle(item.quote_volume_15m_delta)}"`, render: item => compact.format(item.quote_volume_15m_delta || 0) },
      { key: 'max_leverage', label: 'Lev', render: item => Number(item.max_leverage || 0) ? `${item.max_leverage}x` : '-' }
    ];
    const watchlistsStorageKey = 'bitunix.detail.watchlists.v2';
    const legacyWatchlistStorageKey = 'bitunix.detail.watchlist.v1';
    const watchColumnWidthsStorageKey = 'bitunix.detail.watchColumnWidths.v1';

    function installWindowControls() {
      if (!window.bitunixElectron?.windowAction) return;
      document.body.classList.add('electron-window');
      const params = new URLSearchParams(window.location.search);
      if (params.get('popout') === '1') {
        const widgetId = params.get('widget') || '';
        const panel = [...document.querySelectorAll('.panel')]
          .find(item => item.dataset.panelId === widgetId || item.dataset.dashboardWidget === widgetId);
        const header = panel?.querySelector('h2');
        if (header && !header.querySelector('.panel-window-controls')) {
          const controls = document.createElement('div');
          controls.className = 'window-controls panel-window-controls';
          controls.setAttribute('aria-label', 'Window controls');
          controls.innerHTML = `
            <button type="button" data-zoom-action="out" title="Zoom out">-</button>
            <button type="button" data-zoom-action="reset" title="Reset zoom">100</button>
            <button type="button" data-zoom-action="in" title="Zoom in">+</button>
            <button type="button" data-window-action="minimize" title="Minimize">_</button>
            <button type="button" data-window-action="toggle-maximize" title="Maximize or restore">[]</button>
            <button type="button" data-window-action="close" title="Close">X</button>
          `;
          header.appendChild(controls);
        }
      }
      document.querySelectorAll('[data-window-action]').forEach(button => {
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          window.bitunixElectron.windowAction(button.dataset.windowAction);
        });
      });
      document.querySelectorAll('[data-zoom-action]').forEach(button => {
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          const action = button.dataset.zoomAction;
          if (action === 'in') window.bitunixElectron.zoomIn?.();
          else if (action === 'out') window.bitunixElectron.zoomOut?.();
          else window.bitunixElectron.resetZoom?.();
        });
      });
    }

    function widgetPanel(id, root = document) {
      return root.querySelector(`.panel[data-panel-id="${id}"]`);
    }

    function registeredWidgetPanels(widgets, root = document) {
      return widgets
        .map(widget => ({ widget, panel: widgetPanel(widget.id, root) }))
        .filter(item => item.panel);
    }

    function canDetachWidgets() {
      return Boolean(window.bitunixElectron?.detachWidget || window.open);
    }

    function beginWidgetResize() {
      resizeQuietUntil = Date.now() + 600;
      document.body.classList.add('layout-resizing');
    }

    function endWidgetResize(panel = null) {
      const followDom = panel?.matches?.('.dom-panel') && document.getElementById('domFollowPrice')?.checked;
      const followProfile = panel?.matches?.('.bookmap-panel') && document.getElementById('bookmapFollow')?.checked;
      resizeQuietUntil = Date.now() + 350;
      document.body.classList.remove('layout-resizing');
      setTimeout(() => {
        if (followDom) requestAnimationFrame(() => centerDom(true));
        if (followProfile) requestAnimationFrame(() => centerBookmapProfile(true));
      }, 360);
    }

    function isWidgetResizeQuiet() {
      return document.body.classList.contains('layout-resizing') || Date.now() < resizeQuietUntil;
    }

    function rowCapacityFor(selector, fallback, rowHeight = 24, buffer = 10) {
      const scroller = document.querySelector(selector);
      const height = scroller?.clientHeight || 0;
      if (!height) return fallback;
      return Math.max(fallback, Math.min(260, Math.ceil(height / rowHeight) + buffer));
    }

    function rowsAroundPrice(rows, target, maxRows) {
      if (rows.length <= maxRows) return rows;
      const price = Number(target || rows[Math.floor(rows.length / 2)]?.price || 0);
      const index = rows.reduce((best, row, idx) => {
        const distance = Math.abs(Number(row.price) - price);
        return distance < best.distance ? { index: idx, distance } : best;
      }, { index: 0, distance: Infinity }).index;
      const start = Math.max(0, Math.min(rows.length - maxRows, index - Math.floor(maxRows / 2)));
      return rows.slice(start, start + maxRows);
    }

    function fitRowsToScroller(scrollerSelector, rowSelector, variable, fallback, max = 42) {
      const scroller = document.querySelector(scrollerSelector);
      if (!scroller) return;
      const rows = [...document.querySelectorAll(rowSelector)].filter(row => row.getClientRects().length);
      const headerHeight = scroller.querySelector('thead')?.getBoundingClientRect().height || 0;
      const available = Math.max(0, scroller.clientHeight - headerHeight);
      const rowHeight = rows.length ? Math.max(fallback, Math.min(max, Math.floor(available / rows.length))) : fallback;
      scroller.style.setProperty(variable, `${rowHeight}px`);
    }

    function renderSizedRows() {
      renderDom();
      scheduleBookmapProfile(true);
    }

    function widgetPopoutRoute(panel) {
      if (panel.dataset.dashboardWidget) {
        return `/?widget=${encodeURIComponent(panel.dataset.dashboardWidget)}&popout=1`;
      }
      const params = new URLSearchParams(window.location.search);
      params.set('widget', panel.dataset.panelId);
      params.set('popout', '1');
      return `${window.location.pathname}?${params.toString()}`;
    }

    function detachWidget(panel, label = '') {
      if (!canDetachWidgets() || !panel) return;
      const title = `${symbol} ${label || panel.querySelector('h2 span')?.textContent || panel.dataset.panelId}`;
      const route = widgetPopoutRoute(panel);
      if (window.bitunixElectron?.detachWidget) {
        const rect = panel.getBoundingClientRect();
        const compactWidget = panel.dataset.panelId === 'tickerCard';
        const dashboardWidget = panel.dataset.dashboardWidget;
        window.bitunixElectron.detachWidget({
          panelId: dashboardWidget || panel.dataset.panelId,
          title,
          path: dashboardWidget ? '/' : `${window.location.pathname}${window.location.search}`,
          detachedKey: dashboardWidget ? `symbol:${symbol}:scanner:${panel.dataset.panelId}` : `symbol:${symbol}:${panel.dataset.panelId}`,
          width: compactWidget ? Math.max(320, Math.round(rect.width || 360)) : Math.max(700, Math.round(rect.width || 1000)),
          height: compactWidget ? Math.max(260, Math.round(rect.height || 300)) : Math.max(480, Math.round(rect.height || 720))
        });
        return;
      }
      const features = panel.dataset.panelId === 'tickerCard' ? 'popup,width=360,height=300' : 'popup,width=1000,height=720';
      const popup = window.open(route, `bitunix-${symbol}-${panel.dataset.panelId}`, features);
      if (!popup) document.getElementById('status').textContent = 'Popout blocked by browser';
      else popup.focus();
    }

    function installDetachButtons(widgets, rootId) {
      if (!canDetachWidgets()) return;
      const params = new URLSearchParams(window.location.search);
      if (params.get('popout') === '1') return;
      const root = document.getElementById(rootId);
      registeredWidgetPanels(widgets, root).forEach(({ widget, panel }) => {
        const header = panel.querySelector('h2');
        if (!header || header.querySelector('.panel-detach')) return;
        const button = document.createElement('button');
        button.className = 'panel-detach';
        button.type = 'button';
        button.textContent = 'Detach';
        button.title = `Detach ${widget.label}`;
        button.addEventListener('click', event => {
          event.preventDefault();
          event.stopPropagation();
          detachWidget(panel, widget.label);
        });
        header.appendChild(button);
      });
    }

    function applyWidgetPopoutMode(widgets, rootId) {
      const params = new URLSearchParams(window.location.search);
      const widgetId = params.get('widget');
      if (!widgetId) return;
      const root = document.getElementById(rootId);
      const target = widgetPanel(widgetId, root);
      if (!target) return;
      document.body.classList.add('widget-popout');
      document.body.classList.remove('layout-edit', 'layout-dragging');
      document.querySelector('header')?.setAttribute('hidden', '');
      document.querySelectorAll('details[open]').forEach(details => details.removeAttribute('open'));
      registeredWidgetPanels(widgets, root).forEach(({ panel }) => {
        panel.hidden = panel !== target;
        if (panel === target) {
          panel.style.left = '';
          panel.style.top = '';
          panel.style.width = '';
          panel.style.height = '';
        }
      });
      document.title = `${symbol} - ${target.querySelector('h2 span')?.textContent || widgetId} - Bitunix`;
    }

    function cls(value) {
      return Number(value || 0) > 0 ? 'pos' : Number(value || 0) < 0 ? 'neg' : '';
    }

    function movePct(current, base) {
      const c = Number(current || 0);
      const b = Number(base || 0);
      return b ? ((c - b) / b) * 100 : 0;
    }

    function positionMovePct(current, entry, side) {
      const move = movePct(current, entry);
      return side === 'short' ? -move : move;
    }

    function normalizeImpulseMode(value) {
      const mode = String(value || '').toLowerCase();
      return ['impulse', 'long', 'short'].includes(mode) ? mode : 'impulse';
    }

    function impulseStorageKey() {
      return `bitunix.dailyProfileAnchor.${normalize(symbol)}`;
    }

    function currentImpulseReferencePrice() {
      return Number(lastTradePrice || market?.last_price || market?.mark_price || 0);
    }

    function parsePriceInput(value) {
      return Number(String(value || '').replace(/,/g, '').trim());
    }

    function createManualImpulse(price, modeValue) {
      const mode = normalizeImpulseMode(modeValue);
      const now = Date.now();
      return {
        direction: mode === 'short' ? 'down' : 'up',
        startTs: now,
        startPrice: price,
        triggerTs: now,
        triggerPrice: price,
        highPrice: price,
        lowPrice: price,
        thresholdPct: 10,
        manual: true,
        mode,
        kind: mode === 'impulse' ? 'impulse' : 'position',
        positionSide: mode === 'impulse' ? null : mode
      };
    }

    function readStoredImpulse() {
      try {
        const stored = JSON.parse(localStorage.getItem(impulseStorageKey()) || 'null');
        const price = Number(stored?.startPrice || 0);
        if (!price) return null;
        const mode = normalizeImpulseMode(stored?.mode);
        return {
          ...createManualImpulse(price, mode),
          startTs: Number(stored?.startTs || Date.now()),
          triggerTs: Number(stored?.triggerTs || stored?.startTs || Date.now()),
          triggerPrice: Number(stored?.triggerPrice || price),
          highPrice: Number(stored?.highPrice || price),
          lowPrice: Number(stored?.lowPrice || price)
        };
      } catch {
        return null;
      }
    }

    function saveManualImpulse() {
      if (!activeImpulse?.manual) {
        localStorage.removeItem(impulseStorageKey());
        return;
      }
      localStorage.setItem(impulseStorageKey(), JSON.stringify({
        mode: normalizeImpulseMode(activeImpulse.mode),
        startTs: activeImpulse.startTs,
        startPrice: activeImpulse.startPrice,
        triggerTs: activeImpulse.triggerTs,
        triggerPrice: activeImpulse.triggerPrice,
        highPrice: activeImpulse.highPrice,
        lowPrice: activeImpulse.lowPrice
      }));
    }

    function syncImpulseControls() {
      const mode = document.getElementById('impulseTrackMode');
      const price = document.getElementById('impulseAnchorPrice');
      if (mode) mode.value = normalizeImpulseMode(activeImpulse?.mode);
      if (price) price.value = activeImpulse?.startPrice ? fmt.format(activeImpulse.startPrice) : '';
    }

    function setImpulseAnchor() {
      const input = document.getElementById('impulseAnchorPrice');
      const mode = document.getElementById('impulseTrackMode')?.value || 'impulse';
      const entered = parsePriceInput(input?.value);
      const price = entered || currentImpulseReferencePrice();
      if (!price || price <= 0) {
        document.getElementById('bookmapStatus').textContent = 'Enter an anchor or entry price first';
        input?.focus();
        return;
      }
      activeImpulse = createManualImpulse(price, mode);
      saveManualImpulse();
      syncImpulseControls();
      scheduleBookmapProfile(true);
      renderMarketSnapshot();
    }

    function clearImpulseAnchor() {
      activeImpulse = null;
      localStorage.removeItem(impulseStorageKey());
      const price = document.getElementById('impulseAnchorPrice');
      if (price) price.value = '';
      scheduleBookmapProfile(true);
      renderMarketSnapshot();
    }

    function normalize(value) {
      return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    function widgetTitleSuffix() {
      const params = new URLSearchParams(window.location.search);
      const widgetId = params.get('widget');
      if (!widgetId) return 'Bitunix Perp Scanner';
      const target = widgetPanel(widgetId, document.getElementById('detailGrid'));
      return `${target?.querySelector('h2 span')?.textContent || widgetId} - Bitunix`;
    }

    function setDetailSymbol(nextSymbol, { push = true, replace = false } = {}) {
      const normalized = normalize(nextSymbol);
      if (!normalized) return false;
      symbol = normalized;
      window.BITUNIX_SYMBOL = symbol;
      document.title = `${symbol} - ${widgetTitleSuffix()}`;
      const title = document.getElementById('title');
      if (title) {
        title.textContent = symbol;
        title.style.cssText = '';
      }
      const search = document.getElementById('symbolSearch');
      if (search) search.placeholder = `Symbol (${symbol})`;
      if (push && window.history?.pushState) {
        const nextUrl = `/symbol/${encodeURIComponent(symbol)}${window.location.search || ''}`;
        if (replace && window.history?.replaceState) window.history.replaceState({ symbol }, '', nextUrl);
        else window.history.pushState({ symbol }, '', nextUrl);
      }
      updateWatchActiveSymbol();
      return true;
    }

    function setElementHtml(id, html) {
      const element = document.getElementById(id);
      if (element) element.innerHTML = html;
    }

    function setElementText(id, text) {
      const element = document.getElementById(id);
      if (element) element.textContent = text;
    }

    function resetSymbolDataState({ clearUi = false } = {}) {
      market = null;
      book = { asks: [], bids: [] };
      trades = [];
      cvdQuote = 0;
      buyQuoteTotal = 0;
      sellQuoteTotal = 0;
      volumeByPrice = new Map();
      tapeHistory = [];
      activeImpulse = readStoredImpulse();
      syncImpulseControls();
      blockTrades = [];
      lastAgentPost = 0;
      lastTradePrice = 0;
      dailyCandle = null;
      frameCandle = null;
      impulseHistory = null;
      bookmapRenderPending = false;
      liquidityFrames = [];
      liquidityRenderPending = false;
      lastLiquidityFrame = 0;
      liquidityHover = null;
      tradeRenderPending = false;
      bookRenderPending = false;
      pendingBookLabel = 'Live';
      if (clearUi) {
        setElementHtml('asks', '');
        setElementHtml('bids', '');
        setElementHtml('domRows', '<tr><td colspan="5" class="muted">Loading symbol...</td></tr>');
        setElementHtml('trades', '<tr><td colspan="5" class="muted">Loading live tape...</td></tr>');
        setElementHtml('bookmapRows', '<div class="error">Loading profile...</div>');
        setElementText('tradeStatus', 'Loading live tape...');
        setElementText('bookTime', 'Loading book...');
        setElementText('liquidations', 'Loading...');
      } else {
        setElementText('tradeStatus', `Switching tape to ${symbol}...`);
        setElementText('bookTime', `Switching book to ${symbol}...`);
        setElementText('flowStatus', `Waiting for ${symbol} flow...`);
        renderTrades();
        renderFlowProfile();
        renderPressure();
        renderDom();
        scheduleBookmapProfile(true);
        requestLiquidityRender(true);
      }
      if (clearUi) {
        renderFlowProfile();
        renderPressure();
        renderMarketSnapshot();
        renderTickerCard();
        renderDom();
        scheduleBookmapProfile(true);
        requestLiquidityRender(true);
        updateCalculator();
      }
    }

    async function changeDetailSymbol(nextSymbol) {
      const normalized = normalize(nextSymbol);
      if (!normalized || normalized === symbol) return;
      const token = ++symbolSwitchToken;
      setDetailSymbol(normalized);
      resetSymbolDataState({ clearUi: false });
      setElementText('status', `Switching to ${symbol}...`);
      const search = document.getElementById('symbolSearch');
      if (search) search.value = '';
      await loadMarket();
      if (token !== symbolSwitchToken) return;
      connectStreams();
      await Promise.allSettled([
        loadDailyCandle(),
        loadFrameCandle(),
        loadImpulseHistory(),
        loadDepth(),
        loadLiquidations()
      ]);
      if (token === symbolSwitchToken) setElementText('status', `Loaded ${symbol}`);
    }

    function compareValues(a, b, key, dir) {
      const direction = dir === 'asc' ? 1 : -1;
      if (key === 'symbol') {
        return String(a[key] || '').localeCompare(String(b[key] || '')) * direction;
      }
      return (Number(a[key] || 0) - Number(b[key] || 0)) * direction;
    }

    function heatStyle(value, maxAbs) {
      const n = Number(value || 0);
      const intensity = Math.min(0.7, Math.abs(n) / maxAbs * 0.7);
      const color = n >= 0 ? '32, 201, 151' : '255, 107, 107';
      return `background: rgba(${color}, ${intensity.toFixed(3)})`;
    }

    function rangeHeatStyle(value) {
      const intensity = Math.min(0.65, Number(value || 0) / 35 * 0.65);
      return `background: rgba(139, 188, 255, ${intensity.toFixed(3)})`;
    }

    function volumeHeatStyle(value) {
      const intensity = Math.min(0.55, Math.log10(Math.max(1, Number(value || 0))) / 11 * 0.55);
      return `background: rgba(32, 201, 151, ${intensity.toFixed(3)})`;
    }

    function volumeDeltaHeatStyle(value) {
      const intensity = Math.min(0.65, Math.log10(Math.max(1, Number(value || 0))) / 9 * 0.65);
      return `background: rgba(110, 168, 254, ${intensity.toFixed(3)})`;
    }

    function tickerGlowStyle(value) {
      const n = Number(value || 0);
      if (Math.abs(n) < 0.01) return '';
      const strength = Math.min(1, Math.abs(n) / 6);
      const alpha = 0.12 + strength * 0.58;
      const glow = 6 + strength * 22;
      const color = n >= 0 ? '32, 201, 151' : '255, 107, 107';
      return [
        `background: rgba(${color}, ${(alpha * 0.32).toFixed(3)})`,
        `box-shadow: 0 0 ${glow.toFixed(0)}px rgba(${color}, ${alpha.toFixed(3)})`,
        `color: rgb(${color})`
      ].join(';');
    }

    async function loadMarket() {
      const requestSymbol = symbol;
      let data = null;
      try {
        const response = await fetch(cacheBust(`/api/market?symbol=${encodeURIComponent(requestSymbol)}`), { cache: 'no-store' });
        data = await response.json();
      } catch (error) {
        if (requestSymbol === symbol) document.getElementById('status').textContent = `Market refresh failed: ${error.message || 'network error'}`;
        return;
      }
      if (requestSymbol !== symbol) return;
      if (data.error) {
        document.getElementById('status').textContent = data.error;
        return;
      }
      const resolved = normalize(data.resolved_symbol || data.symbol);
      if (resolved && resolved !== symbol) {
        setDetailSymbol(resolved, { replace: true });
        activeImpulse = readStoredImpulse();
        syncImpulseControls();
      }
      market = data;
      document.getElementById('last').textContent = fmt.format(market.last_price || 0);
      document.getElementById('move').textContent = pct(market.price_change_pct);
      document.getElementById('move').className = cls(market.price_change_pct);
      document.getElementById('funding').textContent = pctRate(market.funding_rate);
      document.getElementById('funding').className = cls(market.funding_rate);
      document.getElementById('volume').textContent = compact.format(market.quote_volume || 0);
      document.getElementById('range15').textContent = pct(market.range_15m_pct);
      document.getElementById('range15').className = 'warn';
      document.getElementById('scanMove').textContent = pct(market.scan_price_change_pct);
      document.getElementById('scanMove').className = cls(market.scan_price_change_pct);
      document.getElementById('title').style.cssText = tickerGlowStyle(market.scan_price_change_pct);
      renderMarketSnapshot();
      updateCalculator();
      scheduleBookmapProfile();
    }

    function normalizeCandle(row, previous = null) {
      if (!row) return null;
      const open = Number(row.open || row.o || 0);
      const high = Number(row.high || row.h || 0);
      const low = Number(row.low || row.l || 0);
      const close = Number(row.close || row.c || 0);
      return {
        open,
        high,
        low,
        close,
        previousClose: Number(previous?.close || previous?.c || 0),
        quoteVolume: Number(row.quoteVol || row.quote_volume || row.quoteVolume || 0),
        baseVolume: Number(row.baseVol || row.base_volume || row.baseVolume || 0),
        time: Number(row.time || row.ts || 0)
      };
    }

    async function loadDailyCandle() {
      const requestSymbol = symbol;
      try {
        const response = await fetch(cacheBust(`/api/kline?symbol=${encodeURIComponent(requestSymbol)}&interval=1d&limit=2`), { cache: 'no-store' });
        const data = await response.json();
        if (requestSymbol !== symbol) return;
        if (data.error) throw new Error(data.error);
        const rows = Array.isArray(data.rows) ? [...data.rows].sort((a, b) => Number(b.time || 0) - Number(a.time || 0)) : [];
        dailyCandle = normalizeCandle(rows[0], rows[1]);
      } catch {
        if (requestSymbol !== symbol) return;
        if (!dailyCandle) dailyCandle = null;
      }
      renderMarketSnapshot();
      scheduleBookmapProfile(true);
    }

    async function loadFrameCandle() {
      const requestSymbol = symbol;
      const interval = document.getElementById('snapshotFrame')?.value || '5m';
      document.getElementById('frameMoveLabel').textContent = `${interval} Move`;
      try {
        const response = await fetch(cacheBust(`/api/kline?symbol=${encodeURIComponent(requestSymbol)}&interval=${encodeURIComponent(interval)}&limit=2`), { cache: 'no-store' });
        const data = await response.json();
        if (requestSymbol !== symbol) return;
        if (data.error) throw new Error(data.error);
        const rows = Array.isArray(data.rows) ? [...data.rows].sort((a, b) => Number(b.time || 0) - Number(a.time || 0)) : [];
        frameCandle = normalizeCandle(rows[0], rows[1]);
      } catch {
        if (requestSymbol !== symbol) return;
        if (!frameCandle) frameCandle = null;
      }
      renderMarketSnapshot();
    }

    async function loadImpulseHistory() {
      const requestSymbol = symbol;
      const threshold = Number(document.getElementById('impulseHistoryThreshold')?.value || 25);
      const limit = Number(document.getElementById('impulseHistoryRange')?.value || 90);
      if (!impulseHistory) document.getElementById('impulseHistoryStatus').textContent = 'Loading daily candles';
      try {
        const response = await fetch(cacheBust(`/api/impulse?symbol=${encodeURIComponent(requestSymbol)}&threshold=${encodeURIComponent(threshold)}&limit=${encodeURIComponent(limit)}`), { cache: 'no-store' });
        const data = await response.json();
        if (requestSymbol !== symbol) return;
        if (data.error) throw new Error(data.error);
        impulseHistory = data;
      } catch (error) {
        if (requestSymbol !== symbol) return;
        if (!impulseHistory) impulseHistory = { error: error.message || 'Impulse history failed', rows: [], impulses: [] };
        document.getElementById('impulseHistoryStatus').textContent = `Refresh failed: ${error.message || 'network error'}`;
      }
      renderImpulseHistory();
      renderTickerCard();
    }

    function impulseStateClass(state) {
      const value = String(state || '').toLowerCase();
      if (value.includes('high')) return 'pressing';
      if (value.includes('reclaim')) return 'reclaiming';
      if (value.includes('deep') || value.includes('pull')) return 'retrace';
      return '';
    }

    function impulseStateBadge(state) {
      return `<span class="impulse-state ${impulseStateClass(state)}">${state || '-'}</span>`;
    }

    function shortDate(ts) {
      if (!ts) return '-';
      return new Date(Number(ts) * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    }

    function renderImpulseHistory() {
      const payload = impulseHistory || {};
      if (payload.error) {
        document.getElementById('impulseHistoryStatus').textContent = payload.error;
        document.getElementById('impulseHistoryChart').innerHTML = `<span class="error">${payload.error}</span>`;
        document.getElementById('impulseHistoryRows').innerHTML = '<tr><td colspan="6" class="muted">No impulse history loaded.</td></tr>';
        renderTickerCard();
        return;
      }
      const active = payload.active;
      document.getElementById('impulseHistoryStatus').textContent = `${payload.rows?.length || 0} daily candles · ${payload.threshold_pct || 0}% spike`;
      setMetric('impulseHistoryState', active ? active.state : 'Watching', active ? impulseStateClass(active.state) : '');
      setMetric('impulseHistoryMove', active ? pct(active.move_pct) : '-', active ? cls(active.move_pct) : '');
      setMetric('impulseHistoryOffHigh', active ? pct(active.off_high_pct) : '-', active ? cls(active.off_high_pct) : '');
      setMetric('impulseHistoryDrawdown', active ? pct(active.drawdown_pct) : '-', active ? cls(active.drawdown_pct) : '');
      setMetric('impulseHistoryRebound', active ? pct(active.rebound_pct) : '-', active ? cls(active.rebound_pct) : '');
      setMetric('impulseHistoryDaysHigh', active ? `${Number(active.days_since_high || 0).toFixed(1)}d` : '-');
      document.getElementById('impulseHistoryChart').innerHTML = impulseHistorySvg(payload);
      const impulses = Array.isArray(payload.impulses) ? [...payload.impulses].reverse() : [];
      document.getElementById('impulseHistoryRows').innerHTML = impulses.length ? impulses.map((item, index) => `
        <tr>
          <td>${index === 0 ? 'Current' : `Cycle ${impulses.length - index}`}</td>
          <td>${shortDate(item.start_ts)} · ${fmt.format(item.start_price || 0)}</td>
          <td>${shortDate(item.high_ts)} · ${fmt.format(item.high_price || 0)}</td>
          <td class="${cls(item.move_pct)}">${pct(item.move_pct)}</td>
          <td class="${cls(item.off_high_pct)}">${pct(item.off_high_pct)}</td>
          <td>${impulseStateBadge(item.state)}</td>
        </tr>
      `).join('') : '<tr><td colspan="6" class="muted">No daily impulse has crossed the selected spike threshold yet.</td></tr>';
    }

    function impulseHistorySvg(payload) {
      const rows = Array.isArray(payload.rows) ? payload.rows : [];
      if (rows.length < 2) return '<span class="muted">Need more daily candles for an impulse chart.</span>';
      const active = payload.active || {};
      const width = 720;
      const height = 170;
      const pad = { left: 42, right: 18, top: 14, bottom: 24 };
      const lows = rows.map(row => Number(row.low || row.close || 0)).filter(Boolean);
      const highs = rows.map(row => Number(row.high || row.close || 0)).filter(Boolean);
      const min = Math.min(...lows, Number(active.start_price || Infinity), Number(active.pullback_low_price || Infinity));
      const max = Math.max(...highs, Number(active.high_price || 0), Number(active.current_price || 0));
      const span = max - min || Math.max(1, max * 0.001);
      const xFor = index => pad.left + (rows.length === 1 ? 0 : (index / (rows.length - 1)) * (width - pad.left - pad.right));
      const yFor = price => pad.top + (1 - ((Number(price || 0) - min) / span)) * (height - pad.top - pad.bottom);
      const line = rows.map((row, index) => `${xFor(index).toFixed(1)},${yFor(row.close).toFixed(1)}`).join(' ');
      const bars = rows.map((row, index) => {
        const x = xFor(index);
        const y1 = yFor(row.high);
        const y2 = yFor(row.low);
        const color = Number(row.close || 0) >= Number(row.open || 0) ? 'rgba(32,201,151,.42)' : 'rgba(255,107,107,.42)';
        return `<line x1="${x.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="2"></line>`;
      }).join('');
      const marker = (index, price, color, label) => {
        if (!Number.isFinite(Number(index)) || !Number(price)) return '';
        const x = xFor(Math.max(0, Math.min(rows.length - 1, Number(index))));
        const y = yFor(price);
        return `
          <line x1="${x.toFixed(1)}" y1="${pad.top}" x2="${x.toFixed(1)}" y2="${height - pad.bottom}" stroke="${color}" stroke-dasharray="4 4" opacity=".65"></line>
          <circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="4" fill="${color}"></circle>
          <text class="impulse-chart-label" x="${Math.min(width - 72, x + 6).toFixed(1)}" y="${Math.max(12, y - 6).toFixed(1)}">${label}</text>`;
      };
      const hline = (price, color, label) => {
        if (!Number(price)) return '';
        const y = yFor(price);
        return `
          <line x1="${pad.left}" y1="${y.toFixed(1)}" x2="${width - pad.right}" y2="${y.toFixed(1)}" stroke="${color}" opacity=".58"></line>
          <text class="impulse-chart-label" x="${pad.left + 4}" y="${(y - 4).toFixed(1)}">${label} ${fmt.format(price)}</text>`;
      };
      return `
        <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Daily impulse history">
          <rect x="0" y="0" width="${width}" height="${height}" fill="#101418"></rect>
          ${bars}
          <polyline points="${line}" fill="none" stroke="rgba(110,168,254,.95)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"></polyline>
          ${hline(active.start_price, 'rgba(110,168,254,.72)', 'Anchor')}
          ${hline(active.high_price, 'rgba(255,209,102,.85)', 'High')}
          ${hline(active.pullback_low_price, 'rgba(255,107,107,.65)', 'Low')}
          ${hline(active.current_price, 'rgba(237,242,247,.75)', 'Now')}
          ${marker(active.start_index, active.start_price, 'rgb(110,168,254)', 'start')}
          ${marker(active.high_index, active.high_price, 'rgb(255,209,102)', 'high')}
          ${marker(active.pullback_low_index, active.pullback_low_price, 'rgb(255,107,107)', 'pullback')}
        </svg>`;
    }

    function snapshotHiddenFields() {
      try {
        return new Set(JSON.parse(localStorage.getItem('bitunix.detail.snapshotHidden.v1') || '[]'));
      } catch {
        return new Set();
      }
    }

    function saveSnapshotHiddenFields(hidden) {
      localStorage.setItem('bitunix.detail.snapshotHidden.v1', JSON.stringify([...hidden]));
    }

    function applySnapshotVisibility() {
      const hidden = snapshotHiddenFields();
      document.querySelectorAll('[data-snapshot-id]').forEach(card => {
        card.hidden = hidden.has(card.dataset.snapshotId);
      });
      document.querySelectorAll('#snapshotFieldControls input[data-snapshot-field]').forEach(input => {
        input.checked = !hidden.has(input.dataset.snapshotField);
      });
    }

    function renderSnapshotFieldControls() {
      document.getElementById('snapshotFieldControls').innerHTML = snapshotFields.map(field => `
        <label><input type="checkbox" data-snapshot-field="${field.id}" checked> ${field.label}</label>
      `).join('');
      document.querySelectorAll('#snapshotFieldControls input[data-snapshot-field]').forEach(input => {
        input.addEventListener('change', () => {
          const hidden = snapshotHiddenFields();
          if (input.checked) hidden.delete(input.dataset.snapshotField);
          else hidden.add(input.dataset.snapshotField);
          saveSnapshotHiddenFields(hidden);
          applySnapshotVisibility();
        });
      });
      document.querySelectorAll('.snapshot-card[data-snapshot-id]').forEach(card => {
        card.addEventListener('click', event => {
          if (!event.altKey) return;
          const hidden = snapshotHiddenFields();
          hidden.add(card.dataset.snapshotId);
          saveSnapshotHiddenFields(hidden);
          applySnapshotVisibility();
        });
      });
      applySnapshotVisibility();
    }

    function setMetric(id, value, className = '') {
      const element = document.getElementById(id);
      if (!element) return;
      element.textContent = value;
      element.className = className;
    }

    function setText(id, value, className = null) {
      const element = document.getElementById(id);
      if (!element) return;
      element.textContent = value;
      if (className !== null) element.className = className;
    }

    function setRangeIndicator(fillId, pinId, low, high, value) {
      const fill = document.getElementById(fillId);
      const pin = document.getElementById(pinId);
      if (!fill || !pin) return;
      const l = Number(low || 0);
      const h = Number(high || 0);
      const v = Number(value || 0);
      const position = h > l ? Math.max(0, Math.min(100, ((v - l) / (h - l)) * 100)) : 0;
      fill.style.width = `${position.toFixed(1)}%`;
      pin.style.left = `${position.toFixed(1)}%`;
    }

    function historyRange() {
      const rows = Array.isArray(impulseHistory?.rows) ? impulseHistory.rows : [];
      const lows = rows.map(row => Number(row.low || 0)).filter(value => value > 0);
      const highs = rows.map(row => Number(row.high || 0)).filter(value => value > 0);
      if (lows.length && highs.length) {
        return {
          low: Math.min(...lows),
          high: Math.max(...highs),
          label: `${document.getElementById('impulseHistoryRange')?.value || rows.length}d Range`
        };
      }
      const athLow = Number(market?.scanner_ath_low_price || 0);
      const athHigh = Number(market?.scanner_ath_price || 0);
      return {
        low: athLow || Number(market?.low_price || 0),
        high: athHigh || Number(market?.high_price || 0),
        label: 'Tracked Range'
      };
    }

    function renderTickerCard() {
      const last = Number(lastTradePrice || market?.last_price || 0);
      const base = market?.base || symbol.replace(/USDT$/i, '').replace(/USD$/i, '') || symbol;
      const quote = market?.quote || 'USDT';
      const move = Number(market?.price_change_pct || 0);
      const moveBase = Number(market?.open_price || dailyCandle?.open || 0);
      const moveAmount = last && moveBase ? last - moveBase : 0;
      const status = String(market?.status || 'OPEN').toUpperCase();
      const isOpen = status === 'OPEN';
      const bestBid = Number(book.bids[0]?.[0] || 0);
      const bestAsk = Number(book.asks[0]?.[0] || 0);
      const dayLow = Number(dailyCandle?.low || market?.low_price || 0);
      const dayHigh = Number(dailyCandle?.high || market?.high_price || 0);
      const longRange = historyRange();

      setText('tickerCardIcon', base.slice(0, 2) || '--');
      setText('tickerCardSymbol', `${symbol}.P`);
      setText('tickerCardPair', `${base} / ${quote} PERPETUAL CONTRACT`);
      setText('tickerCardExchange', 'Bitunix');
      setText('tickerCardLast', last ? fmt.format(last) : '-');
      setText('tickerCardQuote', quote);
      setText('tickerCardMove', `${moveAmount ? fmt.format(moveAmount) : ''} ${pct(move)}`.trim(), cls(move));
      setText('tickerCardMarketState', isOpen ? 'Market open' : status);
      setText('tickerCardStatus', bestBid && bestAsk ? `Spread ${pct(((bestAsk - bestBid) / bestAsk) * 100)}` : 'Live');
      setText('tickerCardBid', bestBid ? `${fmt.format(bestBid)} Bid` : 'Bid -');
      setText('tickerCardAsk', bestAsk ? `${fmt.format(bestAsk)} Ask` : 'Ask -');
      setText('tickerCardDayRangeText', dayLow && dayHigh ? `${fmt.format(dayLow)} - ${fmt.format(dayHigh)}` : '-');
      setText('tickerCardHistoryRangeLabel', longRange.label);
      setText('tickerCardHistoryRangeText', longRange.low && longRange.high ? `${fmt.format(longRange.low)} - ${fmt.format(longRange.high)}` : '-');
      document.getElementById('tickerCardMarketDot')?.classList.toggle('open', isOpen);
      document.getElementById('tickerCardMarketDot')?.classList.toggle('closed', !isOpen);
      setRangeIndicator('tickerCardDayRangeFill', 'tickerCardDayRangePin', dayLow, dayHigh, last);
      setRangeIndicator('tickerCardHistoryRangeFill', 'tickerCardHistoryRangePin', longRange.low, longRange.high, last);
    }

    function renderMarketSnapshot() {
      const last = Number(market?.last_price || lastTradePrice || 0);
      const dailyMove = movePct(last, dailyCandle?.open || market?.open_price);
      const frameMove = movePct(last, frameCandle?.open);
      const dailyRange = dailyCandle?.low ? ((dailyCandle.high - dailyCandle.low) / dailyCandle.low) * 100 : 0;
      const bidQuote = book.bids.reduce((total, level) => total + levelVol(level), 0);
      const askQuote = book.asks.reduce((total, level) => total + levelVol(level), 0);
      const totalBook = bidQuote + askQuote;
      const bookImbalance = totalBook ? ((bidQuote - askQuote) / totalBook) * 100 : 0;
      const bestAsk = Number(book.asks[0]?.[0] || 0);
      const bestBid = Number(book.bids[0]?.[0] || 0);
      const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
      const spreadPct = bestAsk ? (spread / bestAsk) * 100 : 0;
      const sessionVol = buyQuoteTotal + sellQuoteTotal;
      const sessionFlow = sessionVol ? (cvdQuote / sessionVol) * 100 : 0;
      const poc = [...volumeByPrice.values()].sort((a, b) => b.total - a.total)[0];
      const impulse = impulseAnalytics();
      setMetric('dailyMove', dailyMove ? pct(dailyMove) : '-', cls(dailyMove));
      setMetric('frameMove', frameMove ? pct(frameMove) : '-', cls(frameMove));
      setMetric('sessionDelta', sessionVol ? compact.format(cvdQuote) : '-', cls(cvdQuote));
      setMetric('sessionFlow', sessionVol ? pct(sessionFlow) : '-', cls(sessionFlow));
      setMetric('snapshotSpread', spread ? `${fmt.format(spread)} · ${spreadPct.toFixed(4)}%` : '-');
      setMetric('snapshotBookImbalance', totalBook ? pct(bookImbalance) : '-', cls(bookImbalance));
      setMetric('dailyRange', dailyRange ? pct(dailyRange) : '-', 'warn');
      setMetric('dailyHighLow', dailyCandle?.low && dailyCandle?.high ? `${fmt.format(dailyCandle.low)} / ${fmt.format(dailyCandle.high)}` : '-');
      setMetric('sessionVol', sessionVol ? compact.format(sessionVol) : '-');
      setMetric('snapshotLargeBlocks', String(blockTrades.length));
      setMetric('snapshotPoc', poc?.total ? `${poc.price} · ${compact.format(poc.total)}` : '-');
      setMetric('snapshotImpulseMove', impulse.active ? `${impulse.shortLabel} ${pct(impulse.move)}` : 'Watching', impulse.active ? cls(impulse.move) : '');
      setMetric('snapshotImpulseVwap', impulse.active && impulse.vwap ? fmt.format(impulse.vwap) : '-');
      setMetric('snapshotImpulseHvn', impulse.active && impulse.lowerHvn ? `${impulse.lowerHvn.price} · ${compact.format(impulse.lowerHvn.total)}` : '-');
      setMetric('snapshotLeverage', market?.max_leverage ? `${market.max_leverage}x` : '-');
      renderTickerCard();
    }

    async function loadApiStatus() {
      const response = await fetch(cacheBust('/api/config'), { cache: 'no-store' });
      apiConfig = await response.json();
      document.getElementById('orderMode').textContent = apiConfig.trading_live
        ? 'Live'
        : apiConfig.trading_configured
          ? 'Dry run'
          : 'Disabled';
      document.getElementById('apiStatus').innerHTML = `
        <tr><td>Bitunix Market Data</td><td class="api-ok">Public</td></tr>
        <tr><td>CoinGlass</td><td class="${apiConfig.coinglass_configured ? 'api-ok' : 'api-warn'}">${apiConfig.coinglass_configured ? 'Configured' : 'Set COINGLASS_API_KEY'}</td></tr>
        <tr><td>Bitunix Trading Keys</td><td class="${apiConfig.trading_configured ? 'api-ok' : 'api-warn'}">${apiConfig.trading_configured ? 'Configured' : 'Set BITUNIX_API_KEY / BITUNIX_SECRET_KEY'}</td></tr>
        <tr><td>Trading Mode</td><td class="${apiConfig.trading_live ? 'api-ok' : 'api-warn'}">${apiConfig.trading_live ? 'Live orders enabled' : 'Disabled / dry run'}</td></tr>
        <tr><td>Live Enable</td><td><code>TRADING_ENABLED=true</code></td></tr>
        <tr><td>Dry Run</td><td><code>TRADING_DRY_RUN=${apiConfig.trading_dry_run ? 'true' : 'false'}</code></td></tr>`;
    }

    async function loadWatchlist() {
      if (watchlistLoading) return;
      watchlistLoading = true;
      try {
        const response = await fetch(cacheBust('/api/markets?limit=1000'), { cache: 'no-store' });
        const data = await response.json();
        if (Array.isArray(data)) {
          mergeWatchMarkets(data);
          renderWatchlist();
        }
      } catch {
        document.getElementById('watchStatus').textContent = `${currentWatchlistName()} · ${watchSymbols.length} saved · refresh failed`;
      } finally {
        watchlistLoading = false;
      }
      await loadLiveWatchlist();
    }

    async function loadLiveWatchlist() {
      if (!watchSymbols.length) {
        renderWatchlist();
        return;
      }
      try {
        const query = watchSymbols.map(encodeURIComponent).join(',');
        const response = await fetch(cacheBust(`/api/live-watchlist?symbols=${query}`), { cache: 'no-store' });
        const data = await response.json();
        if (Array.isArray(data?.markets)) {
          mergeWatchMarkets(data.markets);
          watchLiveUpdatedAt = Number(data.ts || Date.now());
          renderWatchlist();
        } else if (data?.error) {
          document.getElementById('watchStatus').textContent = `${currentWatchlistName()} · ${watchSymbols.length} saved · live refresh failed`;
        }
      } catch {
        document.getElementById('watchStatus').textContent = `${currentWatchlistName()} · ${watchSymbols.length} saved · live refresh failed`;
      }
    }

    function mergeWatchMarkets(markets) {
      const merged = new Map(watchMarkets.map(item => [normalize(item.symbol), item]));
      markets.forEach(item => {
        const key = normalize(item?.symbol);
        if (!key) return;
        merged.set(key, { ...(merged.get(key) || {}), ...item });
      });
      watchMarkets = [...merged.values()];
    }

    function watchEscape(value) {
      return String(value ?? '').replace(/[&<>"']/g, char => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[char]));
    }

    function readWatchJson(key, fallback) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '');
        return parsed ?? fallback;
      } catch {
        return fallback;
      }
    }

    function uniqueWatchSymbols(values) {
      return [...new Set((values || []).map(normalize).filter(Boolean))];
    }

    function normalizeWatchlistName(value) {
      const name = String(value || '').replace(/\s+/g, ' ').trim();
      return name ? name.slice(0, 40) : 'Default';
    }

    function readWatchlistStore() {
      const parsed = readWatchJson(watchlistsStorageKey, null);
      const lists = {};
      if (parsed?.lists && typeof parsed.lists === 'object') {
        Object.entries(parsed.lists).forEach(([name, values]) => {
          const listName = normalizeWatchlistName(name);
          lists[listName] = uniqueWatchSymbols(Array.isArray(values) ? values : []);
        });
      }
      const legacy = uniqueWatchSymbols(readWatchJson(legacyWatchlistStorageKey, []));
      if (!Object.keys(lists).length && legacy.length) lists.Default = legacy;
      if (!Object.keys(lists).length) lists.Default = [];
      const active = normalizeWatchlistName(parsed?.active || Object.keys(lists)[0] || 'Default');
      return {
        active: lists[active] ? active : Object.keys(lists)[0],
        lists
      };
    }

    function writeWatchlistStore() {
      const active = currentWatchlistName();
      watchlistStore.lists[active] = uniqueWatchSymbols(watchSymbols);
      localStorage.setItem(watchlistsStorageKey, JSON.stringify({
        active,
        lists: watchlistStore.lists
      }));
      localStorage.setItem(legacyWatchlistStorageKey, JSON.stringify(watchlistStore.lists[active]));
    }

    function currentWatchlistName() {
      return normalizeWatchlistName(watchlistStore.active);
    }

    function readWatchSymbols() {
      watchlistStore = readWatchlistStore();
      return uniqueWatchSymbols(watchlistStore.lists[currentWatchlistName()] || []);
    }

    function writeWatchSymbols() {
      writeWatchlistStore();
      renderWatchlistSelector();
    }

    function renderWatchlistSelector() {
      const select = document.getElementById('watchListSelect');
      const input = document.getElementById('watchListName');
      if (!select || !input) return;
      const names = Object.keys(watchlistStore.lists);
      select.innerHTML = names.map(name => `<option value="${watchEscape(name)}">${watchEscape(name)}</option>`).join('');
      select.value = currentWatchlistName();
      input.value = currentWatchlistName();
      const deleteButton = document.getElementById('watchListDelete');
      if (deleteButton) deleteButton.disabled = names.length <= 1;
    }

    function setActiveWatchlist(name) {
      const listName = normalizeWatchlistName(name);
      if (!watchlistStore.lists[listName]) watchlistStore.lists[listName] = [];
      watchlistStore.active = listName;
      watchSymbols = uniqueWatchSymbols(watchlistStore.lists[listName]);
      writeWatchlistStore();
      renderWatchlistSelector();
      renderWatchlist();
      loadLiveWatchlist();
    }

    function saveWatchlistName() {
      const listName = normalizeWatchlistName(document.getElementById('watchListName')?.value || currentWatchlistName());
      watchlistStore.active = listName;
      watchlistStore.lists[listName] = uniqueWatchSymbols(watchSymbols);
      writeWatchSymbols();
      renderWatchlist();
      document.getElementById('watchStatus').textContent = `${listName} saved · ${watchSymbols.length} symbols`;
    }

    function createWatchlist() {
      let index = Object.keys(watchlistStore.lists).length + 1;
      let name = `List ${index}`;
      while (watchlistStore.lists[name]) {
        index += 1;
        name = `List ${index}`;
      }
      watchlistStore.lists[name] = [];
      setActiveWatchlist(name);
      document.getElementById('watchListName')?.focus();
      document.getElementById('watchListName')?.select();
    }

    function deleteWatchlist() {
      const name = currentWatchlistName();
      const names = Object.keys(watchlistStore.lists);
      if (names.length <= 1) return;
      delete watchlistStore.lists[name];
      watchlistStore.active = Object.keys(watchlistStore.lists)[0] || 'Default';
      watchSymbols = uniqueWatchSymbols(watchlistStore.lists[currentWatchlistName()]);
      writeWatchlistStore();
      renderWatchlistSelector();
      renderWatchlist();
    }

    function resolveWatchSymbol(query) {
      const wanted = normalize(query);
      if (!wanted) return '';
      const candidates = [];
      for (const item of watchMarkets) {
        const itemSymbol = normalize(item.symbol);
        const base = normalize(item.base);
        const quote = normalize(item.quote);
        const baseQuote = `${base}${quote}`;
        const quoteRank = quote === 'USDT' ? 0 : quote === 'USDC' ? 1 : quote === 'USD' ? 2 : 3;
        if (wanted === itemSymbol) return item.symbol;
        if (wanted === base) candidates.push([1, quoteRank, item.symbol]);
        else if (wanted === baseQuote) candidates.push([2, quoteRank, item.symbol]);
        else if (itemSymbol.startsWith(wanted) || base.startsWith(wanted)) candidates.push([3, quoteRank, item.symbol]);
        else if (wanted.startsWith(base) && base) candidates.push([4, quoteRank, item.symbol]);
        else if (itemSymbol.includes(wanted) || baseQuote.includes(wanted)) candidates.push([5, quoteRank, item.symbol]);
      }
      return candidates.sort((a, b) => a[0] - b[0] || a[1] - b[1] || String(a[2]).localeCompare(String(b[2])))[0]?.[2] || wanted;
    }

    function saveWatchlist(message = 'Saved') {
      writeWatchSymbols();
      document.getElementById('watchStatus').textContent = `${currentWatchlistName()} · ${message} · ${watchSymbols.length} saved`;
    }

    function addWatchSymbol(query) {
      const resolved = resolveWatchSymbol(query);
      if (!resolved) return;
      const normalized = normalize(resolved);
      if (!watchSymbols.includes(normalized)) {
        watchSymbols.push(normalized);
      }
      writeWatchSymbols();
      document.getElementById('watchAddSymbol').value = '';
      renderWatchlist();
      loadLiveWatchlist();
    }

    function removeWatchSymbol(query) {
      const normalized = normalize(query);
      watchSymbols = watchSymbols.filter(item => item !== normalized);
      writeWatchSymbols();
      renderWatchlist();
    }

    function visibleWatchColumns() {
      const hidden = new Set(JSON.parse(localStorage.getItem('bitunix.detail.watchHiddenColumns.v1') || '[]'));
      return watchColumns.filter(column => !hidden.has(column.key));
    }

    function setHiddenWatchColumn(key, hidden) {
      const hiddenSet = new Set(JSON.parse(localStorage.getItem('bitunix.detail.watchHiddenColumns.v1') || '[]'));
      if (hidden) hiddenSet.add(key);
      else hiddenSet.delete(key);
      localStorage.setItem('bitunix.detail.watchHiddenColumns.v1', JSON.stringify([...hiddenSet]));
      renderWatchlist();
    }

    function renderWatchColumnControls() {
      const hidden = new Set(JSON.parse(localStorage.getItem('bitunix.detail.watchHiddenColumns.v1') || '[]'));
      document.getElementById('watchColumnControls').innerHTML = watchColumns.map(column => `
        <label><input type="checkbox" data-column="${column.key}" ${hidden.has(column.key) ? '' : 'checked'}> ${column.label}</label>
      `).join('');
      document.querySelectorAll('#watchColumnControls input[data-column]').forEach(input => {
        input.addEventListener('change', () => setHiddenWatchColumn(input.dataset.column, !input.checked));
      });
    }

    function readWatchColumnWidths() {
      const parsed = readWatchJson(watchColumnWidthsStorageKey, {});
      return parsed && typeof parsed === 'object' ? parsed : {};
    }

    function defaultWatchColumnWidth(key) {
      return {
        symbol: 120,
        last_price: 104,
        mark_price: 104,
        best_bid: 104,
        best_ask: 104,
        price_change_pct: 82,
        range_15m_pct: 82,
        scan_price_change_pct: 82,
        funding_rate: 92,
        quote_volume: 104,
        quote_volume_15m_delta: 104,
        max_leverage: 70
      }[key] || 92;
    }

    function watchColumnWidth(key) {
      const stored = Number(readWatchColumnWidths()[key] || 0);
      return Math.max(54, Math.min(260, stored || defaultWatchColumnWidth(key)));
    }

    function renderWatchColumnGroup(columns) {
      const colgroup = document.getElementById('watchCols');
      const table = document.querySelector('.watchlist-table');
      if (!colgroup || !table) return;
      const widths = columns.map(column => [column.key, watchColumnWidth(column.key)]);
      colgroup.innerHTML = widths
        .map(([key, width]) => `<col data-watch-col="${watchEscape(key)}" style="width:${width}px">`)
        .join('');
      table.style.minWidth = `${widths.reduce((total, [, width]) => total + width, 0)}px`;
    }

    function applyWatchColumnWidth(key, width) {
      document.querySelectorAll('#watchCols col').forEach(col => {
        if (col.dataset.watchCol === key) col.style.width = `${width}px`;
      });
    }

    function installWatchColumnResizers() {
      document.querySelectorAll('[data-resize-column]').forEach(handle => {
        handle.addEventListener('pointerdown', event => {
          event.preventDefault();
          event.stopPropagation();
          const key = handle.dataset.resizeColumn;
          const startX = event.clientX;
          const startWidth = watchColumnWidth(key);
          const widths = readWatchColumnWidths();
          const move = moveEvent => {
            const width = Math.max(54, Math.min(260, startWidth + moveEvent.clientX - startX));
            widths[key] = Math.round(width);
            applyWatchColumnWidth(key, widths[key]);
          };
          const up = () => {
            localStorage.setItem(watchColumnWidthsStorageKey, JSON.stringify(widths));
            window.removeEventListener('pointermove', move);
          };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up, { once: true });
        });
      });
    }

    function hideWatchRowMenu() {
      const menu = document.getElementById('watchRowMenu');
      if (menu) menu.hidden = true;
    }

    function showWatchRowMenu(symbolValue, x, y) {
      const menu = document.getElementById('watchRowMenu');
      if (!menu) return;
      const safeSymbol = watchEscape(symbolValue);
      const safeList = watchEscape(currentWatchlistName());
      menu.innerHTML = `
        <button type="button" data-watch-menu-open>Open ${safeSymbol}</button>
        <button type="button" data-watch-menu-copy>Copy symbol</button>
        <button type="button" class="danger" data-watch-menu-remove>Remove from ${safeList}</button>
      `;
      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
      menu.hidden = false;
      const rect = menu.getBoundingClientRect();
      menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - rect.width - 6))}px`;
      menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - rect.height - 6))}px`;
      menu.querySelector('[data-watch-menu-open]')?.addEventListener('click', () => {
        hideWatchRowMenu();
        changeDetailSymbol(symbolValue);
      });
      menu.querySelector('[data-watch-menu-copy]')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard?.writeText(symbolValue);
        } catch {
          // Clipboard permission can be unavailable in some detached-window contexts.
        }
        hideWatchRowMenu();
      });
      menu.querySelector('[data-watch-menu-remove]')?.addEventListener('click', () => {
        hideWatchRowMenu();
        removeWatchSymbol(symbolValue);
      });
    }

    function renderWatchlist() {
      const filter = normalize(document.getElementById('watchFilter').value);
      const [sortKey, sortDir] = document.getElementById('watchSort').value.split(':');
      const saved = new Set(watchSymbols);
      const rows = watchMarkets
        .filter(item => saved.has(normalize(item.symbol)))
        .filter(item => item.status === 'OPEN')
        .filter(item => {
          if (!filter) return true;
          return [item.symbol, item.base, item.quote, `${item.base}${item.quote}`]
            .map(normalize)
            .join(' ')
            .includes(filter);
        })
        .sort((a, b) => compareValues(a, b, sortKey, sortDir));
      const columns = visibleWatchColumns();
      renderWatchColumnGroup(columns);
      document.getElementById('watchHead').innerHTML = `<tr>${columns.map(column => `
        <th data-watch-column="${watchEscape(column.key)}">
          <span class="watch-col-head"><span>${watchEscape(column.label)}</span></span>
          <button class="watch-col-resize" data-resize-column="${watchEscape(column.key)}" type="button" title="Drag to resize ${watchEscape(column.label)}"></button>
        </th>
      `).join('')}</tr>`;
      const hiddenCount = watchSymbols.length - rows.length;
      const updated = watchLiveUpdatedAt ? new Date(watchLiveUpdatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'cached';
      document.getElementById('watchStatus').textContent = `${currentWatchlistName()} · ${watchSymbols.length} saved · ${rows.length} open${hiddenCount > 0 ? ` · ${hiddenCount} hidden` : ''} · ${updated}`;
      document.getElementById('watchRows').innerHTML = rows.length ? rows.map(item => `
        <tr data-watch-symbol="${watchEscape(item.symbol)}">
          ${columns.map(column => `<td ${column.td ? column.td(item) : ''}>${column.render(item)}</td>`).join('')}
        </tr>`).join('') : `<tr><td colspan="${Math.max(1, columns.length)}" class="muted">Watchlist is empty. Add a symbol to start.</td></tr>`;
      installWatchColumnResizers();
      document.querySelectorAll('#watchRows tr[data-watch-symbol]').forEach(row => {
        row.addEventListener('contextmenu', event => {
          event.preventDefault();
          showWatchRowMenu(row.dataset.watchSymbol, event.clientX, event.clientY);
        });
        row.addEventListener('dblclick', () => changeDetailSymbol(row.dataset.watchSymbol));
      });
      document.querySelectorAll('#watchRows a.watch-symbol').forEach(link => {
        link.addEventListener('click', event => {
          event.preventDefault();
          changeDetailSymbol(link.textContent);
        });
      });
      updateWatchActiveSymbol();
    }

    function updateWatchActiveSymbol() {
      document.querySelectorAll('#watchRows a.watch-symbol').forEach(link => {
        link.classList.toggle('active', normalize(link.textContent) === symbol);
      });
    }

    async function loadDepth() {
      const requestSymbol = symbol;
      const limit = document.getElementById('depthLimit').value;
      let data = null;
      try {
        const response = await fetch(cacheBust(`/api/depth?symbol=${encodeURIComponent(requestSymbol)}&limit=${encodeURIComponent(limit)}`), { cache: 'no-store' });
        data = await response.json();
      } catch (error) {
        if (requestSymbol === symbol) document.getElementById('bookTime').textContent = `Depth refresh failed: ${error.message || 'network error'}`;
        return;
      }
      if (requestSymbol !== symbol) return;
      if (data.error) {
        document.getElementById('bookTime').textContent = data.error;
        return;
      }
      book = { asks: data.asks || [], bids: data.bids || [] };
      renderBook('REST snapshot');
    }

    function levelVol(level) {
      const price = Number(level[0] || 0);
      const size = Number(level[1] || 0);
      return price * size;
    }

    function renderBook(label = 'Live') {
      lastBookRender = Date.now();
      let cumulativeAsk = 0;
      const askRows = [...book.asks].map(level => {
        const price = Number(level[0] || 0);
        const size = Number(level[1] || 0);
        cumulativeAsk += size;
        return { price, size, sum: cumulativeAsk };
      });
      const reversedAsks = askRows.reverse();

      let cumulativeBid = 0;
      const bidRows = book.bids.map(level => {
        const price = Number(level[0] || 0);
        const size = Number(level[1] || 0);
        cumulativeBid += size;
        return { price, size, sum: cumulativeBid };
      });

      const maxAskSum = askRows[0]?.sum || 1; // Since it was reversed, index 0 is max
      const maxBidSum = bidRows[bidRows.length - 1]?.sum || 1;
      const maxSum = Math.max(maxAskSum, maxBidSum);

      const renderRowList = (rows, side) => rows.map(r => {
        const width = Math.min(100, (r.sum / maxSum) * 100);
        const priceColor = side === 'ask' ? 'var(--red)' : 'var(--green)';
        return `<tr class="${side}"><td><span style="color:${priceColor}; font-weight: 600;">${fmt.format(r.price)}</span></td><td>${compact.format(r.size)}</td><td class="book-side"><span class="bar" style="width:${width}%"></span>${compact.format(r.sum)}</td></tr>`;
      }).join('');

      document.getElementById('asks').innerHTML = renderRowList(reversedAsks, 'ask');
      document.getElementById('bids').innerHTML = renderRowList(bidRows, 'bid');
      
      const tickerElement = document.getElementById('bookTickerPrice');
      if (tickerElement) {
        const last = Number(lastTradePrice || market?.last_price || 0);
        tickerElement.textContent = last ? fmt.format(last) : '-';
        tickerElement.style.color = last >= (book.asks[0]?.[0] || 0) ? 'var(--green)' : 'var(--red)';
      }

      document.getElementById('bookTime').textContent = `${label} - ${new Date().toLocaleTimeString()}`;
      renderPressure();
      renderDom();
      renderMarketSnapshot();
      scheduleBookmapProfile();
      recordLiquidityFrame();
      updateCalculator();
    }

    function requestBookRender(label = 'Live') {
      pendingBookLabel = label;
      if (bookRenderPending) return;
      const wait = Math.max(0, 160 - (Date.now() - lastBookRender));
      bookRenderPending = true;
      setTimeout(() => {
        bookRenderPending = false;
        renderBook(pendingBookLabel);
      }, wait);
    }

    function renderTrades() {
      lastTradeRender = Date.now();
      const maxQuote = Math.max(1, ...trades.map(trade => Number(trade.p || 0) * Number(trade.v || 0)));
      const threshold = blockThreshold();
      document.getElementById('trades').innerHTML = trades.length ? trades.map(trade => {
        const price = Number(trade.p || 0);
        const size = Number(trade.v || 0);
        const side = String(trade.s || '').toLowerCase();
        const time = trade.t ? new Date(trade.t).toLocaleTimeString() : new Date().toLocaleTimeString();
        const quote = Number(trade.q || 0) || price * size;
        const alpha = Math.min(0.45, quote / maxQuote * 0.45).toFixed(3);
        const large = quote >= threshold ? ' large-print' : '';
        return `<tr class="trade-${side}-row${large}" style="--trade-alpha:${alpha}"><td>${time}</td><td class="trade-${side}">${side.toUpperCase()}</td><td>${fmt.format(price)}</td><td>${fmt.format(size)}</td><td>${compact.format(quote)}</td></tr>`;
      }).join('') : `<tr><td colspan="5" class="muted">Waiting for ${symbol} live prints...</td></tr>`;
      document.getElementById('tradeStatus').textContent = trades.length ? `${trades.length} recent prints` : `Waiting for ${symbol} prints`;
      renderPressure();
      renderFlowProfile();
      renderDom();
      renderMarketSnapshot();
      scheduleBookmapProfile();
      requestLiquidityRender();
      postAgentFlow();
    }

    function requestTradeRender(force = false) {
      if (force) {
        tradeRenderPending = false;
        renderTrades();
        return;
      }
      if (tradeRenderPending) return;
      const wait = Math.max(0, 120 - (Date.now() - lastTradeRender));
      tradeRenderPending = true;
      setTimeout(() => {
        tradeRenderPending = false;
        renderTrades();
      }, wait);
    }

    function blockThreshold() {
      return Math.max(0, Number(document.getElementById('blockUsdThreshold').value || 0));
    }

    function priceBucket(price) {
      const precision = Number(market?.quote_precision ?? 4);
      const decimals = Math.max(0, Math.min(precision, price >= 100 ? 1 : price >= 1 ? 4 : 6));
      return Number(price).toFixed(decimals);
    }

    function pruneTapeHistory(now = Date.now()) {
      const maxAgeMs = 45 * 60 * 1000;
      tapeHistory = tapeHistory.filter(trade => now - trade.ts <= maxAgeMs).slice(-2500);
    }

    function recordTapeTrade(trade) {
      tapeHistory.push(trade);
      pruneTapeHistory(trade.ts);
    }

    function detectImpulse(trade) {
      if (activeImpulse?.manual) return;
      const lookbackMs = 6 * 60 * 1000;
      const thresholdPct = 10;
      const windowTrades = tapeHistory.filter(item => trade.ts - item.ts <= lookbackMs && item.ts <= trade.ts);
      if (windowTrades.length < 2) return;
      const low = windowTrades.reduce((best, item) => item.price < best.price ? item : best, windowTrades[0]);
      const upMove = movePct(trade.price, low.price);
      if (upMove < thresholdPct) return;
      if (activeImpulse && activeImpulse.direction === 'up' && trade.price <= activeImpulse.highPrice && low.ts >= activeImpulse.startTs) {
        return;
      }
      activeImpulse = {
        direction: 'up',
        startTs: low.ts,
        startPrice: low.price,
        triggerTs: trade.ts,
        triggerPrice: trade.price,
        highPrice: trade.price,
        lowPrice: low.price,
        thresholdPct
      };
    }

    function updateImpulse(trade) {
      detectImpulse(trade);
      if (!activeImpulse) return;
      activeImpulse.highPrice = Math.max(activeImpulse.highPrice, trade.price);
      activeImpulse.lowPrice = Math.min(activeImpulse.lowPrice, trade.price);
    }

    function ingestTrades(rows) {
      const threshold = blockThreshold();
      rows.forEach(raw => {
        const price = Number(raw.p || 0);
        const size = Number(raw.v || 0);
        if (!price || !size) return;
        lastTradePrice = price;
        const side = String(raw.s || '').toLowerCase();
        const quote = price * size;
        const ts = Number(raw.t || Date.now());
        const trade = { ...raw, t: ts, q: quote };
        const tapeTrade = { ts, price, size, side, quote };
        recordTapeTrade(tapeTrade);
        updateImpulse(tapeTrade);
        const bucket = priceBucket(price);
        const profile = volumeByPrice.get(bucket) || { price: bucket, buy: 0, sell: 0, total: 0 };
        if (side === 'buy') {
          profile.buy += quote;
          buyQuoteTotal += quote;
          cvdQuote += quote;
        } else {
          profile.sell += quote;
          sellQuoteTotal += quote;
          cvdQuote -= quote;
        }
        profile.total += quote;
        volumeByPrice.set(bucket, profile);
        if (volumeByPrice.size > 260) {
          const weakest = [...volumeByPrice.values()].sort((a, b) => a.total - b.total)[0];
          if (weakest) volumeByPrice.delete(weakest.price);
        }
        if (quote >= threshold) {
          blockTrades = [trade, ...blockTrades].slice(0, 20);
          playBlockSound(side, quote, threshold);
        }
      });
      trades = [...rows.map(row => ({ ...row, q: Number(row.p || 0) * Number(row.v || 0) })), ...trades].slice(0, 120);
    }

    function renderFlowProfile() {
      document.getElementById('cvdQuote').textContent = compact.format(cvdQuote);
      document.getElementById('cvdQuote').className = cls(cvdQuote);
      document.getElementById('buyVol').textContent = compact.format(buyQuoteTotal);
      document.getElementById('sellVol').textContent = compact.format(sellQuoteTotal);
      document.getElementById('blockCount').textContent = blockTrades.length;
      const rows = [...volumeByPrice.values()]
        .sort((a, b) => Number(b.price) - Number(a.price))
        .slice(0, 10);
      const maxSide = Math.max(1, ...rows.flatMap(item => [item.buy, item.sell]));
      document.getElementById('volumeProfile').innerHTML = rows.map(item => `
        <div class="profile-row">
          <span>${item.price}</span>
          <div class="profile-track"><div class="profile-bar-sell" style="width:${Math.min(100, item.sell / maxSide * 100).toFixed(1)}%"></div></div>
          <div class="profile-track"><div class="profile-bar-buy" style="width:${Math.min(100, item.buy / maxSide * 100).toFixed(1)}%"></div></div>
        </div>`).join('') || '<span class="muted">Waiting for live trades...</span>';
      document.getElementById('blockTrades').innerHTML = blockTrades.slice(0, 8).map(trade => {
        const side = String(trade.s || '').toLowerCase();
        const time = trade.t ? new Date(trade.t).toLocaleTimeString() : new Date().toLocaleTimeString();
        return `<tr><td>${time}</td><td class="trade-${side}">${side.toUpperCase()}</td><td>${fmt.format(Number(trade.p || 0))}</td><td>${compact.format(Number(trade.q || 0))}</td></tr>`;
      }).join('') || '<tr><td colspan="4" class="muted">No large prints yet.</td></tr>';
      document.getElementById('flowStatus').textContent = trades.length
        ? `${new Date().toLocaleTimeString()} · threshold ${compact.format(blockThreshold())}`
        : `Waiting for ${symbol} flow · threshold ${compact.format(blockThreshold())}`;
    }

    function renderDom() {
      const rowsByPrice = new Map();
      book.asks.forEach(level => {
        const price = priceBucket(Number(level[0] || 0));
        const item = rowsByPrice.get(price) || { price, ask: 0, bid: 0, tape: 0, delta: 0 };
        item.ask += levelVol(level);
        rowsByPrice.set(price, item);
      });
      book.bids.forEach(level => {
        const price = priceBucket(Number(level[0] || 0));
        const item = rowsByPrice.get(price) || { price, ask: 0, bid: 0, tape: 0, delta: 0 };
        item.bid += levelVol(level);
        rowsByPrice.set(price, item);
      });
      volumeByPrice.forEach(profile => {
        const item = rowsByPrice.get(profile.price) || { price: profile.price, ask: 0, bid: 0, tape: 0, delta: 0 };
        item.tape += profile.total;
        item.delta += profile.buy - profile.sell;
        rowsByPrice.set(profile.price, item);
      });
      const bestAsk = Number(book.asks[0]?.[0] || 0);
      const bestBid = Number(book.bids[0]?.[0] || 0);
      const showSpread = document.getElementById('domShowSpread')?.checked ?? true;
      const maxRows = rowCapacityFor('.dom-panel .scroll', 80, 24, 14);
      const targetPrice = lastTradePrice || (bestAsk && bestBid ? (bestAsk + bestBid) / 2 : bestAsk || bestBid);
      const rows = rowsAroundPrice(
        [...rowsByPrice.values()].sort((a, b) => Number(b.price) - Number(a.price)),
        targetPrice,
        maxRows
      );
      const maxVol = Math.max(1, ...rows.flatMap(item => [item.ask, item.bid, item.tape, Math.abs(item.delta)]));
      let spreadInserted = false;
      const html = [];
      rows.forEach(item => {
        const p = Number(item.price);
        if (showSpread && !spreadInserted && bestAsk && bestBid && p <= bestBid) {
          const spread = bestAsk - bestBid;
          const spreadPct = bestAsk ? (spread / bestAsk) * 100 : 0;
          html.push(`<tr class="dom-spread-row" data-dom-center="1"><td colspan="5">Spread ${fmt.format(spread)} · ${spreadPct.toFixed(4)}%</td></tr>`);
          spreadInserted = true;
        }
        const isBestAsk = bestAsk && Math.abs(p - bestAsk) < Math.max(bestAsk * 1e-10, 1e-12);
        const isBestBid = bestBid && Math.abs(p - bestBid) < Math.max(bestBid * 1e-10, 1e-12);
        const isLast = lastTradePrice && priceBucket(lastTradePrice) === item.price;
        const rowClass = [
          isBestAsk ? 'dom-best-ask' : '',
          isBestBid ? 'dom-best-bid' : '',
          isLast ? 'dom-last-trade' : ''
        ].filter(Boolean).join(' ');
        const sideClass = bestAsk && p >= bestAsk ? 'ask' : bestBid && p <= bestBid ? 'bid' : '';
        const askWidth = Math.min(100, item.ask / maxVol * 100).toFixed(1);
        const bidWidth = Math.min(100, item.bid / maxVol * 100).toFixed(1);
        const tapeWidth = Math.min(100, item.tape / maxVol * 100).toFixed(1);
        const deltaWidth = Math.min(100, Math.abs(item.delta) / maxVol * 100).toFixed(1);
        const deltaClass = item.delta >= 0 ? 'pos' : 'neg';
        html.push(`
          <tr class="${rowClass}">
            <td class="book-side ask"><span class="bar" style="width:${askWidth}%"></span>${item.ask ? compact.format(item.ask) : ''}</td>
            <td class="dom-price ${sideClass}">${item.price}</td>
            <td class="book-side bid"><span class="bar" style="width:${bidWidth}%"></span>${item.bid ? compact.format(item.bid) : ''}</td>
            <td class="book-side"><span class="bar" style="width:${tapeWidth}%;background:var(--profile-volume)"></span>${item.tape ? compact.format(item.tape) : ''}</td>
            <td class="book-side dom-delta ${deltaClass}"><span class="bar" style="width:${deltaWidth}%;background:${item.delta >= 0 ? 'var(--green)' : 'var(--red)'}"></span>${item.delta ? compact.format(item.delta) : ''}</td>
          </tr>`);
      });
      document.getElementById('domRows').innerHTML = html.join('') || '<tr><td colspan="5" class="muted">Waiting for book and prints...</td></tr>';
      fitRowsToScroller('.dom-panel .scroll', '#domRows tr', '--dom-row-height', 24, 44);
      const spread = bestAsk && bestBid ? bestAsk - bestBid : 0;
      document.getElementById('domStatus').textContent = spread
        ? `${document.getElementById('domFollowPrice').checked ? 'Following' : 'Locked'} · ${fmt.format(spread)}`
        : 'Waiting for book';
      if (document.getElementById('domFollowPrice').checked && !isWidgetResizeQuiet()) centerDom();
    }

    function profileAnchorPrice() {
      return Number(dailyCandle?.previousClose || dailyCandle?.open || market?.open_price || market?.last_price || lastTradePrice || 0);
    }

    function profileRows() {
      const rowsByPrice = new Map();
      function touch(price) {
        const bucket = priceBucket(price);
        const item = rowsByPrice.get(bucket) || { price: bucket, ask: 0, bid: 0, buy: 0, sell: 0, total: 0, delta: 0 };
        rowsByPrice.set(bucket, item);
        return item;
      }
      book.asks.forEach(level => {
        const item = touch(Number(level[0] || 0));
        item.ask += levelVol(level);
      });
      book.bids.forEach(level => {
        const item = touch(Number(level[0] || 0));
        item.bid += levelVol(level);
      });
      volumeByPrice.forEach(profile => {
        const item = touch(Number(profile.price || 0));
        item.buy += profile.buy;
        item.sell += profile.sell;
        item.total += profile.total;
        item.delta += profile.buy - profile.sell;
      });
      [dailyCandle?.open, dailyCandle?.high, dailyCandle?.low, dailyCandle?.close, dailyCandle?.previousClose, market?.open_price, market?.last_price, lastTradePrice, activeImpulse?.startPrice]
        .map(Number)
        .filter(Boolean)
        .forEach(touch);
      return [...rowsByPrice.values()].sort((a, b) => Number(b.price) - Number(a.price));
    }

    function visibleProfileRows(rows) {
      const maxRows = rowCapacityFor('.bookmap-panel .scroll', 110, 24, 12);
      if (rows.length <= maxRows) return rows;
      const anchor = profileAnchorPrice();
      const current = lastTradePrice || Number(market?.last_price || 0);
      const target = current || anchor || Number(rows[Math.floor(rows.length / 2)]?.price || 0);
      return rowsAroundPrice(rows, target, maxRows);
    }

    function nearestProfileBucket(rows, price) {
      const target = Number(price || 0);
      if (!target || !rows.length) return '';
      return rows.reduce((best, row) => {
        const distance = Math.abs(Number(row.price) - target);
        return distance < best.distance ? { price: row.price, distance } : best;
      }, { price: '', distance: Infinity }).price;
    }

    function profileAnalytics(rows) {
      const traded = rows
        .filter(row => row.total > 0)
        .sort((a, b) => Number(a.price) - Number(b.price));
      const totalTape = traded.reduce((total, row) => total + row.total, 0);
      const vwap = totalTape
        ? traded.reduce((total, row) => total + Number(row.price) * row.total, 0) / totalTape
        : 0;
      const poc = traded.reduce((best, row) => row.total > best.total ? row : best, { price: '-', total: 0 });
      const maxTotal = Math.max(1, ...traded.map(row => row.total));
      const hvn = traded
        .filter(row => row.total >= maxTotal * 0.45)
        .sort((a, b) => b.total - a.total)
        .slice(0, 6);
      const lvn = [];
      for (let i = 1; i < traded.length - 1; i += 1) {
        const prev = traded[i - 1];
        const row = traded[i];
        const next = traded[i + 1];
        const neighborMin = Math.min(prev.total, next.total);
        const neighborMax = Math.max(prev.total, next.total);
        if (row.total <= neighborMin * 0.55 && neighborMax >= maxTotal * 0.12) {
          lvn.push({
            ...row,
            score: (neighborMin - row.total) / Math.max(1, neighborMin)
          });
        }
      }
      lvn.sort((a, b) => b.score - a.score || Math.abs(Number(a.price) - Number(lastTradePrice || market?.last_price || 0)) - Math.abs(Number(b.price) - Number(lastTradePrice || market?.last_price || 0)));
      const vwapBucket = nearestProfileBucket(rows, vwap);
      const nearestLvn = lvn
        .slice(0, 10)
        .sort((a, b) => Math.abs(Number(a.price) - Number(lastTradePrice || market?.last_price || 0)) - Math.abs(Number(b.price) - Number(lastTradePrice || market?.last_price || 0)))[0];
      return {
        totalTape,
        vwap,
        vwapBucket,
        poc,
        hvn: new Set(hvn.map(row => row.price)),
        lvn: new Set(lvn.slice(0, 10).map(row => row.price)),
        nearestLvn
      };
    }

    function impulseProfileRows() {
      if (!activeImpulse) return [];
      const rowsByPrice = new Map();
      tapeHistory
        .filter(trade => trade.ts >= activeImpulse.startTs)
        .forEach(trade => {
          const bucket = priceBucket(trade.price);
          const item = rowsByPrice.get(bucket) || { price: bucket, buy: 0, sell: 0, total: 0, delta: 0 };
          if (trade.side === 'buy') item.buy += trade.quote;
          else item.sell += trade.quote;
          item.total += trade.quote;
          item.delta = item.buy - item.sell;
          rowsByPrice.set(bucket, item);
        });
      return [...rowsByPrice.values()].sort((a, b) => Number(a.price) - Number(b.price));
    }

    function impulseAnalytics() {
      if (!activeImpulse) return { active: false };
      const rows = impulseProfileRows();
      const total = rows.reduce((sum, row) => sum + row.total, 0);
      const vwap = total ? rows.reduce((sum, row) => sum + Number(row.price) * row.total, 0) / total : 0;
      const current = Number(lastTradePrice || market?.last_price || activeImpulse.highPrice || 0);
      const maxTotal = Math.max(1, ...rows.map(row => row.total));
      const hvns = rows
        .filter(row => row.total >= maxTotal * 0.25 && Number(row.price) < current)
        .sort((a, b) => Number(b.price) - Number(a.price));
      const lowerHvn = hvns[0] || null;
      const mode = normalizeImpulseMode(activeImpulse.mode);
      const positionSide = activeImpulse.positionSide || (mode === 'long' || mode === 'short' ? mode : null);
      const move = positionSide
        ? positionMovePct(current || activeImpulse.highPrice, activeImpulse.startPrice, positionSide)
        : movePct(current || activeImpulse.highPrice, activeImpulse.startPrice);
      return {
        active: true,
        rows,
        total,
        vwap,
        vwapBucket: nearestProfileBucket(profileRows(), vwap),
        lowerHvn,
        lowerHvnBucket: lowerHvn?.price || '',
        move,
        mode,
        kind: activeImpulse.kind || (positionSide ? 'position' : 'impulse'),
        positionSide,
        label: positionSide ? `${positionSide === 'short' ? 'Short' : 'Long'} PnL` : 'Impulse',
        shortLabel: positionSide ? (positionSide === 'short' ? 'Short' : 'Long') : 'Impulse'
      };
    }

    function scheduleBookmapProfile(force = false) {
      if (force) {
        bookmapRenderPending = false;
        renderBookmapProfile();
        return;
      }
      if (bookmapRenderPending) return;
      const wait = Math.max(0, 220 - (Date.now() - lastBookmapRender));
      bookmapRenderPending = true;
      setTimeout(() => {
        bookmapRenderPending = false;
        renderBookmapProfile();
      }, wait);
    }

    function renderBookmapProfile() {
      lastBookmapRender = Date.now();
      const rows = profileRows();
      const visible = visibleProfileRows(rows);
      const mode = document.getElementById('bookmapMode')?.value || 'volume';
      const anchor = profileAnchorPrice();
      const anchorBucket = anchor ? priceBucket(anchor) : '';
      const openBucket = dailyCandle?.open ? priceBucket(dailyCandle.open) : '';
      const closeBucket = dailyCandle?.close ? priceBucket(dailyCandle.close) : '';
      const bestAsk = book.asks[0]?.[0] ? priceBucket(Number(book.asks[0][0])) : '';
      const bestBid = book.bids[0]?.[0] ? priceBucket(Number(book.bids[0][0])) : '';
      const lastBucket = lastTradePrice ? priceBucket(lastTradePrice) : '';
      const impulseAnchorBucket = activeImpulse?.startPrice ? nearestProfileBucket(rows, activeImpulse.startPrice) : '';
      const totalTape = rows.reduce((total, row) => total + row.total, 0);
      const delta = rows.reduce((total, row) => total + row.delta, 0);
      const analytics = profileAnalytics(rows);
      const impulse = impulseAnalytics();
      const poc = analytics.poc;
      const maxTotal = Math.max(1, ...visible.map(row => row.total));
      const maxDelta = Math.max(1, ...visible.map(row => Math.abs(row.delta)));
      const maxBook = Math.max(1, ...visible.map(row => row.ask + row.bid));
      document.getElementById('profileAnchor').textContent = anchor ? fmt.format(anchor) : '-';
      document.getElementById('profilePoc').textContent = poc.total ? `${poc.price} · ${compact.format(poc.total)}` : '-';
      document.getElementById('profileVwap').textContent = analytics.vwap ? fmt.format(analytics.vwap) : '-';
      document.getElementById('profileLvn').textContent = analytics.nearestLvn ? `${analytics.nearestLvn.price} · ${compact.format(analytics.nearestLvn.total)}` : '-';
      document.getElementById('impulseVwap').textContent = impulse.active && impulse.vwap ? fmt.format(impulse.vwap) : '-';
      document.getElementById('impulseHvn').textContent = impulse.active && impulse.lowerHvn ? `${impulse.lowerHvn.price} · ${compact.format(impulse.lowerHvn.total)}` : '-';
      document.getElementById('impulseMove').textContent = impulse.active ? `${impulse.label} ${pct(impulse.move)} from ${fmt.format(activeImpulse.startPrice)}` : 'Watching';
      document.getElementById('impulseMove').className = impulse.active ? cls(impulse.move) : '';
      document.getElementById('profileDelta').textContent = compact.format(delta);
      document.getElementById('profileDelta').className = cls(delta);
      document.getElementById('profileTape').textContent = compact.format(totalTape);
      document.getElementById('bookmapRows').innerHTML = visible.map(row => {
        const isLast = row.price === lastBucket;
        const isAnchor = row.price === anchorBucket || row.price === openBucket || row.price === closeBucket;
        const isPoc = row.price === poc.price;
        const isVwap = row.price === analytics.vwapBucket;
        const isImpulseVwap = impulse.active && row.price === impulse.vwapBucket;
        const isImpulseHvn = impulse.active && row.price === impulse.lowerHvnBucket;
        const isImpulseAnchor = impulse.active && row.price === impulseAnchorBucket;
        const isLvn = analytics.lvn.has(row.price);
        const isHvn = analytics.hvn.has(row.price) && !isPoc;
        const rowClass = [
          isLast ? 'is-last' : '',
          isAnchor ? 'is-anchor' : '',
          isVwap ? 'is-vwap' : '',
          isImpulseAnchor ? 'is-impulse-anchor' : '',
          isImpulseVwap ? 'is-impulse-vwap' : '',
          isImpulseHvn ? 'is-impulse-hvn' : '',
          isPoc ? 'is-poc' : '',
          isHvn ? 'is-hvn' : '',
          isLvn ? 'is-lvn' : '',
          row.price === bestAsk ? 'is-best-ask' : '',
          row.price === bestBid ? 'is-best-bid' : ''
        ].filter(Boolean).join(' ');
        const track = mode === 'delta'
          ? `<span class="bookmap-fill ${row.delta >= 0 ? 'delta-pos' : 'delta-neg'}" style="width:${Math.min(50, Math.abs(row.delta) / maxDelta * 50).toFixed(1)}%"></span>`
          : `<span class="bookmap-half sell" style="width:${Math.min(100, row.sell / maxTotal * 100).toFixed(1)}%"></span><span class="bookmap-half buy" style="width:${Math.min(100, row.buy / maxTotal * 100).toFixed(1)}%"></span><span class="bookmap-fill volume" style="width:${Math.min(100, row.total / maxTotal * 100).toFixed(1)}%"></span>`;
        const bookWidth = Math.min(100, (row.ask + row.bid) / maxBook * 100).toFixed(1);
        const tags = [
          isVwap ? '<span class="bookmap-tag vwap">VWAP</span>' : '',
          isImpulseAnchor ? `<span class="bookmap-tag impulse-anchor">${impulse.positionSide ? 'ENTRY' : 'ANCHOR'}</span>` : '',
          isImpulseVwap ? '<span class="bookmap-tag impulse-vwap">I-VWAP</span>' : '',
          isImpulseHvn ? '<span class="bookmap-tag impulse-hvn">I-HVN</span>' : '',
          isPoc ? '<span class="bookmap-tag poc">POC</span>' : '',
          isHvn ? '<span class="bookmap-tag hvn">HVN</span>' : '',
          isLvn ? '<span class="bookmap-tag lvn">LVN</span>' : '',
          isAnchor ? '<span class="bookmap-tag anchor">D</span>' : ''
        ].filter(Boolean).join('');
        return `
          <div class="bookmap-row ${rowClass}" ${isLast || isVwap || isImpulseVwap || isImpulseAnchor || row.price === bestBid || row.price === bestAsk ? 'data-profile-center="1"' : ''}>
            <span class="bookmap-price">${row.price}</span>
            <span class="bookmap-track">${track}</span>
            <span>${row.total ? compact.format(row.total) : ''}</span>
            <span class="${cls(row.delta)}">${row.delta ? compact.format(row.delta) : ''}</span>
            <span class="bookmap-book" title="Current book quote liquidity">
              <span class="bookmap-fill volume" style="width:${bookWidth}%;opacity:.28"></span>${row.ask + row.bid ? compact.format(row.ask + row.bid) : ''}
            </span>
            <span class="bookmap-tags">${tags}</span>
          </div>`;
      }).join('') || '<div class="error">Waiting for book and live prints...</div>';
      fitRowsToScroller('.bookmap-panel .scroll', '#bookmapRows .bookmap-row', '--bookmap-row-height', 23, 44);
      const candleTime = dailyCandle?.time ? new Date(dailyCandle.time).toLocaleDateString() : 'market anchor';
      document.getElementById('bookmapStatus').textContent = `${mode === 'delta' ? 'Delta' : 'Volume'} · ${rows.length} prices · ${candleTime}`;
      if (document.getElementById('bookmapFollow')?.checked && !isWidgetResizeQuiet()) centerBookmapProfile();
    }

    function centerBookmapProfile(force = false) {
      if (!force && isWidgetResizeQuiet()) return;
      const scroller = document.querySelector('.bookmap-panel .scroll');
      const target = document.querySelector('#bookmapRows [data-profile-center="1"]') || document.querySelector('#bookmapRows .is-anchor');
      if (!scroller || !target) return;
      scroller.scrollTop = Math.max(0, target.offsetTop - scroller.clientHeight / 2 + target.clientHeight / 2);
    }

    function liquidityWindowMs() {
      return Math.max(60000, Number(document.getElementById('liquidityWindow')?.value || 180000));
    }

    function liquidityMode() {
      return document.getElementById('liquidityMode')?.value || 'depth';
    }

    function liquidityMaxRows() {
      return Math.max(32, Number(document.getElementById('liquidityRows')?.value || 72));
    }

    function liquidityMarksEnabled() {
      return document.getElementById('liquidityMarks')?.checked !== false;
    }

    function setLiquidityStat(id, text, value = 0) {
      const element = document.getElementById(id);
      if (!element) return;
      element.textContent = text;
      element.className = cls(value);
    }

    function liquidityWindowTrades(now = Date.now()) {
      const cutoff = now - liquidityWindowMs();
      return tapeHistory.filter(trade => trade.ts >= cutoff);
    }

    function liquidityDepthStats(now = Date.now()) {
      const limit = Math.min(80, liquidityMaxRows());
      const bidQuote = book.bids.slice(0, limit).reduce((total, level) => total + levelVol(level), 0);
      const askQuote = book.asks.slice(0, limit).reduce((total, level) => total + levelVol(level), 0);
      const totalBook = bidQuote + askQuote;
      const tilt = totalBook ? ((bidQuote - askQuote) / totalBook) * 100 : 0;
      const bestAsk = Number(book.asks[0]?.[0] || 0);
      const bestBid = Number(book.bids[0]?.[0] || 0);
      const mid = bestAsk && bestBid ? (bestAsk + bestBid) / 2 : Number(lastTradePrice || market?.last_price || 0);
      const spread = bestAsk && bestBid ? Math.max(0, bestAsk - bestBid) : 0;
      const spreadBps = mid && spread ? (spread / mid) * 10000 : 0;
      const recent = liquidityWindowTrades(now);
      const buyQuote = recent.filter(trade => trade.side === 'buy').reduce((total, trade) => total + trade.quote, 0);
      const sellQuote = recent.filter(trade => trade.side !== 'buy').reduce((total, trade) => total + trade.quote, 0);
      const tapeTotal = buyQuote + sellQuote;
      const printFlow = tapeTotal ? ((buyQuote - sellQuote) / tapeTotal) * 100 : 0;
      return { bidQuote, askQuote, totalBook, tilt, bestAsk, bestBid, mid, spread, spreadBps, buyQuote, sellQuote, tapeTotal, printFlow };
    }

    function liquidityWallAnalytics(frames) {
      const byKey = new Map();
      frames.forEach(frame => {
        const seen = new Set();
        frame.levels.forEach(level => {
          const key = `${level.side}:${level.price}`;
          const item = byKey.get(key) || { price: level.price, side: level.side, quote: 0, max: 0, frames: 0 };
          item.quote += level.quote;
          item.max = Math.max(item.max, level.quote);
          if (!seen.has(key)) {
            item.frames += 1;
            seen.add(key);
          }
          byKey.set(key, item);
        });
      });
      const frameCount = Math.max(1, frames.length);
      const walls = [...byKey.values()].map(item => {
        const persistence = item.frames / frameCount;
        const avg = item.quote / Math.max(1, item.frames);
        return {
          ...item,
          avg,
          persistence,
          score: avg * (0.45 + persistence) + item.max * 0.18
        };
      });
      const maxScore = Math.max(1, ...walls.map(item => item.score));
      const strongestBid = walls.filter(item => item.side === 'bid').sort((a, b) => b.score - a.score)[0] || null;
      const strongestAsk = walls.filter(item => item.side === 'ask').sort((a, b) => b.score - a.score)[0] || null;
      const current = Number(lastTradePrice || market?.last_price || 0);
      const nearestWall = current
        ? walls
            .filter(item => item.score >= maxScore * 0.22)
            .sort((a, b) => Math.abs(Number(a.price) - current) - Math.abs(Number(b.price) - current))[0] || null
        : null;
      return {
        byKey: new Map(walls.map(item => [`${item.side}:${item.price}`, item])),
        maxScore,
        strongestBid,
        strongestAsk,
        nearestWall,
        topWalls: walls.filter(item => item.score >= maxScore * 0.25).sort((a, b) => b.score - a.score).slice(0, 10)
      };
    }

    function liquidityWallText(wall) {
      if (!wall) return '-';
      const current = Number(lastTradePrice || market?.last_price || 0);
      const distance = current ? Math.abs(movePct(Number(wall.price), current)) : 0;
      return `${wall.side === 'bid' ? 'BID' : 'ASK'} ${wall.price} · ${distance.toFixed(2)}%`;
    }

    function hideLiquidityTooltip() {
      const tooltip = document.getElementById('liquidityTooltip');
      if (tooltip) tooltip.hidden = true;
    }

    function drawLiquidityPriceLine(ctx, layout, price, color, label, dash = []) {
      const row = layout.priceIndex.get(priceBucket(price));
      if (row === undefined) return;
      const y = layout.top + row * layout.rowH + layout.rowH / 2;
      if (y < layout.top || y > layout.top + layout.plotH) return;
      ctx.save();
      ctx.setLineDash(dash);
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(layout.left, y);
      ctx.lineTo(layout.left + layout.plotW + layout.profileW, y);
      ctx.stroke();
      if (label) {
        const text = `${label} ${priceBucket(price)}`;
        ctx.font = '10px system-ui, sans-serif';
        const textW = ctx.measureText(text).width + 10;
        const x = Math.max(layout.left + 4, layout.left + layout.plotW - textW - 6);
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(8, 11, 14, .78)';
        ctx.fillRect(x, y - 8, textW, 16);
        ctx.fillStyle = color;
        ctx.fillText(text, x + 5, y + 4);
      }
      ctx.restore();
    }

    function drawLiquidityWallMarkers(ctx, layout, analytics) {
      if (!analytics.topWalls.length) return;
      ctx.save();
      analytics.topWalls.slice(0, 8).forEach((wall, index) => {
        const row = layout.priceIndex.get(wall.price);
        if (row === undefined) return;
        const y = layout.top + row * layout.rowH + layout.rowH / 2;
        const strength = Math.max(0.18, Math.min(1, wall.score / analytics.maxScore));
        const color = wall.side === 'bid'
          ? `rgba(255, 209, 102, ${0.3 + strength * 0.55})`
          : `rgba(255, 142, 102, ${0.28 + strength * 0.5})`;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1 + strength * 2.2;
        ctx.beginPath();
        ctx.moveTo(layout.left, y);
        ctx.lineTo(layout.left + layout.plotW, y);
        ctx.stroke();
        ctx.fillStyle = color;
        ctx.fillRect(layout.left + layout.plotW + 2, y - Math.max(2, layout.rowH / 2), 4, Math.max(4, layout.rowH));
        if (index < 4 && layout.rowH >= 4) {
          const text = `${wall.side === 'bid' ? 'B' : 'A'} ${compact.format(wall.avg)}`;
          ctx.font = '10px system-ui, sans-serif';
          const textW = ctx.measureText(text).width + 8;
          const x = Math.max(layout.left + 4, layout.left + layout.plotW - textW - 4);
          ctx.fillStyle = 'rgba(8, 11, 14, .72)';
          ctx.fillRect(x, y - 8, textW, 16);
          ctx.fillStyle = color;
          ctx.fillText(text, x + 4, y + 4);
        }
      });
      ctx.restore();
    }

    function renderLiquidityHover(ctx, layout) {
      const tooltip = document.getElementById('liquidityTooltip');
      if (!tooltip || !liquidityHover || !layout.prices.length) {
        hideLiquidityTooltip();
        return;
      }
      const x = liquidityHover.x;
      const y = liquidityHover.y;
      const inPlot = x >= layout.left && x <= layout.left + layout.plotW && y >= layout.top && y <= layout.top + layout.plotH;
      const inProfile = x >= layout.profileX && x <= layout.profileX + layout.profileW && y >= layout.top && y <= layout.top + layout.plotH;
      if (!inPlot && !inProfile) {
        hideLiquidityTooltip();
        return;
      }
      const row = Math.max(0, Math.min(layout.prices.length - 1, Math.floor((y - layout.top) / layout.rowH)));
      const price = layout.prices[row];
      const hoverTs = inPlot
        ? layout.startTs + ((x - layout.left) / Math.max(1, layout.plotW)) * layout.span
        : layout.endTs;
      const nearestFrame = layout.frames.reduce((best, frame) => {
        const distance = Math.abs(frame.ts - hoverTs);
        return distance < best.distance ? { frame, distance } : best;
      }, { frame: layout.frames[layout.frames.length - 1], distance: Infinity }).frame;
      let bidQuote = 0;
      let askQuote = 0;
      nearestFrame?.levels.forEach(level => {
        if (level.price !== price) return;
        if (level.side === 'bid') bidQuote += level.quote;
        else askQuote += level.quote;
      });
      const profile = volumeByPrice.get(price) || { buy: 0, sell: 0, total: 0 };
      const wall = [layout.wallByKey.get(`bid:${price}`), layout.wallByKey.get(`ask:${price}`)]
        .filter(Boolean)
        .sort((a, b) => b.score - a.score)[0];

      ctx.save();
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = 'rgba(237, 242, 247, .42)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(layout.left, layout.top + row * layout.rowH + layout.rowH / 2);
      ctx.lineTo(layout.left + layout.plotW + layout.profileW, layout.top + row * layout.rowH + layout.rowH / 2);
      if (inPlot) {
        ctx.moveTo(x, layout.top);
        ctx.lineTo(x, layout.top + layout.plotH);
      }
      ctx.stroke();
      ctx.restore();

      const flow = profile.buy - profile.sell;
      tooltip.innerHTML = `
        <strong>${price} · ${new Date(nearestFrame?.ts || layout.endTs).toLocaleTimeString()}</strong>
        <span>Bid depth <b>${compact.format(bidQuote)}</b></span>
        <span>Ask depth <b>${compact.format(askQuote)}</b></span>
        <span>Tape total <b>${compact.format(profile.total || 0)}</b></span>
        <span>Tape delta <b class="${cls(flow)}">${compact.format(flow)}</b></span>
        <span>Wall <b>${wall ? `${wall.side.toUpperCase()} ${Math.round(wall.persistence * 100)}%` : '-'}</b></span>
      `;
      tooltip.hidden = false;
      const pad = 9;
      const tooltipW = tooltip.offsetWidth || 190;
      const tooltipH = tooltip.offsetHeight || 118;
      const nextX = Math.min(layout.width - tooltipW - pad, Math.max(pad, x + 14));
      const nextY = Math.min(layout.height - tooltipH - pad, Math.max(pad, y + 14));
      tooltip.style.left = `${Math.round(nextX)}px`;
      tooltip.style.top = `${Math.round(nextY)}px`;
    }

    function pruneLiquidityFrames(now = Date.now()) {
      const cutoff = now - liquidityWindowMs();
      liquidityFrames = liquidityFrames.filter(frame => frame.ts >= cutoff).slice(-900);
    }

    function recordLiquidityFrame(force = false) {
      const now = Date.now();
      if (!force && now - lastLiquidityFrame < 500) return;
      if (!book.asks.length && !book.bids.length) return;
      lastLiquidityFrame = now;
      const levels = new Map();
      const capture = (rows, side) => {
        rows.slice(0, 100).forEach(level => {
          const price = Number(level[0] || 0);
          const quote = levelVol(level);
          if (!price || !quote) return;
          const bucket = priceBucket(price);
          const key = `${side}:${bucket}`;
          const item = levels.get(key) || { price: bucket, side, quote: 0 };
          item.quote += quote;
          levels.set(key, item);
        });
      };
      capture(book.asks, 'ask');
      capture(book.bids, 'bid');
      liquidityFrames.push({ ts: now, levels: [...levels.values()] });
      pruneLiquidityFrames(now);
      requestLiquidityRender();
    }

    function requestLiquidityRender(force = false) {
      if (force) liquidityRenderPending = false;
      if (liquidityRenderPending) return;
      liquidityRenderPending = true;
      requestAnimationFrame(() => {
        liquidityRenderPending = false;
        renderLiquidityHeatmap();
      });
    }

    function liquidityHeatColor(value, side, mode = 'depth', persistence = 0) {
      const ratio = Math.max(0, Math.min(1, value));
      const alpha = 0.1 + ratio * 0.78;
      if (mode === 'pressure') {
        return side === 'bid'
          ? `rgba(46, 224, 111, ${alpha})`
          : `rgba(255, 85, 85, ${alpha})`;
      }
      if (mode === 'walls') {
        if (persistence > 0.56 || ratio > 0.78) return `rgba(255, 209, 102, ${Math.min(0.92, alpha + persistence * 0.18)})`;
        return side === 'bid'
          ? `rgba(68, 199, 132, ${alpha})`
          : `rgba(255, 128, 98, ${alpha})`;
      }
      if (ratio > 0.78) return `rgba(255, 84, 45, ${alpha})`;
      if (ratio > 0.52) return `rgba(139, 188, 255, ${alpha})`;
      if (ratio > 0.28) return side === 'bid' ? `rgba(46, 224, 111, ${alpha})` : `rgba(85, 170, 255, ${alpha})`;
      return `rgba(30, 101, 139, ${alpha})`;
    }

    function visibleLiquidityPrices(frames, maxRows) {
      const prices = new Set();
      frames.forEach(frame => frame.levels.forEach(level => prices.add(level.price)));
      volumeByPrice.forEach(profile => prices.add(profile.price));
      [lastTradePrice, market?.last_price, book.asks[0]?.[0], book.bids[0]?.[0]]
        .map(Number)
        .filter(Boolean)
        .forEach(price => prices.add(priceBucket(price)));
      let rows = [...prices].filter(price => Number(price) > 0).sort((a, b) => Number(b) - Number(a));
      if (rows.length <= maxRows) return rows;
      const target = Number(lastTradePrice || market?.last_price || book.bids[0]?.[0] || book.asks[0]?.[0] || rows[Math.floor(rows.length / 2)] || 0);
      const index = rows.reduce((best, row, idx) => {
        const distance = Math.abs(Number(row) - target);
        return distance < best.distance ? { index: idx, distance } : best;
      }, { index: 0, distance: Infinity }).index;
      const start = Math.max(0, Math.min(rows.length - maxRows, index - Math.floor(maxRows / 2)));
      return rows.slice(start, start + maxRows);
    }

    function nearestLiquidityRow(prices, price) {
      if (!prices.length || !price) return -1;
      return prices.reduce((best, row, index) => {
        const distance = Math.abs(Number(row) - price);
        return distance < best.distance ? { index, distance } : best;
      }, { index: -1, distance: Infinity }).index;
    }

    function strongestBookLevel(rows) {
      return rows.reduce((best, level) => {
        const quote = levelVol(level);
        return quote > best.quote ? { price: Number(level[0] || 0), quote } : best;
      }, { price: 0, quote: 0 });
    }

    function clearLiquidityHeatmap() {
      liquidityFrames = [];
      lastLiquidityFrame = 0;
      liquidityHover = null;
      hideLiquidityTooltip();
      requestLiquidityRender(true);
    }

    function renderLiquidityHeatmap() {
      const canvas = document.getElementById('liquidityHeatmapCanvas');
      if (!canvas) return;
      const wrap = canvas.parentElement;
      const width = Math.max(320, Math.floor(wrap?.clientWidth || canvas.clientWidth || 0));
      const height = Math.max(260, Math.floor(wrap?.clientHeight || canvas.clientHeight || 0));
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, width, height);
      const background = ctx.createLinearGradient(0, 0, 0, height);
      background.addColorStop(0, '#0b0f12');
      background.addColorStop(1, '#080b0e');
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, width, height);

      pruneLiquidityFrames();
      const frames = liquidityFrames;
      const status = document.getElementById('liquidityStatus');
      const frameCount = document.getElementById('liquidityFrames');
      if (frameCount) frameCount.textContent = String(frames.length);
      if (!frames.length) {
        ctx.fillStyle = '#9aa6b2';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('Waiting for live book snapshots...', 14, 28);
        hideLiquidityTooltip();
        setLiquidityStat('liquidityBookTilt', '-', 0);
        setLiquidityStat('liquidityPrintFlow', '-', 0);
        setLiquidityStat('liquidityNearestWall', '-', 0);
        if (status) status.textContent = 'Waiting for live book';
        return;
      }

      const mode = liquidityMode();
      const top = 16;
      const bottom = 28;
      const left = 10;
      const labelW = width < 520 ? 64 : 84;
      const profileW = width < 520 ? 58 : 82;
      const plotW = Math.max(128, width - left - labelW - profileW - 16);
      const plotH = Math.max(96, height - top - bottom);
      const prices = visibleLiquidityPrices(frames, liquidityMaxRows());
      if (!prices.length) {
        ctx.fillStyle = '#9aa6b2';
        ctx.font = '12px system-ui, sans-serif';
        ctx.fillText('Waiting for price rows...', 14, 28);
        hideLiquidityTooltip();
        return;
      }
      const rowH = Math.max(2, plotH / Math.max(1, prices.length));
      const priceIndex = new Map(prices.map((price, index) => [price, index]));
      const startTs = Math.min(...frames.map(frame => frame.ts));
      const endTs = Math.max(Date.now(), ...frames.map(frame => frame.ts));
      const span = Math.max(1, endTs - startTs);
      const maxQuote = Math.max(1, ...frames.flatMap(frame => frame.levels.map(level => level.quote)));
      const maxBidQuote = Math.max(1, ...frames.flatMap(frame => frame.levels.filter(level => level.side === 'bid').map(level => level.quote)));
      const maxAskQuote = Math.max(1, ...frames.flatMap(frame => frame.levels.filter(level => level.side === 'ask').map(level => level.quote)));
      const colW = Math.max(1.2, plotW / Math.max(24, frames.length));
      const analytics = liquidityWallAnalytics(frames);
      const stats = liquidityDepthStats(endTs);
      const profileX = left + plotW + 8;
      const layout = {
        width,
        height,
        top,
        left,
        plotW,
        plotH,
        profileW,
        profileX,
        rowH,
        prices,
        priceIndex,
        frames,
        startTs,
        endTs,
        span,
        wallByKey: analytics.byKey
      };

      ctx.strokeStyle = 'rgba(255,255,255,.06)';
      ctx.lineWidth = 1;
      const rowGridStep = Math.max(4, Math.ceil(prices.length / 12));
      for (let i = 0; i < prices.length; i += rowGridStep) {
        const y = top + i * rowH;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + plotW + profileW, y);
        ctx.stroke();
      }
      for (let i = 0; i <= 4; i += 1) {
        const x = left + (plotW * i) / 4;
        ctx.beginPath();
        ctx.moveTo(x, top);
        ctx.lineTo(x, top + plotH);
        ctx.stroke();
      }

      if (liquidityMarksEnabled() && stats.bestBid && stats.bestAsk) {
        const bidRow = nearestLiquidityRow(prices, stats.bestBid);
        const askRow = nearestLiquidityRow(prices, stats.bestAsk);
        if (bidRow >= 0 && askRow >= 0) {
          const y1 = top + Math.min(bidRow, askRow) * rowH;
          const y2 = top + (Math.max(bidRow, askRow) + 1) * rowH;
          ctx.fillStyle = 'rgba(139, 188, 255, .06)';
          ctx.fillRect(left, y1, plotW + profileW, Math.max(2, y2 - y1));
        }
      }

      frames.forEach(frame => {
        const x = left + ((frame.ts - startTs) / span) * plotW;
        frame.levels.forEach(level => {
          const row = priceIndex.get(level.price);
          if (row === undefined) return;
          const wall = analytics.byKey.get(`${level.side}:${level.price}`);
          const sideMax = level.side === 'bid' ? maxBidQuote : maxAskQuote;
          const baseRatio = level.quote / (mode === 'pressure' ? sideMax : maxQuote);
          const wallRatio = wall ? wall.score / analytics.maxScore : 0;
          const ratio = mode === 'walls' ? Math.max(baseRatio, wallRatio * 0.9) : baseRatio;
          ctx.fillStyle = liquidityHeatColor(ratio, level.side, mode, wall?.persistence || 0);
          ctx.fillRect(x, top + row * rowH, colW, Math.max(1, rowH - 0.3));
        });
      });

      ctx.strokeStyle = 'rgba(255,255,255,.1)';
      ctx.beginPath();
      ctx.moveTo(profileX - 4, top);
      ctx.lineTo(profileX - 4, top + plotH);
      ctx.moveTo(profileX + profileW / 2, top);
      ctx.lineTo(profileX + profileW / 2, top + plotH);
      ctx.stroke();

      const visibleProfiles = prices.map(price => volumeByPrice.get(price) || { price, buy: 0, sell: 0, total: 0 });
      const maxTape = Math.max(1, ...visibleProfiles.map(item => item.total));
      visibleProfiles.forEach((profile, index) => {
        if (!profile.total) return;
        const y = top + index * rowH;
        const sellW = Math.min(profileW / 2, (profile.sell / maxTape) * profileW);
        const buyW = Math.min(profileW / 2, (profile.buy / maxTape) * profileW);
        ctx.fillStyle = 'rgba(255, 85, 85, .55)';
        ctx.fillRect(profileX + profileW / 2 - sellW, y, sellW, Math.max(1, rowH - 0.3));
        ctx.fillStyle = 'rgba(46, 224, 111, .62)';
        ctx.fillRect(profileX + profileW / 2, y, buyW, Math.max(1, rowH - 0.3));
      });

      if (liquidityMarksEnabled()) {
        drawLiquidityWallMarkers(ctx, layout, analytics);
        if (stats.bestAsk) drawLiquidityPriceLine(ctx, layout, stats.bestAsk, 'rgba(255, 85, 85, .66)', 'ASK', [3, 4]);
        if (stats.bestBid) drawLiquidityPriceLine(ctx, layout, stats.bestBid, 'rgba(46, 224, 111, .66)', 'BID', [3, 4]);
      }

      if (document.getElementById('liquidityBubbles')?.checked) {
        const recent = tapeHistory.filter(trade => trade.ts >= endTs - liquidityWindowMs());
        const maxTrade = Math.max(1, ...recent.map(trade => trade.quote));
        recent.slice(-450).forEach(trade => {
          const row = priceIndex.has(priceBucket(trade.price))
            ? priceIndex.get(priceBucket(trade.price))
            : nearestLiquidityRow(prices, trade.price);
          if (row < 0) return;
          const x = left + ((trade.ts - startTs) / span) * plotW;
          if (x < left - 10 || x > left + plotW + 10) return;
          const y = top + row * rowH + rowH / 2;
          const radius = Math.min(10, 1.8 + Math.sqrt(trade.quote / maxTrade) * 8);
          ctx.beginPath();
          ctx.fillStyle = trade.side === 'buy' ? 'rgba(46, 224, 111, .72)' : 'rgba(255, 85, 85, .72)';
          ctx.arc(x, y, radius, 0, Math.PI * 2);
          ctx.fill();
          ctx.strokeStyle = trade.quote >= maxTrade * 0.5 ? 'rgba(255, 209, 102, .78)' : 'rgba(255,255,255,.28)';
          ctx.stroke();
        });
      }

      const last = Number(lastTradePrice || market?.last_price || 0);
      const lastRow = nearestLiquidityRow(prices, last);
      if (lastRow >= 0) {
        const y = top + lastRow * rowH + rowH / 2;
        ctx.strokeStyle = 'rgba(139, 188, 255, .95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(left + plotW + profileW, y);
        ctx.stroke();
        const text = fmt.format(last);
        const textW = ctx.measureText(text).width + 10;
        ctx.fillStyle = 'rgba(8, 11, 14, .82)';
        ctx.fillRect(left + plotW + profileW + 1, y - 9, textW, 17);
        ctx.fillStyle = '#8bbcff';
        ctx.font = '11px system-ui, sans-serif';
        ctx.fillText(text, left + plotW + profileW + 6, y + 4);
      }

      ctx.fillStyle = '#9aa6b2';
      ctx.font = '10px system-ui, sans-serif';
      const labelStep = Math.max(1, Math.ceil(prices.length / Math.max(5, Math.floor(plotH / 42))));
      prices.forEach((price, index) => {
        if (index % labelStep !== 0 && index !== prices.length - 1) return;
        ctx.fillText(price, left + plotW + profileW + 4, top + index * rowH + Math.max(10, rowH));
      });
      const startLabel = new Date(startTs).toLocaleTimeString();
      const endLabel = new Date(endTs).toLocaleTimeString();
      ctx.fillText(startLabel, left, height - 6);
      ctx.fillText(endLabel, Math.max(left, left + plotW - ctx.measureText(endLabel).width), height - 6);
      ctx.fillText('Profile', profileX + Math.max(2, profileW / 2 - 16), height - 6);

      renderLiquidityHover(ctx, layout);

      const strongBid = strongestBookLevel(book.bids);
      const strongAsk = strongestBookLevel(book.asks);
      const tapePoc = [...volumeByPrice.values()].sort((a, b) => b.total - a.total)[0];
      setLiquidityStat('liquidityBookTilt', stats.totalBook ? `${stats.tilt > 0 ? '+' : ''}${stats.tilt.toFixed(1)}%` : '-', stats.tilt);
      const spread = document.getElementById('liquiditySpread');
      if (spread) {
        spread.textContent = stats.spread ? `${fmt.format(stats.spread)} · ${stats.spreadBps.toFixed(1)}bp` : '-';
        spread.className = stats.spreadBps > 4 ? 'warn' : '';
      }
      setLiquidityStat('liquidityStrongBid', strongBid.quote ? `${fmt.format(strongBid.price)} · ${compact.format(strongBid.quote)}` : '-', strongBid.quote);
      setLiquidityStat('liquidityStrongAsk', strongAsk.quote ? `${fmt.format(strongAsk.price)} · ${compact.format(strongAsk.quote)}` : '-', -strongAsk.quote);
      setLiquidityStat('liquidityNearestWall', liquidityWallText(analytics.nearestWall), analytics.nearestWall?.side === 'bid' ? 1 : analytics.nearestWall?.side === 'ask' ? -1 : 0);
      const tapePocElement = document.getElementById('liquidityTapePoc');
      if (tapePocElement) tapePocElement.textContent = tapePoc?.total ? `${tapePoc.price} · ${compact.format(tapePoc.total)}` : '-';
      setLiquidityStat('liquidityPrintFlow', stats.tapeTotal ? `${stats.printFlow > 0 ? '+' : ''}${stats.printFlow.toFixed(1)}%` : '-', stats.printFlow);
      const cvd = document.getElementById('liquidityCvd');
      cvd.textContent = compact.format(cvdQuote);
      cvd.className = cls(cvdQuote);
      const modeLabel = mode === 'pressure' ? 'Pressure' : mode === 'walls' ? 'Walls' : 'Depth';
      if (status) status.textContent = `${modeLabel} · ${frames.length} frames · ${new Date(endTs).toLocaleTimeString()}`;
    }

    function centerDom(force = false) {
      if (!force && isWidgetResizeQuiet()) return;
      const scroller = document.querySelector('.dom-panel .scroll');
      const target = document.querySelector('#domRows [data-dom-center="1"]')
        || document.querySelector('#domRows .dom-last-trade')
        || document.querySelector('#domRows .dom-best-bid')
        || document.querySelector('#domRows .dom-best-ask');
      if (!scroller || !target) return;
      scroller.scrollTop = Math.max(0, target.offsetTop - scroller.clientHeight / 2 + target.clientHeight / 2);
    }

    function playBlockSound(side, quote, threshold) {
      if (!audioEnabled) return;
      const nowMs = Date.now();
      if (nowMs - lastBlockSoundAt < 90) return;
      lastBlockSoundAt = nowMs;
      const Audio = window.AudioContext || window.webkitAudioContext;
      if (!Audio) return;
      audioContext ||= new Audio();
      const osc = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const now = audioContext.currentTime;
      const strength = Math.min(1, quote / Math.max(1, threshold * 5));
      const peak = 0.026 + strength * 0.052;
      const duration = 0.13 + strength * 0.08;
      osc.frequency.value = side === 'buy' ? 660 + strength * 440 : 220 + strength * 180;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(peak, now + 0.012);
      gain.gain.setValueAtTime(peak, now + duration - 0.045);
      gain.gain.linearRampToValueAtTime(0, now + duration);
      osc.connect(gain);
      gain.connect(audioContext.destination);
      osc.start(now);
      osc.stop(now + duration + 0.01);
      osc.onended = () => {
        try {
          osc.disconnect();
          gain.disconnect();
        } catch {}
      };
    }

    function flowPayload() {
      const topProfile = [...volumeByPrice.values()].sort((a, b) => b.total - a.total).slice(0, 20);
      const profile = profileRows();
      const poc = profile.reduce((best, row) => row.total > best.total ? row : best, { price: null, total: 0 });
      const impulse = impulseAnalytics();
      return {
        symbol,
        ts: Date.now(),
        cvd_quote: cvdQuote,
        buy_quote: buyQuoteTotal,
        sell_quote: sellQuoteTotal,
        trade_flow_pct: buyQuoteTotal + sellQuoteTotal ? ((buyQuoteTotal - sellQuoteTotal) / (buyQuoteTotal + sellQuoteTotal)) * 100 : 0,
        block_threshold_usd: blockThreshold(),
        daily_candle: dailyCandle,
        daily_profile_anchor: profileAnchorPrice(),
        daily_profile_poc: poc,
        impulse_profile: impulse.active ? {
          mode: impulse.mode,
          kind: impulse.kind,
          position_side: impulse.positionSide,
          start_ts: activeImpulse.startTs,
          start_price: activeImpulse.startPrice,
          move_pct: impulse.move,
          pnl_pct: impulse.positionSide ? impulse.move : null,
          vwap: impulse.vwap,
          lower_hvn: impulse.lowerHvn,
          total_quote: impulse.total
        } : {},
        large_blocks: blockTrades.slice(0, 20),
        volume_by_price: topProfile,
        recent_trades: trades.slice(0, 50)
      };
    }

    async function postAgentFlow(force = false) {
      const now = Date.now();
      if (!force && now - lastAgentPost < 2500) return;
      lastAgentPost = now;
      try {
        await fetch('/api/agent/flow', {
          method: 'POST',
          cache: 'no-store',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(flowPayload())
        });
      } catch {
        return;
      }
    }

    function renderPressure() {
      const bidQuote = book.bids.reduce((total, level) => total + levelVol(level), 0);
      const askQuote = book.asks.reduce((total, level) => total + levelVol(level), 0);
      const totalBook = bidQuote + askQuote;
      const imbalance = totalBook ? ((bidQuote - askQuote) / totalBook) * 100 : 0;
      const recentTrades = trades.slice(0, 60);
      const buyQuote = recentTrades
        .filter(trade => String(trade.s || '').toLowerCase() === 'buy')
        .reduce((total, trade) => total + Number(trade.p || 0) * Number(trade.v || 0), 0);
      const sellQuote = recentTrades
        .filter(trade => String(trade.s || '').toLowerCase() === 'sell')
        .reduce((total, trade) => total + Number(trade.p || 0) * Number(trade.v || 0), 0);
      const tradeTotal = buyQuote + sellQuote;
      const flow = tradeTotal ? ((buyQuote - sellQuote) / tradeTotal) * 100 : 0;
      document.getElementById('pressure').innerHTML = `
        <table><tbody>
          <tr><td>Book Bid Quote</td><td class="pos">${compact.format(bidQuote)}</td></tr>
          <tr><td>Book Ask Quote</td><td class="neg">${compact.format(askQuote)}</td></tr>
          <tr><td>Book Imbalance</td><td class="${cls(imbalance)}">${pct(imbalance)}</td></tr>
          <tr><td>Recent Buy Prints</td><td class="pos">${compact.format(buyQuote)}</td></tr>
          <tr><td>Recent Sell Prints</td><td class="neg">${compact.format(sellQuote)}</td></tr>
          <tr><td>Trade Flow</td><td class="${cls(flow)}">${pct(flow)}</td></tr>
        </tbody></table>`;
      document.getElementById('pressureTime').textContent = new Date().toLocaleTimeString();
    }

    async function loadLiquidations() {
      const requestSymbol = symbol;
      const range = document.getElementById('liqRange').value;
      let data = null;
      try {
        const response = await fetch(cacheBust(`/api/coinglass/liquidations?symbol=${encodeURIComponent(requestSymbol)}&range=${encodeURIComponent(range)}`), { cache: 'no-store' });
        data = await response.json();
      } catch (error) {
        if (requestSymbol === symbol && document.getElementById('liquidations')?.textContent === 'Loading...') {
          document.getElementById('liquidations').textContent = `Liquidations refresh failed: ${error.message || 'network error'}`;
        }
        return;
      }
      if (requestSymbol !== symbol) return;
      if (data.error) {
        document.getElementById('liquidations').textContent = data.error;
        return;
      }
      const totals = data.totals || {};
      const exchanges = Array.isArray(data.exchanges) ? data.exchanges.slice(0, 8) : [];
      document.getElementById('liquidations').innerHTML = `
        <table><tbody>
          <tr><td>Coin</td><td>${data.coin || '-'}</td></tr>
          <tr><td>Range</td><td>${data.range || range}</td></tr>
          <tr><td>Long Liqs</td><td class="neg">${compact.format(totals.long || 0)}</td></tr>
          <tr><td>Short Liqs</td><td class="pos">${compact.format(totals.short || 0)}</td></tr>
          <tr><td>Total Liqs</td><td>${compact.format(totals.total || 0)}</td></tr>
        </tbody></table>
        <table>
          <thead><tr><th>Exchange</th><th>Long</th><th>Short</th><th>Total</th></tr></thead>
          <tbody>${exchanges.map(item => `
            <tr>
              <td>${item.exchange || item.exchangeName || '-'}</td>
              <td class="neg">${compact.format(item.long || 0)}</td>
              <td class="pos">${compact.format(item.short || 0)}</td>
              <td>${compact.format(item.total || 0)}</td>
            </tr>`).join('') || '<tr><td colspan="4" class="muted">No exchange rows returned.</td></tr>'}</tbody>
        </table>`;
    }

    function connectStreams() {
      if (streamReconnectTimer) {
        clearTimeout(streamReconnectTimer);
        streamReconnectTimer = null;
      }
      if (streamWatchdogTimer) {
        clearTimeout(streamWatchdogTimer);
        streamWatchdogTimer = null;
      }
      if (socket) {
        socket.manualClose = true;
        socket.close();
      }
      const streamSymbol = symbol;
      const nextSocket = new WebSocket(wsUrl);
      socket = nextSocket;
      let pingTimer = null;
      nextSocket.addEventListener('open', () => {
        if (nextSocket !== socket || streamSymbol !== symbol) return;
        document.getElementById('status').textContent = 'Live streams connected';
        nextSocket.send(JSON.stringify({
          op: 'subscribe',
          args: [
            { symbol: streamSymbol, ch: 'trade' },
            { symbol: streamSymbol, ch: 'depth_book15' }
          ]
        }));
        pingTimer = setInterval(() => {
          if (nextSocket === socket && nextSocket.readyState === WebSocket.OPEN) {
            nextSocket.send(JSON.stringify({ op: 'ping', ping: Math.floor(Date.now() / 1000) }));
          }
        }, 20000);
        streamWatchdogTimer = setTimeout(() => {
          if (nextSocket !== socket || streamSymbol !== symbol || trades.length) return;
          document.getElementById('status').textContent = `Connected, waiting for ${streamSymbol} tape...`;
          requestTradeRender(true);
          renderFlowProfile();
        }, 5000);
      });
      nextSocket.addEventListener('message', event => {
        if (nextSocket !== socket || streamSymbol !== symbol) return;
        let msg = null;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }
        if (msg.ch === 'trade' && Array.isArray(msg.data)) {
          if (streamWatchdogTimer) {
            clearTimeout(streamWatchdogTimer);
            streamWatchdogTimer = null;
          }
          ingestTrades(msg.data);
          requestTradeRender();
        }
        if (String(msg.ch || '').startsWith('depth_') && msg.data) {
          book = { asks: msg.data.a || msg.data.asks || book.asks, bids: msg.data.b || msg.data.bids || book.bids };
          requestBookRender('Live book');
        }
      });
      nextSocket.addEventListener('close', () => {
        if (pingTimer) clearInterval(pingTimer);
        if (streamWatchdogTimer) {
          clearTimeout(streamWatchdogTimer);
          streamWatchdogTimer = null;
        }
        if (nextSocket.manualClose || nextSocket !== socket || streamSymbol !== symbol) return;
        document.getElementById('status').textContent = 'Stream closed, reconnecting...';
        streamReconnectTimer = setTimeout(connectStreams, 3000);
      });
      nextSocket.addEventListener('error', () => {
        if (streamWatchdogTimer) {
          clearTimeout(streamWatchdogTimer);
          streamWatchdogTimer = null;
        }
        if (nextSocket !== socket || streamSymbol !== symbol) return;
        document.getElementById('status').textContent = 'Stream error';
      });
    }

    function markActiveControls() {
      document.getElementById('sideBuy').classList.toggle('active', selectedSide === 'BUY');
      document.getElementById('sideSell').classList.toggle('active', selectedSide === 'SELL');
      document.querySelectorAll('.type-tab').forEach(button => {
        button.classList.toggle('active', button.dataset.type === selectedOrderType);
      });
      document.getElementById('leverageButton').textContent = `${leverage}x`;
      document.getElementById('orderPrice').disabled = selectedOrderType === 'MARKET';
      document.getElementById('submitBuy').textContent = selectedSide === 'BUY' ? 'Open Long' : 'Switch Long';
      document.getElementById('submitSell').textContent = selectedSide === 'SELL' ? 'Open Short' : 'Switch Short';
    }

    function currentEntryPrice() {
      const manual = Number(document.getElementById('orderPrice').value || 0);
      if (manual > 0) return manual;
      if (selectedSide === 'BUY') return Number(book.asks[0]?.[0] || market?.last_price || 0);
      return Number(book.bids[0]?.[0] || market?.last_price || 0);
    }

    function syncQtyFromUsd() {
      const usd = Number(document.getElementById('usdPosition').value || 0);
      const price = currentEntryPrice();
      if (usd > 0 && price > 0) {
        const qty = usd / price;
        document.getElementById('orderQty').value = qty.toFixed(Math.max(0, Math.min(8, Number(market?.base_precision ?? 6))));
      }
      updateCalculator();
    }

    function updateCalculator() {
      const price = currentEntryPrice();
      const qty = Number(document.getElementById('orderQty').value || 0);
      const usdInput = Number(document.getElementById('usdPosition').value || 0);
      const notional = usdInput > 0 ? usdInput : qty * price;
      const accountEquity = Number(document.getElementById('accountEquity').value || 0);
      const available = Number(document.getElementById('availableMargin').value || 0);
      const maintenanceRate = Math.max(0, Number(document.getElementById('maintenanceMargin').value || 0)) / 100;
      const initialMargin = leverage > 0 ? notional / leverage : 0;
      const freeAfter = available ? available - initialMargin : 0;
      const marginBuffer = accountEquity > 0 ? accountEquity - initialMargin : initialMargin;
      const adverseMove = notional > 0 ? Math.max(0, (marginBuffer / notional) - maintenanceRate) : 0;
      const liquidation = selectedSide === 'BUY'
        ? price * (1 - adverseMove)
        : price * (1 + adverseMove);
      const tickSize = Math.pow(10, -Number(market?.quote_precision ?? 4));
      const tickValue = qty * tickSize;
      const onePctMove = notional * 0.01;
      const rows = [
        ['Entry', price ? fmt.format(price) : '-'],
        ['Notional', notional ? `${compact.format(notional)} USDT` : '-'],
        ['Initial Margin', initialMargin ? `${fmt.format(initialMargin)} USDT` : '-'],
        ['Free After', available ? `${fmt.format(freeAfter)} USDT` : '-'],
        ['Est. Liq', liquidation > 0 && Number.isFinite(liquidation) ? fmt.format(liquidation) : '-'],
        ['Distance', adverseMove ? pct(adverseMove * 100) : '-'],
        ['Tick Size', fmt.format(tickSize)],
        ['Tick Value', tickValue ? `${fmt.format(tickValue)} USDT` : '-'],
        ['1% PnL', notional ? `${fmt.format(onePctMove)} USDT` : '-']
      ];
      document.getElementById('marginCalc').innerHTML = rows
        .map(([label, value]) => `<tr><td>${label}</td><td>${value}</td></tr>`)
        .join('');
    }

    function applyPercent(percent) {
      const available = Number(document.getElementById('availableMargin').value || 0);
      if (!available) return;
      const notional = available * (percent / 100) * leverage;
      document.getElementById('usdPosition').value = notional.toFixed(2);
      syncQtyFromUsd();
    }

    function isSafetyLocked() {
      return document.getElementById('orderSafetyLock').checked || document.getElementById('domSafetyLock').checked;
    }

    function syncSafetyLocks(sourceId) {
      const checked = document.getElementById(sourceId).checked;
      document.getElementById('orderSafetyLock').checked = checked;
      document.getElementById('domSafetyLock').checked = checked;
      document.getElementById('orderResult').textContent = checked
        ? 'Safety lock is ON. Live order submission is blocked.'
        : 'Safety lock is OFF. Confirmation is still required before any live order.';
    }

    async function submitOrder(sideOverride = selectedSide) {
      selectedSide = sideOverride;
      markActiveControls();
      if (apiConfig.trading_live && isSafetyLocked()) {
        document.getElementById('orderResult').textContent = 'Blocked by safety lock. Turn Order Lock off before submitting a live order.';
        return;
      }
      const payload = {
        symbol,
        side: selectedSide,
        orderType: selectedOrderType === 'MARKET' ? 'MARKET' : 'LIMIT',
        qty: document.getElementById('orderQty').value.trim(),
        price: document.getElementById('orderPrice').value.trim(),
        tradeSide: 'OPEN',
        effect: document.getElementById('orderEffect').value,
        reduceOnly: document.getElementById('reduceOnly').checked,
        confirm: document.getElementById('orderConfirm').checked,
        safetyLock: isSafetyLocked()
      };
      document.getElementById('orderResult').textContent = 'Preparing order...';
      const response = await fetch(cacheBust('/api/trading/place-order'), {
        method: 'POST',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const result = await response.json();
      document.getElementById('orderResult').textContent = JSON.stringify(result, null, 2);
    }

    function setupLayoutMode() {
      const button = document.getElementById('layoutToggle');
      if (!button) return;
      const saved = localStorage.getItem('bitunix.detail.layoutEdit') === '1';
      document.body.classList.toggle('layout-edit', saved);
      button.textContent = saved ? 'Done Layout' : 'Layout';
      button.addEventListener('click', () => {
        const enabled = !document.body.classList.contains('layout-edit');
        document.body.classList.toggle('layout-edit', enabled);
        localStorage.setItem('bitunix.detail.layoutEdit', enabled ? '1' : '0');
        button.textContent = enabled ? 'Done Layout' : 'Layout';
        window.dispatchEvent(new CustomEvent('layout-mode-change', { detail: { enabled } }));
      });
    }

    function setupFreeLayout() {
      const grid = document.getElementById('detailGrid');
      const panels = registeredWidgetPanels(detailWidgets, grid).map(item => item.panel);
      const storageKey = 'bitunix.detail.freeLayout.v1';
      let dragState = null;
      let resizeState = null;

      function readLayout() {
        try {
          return JSON.parse(localStorage.getItem(storageKey) || '{}');
        } catch {
          return {};
        }
      }

      function writeLayout() {
        const layout = {};
        panels.forEach(panel => {
          layout[panel.dataset.panelId] = {
            x: Number.parseFloat(panel.style.left || 0),
            y: Number.parseFloat(panel.style.top || 0),
            w: Number.parseFloat(panel.style.width || panel.getBoundingClientRect().width),
            h: Number.parseFloat(panel.style.height || panel.getBoundingClientRect().height)
          };
        });
        localStorage.setItem(storageKey, JSON.stringify(layout));
        updateCanvasHeight();
      }

      function captureCurrentLayout() {
        const gridRect = grid.getBoundingClientRect();
        const layout = {};
        panels.forEach(panel => {
          const rect = panel.getBoundingClientRect();
          layout[panel.dataset.panelId] = {
            x: Math.max(0, Math.round(rect.left - gridRect.left)),
            y: Math.max(0, Math.round(rect.top - gridRect.top)),
            w: Math.round(rect.width),
            h: Math.round(rect.height)
          };
        });
        return layout;
      }

      function completeLayout(layout) {
        const captured = captureCurrentLayout();
        const next = { ...layout };
        panels.forEach(panel => {
          if (!next[panel.dataset.panelId]) next[panel.dataset.panelId] = captured[panel.dataset.panelId];
        });
        return next;
      }

      function applyLayout(layout) {
        document.body.classList.add('free-layout');
        panels.forEach(panel => {
          const item = layout[panel.dataset.panelId];
          if (!item) return;
          panel.style.left = `${Math.round(item.x)}px`;
          panel.style.top = `${Math.round(item.y)}px`;
          panel.style.width = `${Math.max(260, Math.round(item.w))}px`;
          panel.style.height = `${Math.max(120, Math.round(item.h))}px`;
        });
        updateCanvasHeight();
        requestLiquidityRender(true);
      }

      function updateCanvasHeight() {
        const bottom = panels.reduce((max, panel) => {
          const y = Number.parseFloat(panel.style.top || 0);
          const h = Number.parseFloat(panel.style.height || panel.getBoundingClientRect().height);
          return Math.max(max, y + h);
        }, 0);
        grid.style.minHeight = `${Math.max(window.innerHeight - 178, bottom + 24)}px`;
      }

      function ensureFreeLayout() {
        if (document.body.classList.contains('free-layout')) return;
        const saved = readLayout();
        const layout = Object.keys(saved).length ? completeLayout(saved) : captureCurrentLayout();
        applyLayout(layout);
        if (!Object.keys(saved).length) writeLayout();
      }

      function nudge(panel, action) {
        ensureFreeLayout();
        const step = 24;
        const x = Number.parseFloat(panel.style.left || 0);
        const y = Number.parseFloat(panel.style.top || 0);
        if (action === 'left') panel.style.left = `${Math.max(0, x - step)}px`;
        if (action === 'right') panel.style.left = `${x + step}px`;
        if (action === 'up') panel.style.top = `${Math.max(0, y - step)}px`;
        if (action === 'down') panel.style.top = `${y + step}px`;
        writeLayout();
      }

      panels.forEach(panel => {
        panel.setAttribute('draggable', 'false');
        const header = panel.querySelector('h2');
        if (header && !header.querySelector('.layout-controls')) {
          const controls = document.createElement('span');
          controls.className = 'layout-controls';
          controls.innerHTML = `
            <button type="button" data-layout-action="up">Up</button>
            <button type="button" data-layout-action="down">Down</button>
            <button type="button" data-layout-action="left">Left</button>
            <button type="button" data-layout-action="right">Right</button>
            ${canDetachWidgets() ? '<button type="button" data-layout-action="detach">Detach</button>' : ''}
          `;
          header.appendChild(controls);
          controls.addEventListener('click', event => {
            const button = event.target.closest('button[data-layout-action]');
            if (!button) return;
            if (button.dataset.layoutAction === 'detach') detachWidget(panel);
            else nudge(panel, button.dataset.layoutAction);
            event.preventDefault();
            event.stopPropagation();
          });
        }
        if (!panel.querySelector('.layout-resizer')) {
          const handle = document.createElement('div');
          handle.className = 'layout-resizer';
          handle.title = 'Resize panel';
          panel.appendChild(handle);
        }
        header?.addEventListener('pointerdown', event => {
          if (!document.body.classList.contains('layout-edit')) return;
          if (event.target.closest('button, input, select, a, summary, details, .inline-controls, .layout-controls, .column-menu')) return;
          ensureFreeLayout();
          dragState = {
            panel,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: panel.offsetLeft,
            startTop: panel.offsetTop
          };
          panel.classList.add('dragging');
          document.body.classList.add('layout-dragging');
          panel.setPointerCapture?.(event.pointerId);
          event.preventDefault();
        });
        panel.querySelector('.layout-resizer')?.addEventListener('pointerdown', event => {
          if (!document.body.classList.contains('layout-edit')) return;
          ensureFreeLayout();
          beginWidgetResize();
          resizeState = {
            panel,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: panel.offsetWidth,
            startHeight: panel.offsetHeight
          };
          panel.classList.add('resizing');
          event.preventDefault();
          event.stopPropagation();
        });
      });

      document.addEventListener('pointermove', event => {
        if (resizeState) {
          resizeQuietUntil = Date.now() + 300;
          resizeState.panel.style.width = `${Math.max(260, Math.round(resizeState.startWidth + (event.clientX - resizeState.startX)))}px`;
          resizeState.panel.style.height = `${Math.max(120, Math.round(resizeState.startHeight + (event.clientY - resizeState.startY)))}px`;
          updateCanvasHeight();
          event.preventDefault();
          return;
        }
        if (!dragState) return;
        dragState.panel.style.left = `${Math.max(0, Math.round(dragState.startLeft + (event.clientX - dragState.startX)))}px`;
        dragState.panel.style.top = `${Math.max(0, Math.round(dragState.startTop + (event.clientY - dragState.startY)))}px`;
        updateCanvasHeight();
        event.preventDefault();
      });

      document.addEventListener('pointerup', () => {
        if (resizeState) {
          const panel = resizeState.panel;
          panel.classList.remove('resizing');
          resizeState = null;
          writeLayout();
          requestLiquidityRender(true);
          endWidgetResize(panel);
          if (panel.matches('.dom-panel, .bookmap-panel')) renderSizedRows();
        }
        if (dragState) {
          dragState.panel.classList.remove('dragging');
          document.body.classList.remove('layout-dragging');
          dragState = null;
          writeLayout();
        }
      });

      const saved = readLayout();
      if (Object.keys(saved).length) applyLayout(completeLayout(saved));
      if (document.body.classList.contains('layout-edit')) ensureFreeLayout();
      window.addEventListener('layout-mode-change', event => {
        if (event.detail.enabled) ensureFreeLayout();
      });
      window.addEventListener('resize', updateCanvasHeight);
    }

    function setupWorkspaces() {
      const grid = document.getElementById('detailGrid');
      let registeredPanels = registeredWidgetPanels(detailWidgets, grid);
      let panels = registeredPanels.map(item => item.panel);
      const storeKey = 'bitunix.detail.workspaces.v1';
      const legacyLayoutKey = 'bitunix.detail.freeLayout.v1';
      const autosaveWorkspaceName = 'last';
      const autosaveIntervalMs = 30 * 60 * 1000;
      const detailWidgetIds = detailWidgets.map(widget => widget.id);
      let dynamicPanelCounter = 0;
      let dynamicDragState = null;
      let dynamicResizeState = null;
      let activeWorkspaceName = '';

      function readLegacyLayout() {
        try { return JSON.parse(localStorage.getItem(legacyLayoutKey) || '{}'); }
        catch { return {}; }
      }

      function defaultHiddenWidgetIds() {
        return detailWidgets.filter(widget => widget.defaultVisible === false).map(widget => widget.id);
      }

      function defaultWorkspace() {
        return { layout: readLegacyLayout(), hidden: defaultHiddenWidgetIds(), scannerWidgets: [] };
      }

      function blankWorkspace() {
        return { layout: {}, hidden: [...detailWidgetIds], scannerWidgets: [] };
      }

      function isAutosaveWorkspaceName(name) {
        return String(name || '').trim().toLowerCase() === autosaveWorkspaceName;
      }

      function isDefaultWorkspaceName(name) {
        return name === 'Default' || isAutosaveWorkspaceName(name);
      }

      function cloneWorkspace(workspace) {
        return JSON.parse(JSON.stringify(workspace || defaultWorkspace()));
      }

      function blankWorkspaceForName(name) {
        return isDefaultWorkspaceName(name) ? defaultWorkspace() : blankWorkspace();
      }

      function hiddenDefaultsForName(name) {
        return isDefaultWorkspaceName(name) ? defaultHiddenWidgetIds() : [...detailWidgetIds];
      }

      function autosaveWorkspaceKey(store) {
        const existing = Object.keys(store.workspaces || {}).find(isAutosaveWorkspaceName);
        return existing || autosaveWorkspaceName;
      }

      function ensureAutosaveWorkspace(store) {
        store.workspaces ||= {};
        const name = autosaveWorkspaceKey(store);
        if (!store.workspaces[name]) {
          const source = store.active && store.workspaces[store.active]
            ? store.workspaces[store.active]
            : store.workspaces.Default || defaultWorkspace();
          store.workspaces[name] = cloneWorkspace(source);
        }
        store.workspaces[name].layout ||= {};
        store.workspaces[name].hidden ||= defaultHiddenWidgetIds();
        store.workspaces[name].scannerWidgets ||= [];
        return name;
      }

      function currentWorkspaceName(store) {
        return activeWorkspaceName || ensureAutosaveWorkspace(store);
      }

      function readStore() {
        try {
          const parsed = JSON.parse(localStorage.getItem(storeKey) || '{}');
          if (parsed.workspaces) {
            Object.entries(parsed.workspaces).forEach(([name, workspace]) => {
              workspace.layout ||= {};
              workspace.hidden ||= hiddenDefaultsForName(name);
              workspace.scannerWidgets ||= [];
            });
            const autosaveName = ensureAutosaveWorkspace(parsed);
            parsed.active ||= autosaveName;
            return parsed;
          }
        } catch {}
        const store = {
          active: autosaveWorkspaceName,
          workspaces: {
            Default: defaultWorkspace()
          }
        };
        store.active = ensureAutosaveWorkspace(store);
        return store;
      }

      function writeStore(store) {
        localStorage.setItem(storeKey, JSON.stringify(store));
      }

      function refreshRegisteredPanels() {
        registeredPanels = [
          ...registeredWidgetPanels(detailWidgets, grid),
          ...[...grid.querySelectorAll('.embedded-scanner-panel')].map(panel => ({
            widget: {
              id: panel.dataset.panelId,
              label: panel.querySelector('h2 span')?.textContent || panel.dataset.panelId,
              dynamic: true
            },
            panel
          }))
        ];
        panels = registeredPanels.map(item => item.panel);
      }

      function dashboardWidgetMeta(id) {
        return dashboardWidgets.find(widget => widget.id === id) || { id, label: id };
      }

      function uniqueWorkspaceName(store, base = 'Blank Workspace') {
        if (!store.workspaces[base]) return base;
        let index = 2;
        while (store.workspaces[`${base} ${index}`]) index += 1;
        return `${base} ${index}`;
      }

      function dynamicPanelId(widgetId) {
        dynamicPanelCounter += 1;
        return `scanner-${widgetId}-${Date.now()}-${dynamicPanelCounter}`;
      }

      function scannerWidgetFrameSrc(widgetId) {
        return `/?widget=${encodeURIComponent(widgetId)}&popout=1`;
      }

      function wireDynamicPanel(panel) {
        const header = panel.querySelector('h2');
        if (header && !header.querySelector('.layout-controls')) {
          const controls = document.createElement('span');
          controls.className = 'layout-controls';
          controls.innerHTML = `
            <button type="button" data-layout-action="up">Up</button>
            <button type="button" data-layout-action="down">Down</button>
            <button type="button" data-layout-action="left">Left</button>
            <button type="button" data-layout-action="right">Right</button>
            ${canDetachWidgets() ? '<button type="button" data-layout-action="detach">Detach</button>' : ''}
            <button type="button" data-layout-action="remove">Remove</button>
          `;
          header.appendChild(controls);
          controls.addEventListener('click', event => {
            const button = event.target.closest('button[data-layout-action]');
            if (!button) return;
            const action = button.dataset.layoutAction;
            if (action === 'detach') {
              detachWidget(panel);
            } else if (action === 'remove') {
              removeScannerPanel(panel.dataset.panelId);
            } else {
              const step = 24;
              const x = Number.parseFloat(panel.style.left || 0);
              const y = Number.parseFloat(panel.style.top || 0);
              if (action === 'left') panel.style.left = `${Math.max(0, x - step)}px`;
              if (action === 'right') panel.style.left = `${x + step}px`;
              if (action === 'up') panel.style.top = `${Math.max(0, y - step)}px`;
              if (action === 'down') panel.style.top = `${y + step}px`;
              saveActiveWorkspaceState();
            }
            updateCanvasHeight();
            event.preventDefault();
            event.stopPropagation();
          });
        }
        if (!panel.querySelector('.layout-resizer')) {
          const handle = document.createElement('div');
          handle.className = 'layout-resizer';
          handle.title = 'Resize panel';
          panel.appendChild(handle);
        }
        header?.addEventListener('pointerdown', event => {
          if (!document.body.classList.contains('layout-edit')) return;
          if (event.target.closest('button, input, select, a, summary, details, .layout-controls')) return;
          dynamicDragState = {
            panel,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: panel.offsetLeft,
            startTop: panel.offsetTop
          };
          panel.classList.add('dragging');
          document.body.classList.add('layout-dragging');
          panel.setPointerCapture?.(event.pointerId);
          event.preventDefault();
        });
        panel.querySelector('.layout-resizer')?.addEventListener('pointerdown', event => {
          if (!document.body.classList.contains('layout-edit')) return;
          dynamicResizeState = {
            panel,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: panel.offsetWidth,
            startHeight: panel.offsetHeight
          };
          panel.classList.add('resizing');
          event.preventDefault();
          event.stopPropagation();
        });
      }

      function createScannerPanel(definition) {
        if (!definition?.id || grid.querySelector(`[data-panel-id="${definition.id}"]`)) return;
        const widgetId = definition.widgetId;
        const meta = dashboardWidgetMeta(widgetId);
        const label = definition.label || meta.label || widgetId;
        const panel = document.createElement('section');
        panel.className = 'panel embedded-scanner-panel';
        panel.dataset.panelId = definition.id;
        panel.dataset.dashboardWidget = widgetId;
        panel.innerHTML = `
          <h2><span>Scanner ${label}</span></h2>
          <div class="scanner-frame-wrap">
            <iframe src="${scannerWidgetFrameSrc(widgetId)}" title="Scanner ${label}"></iframe>
          </div>
        `;
        grid.appendChild(panel);
        wireDynamicPanel(panel);
      }

      function ensureScannerPanels(workspace) {
        grid.querySelectorAll('.embedded-scanner-panel').forEach(panel => {
          const keep = (workspace.scannerWidgets || []).some(widget => widget.id === panel.dataset.panelId);
          if (!keep) panel.remove();
        });
        (workspace.scannerWidgets || []).forEach(createScannerPanel);
        refreshRegisteredPanels();
      }

      function workspaceScannerWidgets() {
        return [...grid.querySelectorAll('.embedded-scanner-panel')].map(panel => ({
          id: panel.dataset.panelId,
          widgetId: panel.dataset.dashboardWidget,
          label: (panel.querySelector('h2 span')?.textContent || '').replace(/^Scanner\s+/, '')
        }));
      }

      function currentLayout() {
        const gridRect = grid.getBoundingClientRect();
        const layout = {};
        panels.forEach(panel => {
          const rect = panel.getBoundingClientRect();
          layout[panel.dataset.panelId] = {
            x: Number.parseFloat(panel.style.left || Math.max(0, Math.round(rect.left - gridRect.left))),
            y: Number.parseFloat(panel.style.top || Math.max(0, Math.round(rect.top - gridRect.top))),
            w: Number.parseFloat(panel.style.width || Math.round(rect.width)),
            h: Number.parseFloat(panel.style.height || Math.round(rect.height))
          };
        });
        return layout;
      }

      function updateCanvasHeight() {
        const bottom = panels.reduce((max, panel) => {
          if (panel.hidden) return max;
          const y = Number.parseFloat(panel.style.top || 0);
          const h = Number.parseFloat(panel.style.height || panel.getBoundingClientRect().height);
          return Math.max(max, y + h);
        }, 0);
        grid.style.minHeight = `${Math.max(window.innerHeight - 178, bottom + 24)}px`;
      }

      function completeWorkspaceLayout(workspace) {
        const layout = { ...(workspace.layout || {}) };
        const hidden = new Set(workspace.hidden || []);
        let bottom = Object.values(layout).reduce((max, item) => {
          if (!item) return max;
          return Math.max(max, Number(item.y || 0) + Number(item.h || 0));
        }, 0);
        const gridWidth = Math.max(320, grid.getBoundingClientRect().width || window.innerWidth - 36);
        panels.forEach(panel => {
          const id = panel.dataset.panelId;
          if (layout[id]) return;
          if (hidden.has(id)) return;
          const rect = panel.getBoundingClientRect();
          const defaultHeight = panel.dataset.dashboardWidget ? 520 : id === 'tickerCard' ? 190 : id === 'metrics' ? 112 : id === 'liquidityHeatmap' ? 380 : id === 'bookmapProfile' || id === 'dom' || id === 'impulseHistory' ? 340 : id === 'trades' ? 420 : 220;
          layout[id] = {
            x: 0,
            y: bottom + 10,
            w: Math.min(Math.max(360, Math.round(rect.width || 520)), gridWidth),
            h: Math.max(defaultHeight, Math.round(rect.height || defaultHeight))
          };
          bottom = layout[id].y + layout[id].h;
        });
        return layout;
      }

      function applyWorkspace(workspace) {
        workspace.scannerWidgets ||= [];
        ensureScannerPanels(workspace);
        const hidden = new Set(workspace.hidden || []);
        const layout = completeWorkspaceLayout(workspace);
        document.body.classList.add('free-layout');
        panels.forEach(panel => {
          panel.hidden = hidden.has(panel.dataset.panelId);
          const item = layout[panel.dataset.panelId];
          if (!item) return;
          panel.style.left = `${Math.round(item.x)}px`;
          panel.style.top = `${Math.round(item.y)}px`;
          panel.style.width = `${Math.max(260, Math.round(item.w))}px`;
          panel.style.height = `${Math.max(120, Math.round(item.h))}px`;
        });
        updateCanvasHeight();
      }

      function saveActiveWorkspaceState() {
        const store = readStore();
        const name = currentWorkspaceName(store);
        store.workspaces[name] ||= blankWorkspaceForName(name);
        store.workspaces[name].layout = currentLayout();
        store.workspaces[name].hidden = panels.filter(panel => panel.hidden).map(panel => panel.dataset.panelId);
        store.workspaces[name].scannerWidgets = workspaceScannerWidgets();
        writeStore(store);
      }

      function currentWorkspaceSnapshot() {
        return {
          layout: currentLayout(),
          hidden: panels.filter(panel => panel.hidden).map(panel => panel.dataset.panelId),
          scannerWidgets: workspaceScannerWidgets()
        };
      }

      function saveLastWorkspace() {
        const store = readStore();
        const name = ensureAutosaveWorkspace(store);
        store.workspaces[name] = currentWorkspaceSnapshot();
        store.lastAutosavedAt = Date.now();
        writeStore(store);
        return name;
      }

      function removeScannerPanel(panelId) {
        const panel = panels.find(item => item.dataset.panelId === panelId);
        if (!panel?.dataset.dashboardWidget) return;
        panel.remove();
        refreshRegisteredPanels();
        saveActiveWorkspaceState();
        renderControls();
        updateCanvasHeight();
      }

      function addScannerWidgetToWorkspace(widgetId) {
        const meta = dashboardWidgetMeta(widgetId);
        const id = dynamicPanelId(widgetId);
        const layout = currentLayout();
        const bottom = Object.values(layout).reduce((max, item) => (
          item ? Math.max(max, Number(item.y || 0) + Number(item.h || 0)) : max
        ), 0);
        const gridWidth = Math.max(320, grid.getBoundingClientRect().width || window.innerWidth - 36);
        const defaultHeight = widgetId === 'metrics' ? 180 : widgetId === 'markets' ? 620 : widgetId === 'alertSettings' ? 430 : 320;
        const store = readStore();
        const name = currentWorkspaceName(store);
        store.workspaces[name] ||= blankWorkspaceForName(name);
        const workspace = store.workspaces[name];
        workspace.scannerWidgets ||= [];
        workspace.layout ||= {};
        workspace.hidden ||= [];
        workspace.scannerWidgets.push({ id, widgetId, label: meta.label || widgetId });
        workspace.layout[id] = {
          x: 16,
          y: Math.max(16, bottom + 14),
          w: Math.min(1040, Math.max(560, gridWidth - 32)),
          h: defaultHeight
        };
        workspace.hidden = workspace.hidden.filter(panelId => panelId !== id);
        store.active = name;
        writeStore(store);
        applyWorkspace(workspace);
        renderControls();
        document.getElementById('status').textContent = `Added scanner ${meta.label || widgetId}`;
      }

      function createBlankWorkspace() {
        const store = readStore();
        const name = uniqueWorkspaceName(store);
        store.workspaces[name] = blankWorkspace();
        activeWorkspaceName = name;
        store.active = name;
        writeStore(store);
        applyWorkspace(store.workspaces[name]);
        renderControls();
        document.getElementById('workspaceSelect').value = name;
        document.getElementById('workspaceName').value = name;
        document.getElementById('status').textContent = `Opened blank workspace: ${name}`;
      }

      function renderControls() {
        const store = readStore();
        const names = Object.keys(store.workspaces);
        const activeName = currentWorkspaceName(store);
        document.getElementById('workspaceSelect').innerHTML = names.map(name => `<option value="${name}">${name}</option>`).join('');
        document.getElementById('workspaceSelect').value = activeName;
        document.getElementById('workspaceName').value = activeName;
        const currentControls = registeredPanels.map(({ widget, panel }) => `
          <label><input type="checkbox" data-widget="${widget.id}" ${panel.hidden ? '' : 'checked'}> ${widget.label}</label>
          ${canDetachWidgets() ? `<button type="button" data-detach-widget="${widget.id}">Detach</button>` : ''}
          ${widget.dynamic ? `<button type="button" data-remove-scanner-widget="${widget.id}">Remove</button>` : ''}
        `).join('');
        const scannerControls = dashboardWidgets.map(widget => `<button type="button" data-add-scanner-widget="${widget.id}">${widget.label}</button>`).join('');
        document.getElementById('widgetControls').innerHTML = `
          <button type="button" data-create-blank-workspace>Blank Workspace</button>
          <div class="widget-group-title">Data Widgets</div>
          ${currentControls}
          <div class="widget-group-title">Scanner Widgets</div>
          ${scannerControls}
        `;
        document.querySelectorAll('#widgetControls input[data-widget]').forEach(input => {
          input.addEventListener('change', () => {
            const panel = panels.find(item => item.dataset.panelId === input.dataset.widget);
            if (!panel) return;
            panel.hidden = !input.checked;
            saveActiveWorkspaceState();
            updateCanvasHeight();
          });
        });
        document.querySelectorAll('#widgetControls button[data-detach-widget]').forEach(button => {
          button.addEventListener('click', () => {
            const item = registeredPanels.find(({ widget }) => widget.id === button.dataset.detachWidget);
            if (item) detachWidget(item.panel, item.widget.label);
          });
        });
        document.querySelectorAll('#widgetControls button[data-remove-scanner-widget]').forEach(button => {
          button.addEventListener('click', () => removeScannerPanel(button.dataset.removeScannerWidget));
        });
        document.querySelectorAll('#widgetControls button[data-add-scanner-widget]').forEach(button => {
          button.addEventListener('click', () => addScannerWidgetToWorkspace(button.dataset.addScannerWidget));
        });
        document.querySelector('#widgetControls button[data-create-blank-workspace]')?.addEventListener('click', createBlankWorkspace);
      }

      document.addEventListener('pointermove', event => {
        if (dynamicResizeState) {
          dynamicResizeState.panel.style.width = `${Math.max(260, Math.round(dynamicResizeState.startWidth + (event.clientX - dynamicResizeState.startX)))}px`;
          dynamicResizeState.panel.style.height = `${Math.max(140, Math.round(dynamicResizeState.startHeight + (event.clientY - dynamicResizeState.startY)))}px`;
          updateCanvasHeight();
          event.preventDefault();
          return;
        }
        if (!dynamicDragState) return;
        dynamicDragState.panel.style.left = `${Math.max(0, Math.round(dynamicDragState.startLeft + (event.clientX - dynamicDragState.startX)))}px`;
        dynamicDragState.panel.style.top = `${Math.max(0, Math.round(dynamicDragState.startTop + (event.clientY - dynamicDragState.startY)))}px`;
        updateCanvasHeight();
        event.preventDefault();
      });

      document.addEventListener('pointerup', () => {
        if (dynamicResizeState) {
          dynamicResizeState.panel.classList.remove('resizing');
          dynamicResizeState = null;
          saveActiveWorkspaceState();
        }
        if (dynamicDragState) {
          dynamicDragState.panel.classList.remove('dragging');
          document.body.classList.remove('layout-dragging');
          dynamicDragState = null;
          saveActiveWorkspaceState();
        }
      });

      document.getElementById('workspaceSelect').addEventListener('change', event => {
        const store = readStore();
        const name = event.target.value;
        activeWorkspaceName = name;
        store.active = name;
        writeStore(store);
        applyWorkspace(store.workspaces[name]);
        renderControls();
      });
      document.getElementById('workspaceBlank')?.addEventListener('click', createBlankWorkspace);
      document.getElementById('workspaceSave').addEventListener('click', () => {
        const nameInput = document.getElementById('workspaceName');
        const newName = nameInput.value.trim();
        if (!newName) {
          alert('Please enter a workspace name');
          return;
        }
        const store = readStore();
        activeWorkspaceName = newName;
        store.active = newName;
        store.workspaces[newName] = {
          layout: currentLayout(),
          hidden: panels.filter(panel => panel.hidden).map(panel => panel.dataset.panelId),
          scannerWidgets: workspaceScannerWidgets()
        };
        writeStore(store);
        localStorage.setItem(legacyLayoutKey, JSON.stringify(store.workspaces[newName].layout));
        renderControls();
        document.getElementById('workspaceSelect').value = newName;
        nameInput.value = newName;
        document.getElementById('status').textContent = `Saved layout: ${newName}`;
        setTimeout(() => {
          if (document.getElementById('status').textContent === `Saved layout: ${newName}`) {
            document.getElementById('status').textContent = 'Loaded';
          }
        }, 2000);
      });
      document.getElementById('workspaceDelete').addEventListener('click', () => {
        const store = readStore();
        const name = document.getElementById('workspaceSelect').value;
        if (name === 'Default' || isAutosaveWorkspaceName(name)) {
          alert(`Cannot delete the ${isAutosaveWorkspaceName(name) ? 'last autosave' : 'Default'} workspace`);
          return;
        }
        if (!confirm(`Delete workspace "${name}"?`)) return;
        delete store.workspaces[name];
        const fallback = ensureAutosaveWorkspace(store);
        activeWorkspaceName = fallback;
        store.active = fallback;
        writeStore(store);
        applyWorkspace(store.workspaces[fallback]);
        renderControls();
        document.getElementById('status').textContent = `Deleted workspace: ${name}`;
        setTimeout(() => {
          document.getElementById('status').textContent = 'Loaded';
        }, 2000);
      });

      const store = readStore();
      activeWorkspaceName = ensureAutosaveWorkspace(store);
      store.active = activeWorkspaceName;
      writeStore(store);
      if (store.workspaces[activeWorkspaceName]) applyWorkspace(store.workspaces[activeWorkspaceName]);
      renderControls();
      setInterval(saveLastWorkspace, autosaveIntervalMs);
      window.addEventListener('pagehide', saveLastWorkspace);
      window.addEventListener('beforeunload', saveLastWorkspace);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveLastWorkspace();
      });
    }

    function resetDetailLayout() {
      [
        'bitunix.detail.freeLayout.v1',
        'bitunix.detail.workspaces.v1',
        'bitunix.detail.layoutEdit',
        'bitunix.detail.snapshotHidden.v1',
        'bitunix.detail.watchlist.v1',
        'bitunix.detail.leftPanels.v1',
        'bitunix.detail.rightPanels.v1'
      ].forEach(key => localStorage.removeItem(key));
      window.location.reload();
    }

    function setupMovablePanels(containerId, storageKey) {
      const container = document.getElementById(containerId);
      if (!container) return;
      let saved = [];
      try {
        saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
      } catch {
        saved = [];
      }
      saved.forEach(item => {
        const id = typeof item === 'string' ? item : item.id;
        const panel = document.querySelector(`[data-panel-id="${id}"]`);
        if (panel && item.height) panel.style.height = item.height;
        if (panel && item.width) panel.style.width = item.width;
        if (panel) container.appendChild(panel);
      });
      function saveLayout() {
        const layout = [...container.querySelectorAll('[data-panel-id]')].map(panel => ({
          id: panel.dataset.panelId,
          height: panel.style.height || '',
          width: panel.style.width || ''
        }));
        localStorage.setItem(storageKey, JSON.stringify(layout));
      }
      let dragState = null;
      let resizeState = null;
      function saveAllLayouts() {
        document.querySelectorAll('.panel-stack').forEach(stack => {
          const key = stack.id === 'leftDetailPanels'
            ? 'bitunix.detail.leftPanels.v1'
            : stack.id === 'movableDetailPanels'
              ? 'bitunix.detail.rightPanels.v1'
              : '';
          if (!key) return;
          const layout = [...stack.querySelectorAll('[data-panel-id]')].map(panel => ({
            id: panel.dataset.panelId,
            height: panel.style.height || '',
            width: panel.style.width || ''
          }));
          localStorage.setItem(key, JSON.stringify(layout));
        });
      }
      function movePanel(panel, action) {
        const currentStack = panel.parentElement;
        const leftStack = document.getElementById('leftDetailPanels');
        const rightStack = document.getElementById('movableDetailPanels');
        const destination = action === 'left' ? leftStack : action === 'right' ? rightStack : null;
        if (action === 'up' && panel.previousElementSibling) {
          currentStack.insertBefore(panel, panel.previousElementSibling);
        }
        if (action === 'down' && panel.nextElementSibling) {
          currentStack.insertBefore(panel.nextElementSibling, panel);
        }
        if (destination && destination !== currentStack) {
          destination.appendChild(panel);
        }
        saveAllLayouts();
      }
      container.querySelectorAll('.panel[draggable="true"]').forEach(panel => {
        panel.setAttribute('draggable', 'false');
        if (!panel.querySelector('.layout-resizer')) {
          const handle = document.createElement('div');
          handle.className = 'layout-resizer';
          handle.title = 'Resize panel';
          panel.appendChild(handle);
        }
        const header = panel.querySelector('h2');
        if (header && !header.querySelector('.layout-controls')) {
          const controls = document.createElement('span');
          controls.className = 'layout-controls';
          controls.innerHTML = `
            <button type="button" data-layout-action="up">Up</button>
            <button type="button" data-layout-action="down">Down</button>
            <button type="button" data-layout-action="left">Left</button>
            <button type="button" data-layout-action="right">Right</button>
            ${canDetachWidgets() ? '<button type="button" data-layout-action="detach">Detach</button>' : ''}
          `;
          header.appendChild(controls);
          controls.addEventListener('click', event => {
            const button = event.target.closest('button[data-layout-action]');
            if (!button) return;
            if (button.dataset.layoutAction === 'detach') detachWidget(panel);
            else movePanel(panel, button.dataset.layoutAction);
            event.preventDefault();
            event.stopPropagation();
          });
        }
        header?.addEventListener('pointerdown', event => {
          if (!document.body.classList.contains('layout-edit')) return;
          if (event.target.closest('button, input, select, a, .inline-controls, .layout-controls')) return;
          const rect = panel.getBoundingClientRect();
          const placeholder = document.createElement('div');
          placeholder.className = 'layout-placeholder';
          placeholder.style.height = `${Math.round(rect.height)}px`;
          placeholder.style.width = `${Math.round(rect.width)}px`;
          panel.parentElement.insertBefore(placeholder, panel);
          dragState = {
            panel,
            placeholder,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: rect.left,
            startTop: rect.top,
            previousStyle: {
              position: panel.style.position,
              left: panel.style.left,
              top: panel.style.top,
              width: panel.style.width,
              height: panel.style.height,
              margin: panel.style.margin,
              zIndex: panel.style.zIndex
            }
          };
          panel.style.position = 'fixed';
          panel.style.left = `${Math.round(rect.left)}px`;
          panel.style.top = `${Math.round(rect.top)}px`;
          panel.style.width = `${Math.round(panel.offsetWidth)}px`;
          panel.style.height = `${Math.round(panel.offsetHeight)}px`;
          panel.style.margin = '0';
          panel.style.zIndex = '1000';
          panel.classList.add('dragging');
          document.body.classList.add('layout-dragging');
          panel.setPointerCapture?.(event.pointerId);
          event.preventDefault();
        });
        panel.querySelector('.layout-resizer')?.addEventListener('pointerdown', event => {
          if (!document.body.classList.contains('layout-edit')) return;
          beginWidgetResize();
          resizeState = {
            panel,
            startX: event.clientX,
            startY: event.clientY,
            startWidth: panel.offsetWidth,
            startHeight: panel.offsetHeight
          };
          panel.classList.add('resizing');
          event.preventDefault();
          event.stopPropagation();
        });
        panel.addEventListener('dragstart', event => {
          event.preventDefault();
        });
        panel.addEventListener('dragend', event => event.preventDefault());
        panel.addEventListener('mouseup', () => {
          if (document.body.classList.contains('layout-edit')) {
            panel.style.height = `${Math.round(panel.getBoundingClientRect().height)}px`;
            saveLayout();
          }
        });
      });
      document.addEventListener('pointermove', event => {
        if (resizeState) {
          resizeQuietUntil = Date.now() + 300;
          const nextWidth = Math.max(260, resizeState.startWidth + (event.clientX - resizeState.startX));
          const nextHeight = Math.max(120, resizeState.startHeight + (event.clientY - resizeState.startY));
          resizeState.panel.style.width = `${Math.round(nextWidth)}px`;
          resizeState.panel.style.height = `${Math.round(nextHeight)}px`;
          return;
        }
        if (!dragState || !document.body.classList.contains('layout-edit')) return;
        dragState.panel.style.left = `${Math.round(dragState.startLeft + (event.clientX - dragState.startX))}px`;
        dragState.panel.style.top = `${Math.round(dragState.startTop + (event.clientY - dragState.startY))}px`;
        const element = document.elementFromPoint(event.clientX, event.clientY);
        if (!element) return;
        const targetPanel = element.closest('.panel');
        const targetStack = element.closest('.panel-stack') || targetPanel?.parentElement || element.closest('.grid')?.querySelector('.panel-stack');
        if (!targetStack || !targetStack.classList.contains('panel-stack')) return;
        if (targetPanel && targetPanel !== dragState.panel && targetStack.contains(targetPanel)) {
          const box = targetPanel.getBoundingClientRect();
          const before = event.clientY < box.top + box.height / 2;
          targetStack.insertBefore(dragState.placeholder, before ? targetPanel : targetPanel.nextSibling);
        } else if (!targetPanel && targetStack) {
          targetStack.appendChild(dragState.placeholder);
        }
        event.preventDefault();
      });
      document.addEventListener('pointerup', () => {
        if (resizeState) {
          const panel = resizeState.panel;
          panel.classList.remove('resizing');
          resizeState = null;
          saveAllLayouts();
          requestLiquidityRender(true);
          endWidgetResize(panel);
          if (panel.matches('.dom-panel, .bookmap-panel')) renderSizedRows();
        }
        if (dragState) {
          const { panel, placeholder, previousStyle } = dragState;
          placeholder.parentElement?.insertBefore(panel, placeholder);
          placeholder.remove();
          panel.classList.remove('dragging');
          panel.style.position = previousStyle.position;
          panel.style.left = previousStyle.left;
          panel.style.top = previousStyle.top;
          panel.style.width = previousStyle.width;
          panel.style.height = previousStyle.height;
          panel.style.margin = previousStyle.margin;
          panel.style.zIndex = previousStyle.zIndex;
          document.body.classList.remove('layout-dragging');
          dragState = null;
          saveAllLayouts();
        }
      });
    }

    document.getElementById('refresh').addEventListener('click', () => {
      loadMarket();
      loadDepth();
    });
    document.getElementById('depthLimit').addEventListener('change', loadDepth);
    document.getElementById('liqRange').addEventListener('change', loadLiquidations);
    document.getElementById('blockUsdThreshold').addEventListener('input', () => {
      requestTradeRender(true);
      renderFlowProfile();
      postAgentFlow(true);
    });
    document.getElementById('audioToggle').addEventListener('click', async () => {
      audioEnabled = !audioEnabled;
      if (audioEnabled) {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) {
          audioEnabled = false;
          document.getElementById('audioToggle').textContent = 'Audio Unavailable';
          return;
        }
        audioContext ||= new Audio();
        await audioContext.resume();
      }
      document.getElementById('audioToggle').textContent = audioEnabled ? 'Audio On' : 'Audio Off';
    });
    document.getElementById('apiMenuButton').addEventListener('click', event => {
      event.stopPropagation();
      const menu = document.getElementById('apiMenu');
      menu.classList.toggle('open');
      loadApiStatus();
    });
    document.getElementById('apiMenu').addEventListener('click', event => {
      event.stopPropagation();
    });
    document.getElementById('apiMenuClose').addEventListener('click', () => {
      document.getElementById('apiMenu').classList.remove('open');
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('#apiMenuButton')) {
        document.getElementById('apiMenu').classList.remove('open');
      }
    });
    document.getElementById('sideBuy').addEventListener('click', () => {
      selectedSide = 'BUY';
      markActiveControls();
      updateCalculator();
    });
    document.getElementById('sideSell').addEventListener('click', () => {
      selectedSide = 'SELL';
      markActiveControls();
      updateCalculator();
    });
    document.querySelectorAll('.type-tab').forEach(button => {
      button.addEventListener('click', () => {
        if (button.dataset.type === 'TRIGGER' || button.dataset.type === 'SCALE') {
          document.getElementById('orderResult').textContent = `${button.dataset.type} order UI is reserved for the next trading API pass.`;
          return;
        }
        selectedOrderType = button.dataset.type;
        markActiveControls();
        updateCalculator();
      });
    });
    document.getElementById('levDown').addEventListener('click', () => {
      leverage = Math.max(1, leverage - 1);
      markActiveControls();
      updateCalculator();
    });
    document.getElementById('levUp').addEventListener('click', () => {
      leverage = Math.min(Number(market?.max_leverage || 200), leverage + 1);
      markActiveControls();
      updateCalculator();
    });
    document.querySelectorAll('[data-percent]').forEach(button => {
      button.addEventListener('click', () => applyPercent(Number(button.dataset.percent)));
    });
    ['orderQty', 'orderPrice', 'usdPosition', 'availableMargin', 'accountEquity', 'maintenanceMargin'].forEach(id => {
      document.getElementById(id).addEventListener('input', id === 'usdPosition' ? syncQtyFromUsd : updateCalculator);
    });
    document.getElementById('submitBuy').addEventListener('click', () => submitOrder('BUY'));
    document.getElementById('submitSell').addEventListener('click', () => submitOrder('SELL'));
    document.getElementById('orderSafetyLock').addEventListener('change', () => syncSafetyLocks('orderSafetyLock'));
    document.getElementById('domSafetyLock').addEventListener('change', () => syncSafetyLocks('domSafetyLock'));
    document.getElementById('domFollowPrice').addEventListener('change', renderDom);
    document.getElementById('domShowSpread').addEventListener('change', renderDom);
    document.getElementById('domCenter').addEventListener('click', () => {
      document.getElementById('domFollowPrice').checked = true;
      renderDom();
      centerDom(true);
    });
    document.getElementById('bookmapMode').addEventListener('change', () => scheduleBookmapProfile(true));
    document.getElementById('bookmapFollow').addEventListener('change', () => scheduleBookmapProfile(true));
    document.getElementById('bookmapCenter').addEventListener('click', () => {
      document.getElementById('bookmapFollow').checked = true;
      scheduleBookmapProfile(true);
      centerBookmapProfile(true);
    });
    document.getElementById('liquidityMode').addEventListener('change', () => requestLiquidityRender(true));
    document.getElementById('liquidityWindow').addEventListener('change', () => {
      pruneLiquidityFrames();
      requestLiquidityRender(true);
    });
    document.getElementById('liquidityRows').addEventListener('change', () => requestLiquidityRender(true));
    document.getElementById('liquidityBubbles').addEventListener('change', () => requestLiquidityRender(true));
    document.getElementById('liquidityMarks').addEventListener('change', () => requestLiquidityRender(true));
    document.getElementById('liquidityClear').addEventListener('click', clearLiquidityHeatmap);
    document.getElementById('liquidityHeatmapCanvas').addEventListener('pointermove', event => {
      const rect = event.currentTarget.getBoundingClientRect();
      liquidityHover = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top
      };
      requestLiquidityRender();
    });
    document.getElementById('liquidityHeatmapCanvas').addEventListener('pointerleave', () => {
      liquidityHover = null;
      hideLiquidityTooltip();
      requestLiquidityRender();
    });
    document.getElementById('impulseSet').addEventListener('click', setImpulseAnchor);
    document.getElementById('impulseClear').addEventListener('click', clearImpulseAnchor);
    document.getElementById('impulseAnchorPrice').addEventListener('keydown', event => {
      if (event.key === 'Enter') setImpulseAnchor();
    });
    document.getElementById('impulseHistoryRefresh').addEventListener('click', loadImpulseHistory);
    document.getElementById('impulseHistoryRange').addEventListener('change', loadImpulseHistory);
    document.getElementById('impulseHistoryThreshold').addEventListener('change', loadImpulseHistory);
    document.getElementById('impulseHistoryThreshold').addEventListener('keydown', event => {
      if (event.key === 'Enter') loadImpulseHistory();
    });
    document.getElementById('snapshotFrame').addEventListener('change', loadFrameCandle);
    document.getElementById('watchListSelect').addEventListener('change', event => setActiveWatchlist(event.currentTarget.value));
    document.getElementById('watchListSaveName').addEventListener('click', saveWatchlistName);
    document.getElementById('watchListNew').addEventListener('click', createWatchlist);
    document.getElementById('watchListDelete').addEventListener('click', deleteWatchlist);
    document.getElementById('watchListName').addEventListener('keydown', event => {
      if (event.key === 'Enter') saveWatchlistName();
    });
    document.getElementById('watchFilter').addEventListener('input', renderWatchlist);
    document.getElementById('watchSort').addEventListener('change', renderWatchlist);
    document.getElementById('watchAdd').addEventListener('click', () => addWatchSymbol(document.getElementById('watchAddSymbol').value));
    document.getElementById('watchAddCurrent').addEventListener('click', () => addWatchSymbol(symbol));
    document.getElementById('watchAddSymbol').addEventListener('keydown', event => {
      if (event.key === 'Enter') addWatchSymbol(event.currentTarget.value);
    });
    document.addEventListener('click', event => {
      if (!event.target.closest('#watchRowMenu')) hideWatchRowMenu();
    });
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') hideWatchRowMenu();
    });
    document.getElementById('fullscreen').addEventListener('click', async () => {
      const button = document.getElementById('fullscreen');
      try {
        if (!document.fullscreenElement) {
          await document.documentElement.requestFullscreen();
          button.textContent = 'Exit Fullscreen';
        } else {
          await document.exitFullscreen();
          button.textContent = 'Fullscreen';
        }
      } catch {
        document.getElementById('status').textContent = 'Fullscreen blocked by browser';
      }
    });
    document.addEventListener('fullscreenchange', () => {
      document.getElementById('fullscreen').textContent = document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen';
    });
    window.addEventListener('message', event => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === 'bitunix:open-symbol') changeDetailSymbol(event.data.symbol);
    });
    document.getElementById('symbolSearch').addEventListener('keydown', event => {
      if (event.key === 'Enter' && event.currentTarget.value.trim()) {
        event.preventDefault();
        changeDetailSymbol(event.currentTarget.value);
      }
    });
    setupLayoutMode();
    installWindowControls();
    setupFreeLayout();
    setupWorkspaces();
    installDetachButtons(detailWidgets, 'detailGrid');
    applyWidgetPopoutMode(detailWidgets, 'detailGrid');
    document.getElementById('layoutReset').addEventListener('click', resetDetailLayout);
    
    // Brightness slider control
    function setBrightness(value) {
      const normalizedValue = Math.max(0, Math.min(100, Number(value) || 0));
      const darkness = normalizedValue / 100;
      document.documentElement.style.setProperty('--darkness', darkness);
      localStorage.setItem('bitunix.brightness', normalizedValue);
    }
    
    const brightnessSlider = document.getElementById('brightnessSlider');
    if (brightnessSlider) {
      const savedBrightness = localStorage.getItem('bitunix.brightness') || '0';
      brightnessSlider.value = savedBrightness;
      setBrightness(savedBrightness);
      brightnessSlider.addEventListener('input', event => setBrightness(event.target.value));
    }
    window.addEventListener('resize', () => {
      requestLiquidityRender(true);
      renderSizedRows();
    });
    
    renderSnapshotFieldControls();
    activeImpulse = readStoredImpulse();
    syncImpulseControls();
    watchSymbols = readWatchSymbols();
    renderWatchlistSelector();
    renderWatchColumnControls();
    markActiveControls();
    updateCalculator();
    renderFlowProfile();
    renderDom();
    scheduleBookmapProfile(true);
    requestLiquidityRender(true);

    loadMarket();
    loadDailyCandle();
    loadFrameCandle();
    loadImpulseHistory();
    loadApiStatus();
    loadWatchlist();
    loadDepth();
    loadLiquidations();
    connectStreams();
    setInterval(loadMarket, 15000);
    setInterval(loadDailyCandle, 60000);
    setInterval(loadFrameCandle, 60000);
    setInterval(loadImpulseHistory, 60000);
    const watchlistRefreshMs = new URLSearchParams(window.location.search).get('widget') === 'watchlist' ? 5000 : 10000;
    setInterval(loadWatchlist, watchlistRefreshMs);
    setInterval(loadLiquidations, 60000);
