    const fmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });
    const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 2 });
    const pct = value => `${Number(value || 0).toFixed(2)}%`;
    const cls = value => Number(value || 0) > 0 ? 'pos' : Number(value || 0) < 0 ? 'neg' : '';
    const normalize = value => String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const cacheBust = path => `${path}${path.includes('?') ? '&' : '?'}t=${Date.now()}`;
    let sortState = { key: 'quote_volume', dir: 'desc' };
    let markets = [];
    let alerts = [];
    let scannerAlerts = [];
    let previousMarkets = new Map();
    let marketHistory = new Map();
    let knownSymbols = new Set();
    let alertAudioContext = null;
    let audioUnlocked = false;
    let lastBeepAt = 0;
    const dashboardWidgets = window.BITUNIX_DASHBOARD_WIDGETS || [];
    const symbolWidgets = window.BITUNIX_DETAIL_WIDGETS || [];
    const alertSettingsKey = 'bitunix.dashboard.alertSettings.v3';
    const alertCooldownKey = 'bitunix.dashboard.alertCooldowns.v1';
    const alertKnownSymbolsKey = 'bitunix.dashboard.knownSymbols.v1';
    const localAlertsKey = 'bitunix.dashboard.localAlerts.v1';
    const fastMoveWindowMinutes = 5;
    let rememberDetachedWidget = () => {};

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

    const defaultAlertSettings = {
      master: true,
      voice: true,
      beep: false,
      cooldownSeconds: 300,
      universe: 'all',
      status: 'OPEN',
      symbols: '',
      minVolume: 0,
      minPrice: 0,
      maxPrice: 0,
      minLeverage: 0,
      fastMovePct: 3,
      rangePct: 8,
      dailyRangePct: 15,
      volumeDelta: 250000,
      move24Pct: 20,
      fundingPct: 1,
      nearAthPct: 20,
      rules: {
        newListing: true,
        fastMove: true,
        range: true,
        dailyRange: true,
        volume: true,
        move24: true,
        funding: true,
        ath: true
      }
    };
    const marketColumns = [
      { key: 'symbol', label: 'Symbol', sortable: true, render: item => `
        <div class="symbol-cell">
          <a class="symbol-link" href="/symbol/${item.symbol}">
            <b class="ticker-badge" style="${tickerGlowStyle(item.scan_price_change_pct)}" title="Current scan move: ${pct(item.scan_price_change_pct)}">${item.symbol}</b>
          </a>
          <span class="spark-wrap" title="Recent scanner path: ${pct(item.sparkline_change_pct)}">
            ${sparklineSvg(item.sparkline, item.sparkline_change_pct, 72, 22)}
            <span class="spark-popover">
              ${sparklineSvg(item.sparkline, item.sparkline_change_pct, 220, 86)}
              <span class="${cls(item.sparkline_change_pct)}">${pct(item.sparkline_change_pct)}</span>
            </span>
          </span>
        </div>` },
      { key: 'last_price', label: 'Last', sortable: true, render: item => fmt.format(item.last_price) },
      { key: 'scanner_ath_state', label: 'ATH', sortable: true, render: item => athStateBadge(item) },
      { key: 'scanner_ath_distance_pct', label: 'Off ATH', sortable: true, td: item => `class="heat ${athDirectionClass(item)}" style="${athDistanceStyle(item)}"`, render: item => item.scanner_ath_price ? pct(item.scanner_ath_distance_pct) : '-' },
      { key: 'scanner_ath_age_days', label: 'Days ATH', sortable: true, render: item => athAge(item.scanner_ath_age_days) },
      { key: 'scanner_ath_streak_days', label: 'ATH Run', sortable: true, render: item => athStreak(item) },
      { key: 'scanner_ath_drawdown_pct', label: 'ATH Drop', sortable: true, td: item => `class="heat neg" style="${heatStyle(item.scanner_ath_drawdown_pct, 90)}"`, render: item => pct(item.scanner_ath_drawdown_pct) },
      { key: 'scanner_ath_rebound_pct', label: 'Rebound', sortable: true, td: item => `class="heat pos" style="${heatStyle(item.scanner_ath_rebound_pct, 200)}"`, render: item => pct(item.scanner_ath_rebound_pct) },
      { key: 'scanner_move_30d_pct', label: '30d', sortable: true, td: item => `class="heat ${cls(item.scanner_move_30d_pct)}" style="${heatStyle(item.scanner_move_30d_pct, 1000)}"`, render: item => pct(item.scanner_move_30d_pct) },
      { key: 'scanner_move_90d_pct', label: '90d', sortable: true, td: item => `class="heat ${cls(item.scanner_move_90d_pct)}" style="${heatStyle(item.scanner_move_90d_pct, 3000)}"`, render: item => pct(item.scanner_move_90d_pct) },
      { key: 'price_change_pct', label: '24h', sortable: true, td: item => `class="heat ${cls(item.price_change_pct)}" style="${heatStyle(item.price_change_pct, 60)}"`, render: item => pct(item.price_change_pct) },
      { key: 'range_15m_pct', label: '15m Range', sortable: true, td: item => `class="heat warn" style="${rangeHeatStyle(item.range_15m_pct)}"`, render: item => pct(item.range_15m_pct) },
      { key: 'scanner_flush_drop_pct', label: 'Flush', sortable: true, td: item => `class="heat neg" style="${heatStyle(item.scanner_flush_drop_pct, 45)}"`, render: item => flushDropLabel(item) },
      { key: 'scanner_flush_rebound_pct', label: 'Reclaim', sortable: true, td: item => `class="heat pos" style="${heatStyle(item.scanner_flush_rebound_pct, 120)}"`, render: item => flushReboundLabel(item) },
      { key: 'scanner_flush_score', label: 'V Score', sortable: true, td: item => `class="heat warn" style="${flushScoreStyle(item)}"`, render: item => flushScoreLabel(item) },
      { key: 'scanner_ai_cycle_score', label: 'AI Cycle', sortable: true, td: item => `class="heat warn" style="${aiCycleStyle(item)}"`, render: item => aiCycleLabel(item) },
      { key: 'scanner_ai_cycle_week_drop_pct', label: 'Wk Drop', sortable: true, td: item => `class="heat neg" style="${heatStyle(item.scanner_ai_cycle_week_drop_pct, 90)}"`, render: item => pct(item.scanner_ai_cycle_week_drop_pct) },
      { key: 'scanner_ai_cycle_bounce_days_7d', label: 'Bid Days', sortable: true, render: item => bidDaysLabel(item) },
      { key: 'scan_price_change_pct', label: 'Scan Δ', sortable: true, td: item => `class="heat ${cls(item.scan_price_change_pct)}" style="${heatStyle(item.scan_price_change_pct, 8)}"`, render: item => pct(item.scan_price_change_pct) },
      { key: 'funding_rate', label: 'Funding', sortable: true, td: item => `class="${cls(item.funding_rate)}"`, render: item => `${(Number(item.funding_rate || 0) * 100).toFixed(4)}%` },
      { key: 'quote_volume', label: 'Vol Quote', sortable: true, td: item => `class="heat pos" style="${volumeHeatStyle(item.quote_volume)}"`, render: item => compact.format(item.quote_volume || 0) },
      { key: 'quote_volume_15m_delta', label: 'Vol Δ', sortable: true, td: item => `class="heat pos" style="${volumeDeltaHeatStyle(item.quote_volume_15m_delta)}"`, render: item => compact.format(item.quote_volume_15m_delta || 0) },
      { key: 'max_leverage', label: 'Lev', sortable: true, render: item => `${item.max_leverage}x` },
      { key: 'status', label: 'Status', sortable: true, td: item => `class="${item.status === 'OPEN' ? 'pos' : 'warn'}"`, render: item => item.status }
    ];

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

    function openWorkspaceWindow(name) {
      const route = `/?workspace=${encodeURIComponent(name)}`;
      if (window.bitunixElectron?.openWorkspace) {
        window.bitunixElectron.openWorkspace({ workspace: name, width: 1400, height: 900, boundsKey: 'workspace' });
        return true;
      }
      const popup = window.open(route, `bitunix-workspace-${normalize(name)}`, 'popup,width=1400,height=900');
      if (popup) popup.focus();
      return Boolean(popup);
    }

    function openDashboardWidgetWindow(widgetId, label = '') {
      const title = label || dashboardWidgets.find(widget => widget.id === widgetId)?.label || widgetId;
      if (window.bitunixElectron?.detachWidget) {
        window.bitunixElectron.detachWidget({
          panelId: widgetId,
          title,
          path: '/',
          detachedKey: `control:${widgetId}`,
          width: widgetId === 'alerts' ? 720 : 1000,
          height: widgetId === 'alerts' ? 620 : 720
        });
        return true;
      }
      const popup = window.open(`/?widget=${encodeURIComponent(widgetId)}&popout=1`, `bitunix-${widgetId}`, 'popup,width=900,height=700');
      if (popup) popup.focus();
      return Boolean(popup);
    }

    function selectedControlSymbol() {
      const control = document.getElementById('controlSymbol');
      const filter = document.getElementById('filter');
      return normalize(control?.value || filter?.value || selectedDockSymbol()) || 'BTCUSDT';
    }

    function openDataWindow(symbolValue = selectedControlSymbol()) {
      const cleanSymbol = normalize(symbolValue) || 'BTCUSDT';
      const route = `/symbol/${cleanSymbol}`;
      if (window.bitunixElectron?.openWorkspace) {
        window.bitunixElectron.openWorkspace({
          path: route,
          width: 1400,
          height: 900,
          title: `Bitunix Data - ${cleanSymbol}`,
          boundsKey: 'data',
          reuseKey: 'data'
        });
        return true;
      }
      const popup = window.open(route, 'bitunix-data', 'popup,width=1400,height=900');
      if (popup) {
        popup.focus();
        return true;
      }
      window.location.href = route;
      return false;
    }

    function requestDataSymbol(symbolValue) {
      const cleanSymbol = normalize(symbolValue);
      if (!cleanSymbol) return;
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'bitunix:open-symbol', symbol: cleanSymbol }, window.location.origin);
        return;
      }
      openDataWindow(cleanSymbol);
    }

    function widgetPopoutRoute(panel) {
      if (panel?.dataset.symbolWidget) {
        const symbol = panel.dataset.symbol || selectedDockSymbol();
        return `/symbol/${symbol}?widget=${encodeURIComponent(panel.dataset.symbolWidget)}&popout=1`;
      }
      const params = new URLSearchParams(window.location.search);
      params.set('widget', panel.dataset.panelId);
      params.set('popout', '1');
      return `${window.location.pathname}?${params.toString()}`;
    }

    function detachWidget(panel, label = '', remember = true) {
      if (!canDetachWidgets() || !panel) return;
      const title = label || panel.querySelector('h2 span')?.textContent || panel.dataset.panelId;
      const route = widgetPopoutRoute(panel);
      const detachedKey = panel.dataset.symbolWidget
        ? `workspace:${panel.dataset.panelId}`
        : `home:${panel.dataset.panelId}`;
      if (remember) rememberDetachedWidget(panel.dataset.panelId);
      if (window.bitunixElectron?.detachWidget) {
        const rect = panel.getBoundingClientRect();
        const compactWidget = panel.dataset.symbolWidget === 'tickerCard';
        window.bitunixElectron.detachWidget({
          panelId: panel.dataset.symbolWidget || panel.dataset.panelId,
          title,
          path: panel.dataset.symbolWidget ? `/symbol/${panel.dataset.symbol}` : `${window.location.pathname}${window.location.search}`,
          detachedKey,
          width: compactWidget ? Math.max(320, Math.round(rect.width || 360)) : Math.max(700, Math.round(rect.width || 1000)),
          height: compactWidget ? Math.max(260, Math.round(rect.height || 300)) : Math.max(480, Math.round(rect.height || 720))
        });
        return;
      }
      const features = panel.dataset.symbolWidget === 'tickerCard' ? 'popup,width=360,height=300' : 'popup,width=1000,height=720';
      const popup = window.open(route, `bitunix-${panel.dataset.panelId}`, features);
      if (!popup) document.getElementById('status').textContent = 'Popout blocked by browser';
      else popup.focus();
    }

    function selectedDockSymbol() {
      const input = document.getElementById('dockSymbol');
      const value = normalize(input?.value || '');
      return value || 'BTCUSDT';
    }

    function openSymbolWidget(widgetId, label = '') {
      const symbol = selectedDockSymbol();
      if (document.body.classList.contains('workspace-window')) {
        window.dispatchEvent(new CustomEvent('bitunix-add-symbol-widget', {
          detail: { widgetId, label, symbol }
        }));
        return;
      }
      const route = `/symbol/${symbol}?widget=${encodeURIComponent(widgetId)}&popout=1`;
      const title = `${symbol} ${label || widgetId}`;
      if (window.bitunixElectron?.detachWidget) {
        const compactWidget = widgetId === 'tickerCard';
        window.bitunixElectron.detachWidget({
          panelId: widgetId,
          title,
          path: `/symbol/${symbol}`,
          detachedKey: `symbol:${symbol}:${widgetId}`,
          width: compactWidget ? 360 : 1000,
          height: compactWidget ? 300 : 720
        });
        return;
      }
      const compactFeatures = widgetId === 'tickerCard' ? 'popup,width=360,height=300' : 'popup,width=1000,height=720';
      const popup = window.open(route, `bitunix-${symbol}-${widgetId}`, compactFeatures);
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
      document.title = `${target.querySelector('h2 span')?.textContent || widgetId} - Bitunix`;
    }

    function visibleMarketColumns() {
      const hidden = new Set(JSON.parse(localStorage.getItem('bitunix.dashboard.hiddenColumns.v1') || '[]'));
      return marketColumns.filter(column => !hidden.has(column.key));
    }

    function setHiddenMarketColumn(key, hidden) {
      const hiddenSet = new Set(JSON.parse(localStorage.getItem('bitunix.dashboard.hiddenColumns.v1') || '[]'));
      if (hidden) hiddenSet.add(key);
      else hiddenSet.delete(key);
      localStorage.setItem('bitunix.dashboard.hiddenColumns.v1', JSON.stringify([...hiddenSet]));
      render();
    }

    function renderColumnControls() {
      const hidden = new Set(JSON.parse(localStorage.getItem('bitunix.dashboard.hiddenColumns.v1') || '[]'));
      document.getElementById('marketColumnControls').innerHTML = marketColumns.map(column => `
        <label><input type="checkbox" data-column="${column.key}" ${hidden.has(column.key) ? '' : 'checked'}> ${column.label}</label>
      `).join('');
      document.querySelectorAll('#marketColumnControls input[data-column]').forEach(input => {
        input.addEventListener('change', () => setHiddenMarketColumn(input.dataset.column, !input.checked));
      });
    }

    function readHighWatchSymbols() {
      try {
        const parsed = JSON.parse(localStorage.getItem('bitunix.detail.watchlist.v1') || '[]');
        if (Array.isArray(parsed) && parsed.length) return [...new Set(parsed.map(normalize).filter(Boolean))];
        const store = JSON.parse(localStorage.getItem('bitunix.detail.watchlists.v2') || 'null');
        const active = String(store?.active || 'Default');
        const list = store?.lists?.[active] || [];
        return Array.isArray(list) ? [...new Set(list.map(normalize).filter(Boolean))] : [];
      } catch {
        return [];
      }
    }

    function writeHighWatchSymbols(symbols) {
      const values = [...new Set(symbols.map(normalize).filter(Boolean))];
      localStorage.setItem('bitunix.detail.watchlist.v1', JSON.stringify(values));
      try {
        const store = JSON.parse(localStorage.getItem('bitunix.detail.watchlists.v2') || 'null') || { active: 'Default', lists: { Default: [] } };
        const active = String(store.active || 'Default').trim() || 'Default';
        store.active = active;
        store.lists = store.lists && typeof store.lists === 'object' ? store.lists : {};
        store.lists[active] = values;
        localStorage.setItem('bitunix.detail.watchlists.v2', JSON.stringify(store));
      } catch {
        localStorage.setItem('bitunix.detail.watchlists.v2', JSON.stringify({ active: 'Default', lists: { Default: values } }));
      }
    }

    function addHighWatchSymbol(value) {
      const symbol = normalize(value);
      if (!symbol) return;
      const symbols = readHighWatchSymbols();
      if (!symbols.includes(symbol)) symbols.push(symbol);
      writeHighWatchSymbols(symbols);
      document.getElementById('highWatchAddSymbol').value = '';
      document.getElementById('highWatchMode').value = 'saved';
      renderHighWatch();
    }

    function removeHighWatchSymbol(value) {
      const symbol = normalize(value);
      writeHighWatchSymbols(readHighWatchSymbols().filter(item => item !== symbol));
      renderHighWatch();
    }

    function readJson(key, fallback) {
      try {
        const parsed = JSON.parse(localStorage.getItem(key) || '');
        return parsed ?? fallback;
      } catch {
        return fallback;
      }
    }

    function alertSettings() {
      const saved = readJson(alertSettingsKey, {});
      return {
        ...defaultAlertSettings,
        ...saved,
        rules: { ...defaultAlertSettings.rules, ...(saved.rules || {}) }
      };
    }

    function writeAlertSettings(settings) {
      localStorage.setItem(alertSettingsKey, JSON.stringify(settings));
    }

    function loadLocalAlerts() {
      const rows = readJson(localAlertsKey, []);
      scannerAlerts = Array.isArray(rows) ? rows.slice(0, 100) : [];
    }

    function saveLocalAlerts() {
      localStorage.setItem(localAlertsKey, JSON.stringify(scannerAlerts.slice(0, 100)));
    }

    function readCooldowns() {
      return readJson(alertCooldownKey, {});
    }

    function writeCooldowns(cooldowns) {
      localStorage.setItem(alertCooldownKey, JSON.stringify(cooldowns));
    }

    function allowedAlertSymbol(settings, symbol) {
      const filter = String(settings.symbols || '').trim();
      if (!filter) return true;
      const allowed = filter.split(/[,\s]+/).map(normalize).filter(Boolean);
      return allowed.includes(normalize(symbol));
    }

    function passesAlertUniverse(settings, item) {
      const symbol = normalize(item.symbol);
      if (settings.status === 'OPEN' && item.status !== 'OPEN') return false;
      if (!allowedAlertSymbol(settings, symbol)) return false;
      if (settings.universe === 'watchlist') return readHighWatchSymbols().includes(symbol);
      if (settings.universe === 'high_watch') return Number(item.scanner_ath_price || 0) > 0 && Number(item.scanner_ath_distance_pct || -999) >= -20;
      if (settings.universe === 'new_or_ath') return Boolean(item.scanner_ath_new) || (Number(item.scanner_ath_price || 0) > 0 && Number(item.scanner_ath_distance_pct || -999) >= -Number(settings.nearAthPct || 20));
      return true;
    }

    function dailyRangePct(item) {
      const high = Number(item.high_price || 0);
      const low = Number(item.low_price || 0);
      return low > 0 && high > 0 ? ((high - low) / low) * 100 : Math.abs(Number(item.price_change_pct || 0));
    }

    function alertNumber(id, fallback) {
      const value = Number(document.getElementById(id)?.value || fallback);
      return Number.isFinite(value) ? value : fallback;
    }

    function collectAlertSettings() {
      return {
        master: document.getElementById('alertMaster')?.value !== 'off',
        voice: document.getElementById('alertVoice')?.value !== 'off',
        beep: document.getElementById('alertBeep')?.value === 'on',
        cooldownSeconds: Math.max(10, alertNumber('alertCooldown', 300)),
        universe: document.getElementById('alertUniverse')?.value || 'all',
        status: document.getElementById('alertStatus')?.value || 'OPEN',
        symbols: document.getElementById('alertSymbols')?.value || '',
        minVolume: Math.max(0, alertNumber('alertMinVolume', 0)),
        minPrice: Math.max(0, alertNumber('alertMinPrice', 0)),
        maxPrice: Math.max(0, alertNumber('alertMaxPrice', 0)),
        minLeverage: Math.max(0, alertNumber('alertMinLeverage', 0)),
        fastMovePct: Math.max(0, alertNumber('alertFastMovePct', 3)),
        rangePct: Math.max(0, alertNumber('alertRangePct', 8)),
        dailyRangePct: Math.max(0, alertNumber('alertDailyRangePct', 15)),
        volumeDelta: Math.max(0, alertNumber('alertVolumeDelta', 250000)),
        move24Pct: Math.max(0, alertNumber('alertMove24Pct', 20)),
        fundingPct: Math.max(0, alertNumber('alertFundingPct', 1)),
        nearAthPct: Math.max(0, alertNumber('alertNearAthPct', 20)),
        rules: {
          newListing: document.getElementById('ruleNewListing')?.checked ?? true,
          fastMove: document.getElementById('ruleFastMove')?.checked ?? true,
          range: document.getElementById('ruleRange')?.checked ?? true,
          dailyRange: document.getElementById('ruleDailyRange')?.checked ?? true,
          volume: document.getElementById('ruleVolume')?.checked ?? true,
          move24: document.getElementById('ruleMove24')?.checked ?? true,
          funding: document.getElementById('ruleFunding')?.checked ?? true,
          ath: document.getElementById('ruleAth')?.checked ?? true
        }
      };
    }

    function hydrateAlertSettings() {
      const settings = alertSettings();
      document.getElementById('alertMaster').value = settings.master ? 'on' : 'off';
      document.getElementById('alertVoice').value = settings.voice ? 'on' : 'off';
      document.getElementById('alertBeep').value = settings.beep ? 'on' : 'off';
      document.getElementById('alertCooldown').value = settings.cooldownSeconds;
      document.getElementById('alertUniverse').value = settings.universe;
      document.getElementById('alertStatus').value = settings.status;
      document.getElementById('alertSymbols').value = settings.symbols || '';
      document.getElementById('alertMinVolume').value = settings.minVolume;
      document.getElementById('alertMinPrice').value = settings.minPrice;
      document.getElementById('alertMaxPrice').value = settings.maxPrice;
      document.getElementById('alertMinLeverage').value = settings.minLeverage;
      document.getElementById('alertFastMovePct').value = settings.fastMovePct;
      document.getElementById('alertRangePct').value = settings.rangePct;
      document.getElementById('alertDailyRangePct').value = settings.dailyRangePct;
      document.getElementById('alertVolumeDelta').value = settings.volumeDelta;
      document.getElementById('alertMove24Pct').value = settings.move24Pct;
      document.getElementById('alertFundingPct').value = settings.fundingPct;
      document.getElementById('alertNearAthPct').value = settings.nearAthPct;
      document.getElementById('ruleNewListing').checked = settings.rules.newListing;
      document.getElementById('ruleFastMove').checked = settings.rules.fastMove;
      document.getElementById('ruleRange').checked = settings.rules.range;
      document.getElementById('ruleDailyRange').checked = settings.rules.dailyRange;
      document.getElementById('ruleVolume').checked = settings.rules.volume;
      document.getElementById('ruleMove24').checked = settings.rules.move24;
      document.getElementById('ruleFunding').checked = settings.rules.funding;
      document.getElementById('ruleAth').checked = settings.rules.ath;
      syncAlertRulesMaster();
    }

    function saveAlertSettingsFromUi() {
      syncAlertRulesMaster();
      const settings = collectAlertSettings();
      writeAlertSettings(settings);
      document.getElementById('alertAudioState').textContent = settings.master ? 'Alerts saved' : 'Alerts off';
      setTimeout(() => {
        document.getElementById('alertAudioState').textContent = settings.voice ? 'Voice ready' : 'Voice off';
      }, 1600);
      return settings;
    }

    function alertRuleInputs() {
      return [...document.querySelectorAll('.alert-rule-grid input[type="checkbox"]')];
    }

    function syncAlertRulesMaster() {
      const master = document.getElementById('alertRulesMaster');
      if (!master) return;
      const inputs = alertRuleInputs();
      const checked = inputs.filter(input => input.checked).length;
      master.checked = inputs.length > 0 && checked === inputs.length;
      master.indeterminate = checked > 0 && checked < inputs.length;
    }

    function setAlertRules(checked) {
      alertRuleInputs().forEach(input => {
        input.checked = checked;
      });
      syncAlertRulesMaster();
      saveAlertSettingsFromUi();
    }

    function speakAlert(text) {
      if (!('speechSynthesis' in window)) {
        document.getElementById('alertAudioState').textContent = 'Voice unavailable';
        return false;
      }
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        window.speechSynthesis.cancel();
      }
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.03;
      utterance.pitch = 1;
      utterance.volume = 1;
      utterance.onstart = () => {
        document.getElementById('alertAudioState').textContent = 'Voice playing';
      };
      utterance.onend = () => {
        document.getElementById('alertAudioState').textContent = 'Voice ready';
      };
      utterance.onerror = () => {
        document.getElementById('alertAudioState').textContent = 'Voice blocked, beep fallback';
        beepAlert('warning');
      };
      window.speechSynthesis.speak(utterance);
      return true;
    }

    async function unlockScannerAudio() {
      try {
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) return false;
        alertAudioContext ||= new Audio();
        if (alertAudioContext.state === 'suspended') await alertAudioContext.resume();
        audioUnlocked = alertAudioContext.state === 'running';
        if (audioUnlocked) document.getElementById('alertAudioState').textContent = 'Audio ready';
        return audioUnlocked;
      } catch {
        return false;
      }
    }

    function beepAlert(level = 'warning') {
      try {
        const nowMs = Date.now();
        if (nowMs - lastBeepAt < 180) return true;
        lastBeepAt = nowMs;
        const Audio = window.AudioContext || window.webkitAudioContext;
        if (!Audio) {
          document.getElementById('alertAudioState').textContent = 'Beep unavailable';
          return false;
        }
        alertAudioContext ||= new Audio();
        if (alertAudioContext.state === 'suspended') {
          alertAudioContext.resume().catch(() => {});
        }
        const osc = alertAudioContext.createOscillator();
        const gain = alertAudioContext.createGain();
        const now = alertAudioContext.currentTime;
        const peak = level === 'critical' ? 0.085 : 0.045;
        const duration = 0.16;
        osc.frequency.value = level === 'critical' ? 880 : 520;
        osc.type = 'sine';
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(peak, now + 0.015);
        gain.gain.setValueAtTime(peak, now + duration - 0.055);
        gain.gain.linearRampToValueAtTime(0, now + duration);
        osc.connect(gain);
        gain.connect(alertAudioContext.destination);
        osc.start(now);
        osc.stop(now + duration + 0.01);
        osc.onended = () => {
          try {
            osc.disconnect();
            gain.disconnect();
          } catch {}
        };
        audioUnlocked = true;
        return true;
      } catch {
        document.getElementById('alertAudioState').textContent = 'Audio blocked until click';
        return false;
      }
    }

    function playScannerAlert(alert, settings) {
      if (!settings.master) return;
      if (settings.beep) beepAlert(alert.level);
      if (settings.voice) {
        const spoke = speakAlert(alert.voice || alert.title);
        if (!spoke && !settings.beep) beepAlert(alert.level);
      }
    }

    function addScannerAlert(alert, settings) {
      scannerAlerts = [alert, ...scannerAlerts].slice(0, 100);
      saveLocalAlerts();
      playScannerAlert(alert, settings);
    }

    function cooldownAllows(key, settings, now) {
      const cooldowns = readCooldowns();
      const last = Number(cooldowns[key] || 0);
      if (now - last < settings.cooldownSeconds * 1000) return false;
      cooldowns[key] = now;
      writeCooldowns(cooldowns);
      return true;
    }

    function localAlert(symbol, kind, level, title, message, voice) {
      return {
        ts: Math.floor(Date.now() / 1000),
        level,
        kind,
        symbol,
        title,
        message,
        voice,
        local: true
      };
    }

    function updateMarketHistory(nextMarkets) {
      const now = Date.now();
      const cutoff = now - 30 * 60 * 1000;
      nextMarkets.forEach(item => {
        const symbol = normalize(item.symbol);
        const price = Number(item.last_price || 0);
        if (!symbol || !price) return;
        const rows = (marketHistory.get(symbol) || []).filter(row => row.ts >= cutoff);
        const last = rows[rows.length - 1];
        if (!last || last.price !== price) rows.push({ ts: now, price });
        marketHistory.set(symbol, rows.slice(-300));
      });
    }

    function rollingMovePct(item) {
      const rows = marketHistory.get(normalize(item.symbol)) || [];
      const current = Number(item.last_price || 0);
      if (!current || rows.length < 2) return Number(item.scan_price_change_pct || 0);
      const targetTs = Date.now() - fastMoveWindowMinutes * 60 * 1000;
      const anchor = rows.find(row => row.ts >= targetTs) || rows[0];
      return anchor?.price ? ((current - anchor.price) / anchor.price) * 100 : Number(item.scan_price_change_pct || 0);
    }

    function evaluateScannerAlerts(nextMarkets) {
      const settings = alertSettings();
      const now = Date.now();
      updateMarketHistory(nextMarkets);
      const savedKnown = readJson(alertKnownSymbolsKey, []);
      if (!knownSymbols.size && Array.isArray(savedKnown)) knownSymbols = new Set(savedKnown.map(normalize).filter(Boolean));
      const firstKnownLoad = knownSymbols.size === 0;
      const nextKnown = new Set(knownSymbols);

      nextMarkets.forEach(item => {
        const symbol = normalize(item.symbol);
        if (!symbol) return;
        const quoteVol = Number(item.quote_volume || 0);
        const lastPrice = Number(item.last_price || 0);
        nextKnown.add(symbol);
        if (
          !passesAlertUniverse(settings, item)
          || quoteVol < Number(settings.minVolume || 0)
          || (Number(settings.minPrice || 0) > 0 && lastPrice < Number(settings.minPrice || 0))
          || (Number(settings.maxPrice || 0) > 0 && lastPrice > Number(settings.maxPrice || 0))
          || (Number(settings.minLeverage || 0) > 0 && Number(item.max_leverage || 0) < Number(settings.minLeverage || 0))
        ) return;

        if (!firstKnownLoad && settings.rules.newListing && !knownSymbols.has(symbol)) {
          const key = `${symbol}:new_listing`;
          if (cooldownAllows(key, settings, now)) {
            addScannerAlert(localAlert(
              symbol,
              'workspace_new_listing',
              'critical',
              `${symbol} newly appeared on the scanner`,
              `${symbol} is OPEN with ${item.max_leverage || '-'}x max leverage.`,
              `${symbol} new Bitunix perp listing`
            ), settings);
          }
        }

        const fastMove = rollingMovePct(item);
        if (settings.rules.fastMove && Math.abs(fastMove) >= Number(settings.fastMovePct || 0)) {
          const direction = fastMove > 0 ? 'up' : 'down';
          const key = `${symbol}:fast_move:${direction}`;
          if (cooldownAllows(key, settings, now)) {
            addScannerAlert(localAlert(
              symbol,
              'workspace_fast_move',
              'critical',
              `${symbol} ${direction} ${pct(Math.abs(fastMove))} in 5m`,
              `${symbol} moved ${direction} ${pct(Math.abs(fastMove))} over the local 5 minute window.`,
              `${symbol} ${direction} ${Math.abs(fastMove).toFixed(1)} percent in five minutes`
            ), settings);
          }
        }

        const range15 = Number(item.range_15m_pct || 0);
        if (settings.rules.range && range15 >= Number(settings.rangePct || 0)) {
          const key = `${symbol}:range15`;
          if (cooldownAllows(key, settings, now)) {
            addScannerAlert(localAlert(
              symbol,
              'workspace_range_expansion',
              'warning',
              `${symbol} 15m range is ${pct(range15)}`,
              `${symbol} has expanded to a ${pct(range15)} 15 minute high/low range.`,
              `${symbol} fifteen minute range ${range15.toFixed(1)} percent`
            ), settings);
          }
        }

        const dayRange = dailyRangePct(item);
        if (settings.rules.dailyRange && dayRange >= Number(settings.dailyRangePct || 0)) {
          const key = `${symbol}:daily_range`;
          if (cooldownAllows(key, settings, now)) {
            addScannerAlert(localAlert(
              symbol,
              'workspace_daily_range',
              'warning',
              `${symbol} 24h range is ${pct(dayRange)}`,
              `${symbol} has a ${pct(dayRange)} current 24h high/low range. This is the ADR proxy until an external historical range feed is added.`,
              `${symbol} twenty four hour range ${dayRange.toFixed(1)} percent`
            ), settings);
          }
        }

        const volDelta = Number(item.quote_volume_15m_delta || item.scan_quote_volume_delta || 0);
        if (settings.rules.volume && volDelta >= Number(settings.volumeDelta || 0)) {
          const key = `${symbol}:volume_spike`;
          if (cooldownAllows(key, settings, now)) {
            addScannerAlert(localAlert(
              symbol,
              'workspace_volume_spike',
              'warning',
              `${symbol} volume spike ${compact.format(volDelta)}`,
              `${symbol} added about ${compact.format(volDelta)} quote volume in the recent scanner window.`,
              `${symbol} volume spike ${compact.format(volDelta)}`
            ), settings);
          }
        }

        const move24 = Number(item.price_change_pct || 0);
        if (settings.rules.move24 && Math.abs(move24) >= Number(settings.move24Pct || 0)) {
          const direction = move24 > 0 ? 'up' : 'down';
          const key = `${symbol}:move24:${direction}`;
          if (cooldownAllows(key, settings, now)) {
            addScannerAlert(localAlert(
              symbol,
              'workspace_24h_move',
              'warning',
              `${symbol} ${direction} ${pct(Math.abs(move24))} in 24h`,
              `${symbol} is ${direction} ${pct(Math.abs(move24))} from the 24h open.`,
              `${symbol} ${direction} ${Math.abs(move24).toFixed(1)} percent in twenty four hours`
            ), settings);
          }
        }

        const fundingPct = Number(item.funding_rate || 0) * 100;
        if (settings.rules.funding && Math.abs(fundingPct) >= Number(settings.fundingPct || 0)) {
          const direction = fundingPct > 0 ? 'positive' : 'negative';
          const key = `${symbol}:funding:${direction}`;
          if (cooldownAllows(key, settings, now)) {
            addScannerAlert(localAlert(
              symbol,
              'workspace_funding_extreme',
              'warning',
              `${symbol} funding ${fundingPct.toFixed(3)}%`,
              `${symbol} funding is unusually ${direction} at ${fundingPct.toFixed(3)}%.`,
              `${symbol} funding ${direction} ${Math.abs(fundingPct).toFixed(2)} percent`
            ), settings);
          }
        }

        const offAth = Number(item.scanner_ath_distance_pct || 0);
        if (settings.rules.ath && item.scanner_ath_price) {
          const isNewAth = Boolean(item.scanner_ath_new);
          const nearAth = offAth >= -Number(settings.nearAthPct || 0);
          if (isNewAth || nearAth) {
            const key = `${symbol}:${isNewAth ? 'new_ath' : 'near_ath'}`;
            if (cooldownAllows(key, settings, now)) {
              addScannerAlert(localAlert(
                symbol,
                isNewAth ? 'workspace_new_ath' : 'workspace_near_ath',
                isNewAth ? 'critical' : 'info',
                isNewAth ? `${symbol} is printing a new ATH` : `${symbol} is ${pct(Math.abs(offAth))} off ATH`,
                isNewAth
                  ? `${symbol} is at or above its scanner tracked all time high.`
                  : `${symbol} is within ${settings.nearAthPct}% of its scanner tracked high.`,
                isNewAth ? `${symbol} new all time high` : `${symbol} near all time high`
              ), settings);
            }
          }
        }
      });

      knownSymbols = nextKnown;
      localStorage.setItem(alertKnownSymbolsKey, JSON.stringify([...knownSymbols]));
      previousMarkets = new Map(nextMarkets.map(item => [item.symbol, item]));
    }

    async function load() {
      const [marketRes, alertRes] = await Promise.all([
        fetch(cacheBust('/api/markets?limit=1000'), { cache: 'no-store' }),
        fetch(cacheBust('/api/alerts'), { cache: 'no-store' })
      ]);
      markets = await marketRes.json();
      alerts = await alertRes.json();
      evaluateScannerAlerts(markets);
      render();
    }

    async function loadBrief() {
      try {
        const briefRes = await fetch('/api/brief', { cache: 'no-store' });
        const brief = await briefRes.json();
        document.getElementById('brief').textContent = brief.text;
      } catch {
        // brief is non-critical, silently ignore
      }
    }

    function highWatchRows() {
      const mode = document.getElementById('highWatchMode')?.value || 'near';
      const saved = readHighWatchSymbols();
      const savedOrder = new Map(saved.map((symbol, index) => [symbol, index]));
      return markets
        .filter(item => item.status === 'OPEN')
        .filter(item => Number(item.scanner_ath_price || 0) > 0)
        .filter(item => {
          if (mode === 'saved') return savedOrder.has(item.symbol);
          if (mode === 'new') return item.scanner_ath_new;
          if (mode === 'fallout') return Number(item.scanner_ath_distance_pct || 0) <= -20;
          if (mode === 'all') return true;
          return Number(item.scanner_ath_distance_pct || 0) >= -20;
        })
        .sort((a, b) => {
          if (mode === 'saved') return Number(savedOrder.get(a.symbol) || 0) - Number(savedOrder.get(b.symbol) || 0);
          if (a.scanner_ath_new !== b.scanner_ath_new) return a.scanner_ath_new ? -1 : 1;
          if (mode === 'fallout') {
            const aScore = Number(a.scanner_ath_rebound_pct || 0) + Math.abs(Number(a.scanner_ath_drawdown_pct || 0));
            const bScore = Number(b.scanner_ath_rebound_pct || 0) + Math.abs(Number(b.scanner_ath_drawdown_pct || 0));
            return bScore - aScore;
          }
          return Number(b.scanner_ath_distance_pct || -999) - Number(a.scanner_ath_distance_pct || -999);
        })
        .slice(0, 60);
    }

    function renderHighWatch() {
      const rows = highWatchRows();
      const mode = document.getElementById('highWatchMode')?.value || 'near';
      const saved = readHighWatchSymbols();
      const label = mode === 'new' ? 'fresh high events'
        : mode === 'fallout' ? 'fallout events'
        : mode === 'saved' ? `${saved.length} saved · ${rows.length} open`
        : mode === 'all' ? 'event data rows'
        : 'near high events';
      document.getElementById('highWatchStatus').textContent = mode === 'saved' ? label : `${rows.length} ${label}`;
      document.getElementById('highWatchRows').innerHTML = rows.length ? rows.map(item => `
        <tr class="${item.scanner_ath_new ? 'ath-live' : item.scanner_ath_today ? 'ath-day' : ''}">
          <td>
            <div class="symbol-cell">
              <a class="symbol-link" href="/symbol/${item.symbol}"><b class="ticker-badge" style="${tickerGlowStyle(item.scan_price_change_pct)}">${item.symbol}</b></a>
              <span class="spark-wrap" title="Recent scanner path: ${pct(item.sparkline_change_pct)}">
                ${sparklineSvg(item.sparkline, item.sparkline_change_pct, 72, 22)}
                <span class="spark-popover">
                  ${sparklineSvg(item.sparkline, item.sparkline_change_pct, 220, 86)}
                  <span class="${cls(item.sparkline_change_pct)}">${pct(item.sparkline_change_pct)}</span>
                </span>
              </span>
            </div>
          </td>
          <td>${athStateBadge(item)}</td>
          <td>${fmt.format(item.last_price || 0)}</td>
          <td class="${item.scanner_ath_new ? 'warn' : ''}">${fmt.format(item.scanner_ath_price || 0)}</td>
          <td class="heat ${athDirectionClass(item)}" style="${athDistanceStyle(item)}">${pct(item.scanner_ath_distance_pct)}</td>
          <td class="heat ${cls(item.scan_price_change_pct)}" style="${heatStyle(item.scan_price_change_pct, 8)}">${pct(item.scan_price_change_pct)}</td>
          <td>${athStreak(item)}</td>
          <td class="heat neg" style="${heatStyle(item.scanner_ath_drawdown_pct, 90)}">${pct(item.scanner_ath_drawdown_pct)}</td>
          <td class="heat pos" style="${heatStyle(item.scanner_ath_rebound_pct, 200)}">${pct(item.scanner_ath_rebound_pct)}</td>
          <td class="${cls(item.scanner_move_30d_pct)}">${pct(item.scanner_move_30d_pct)}</td>
          <td class="${cls(item.scanner_move_90d_pct)}">${pct(item.scanner_move_90d_pct)}</td>
          <td>${athDayChips(item.scanner_ath_days)}</td>
          <td>${saved.includes(item.symbol) ? `<button class="watch-remove" data-high-watch-remove="${item.symbol}" type="button">Remove</button>` : `<button data-high-watch-save="${item.symbol}" type="button">Save</button>`}</td>
        </tr>`).join('') : '<tr><td colspan="13" class="muted">No open markets match this event watch mode yet.</td></tr>';
      document.querySelectorAll('[data-high-watch-save]').forEach(button => {
        button.addEventListener('click', () => addHighWatchSymbol(button.dataset.highWatchSave));
      });
      document.querySelectorAll('[data-high-watch-remove]').forEach(button => {
        button.addEventListener('click', () => removeHighWatchSymbol(button.dataset.highWatchRemove));
      });
    }

    function render() {
      const filter = normalize(document.getElementById('filter').value);
      const [sortKey, sortDir] = document.getElementById('sort').value.split(':');
      sortState = { key: sortKey, dir: sortDir };
      const visibleAlerts = [...scannerAlerts, ...alerts]
        .sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0))
        .slice(0, 120);
      const visible = markets
        .filter(item => {
          if (!filter) return true;
          const haystack = [
            item.symbol,
            item.base,
            item.quote,
            item.status,
            `${item.base}${item.quote}`
          ].map(normalize).join(' ');
          return haystack.includes(filter);
        })
        .sort((a, b) => compareValues(a, b, sortState.key, sortState.dir));
      document.getElementById('marketCount').textContent = markets.length;
      document.getElementById('openCount').textContent = markets.filter(item => item.status === 'OPEN').length;
      document.getElementById('alertCount').textContent = visibleAlerts.length;
      document.getElementById('lastScan').textContent = markets[0] ? new Date(markets[0].ts * 1000).toLocaleTimeString() : '-';
      document.getElementById('status').textContent = filter
        ? `Showing ${visible.length} of ${markets.length}`
        : `Live - ${markets.length} markets`;
      const columns = visibleMarketColumns();
      document.getElementById('marketHead').innerHTML = `<tr>${columns.map(column => `
        <th>${column.sortable ? `<button data-sort="${column.key}">${column.label}</button>` : column.label}</th>
      `).join('')}</tr>`;
      document.getElementById('markets').innerHTML = visible.length ? visible.map(item => `
        <tr>
          ${columns.map(column => `<td ${column.td ? column.td(item) : ''}>${column.render(item)}</td>`).join('')}
        </tr>`).join('') : `<tr><td colspan="${Math.max(1, columns.length)}" class="muted">No matching markets</td></tr>`;
      document.getElementById('alerts').innerHTML = visibleAlerts.length ? visibleAlerts.map(item => `
        <div class="alert ${item.level}">
          <b>${item.title}</b>
          <span class="muted">${new Date(item.ts * 1000).toLocaleString()} · ${item.kind}${item.local ? ' · workspace' : ''}</span>
          <div>${item.message}</div>
        </div>`).join('') : '<span class="muted">No alerts recorded yet.</span>';
      renderHighWatch();
      updateSortButtons();
      document.querySelectorAll('#marketHead th button[data-sort]').forEach(button => {
        button.addEventListener('click', () => setSort(button.dataset.sort));
      });
    }

    function compareValues(a, b, key, dir) {
      const direction = dir === 'asc' ? 1 : -1;
      if (key === 'symbol' || key === 'status') {
        return String(a[key] || '').localeCompare(String(b[key] || '')) * direction;
      }
      if (key === 'scanner_ath_state') {
        return (athStateRank(a) - athStateRank(b)) * direction;
      }
      return (Number(a[key] || 0) - Number(b[key] || 0)) * direction;
    }

    function heatStyle(value, maxAbs) {
      const n = Number(value || 0);
      const intensity = Math.min(0.7, Math.abs(n) / maxAbs * 0.7);
      const color = n >= 0 ? '32, 201, 151' : '255, 107, 107';
      return `background: rgba(${color}, ${intensity.toFixed(3)})`;
    }

    function tickerGlowStyle(value) {
      const n = Number(value || 0);
      if (Math.abs(n) < 0.01) return '';
      const strength = Math.min(1, Math.abs(n) / 6);
      const alpha = 0.12 + strength * 0.58;
      const glow = 5 + strength * 18;
      const color = n >= 0 ? '32, 201, 151' : '255, 107, 107';
      return [
        `background: rgba(${color}, ${(alpha * 0.32).toFixed(3)})`,
        `box-shadow: 0 0 ${glow.toFixed(0)}px rgba(${color}, ${alpha.toFixed(3)})`,
        `color: rgb(${color})`
      ].join(';');
    }

    function sparklineSvg(points, changePct, width, height) {
      if (!Array.isArray(points) || points.length < 2) {
        return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"></svg>`;
      }
      const prices = points.map(item => Number(item.price || 0)).filter(value => value > 0);
      if (prices.length < 2) {
        return `<svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true"></svg>`;
      }
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      const span = max - min || Math.max(1, max * 0.001);
      const clean = points.filter(item => Number(item.price || 0) > 0);
      const coords = clean.map((item, index) => {
        const x = clean.length === 1 ? width / 2 : (index / (clean.length - 1)) * (width - 6) + 3;
        const y = height - 4 - ((Number(item.price) - min) / span) * (height - 8);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      }).join(' ');
      const color = Number(changePct || 0) >= 0 ? 'rgb(32, 201, 151)' : 'rgb(255, 107, 107)';
      return `
        <svg class="sparkline" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" aria-hidden="true">
          <polyline points="${coords}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></polyline>
        </svg>`;
    }

    function rangeHeatStyle(value) {
      const intensity = Math.min(0.65, Number(value || 0) / 35 * 0.65);
      return `background: rgba(139, 188, 255, ${intensity.toFixed(3)})`;
    }

    function flushScoreStyle(item) {
      const score = Number(item.scanner_flush_score || 0);
      const intensity = Math.min(0.72, score / 160 * 0.72);
      const active = item.scanner_flush_active ? '; box-shadow: inset 0 0 0 1px rgba(139, 188, 255, .7)' : '';
      return `background: rgba(139, 188, 255, ${intensity.toFixed(3)})${active}`;
    }

    function flushAge(item) {
      const minutes = Number(item.scanner_flush_age_minutes || 0);
      if (!minutes) return '';
      if (minutes < 60) return `${Math.round(minutes)}m`;
      return `${(minutes / 60).toFixed(minutes < 180 ? 1 : 0)}h`;
    }

    function flushDropLabel(item) {
      if (!Number(item.scanner_flush_score || 0)) return '<span class="muted">-</span>';
      return `<span title="High ${fmt.format(item.scanner_flush_high_price || 0)} to low ${fmt.format(item.scanner_flush_low_price || 0)}">${pct(item.scanner_flush_drop_pct)}</span>`;
    }

    function flushReboundLabel(item) {
      if (!Number(item.scanner_flush_score || 0)) return '<span class="muted">-</span>';
      return `<span title="Bounce from low ${fmt.format(item.scanner_flush_low_price || 0)}">${pct(item.scanner_flush_rebound_pct)}</span>`;
    }

    function flushScoreLabel(item) {
      const score = Number(item.scanner_flush_score || 0);
      if (!score) return '<span class="muted">-</span>';
      const tag = item.scanner_flush_active ? 'HOT ' : '';
      const age = flushAge(item);
      return `<span title="Flush/reclaim score. Active when dump <= -25% and rebound >= 50%.">${tag}${score.toFixed(0)}${age ? ` · ${age}` : ''}</span>`;
    }

    function aiCycleStyle(item) {
      const score = Number(item.scanner_ai_cycle_score || 0);
      const intensity = Math.min(0.72, score / 120 * 0.72);
      const active = item.scanner_ai_cycle_active ? '; box-shadow: inset 0 0 0 1px rgba(139, 188, 255, .72)' : '';
      return `background: rgba(139, 188, 255, ${intensity.toFixed(3)})${active}`;
    }

    function aiCycleLabel(item) {
      const score = Number(item.scanner_ai_cycle_score || 0);
      if (!score) return '<span class="muted">-</span>';
      const tag = item.scanner_ai_cycle_active ? 'AI BID ' : '';
      const title = [
        `Runup ${pct(item.scanner_ai_cycle_runup_pct)}`,
        `week drop ${pct(item.scanner_ai_cycle_week_drop_pct)}`,
        `reclaim ${pct(item.scanner_ai_cycle_reclaim_pct)}`,
        `${Number(item.scanner_ai_cycle_bounce_days_7d || 0)} bid days`
      ].join(' | ');
      return `<span title="${title}">${tag}${score.toFixed(0)}</span>`;
    }

    function bidDaysLabel(item) {
      const days = Number(item.scanner_ai_cycle_bounce_days_7d || 0);
      if (!days) return '<span class="muted">-</span>';
      return `<span class="${days >= 2 ? 'warn' : 'pos'}" title="Days this week with a large green close or bid-back range">${days}/7</span>`;
    }

    function athHeatStyle(value) {
      const n = Number(value || 0);
      const closeness = Math.max(0, Math.min(1, (20 + n) / 20));
      return `background: rgba(139, 188, 255, ${(closeness * 0.55).toFixed(3)})`;
    }

    function athDistanceStyle(item) {
      if (item.scanner_ath_new) {
        return 'background: rgba(139, 188, 255, .58); box-shadow: inset 0 0 0 1px rgba(139, 188, 255, .65)';
      }
      const move = Number(item.scan_price_change_pct || 0);
      if (Math.abs(move) >= 0.01) {
        return heatStyle(move, 8);
      }
      return athHeatStyle(item.scanner_ath_distance_pct);
    }

    function athDirectionClass(item) {
      if (item.scanner_ath_new) return 'warn';
      return cls(item.scan_price_change_pct);
    }

    function athStateBadge(item) {
      if (item.scanner_ath_new) return '<span class="ath-badge live">LIVE ATH</span>';
      if (item.scanner_ath_today) return '<span class="ath-badge today">ATH DAY</span>';
      if (Number(item.scanner_ath_streak_days || 0) >= 2) return `<span class="ath-badge streak">${Number(item.scanner_ath_streak_days)}D ATH</span>`;
      if (Number(item.scanner_ath_price || 0) > 0) {
        return `<span class="ath-badge off">${pct(item.scanner_ath_distance_pct)} · ${athAge(item.scanner_ath_age_days)}</span>`;
      }
      return '<span class="ath-badge off">-</span>';
    }

    function athStateRank(item) {
      if (item.scanner_ath_new) return 4000 + Number(item.scanner_ath_streak_days || 0);
      if (item.scanner_ath_today) return 3000 + Number(item.scanner_ath_streak_days || 0);
      if (Number(item.scanner_ath_streak_days || 0) >= 2) return 2000 + Number(item.scanner_ath_streak_days || 0);
      if (Number(item.scanner_ath_price || 0) > 0) return 1000 + Math.max(-999, Number(item.scanner_ath_distance_pct || -999));
      return 0;
    }

    function athStreak(item) {
      const streak = Number(item.scanner_ath_streak_days || 0);
      if (!streak) return '<span class="muted">-</span>';
      return `<span class="ath-streak ${streak >= 2 ? 'warn' : ''}">${streak}d</span>`;
    }

    function athAge(value) {
      const days = Number(value || 0);
      if (days < 1) return `${Math.round(days * 24)}h`;
      return `${days.toFixed(days < 10 ? 1 : 0)}d`;
    }

    function athDayChips(days) {
      if (!Array.isArray(days) || !days.length) return '<span class="muted">-</span>';
      return `<span class="day-chips">${days.slice(-5).map(day => {
        const change = Number(day.change_pct || 0);
        const title = `D${day.day}: ${pct(change)} range ${pct(day.range_pct)} off high ${pct(day.off_ath_pct)}`;
        return `<span class="day-chip ${cls(change)}" title="${title}">D${day.day} ${change >= 0 ? '+' : ''}${change.toFixed(0)}%</span>`;
      }).join('')}</span>`;
    }

    function volumeHeatStyle(value) {
      const intensity = Math.min(0.55, Math.log10(Math.max(1, Number(value || 0))) / 11 * 0.55);
      return `background: rgba(32, 201, 151, ${intensity.toFixed(3)})`;
    }

    function volumeDeltaHeatStyle(value) {
      const intensity = Math.min(0.65, Math.log10(Math.max(1, Number(value || 0))) / 9 * 0.65);
      return `background: rgba(110, 168, 254, ${intensity.toFixed(3)})`;
    }

    function setSort(key) {
      const dir = sortState.key === key && sortState.dir === 'desc' ? 'asc' : 'desc';
      const value = `${key}:${dir}`;
      ensureSortOption(key, dir, value);
      document.getElementById('sort').value = value;
      render();
    }

    function ensureSortOption(key, dir, value) {
      const select = document.getElementById('sort');
      let option = [...select.options].find(item => item.value === value);
      if (option) return;
      const labels = {
        symbol: 'Symbol',
        last_price: 'Last',
        scanner_ath_state: 'ATH',
        scanner_ath_distance_pct: 'Off ATH',
        scanner_ath_age_days: 'Days ATH',
        scanner_ath_streak_days: 'ATH Run',
        scanner_ath_drawdown_pct: 'ATH Drop',
        scanner_ath_rebound_pct: 'Rebound',
        scanner_move_30d_pct: '30d',
        scanner_move_90d_pct: '90d',
        price_change_pct: '24h',
        range_15m_pct: '15m Range',
        scanner_flush_drop_pct: 'Flush',
        scanner_flush_rebound_pct: 'Reclaim',
        scanner_flush_score: 'V Score',
        scanner_ai_cycle_score: 'AI Cycle',
        scanner_ai_cycle_week_drop_pct: 'Wk Drop',
        scanner_ai_cycle_bounce_days_7d: 'Bid Days',
        scan_price_change_pct: 'Scan Δ',
        funding_rate: 'Funding',
        quote_volume: 'Volume',
        quote_volume_15m_delta: 'Vol Δ',
        max_leverage: 'Max Lev',
        status: 'Status'
      };
      const suffix = dir === 'desc' ? 'High' : 'Low';
      option = new Option(`${labels[key] || key} ${suffix}`, value);
      select.appendChild(option);
    }

    function updateSortButtons() {
      document.querySelectorAll('th button[data-sort]').forEach(button => {
        const active = button.dataset.sort === sortState.key;
        button.classList.toggle('active', active);
        button.dataset.dir = sortState.dir === 'asc' ? '↑' : '↓';
      });
    }

    function setupMovablePanels(containerId, storageKey) {
      const container = document.getElementById(containerId);
      if (!container) return;
      let saved = [];
      let sizes = {};
      try {
        const parsed = JSON.parse(localStorage.getItem(storageKey) || '[]');
        if (Array.isArray(parsed)) {
          saved = parsed;
        } else {
          saved = parsed.order || [];
          sizes = parsed.sizes || {};
        }
      } catch {
        saved = [];
      }
      saved.forEach(id => {
        const panel = container.querySelector(`[data-panel-id="${id}"]`);
        if (panel) container.appendChild(panel);
      });
      Object.entries(sizes).forEach(([id, height]) => {
        const panel = container.querySelector(`[data-panel-id="${id}"]`);
        if (panel && Number(height) > 120) panel.style.height = `${Number(height)}px`;
      });
      let dragging = null;
      const saveLayout = () => {
        const order = [...container.querySelectorAll('[data-panel-id]')].map(item => item.dataset.panelId);
        const nextSizes = {};
        container.querySelectorAll('[data-panel-id]').forEach(panel => {
          if (panel.style.height) nextSizes[panel.dataset.panelId] = Math.round(panel.getBoundingClientRect().height);
        });
        localStorage.setItem(storageKey, JSON.stringify({ order, sizes: nextSizes }));
      };
      container.querySelectorAll('.panel[draggable="true"]').forEach(panel => {
        panel.addEventListener('dragstart', event => {
          if (!document.body.classList.contains('layout-edit')) {
            event.preventDefault();
            return;
          }
          dragging = panel;
          panel.classList.add('dragging');
          event.dataTransfer.effectAllowed = 'move';
          event.dataTransfer.setData('text/plain', panel.dataset.panelId || '');
        });
        panel.addEventListener('dragend', () => {
          panel.classList.remove('dragging');
          dragging = null;
          saveLayout();
        });
        panel.addEventListener('mouseup', () => {
          if (document.body.classList.contains('layout-edit')) saveLayout();
        });
      });
      container.addEventListener('dragover', event => {
        if (!document.body.classList.contains('layout-edit')) return;
        event.preventDefault();
        const target = event.target.closest ? event.target.closest('.panel') : null;
        if (!dragging || !target || target === dragging || !container.contains(target)) return;
        const box = target.getBoundingClientRect();
        const before = event.clientY < box.top + box.height / 2;
        container.insertBefore(dragging, before ? target : target.nextSibling);
      });
    }

    function setupLayoutMode() {
      const enabled = localStorage.getItem('bitunix.dashboard.layoutEdit') === '1';
      document.body.classList.toggle('layout-edit', enabled);
      document.getElementById('layoutToggle').textContent = enabled ? 'Done Layout' : 'Layout';
      document.getElementById('layoutToggle').addEventListener('click', () => {
        const next = !document.body.classList.contains('layout-edit');
        document.body.classList.toggle('layout-edit', next);
        localStorage.setItem('bitunix.dashboard.layoutEdit', next ? '1' : '0');
        document.getElementById('layoutToggle').textContent = next ? 'Done Layout' : 'Layout';
        window.dispatchEvent(new CustomEvent('dashboard-layout-mode-change', { detail: { enabled: next } }));
      });
    }

    function setupFreeLayout() {
      const grid = document.getElementById('dashboardPanels');
      const panels = registeredWidgetPanels(dashboardWidgets, grid).map(item => item.panel);
      const storageKey = 'bitunix.dashboard.freeLayout.v1';
      let dragState = null;
      let resizeState = null;

      function readLayout() {
        try { return JSON.parse(localStorage.getItem(storageKey) || '{}'); }
        catch { return {}; }
      }

      function updateCanvasHeight() {
        const bottom = panels.reduce((max, panel) => {
          const y = Number.parseFloat(panel.style.top || 0);
          const h = Number.parseFloat(panel.style.height || panel.getBoundingClientRect().height);
          return Math.max(max, y + h);
        }, 0);
        grid.style.minHeight = `${Math.max(window.innerHeight - 170, bottom + 24)}px`;
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
        window.dispatchEvent(new CustomEvent('dashboard-layout-changed'));
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
          panel.style.height = `${Math.max(140, Math.round(item.h))}px`;
        });
        updateCanvasHeight();
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
          if (event.target.closest('button, input, select, a, summary, details, .layout-controls')) return;
          ensureFreeLayout();
          const rect = panel.getBoundingClientRect();
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
          resizeState.panel.style.width = `${Math.max(260, Math.round(resizeState.startWidth + (event.clientX - resizeState.startX)))}px`;
          resizeState.panel.style.height = `${Math.max(140, Math.round(resizeState.startHeight + (event.clientY - resizeState.startY)))}px`;
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
          resizeState.panel.classList.remove('resizing');
          resizeState = null;
          writeLayout();
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
      window.addEventListener('dashboard-layout-mode-change', event => {
        if (event.detail.enabled) ensureFreeLayout();
      });
      window.addEventListener('resize', updateCanvasHeight);
    }

    function setupWorkspaces() {
      const grid = document.getElementById('dashboardPanels');
      let registeredPanels = registeredWidgetPanels(dashboardWidgets, grid);
      let panels = registeredPanels.map(item => item.panel);
      const storeKey = 'bitunix.dashboard.workspaces.v2';
      const legacyLayoutKey = 'bitunix.dashboard.freeLayout.v1';
      const autosaveWorkspaceName = 'last';
      const autosaveIntervalMs = 30 * 60 * 1000;
      const allWidgetIds = dashboardWidgets.map(widget => widget.id);
      const homeCoreWidgetIds = new Set(['metrics', 'markets']);
      let dynamicPanelCounter = 0;
      let dynamicDragState = null;
      let dynamicResizeState = null;
      let scopedWorkspaceName = new URLSearchParams(window.location.search).get('workspace') || '';
      let activeWorkspaceName = '';
      const isWorkspaceWindow = Boolean(scopedWorkspaceName);
      if (isWorkspaceWindow) {
        document.body.classList.add('workspace-window');
        document.getElementById('workspaceDock').hidden = false;
      }

      function defaultHomeHiddenWidgetIds() {
        return allWidgetIds.filter(id => !homeCoreWidgetIds.has(id));
      }

      function defaultHomeWorkspace() {
        return { layout: {}, hidden: defaultHomeHiddenWidgetIds(), detached: [], symbolWidgets: [] };
      }

      function isAutosaveWorkspaceName(name) {
        return String(name || '').trim().toLowerCase() === autosaveWorkspaceName;
      }

      function isDefaultWorkspaceName(name) {
        return name === 'Default' || isAutosaveWorkspaceName(name);
      }

      function cloneWorkspace(workspace) {
        return JSON.parse(JSON.stringify(workspace || defaultHomeWorkspace()));
      }

      function blankWorkspaceForName(name) {
        return isDefaultWorkspaceName(name) ? defaultHomeWorkspace() : blankWorkspace();
      }

      function hiddenDefaultsForName(name) {
        return isDefaultWorkspaceName(name) ? defaultHomeHiddenWidgetIds() : [...allWidgetIds];
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
            : store.workspaces.Default || defaultHomeWorkspace();
          store.workspaces[name] = cloneWorkspace(source);
        }
        store.workspaces[name].layout ||= {};
        store.workspaces[name].hidden ||= defaultHomeHiddenWidgetIds();
        store.workspaces[name].detached ||= [];
        store.workspaces[name].symbolWidgets ||= [];
        return name;
      }

      function readStore() {
        try {
          const parsed = JSON.parse(localStorage.getItem(storeKey) || '{}');
          if (parsed.workspaces) {
            Object.entries(parsed.workspaces).forEach(([name, workspace]) => {
              workspace.detached ||= [];
              workspace.detached = workspace.detached.filter(panelId => panelId !== 'alertSettings');
              workspace.symbolWidgets ||= [];
              workspace.hidden ||= hiddenDefaultsForName(name);
              const isEmptyBlank = !isDefaultWorkspaceName(name)
                && allWidgetIds.every(id => workspace.hidden.includes(id))
                && !workspace.detached.length
                && !workspace.symbolWidgets.length;
              if (isEmptyBlank) workspace.layout = {};
            });
            if (parsed.homeDefaultsVersion !== 1 && parsed.workspaces.Default) {
              const defaultWorkspace = parsed.workspaces.Default;
              const hidden = defaultWorkspace.hidden || [];
              const wasBlankDefault = hidden.length === allWidgetIds.length
                && !(defaultWorkspace.detached || []).length
                && !(defaultWorkspace.symbolWidgets || []).length;
              if (wasBlankDefault) defaultWorkspace.hidden = defaultHomeHiddenWidgetIds();
              parsed.homeDefaultsVersion = 1;
              localStorage.setItem(storeKey, JSON.stringify(parsed));
            }
            const autosaveName = ensureAutosaveWorkspace(parsed);
            parsed.active ||= autosaveName;
            return parsed;
          }
        } catch {}
        try {
          const legacy = JSON.parse(localStorage.getItem('bitunix.dashboard.workspaces.v1') || '{}');
          if (legacy.workspaces) {
            Object.values(legacy.workspaces).forEach(workspace => {
              workspace.detached ||= [];
              workspace.detached = workspace.detached.filter(panelId => panelId !== 'alertSettings');
              workspace.symbolWidgets ||= [];
            });
            legacy.workspaces.Default = defaultHomeWorkspace();
            const autosaveName = ensureAutosaveWorkspace(legacy);
            legacy.active ||= autosaveName;
            legacy.homeDefaultsVersion = 1;
            return legacy;
          }
        } catch {}
        const store = {
          active: autosaveWorkspaceName,
          homeDefaultsVersion: 1,
          workspaces: {
            Default: defaultHomeWorkspace()
          }
        };
        store.active = ensureAutosaveWorkspace(store);
        return store;
      }

      function writeStore(store) {
        localStorage.setItem(storeKey, JSON.stringify(store));
      }

      function selectedWorkspaceName(store) {
        if (scopedWorkspaceName) return scopedWorkspaceName;
        return activeWorkspaceName || ensureAutosaveWorkspace(store);
      }

      function setScopedWorkspaceName(name) {
        if (!scopedWorkspaceName) return;
        scopedWorkspaceName = name;
        const params = new URLSearchParams(window.location.search);
        params.set('workspace', name);
        window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
      }

      function blankWorkspace() {
        return { layout: {}, hidden: [...allWidgetIds], detached: [], symbolWidgets: [] };
      }

      function uniqueWorkspaceName(store, base = 'Blank Workspace') {
        if (!store.workspaces[base]) return base;
        let index = 2;
        while (store.workspaces[`${base} ${index}`]) index += 1;
        return `${base} ${index}`;
      }

      function readLegacyLayout() {
        try { return JSON.parse(localStorage.getItem(legacyLayoutKey) || '{}'); }
        catch { return {}; }
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

      function refreshRegisteredPanels() {
        registeredPanels = [
          ...registeredWidgetPanels(dashboardWidgets, grid),
          ...[...grid.querySelectorAll('.embedded-symbol-panel')].map(panel => ({
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

      function symbolWidgetMeta(id) {
        return symbolWidgets.find(widget => widget.id === id) || { id, label: id };
      }

      function dynamicPanelId(symbol, widgetId) {
        dynamicPanelCounter += 1;
        return `symbol-${normalize(symbol)}-${widgetId}-${Date.now()}-${dynamicPanelCounter}`;
      }

      function symbolWidgetFrameSrc(symbol, widgetId) {
        return `/symbol/${normalize(symbol)}?widget=${encodeURIComponent(widgetId)}&popout=1`;
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
              removeSymbolPanel(panel.dataset.panelId);
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

      function createSymbolPanel(definition) {
        if (!definition?.id || grid.querySelector(`[data-panel-id="${definition.id}"]`)) return;
        const symbol = normalize(definition.symbol || selectedDockSymbol());
        const widgetId = definition.widgetId;
        const meta = symbolWidgetMeta(widgetId);
        const label = definition.label || meta.label || widgetId;
        const panel = document.createElement('section');
        panel.className = 'panel embedded-symbol-panel';
        panel.dataset.panelId = definition.id;
        panel.dataset.symbol = symbol;
        panel.dataset.symbolWidget = widgetId;
        panel.innerHTML = `
          <h2><span>${symbol} ${label}</span></h2>
          <div class="symbol-frame-wrap">
            <iframe src="${symbolWidgetFrameSrc(symbol, widgetId)}" title="${symbol} ${label}"></iframe>
          </div>
        `;
        grid.appendChild(panel);
        wireDynamicPanel(panel);
      }

      function ensureSymbolPanels(workspace) {
        grid.querySelectorAll('.embedded-symbol-panel').forEach(panel => {
          const keep = (workspace.symbolWidgets || []).some(widget => widget.id === panel.dataset.panelId);
          if (!keep) panel.remove();
        });
        (workspace.symbolWidgets || []).forEach(createSymbolPanel);
        refreshRegisteredPanels();
      }

      function workspaceSymbolWidgets() {
        return [...grid.querySelectorAll('.embedded-symbol-panel')].map(panel => ({
          id: panel.dataset.panelId,
          symbol: panel.dataset.symbol,
          widgetId: panel.dataset.symbolWidget,
          label: (panel.querySelector('h2 span')?.textContent || '').replace(`${panel.dataset.symbol} `, '')
        }));
      }

      function updateCanvasHeight() {
        const bottom = panels.reduce((max, panel) => {
          if (panel.hidden) return max;
          const y = Number.parseFloat(panel.style.top || 0);
          const h = Number.parseFloat(panel.style.height || panel.getBoundingClientRect().height);
          return Math.max(max, y + h);
        }, 0);
        grid.style.minHeight = `${Math.max(window.innerHeight - (isWorkspaceWindow ? 16 : 170), bottom + 24)}px`;
      }

      function completeWorkspaceLayout(workspace) {
        const layout = { ...(workspace.layout || {}) };
        const hiddenIds = new Set([...(workspace.hidden || []), ...(workspace.detached || [])]);
        let bottom = Object.values(layout).reduce((max, item) => {
          if (!item) return max;
          return Math.max(max, Number(item.y || 0) + Number(item.h || 0));
        }, 0);
        const gridWidth = Math.max(320, grid.getBoundingClientRect().width || window.innerWidth - 40);
        panels.forEach(panel => {
          const id = panel.dataset.panelId;
          if (layout[id]) return;
          if (hiddenIds.has(id)) return;
          const rect = panel.getBoundingClientRect();
          const defaultHeight = panel.dataset.symbolWidget ? 520 : id === 'metrics' ? 126 : id === 'markets' ? 640 : id === 'highWatch' ? 300 : 240;
          layout[id] = {
            x: 0,
            y: bottom + 12,
            w: Math.min(Math.max(360, Math.round(rect.width || 760)), gridWidth),
            h: Math.max(defaultHeight, Math.round(rect.height || defaultHeight))
          };
          bottom = layout[id].y + layout[id].h;
        });
        return layout;
      }

      function applyWorkspace(workspace) {
        workspace.symbolWidgets ||= [];
        ensureSymbolPanels(workspace);
        const detached = new Set(workspace.detached || []);
        const hidden = new Set([...(workspace.hidden || []), ...detached]);
        const layout = completeWorkspaceLayout(workspace);
        document.body.classList.add('free-layout');
        panels.forEach(panel => {
          panel.hidden = hidden.has(panel.dataset.panelId);
          const item = layout[panel.dataset.panelId];
          if (!item) return;
          panel.style.left = `${Math.round(item.x)}px`;
          panel.style.top = `${Math.round(item.y)}px`;
          panel.style.width = `${Math.max(260, Math.round(item.w))}px`;
          panel.style.height = `${Math.max(140, Math.round(item.h))}px`;
        });
        updateCanvasHeight();
        openDetachedWidgets(workspace);
      }

      function activeWorkspace(store = readStore()) {
        const name = selectedWorkspaceName(store);
        store.workspaces[name] ||= blankWorkspaceForName(name);
        store.workspaces[name].symbolWidgets ||= [];
        store.workspaces[name].detached ||= [];
        store.workspaces[name].hidden ||= hiddenDefaultsForName(name);
        store.workspaces[name].layout ||= {};
        return { store, name, workspace: store.workspaces[name] };
      }

      function saveActiveWorkspaceState() {
        const { store, workspace } = activeWorkspace();
        workspace.layout = currentLayout();
        workspace.hidden = panels.filter(panel => panel.hidden).map(panel => panel.dataset.panelId);
        workspace.symbolWidgets = workspaceSymbolWidgets();
        workspace.detached = (workspace.detached || []).filter(panelId => panels.some(panel => panel.dataset.panelId === panelId));
        writeStore(store);
      }

      function currentWorkspaceSnapshot(existing = {}) {
        return {
          layout: currentLayout(),
          hidden: panels.filter(panel => panel.hidden).map(panel => panel.dataset.panelId),
          detached: (existing.detached || []).filter(panelId => panels.some(panel => panel.dataset.panelId === panelId)),
          symbolWidgets: workspaceSymbolWidgets()
        };
      }

      function saveLastWorkspace() {
        const store = readStore();
        const name = ensureAutosaveWorkspace(store);
        const active = activeWorkspace(store).workspace;
        store.workspaces[name] = currentWorkspaceSnapshot(active);
        store.lastAutosavedAt = Date.now();
        writeStore(store);
        return name;
      }

      function removeSymbolPanel(panelId) {
        const panel = panels.find(item => item.dataset.panelId === panelId);
        if (!panel?.dataset.symbolWidget) return;
        panel.remove();
        refreshRegisteredPanels();
        saveActiveWorkspaceState();
        renderControls();
        updateCanvasHeight();
      }

      function addSymbolWidgetToWorkspace({ widgetId, label, symbol }) {
        const cleanSymbol = normalize(symbol || selectedDockSymbol()) || 'BTCUSDT';
        const meta = symbolWidgetMeta(widgetId);
        const id = dynamicPanelId(cleanSymbol, widgetId);
        const layout = currentLayout();
        const bottom = Object.values(layout).reduce((max, item) => (
          item ? Math.max(max, Number(item.y || 0) + Number(item.h || 0)) : max
        ), 0);
        const gridWidth = Math.max(320, grid.getBoundingClientRect().width || window.innerWidth - 40);
        const defaultHeight = widgetId === 'tickerCard' ? 210 : widgetId === 'metrics' ? 180 : widgetId === 'pressure' ? 300 : 520;
        const { store, workspace } = activeWorkspace();
        workspace.symbolWidgets ||= [];
        workspace.layout ||= {};
        workspace.hidden ||= [];
        workspace.detached ||= [];
        workspace.symbolWidgets.push({
          id,
          symbol: cleanSymbol,
          widgetId,
          label: label || meta.label || widgetId
        });
        workspace.layout[id] = {
          x: 16,
          y: Math.max(16, bottom + 14),
          w: widgetId === 'tickerCard' ? Math.min(420, Math.max(320, gridWidth - 32)) : Math.min(960, Math.max(520, gridWidth - 32)),
          h: defaultHeight
        };
        workspace.hidden = workspace.hidden.filter(panelId => panelId !== id);
        workspace.detached = workspace.detached.filter(panelId => panelId !== id);
        writeStore(store);
        applyWorkspace(workspace);
        renderControls();
        document.getElementById('status').textContent = `Added ${cleanSymbol} ${label || meta.label || widgetId}`;
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

      function setWorkspaceDetached(panelId, detached) {
        const { store, workspace } = activeWorkspace();
        const detachedSet = new Set(workspace.detached || []);
        const hiddenSet = new Set(workspace.hidden || []);
        if (detached) {
          detachedSet.add(panelId);
          hiddenSet.add(panelId);
        } else {
          detachedSet.delete(panelId);
          hiddenSet.delete(panelId);
        }
        workspace.detached = [...detachedSet];
        workspace.hidden = [...hiddenSet];
        writeStore(store);
      }

      function openDetachedWidgets(workspace) {
        if (!window.bitunixElectron?.detachWidget) return;
        if (new URLSearchParams(window.location.search).get('popout') === '1') return;
        (workspace.detached || []).forEach(panelId => {
          if (panelId === 'alertSettings') return;
          const item = registeredPanels.find(({ widget }) => widget.id === panelId);
          if (item) detachWidget(item.panel, item.widget.label, false);
        });
      }

      function renderControls() {
        const { store } = activeWorkspace();
        const names = Object.keys(store.workspaces);
        const activeName = selectedWorkspaceName(store);
        document.getElementById('workspaceSelect').innerHTML = names.map(name => `<option value="${name}">${name}</option>`).join('');
        document.getElementById('workspaceSelect').value = activeName;
        document.getElementById('workspaceName').value = activeName;
        document.getElementById('dockWorkspaceName').textContent = activeName;
        const homeControlsHtml = registeredPanels.map(({ widget, panel }) => `
          <label><input type="checkbox" data-widget="${widget.id}" ${panel.hidden ? '' : 'checked'}> ${widget.label}</label>
          ${canDetachWidgets() ? `<button type="button" data-detach-widget="${widget.id}">Detach</button>` : ''}
          ${widget.dynamic ? `<button type="button" data-remove-widget="${widget.id}">Remove</button>` : ''}
        `).join('');
        const symbolControlsHtml = symbolWidgets.length ? `
          <div class="widget-group-title">Symbol Widgets</div>
          ${symbolWidgets.map(widget => `<button type="button" data-symbol-widget="${widget.id}">${widget.label}</button>`).join('')}
        ` : '';
        document.getElementById('widgetControls').innerHTML = homeControlsHtml;
        document.getElementById('dockWidgetControls').innerHTML = `
          <div class="widget-group-title">Workspace Widgets</div>
          ${homeControlsHtml}
          ${symbolControlsHtml}
        `;
        document.querySelectorAll('#widgetControls input[data-widget], #dockWidgetControls input[data-widget]').forEach(input => {
          input.addEventListener('change', () => {
            const panel = panels.find(item => item.dataset.panelId === input.dataset.widget);
            if (!panel) return;
            panel.hidden = !input.checked;
            if (input.checked) setWorkspaceDetached(input.dataset.widget, false);
            else saveActiveWorkspaceState();
            applyWorkspace(activeWorkspace().workspace);
            renderControls();
          });
        });
        document.querySelectorAll('#widgetControls button[data-detach-widget], #dockWidgetControls button[data-detach-widget]').forEach(button => {
          button.addEventListener('click', () => {
            const item = registeredPanels.find(({ widget }) => widget.id === button.dataset.detachWidget);
            if (item) detachWidget(item.panel, item.widget.label);
          });
        });
        document.querySelectorAll('#widgetControls button[data-remove-widget], #dockWidgetControls button[data-remove-widget]').forEach(button => {
          button.addEventListener('click', () => removeSymbolPanel(button.dataset.removeWidget));
        });
        document.querySelectorAll('#dockWidgetControls button[data-symbol-widget]').forEach(button => {
          button.addEventListener('click', () => {
            const item = symbolWidgets.find(widget => widget.id === button.dataset.symbolWidget);
            if (item) openSymbolWidget(item.id, item.label);
          });
        });
      }

      document.getElementById('workspaceSelect').addEventListener('change', event => {
        const store = readStore();
        const name = event.target.value;
        activeWorkspaceName = name;
        if (scopedWorkspaceName) setScopedWorkspaceName(name);
        else store.active = name;
        writeStore(store);
        applyWorkspace(store.workspaces[name]);
        renderControls();
      });
      window.addEventListener('dashboard-layout-changed', () => {
        saveActiveWorkspaceState();
        renderControls();
      });
      window.addEventListener('bitunix-add-symbol-widget', event => {
        addSymbolWidgetToWorkspace(event.detail || {});
      });
      rememberDetachedWidget = panelId => {
        const panel = panels.find(item => item.dataset.panelId === panelId);
        if (panel) panel.hidden = true;
        setWorkspaceDetached(panelId, true);
        updateCanvasHeight();
        renderControls();
      };
      document.getElementById('workspaceSave').addEventListener('click', () => {
        const nameInput = document.getElementById('workspaceName');
        const newName = nameInput.value.trim();
        if (!newName) {
          alert('Please enter a workspace name');
          return;
        }
        const store = readStore();
        const currentName = selectedWorkspaceName(store);
        const existing = store.workspaces[currentName] || {};
        const detached = (existing.detached || []).filter(panelId => panels.some(panel => panel.dataset.panelId === panelId));
        activeWorkspaceName = newName;
        if (scopedWorkspaceName) setScopedWorkspaceName(newName);
        else store.active = newName;
        store.workspaces[newName] = {
          layout: currentLayout(),
          hidden: panels.filter(panel => panel.hidden).map(panel => panel.dataset.panelId),
          detached,
          symbolWidgets: workspaceSymbolWidgets()
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
      document.getElementById('workspaceBlank').addEventListener('click', () => {
        const store = readStore();
        const name = uniqueWorkspaceName(store);
        store.workspaces[name] = blankWorkspace();
        writeStore(store);
        if (!openWorkspaceWindow(name)) {
          scopedWorkspaceName = '';
          activeWorkspaceName = name;
          store.active = name;
          writeStore(store);
          applyWorkspace(store.workspaces[name]);
          renderControls();
          document.getElementById('status').textContent = `Opened blank workspace: ${name}`;
        } else {
          document.getElementById('status').textContent = `Opened blank workspace window: ${name}`;
        }
      });
      document.getElementById('controlBlankWorkspace')?.addEventListener('click', () => {
        document.getElementById('workspaceBlank').click();
      });
      document.getElementById('controlScannerWorkspace')?.addEventListener('click', () => {
        const { name } = activeWorkspace();
        if (!openWorkspaceWindow(name)) document.getElementById('status').textContent = 'Workspace popout blocked';
      });
      document.getElementById('controlAlertsWindow')?.addEventListener('click', () => {
        if (!openDashboardWidgetWindow('alerts', 'Alerts')) document.getElementById('status').textContent = 'Alerts popout blocked';
      });
      document.getElementById('controlSaveSession')?.addEventListener('click', async () => {
        if (!window.bitunixElectron?.saveSession) {
          document.getElementById('status').textContent = 'Session save is available in the desktop app';
          return;
        }
        const result = await window.bitunixElectron.saveSession();
        document.getElementById('status').textContent = result?.ok ? 'Window session saved' : 'Session save failed';
      });
      document.getElementById('controlDataWindow')?.addEventListener('click', () => openDataWindow());
      document.getElementById('controlSymbol')?.addEventListener('keydown', event => {
        if (event.key === 'Enter') openDataWindow(event.currentTarget.value);
      });
      document.getElementById('workspaceDelete').addEventListener('click', () => {
        const store = readStore();
        const name = selectedWorkspaceName(store);
        if (name === 'Default' || isAutosaveWorkspaceName(name)) {
          alert(`Cannot delete the ${isAutosaveWorkspaceName(name) ? 'last autosave' : 'Default'} workspace`);
          return;
        }
        if (!confirm(`Delete workspace "${name}"?`)) return;
        delete store.workspaces[name];
        const fallback = ensureAutosaveWorkspace(store);
        activeWorkspaceName = fallback;
        if (scopedWorkspaceName) setScopedWorkspaceName(fallback);
        else store.active = fallback;
        writeStore(store);
        applyWorkspace(store.workspaces[fallback]);
        renderControls();
        document.getElementById('status').textContent = `Deleted workspace: ${name}`;
        setTimeout(() => {
          document.getElementById('status').textContent = 'Loaded';
        }, 2000);
      });

      const initialStore = readStore();
      activeWorkspaceName = scopedWorkspaceName || ensureAutosaveWorkspace(initialStore);
      initialStore.active = activeWorkspaceName;
      writeStore(initialStore);
      const { store, workspace } = activeWorkspace(initialStore);
      writeStore(store);
      applyWorkspace(workspace);
      renderControls();
      setInterval(saveLastWorkspace, autosaveIntervalMs);
      window.addEventListener('pagehide', saveLastWorkspace);
      window.addEventListener('beforeunload', saveLastWorkspace);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') saveLastWorkspace();
      });
      document.getElementById('dockLayoutToggle').addEventListener('click', () => document.getElementById('layoutToggle').click());
      document.getElementById('dockWorkspaceSave').addEventListener('click', () => document.getElementById('workspaceSave').click());
      document.getElementById('dockLayoutReset').addEventListener('click', resetDashboardLayout);
    }

    function resetDashboardLayout() {
      [
        'bitunix.dashboard.freeLayout.v1',
        'bitunix.dashboard.workspaces.v1',
        'bitunix.dashboard.workspaces.v2',
        'bitunix.dashboard.layoutEdit',
        'bitunix.dashboard.panels.v1'
      ].forEach(key => localStorage.removeItem(key));
      window.location.reload();
    }

    document.getElementById('filter').addEventListener('input', render);
    document.getElementById('filter').addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      const filter = normalize(event.currentTarget.value);
      const match = markets.find(item => normalize(item.symbol).includes(filter) || normalize(`${item.base}${item.quote}`).includes(filter));
      requestDataSymbol(match ? match.symbol : filter);
    });
    document.addEventListener('click', event => {
      const link = event.target.closest('a.symbol-link[href^="/symbol/"]');
      if (!link) return;
      event.preventDefault();
      const symbolFromHref = link.getAttribute('href')?.split('/symbol/')[1]?.split(/[?#]/)[0] || link.textContent;
      requestDataSymbol(symbolFromHref);
    });
    document.getElementById('sort').addEventListener('change', render);
    document.getElementById('highWatchMode').addEventListener('change', renderHighWatch);
    document.getElementById('highWatchAdd').addEventListener('click', () => addHighWatchSymbol(document.getElementById('highWatchAddSymbol').value));
    document.getElementById('highWatchAddSymbol').addEventListener('keydown', event => {
      if (event.key === 'Enter') addHighWatchSymbol(event.currentTarget.value);
    });
    document.getElementById('scannerOnly').addEventListener('click', () => {
      document.body.classList.toggle('scanner-only');
      const scannerOnly = document.body.classList.contains('scanner-only');
      const marketPanel = widgetPanel('markets', document.getElementById('dashboardPanels'));
      if (marketPanel) {
        if (scannerOnly) {
          marketPanel.dataset.scannerOnlyWasHidden = marketPanel.hidden ? '1' : '0';
          marketPanel.hidden = false;
        } else if (marketPanel.dataset.scannerOnlyWasHidden === '1') {
          marketPanel.hidden = true;
          delete marketPanel.dataset.scannerOnlyWasHidden;
        }
      }
      document.getElementById('scannerOnly').textContent = document.body.classList.contains('scanner-only')
        ? 'Show Widgets'
        : 'Scanner Only';
    });
    hydrateAlertSettings();
    loadLocalAlerts();
    window.addEventListener('pointerdown', () => {
      if (!audioUnlocked) unlockScannerAudio();
    }, { once: false, passive: true });
    document.getElementById('alertSettingsSave').addEventListener('click', saveAlertSettingsFromUi);
    document.querySelectorAll('.control-alert-settings input, .control-alert-settings select').forEach(input => {
      input.addEventListener('change', saveAlertSettingsFromUi);
    });
    document.getElementById('alertRulesMaster').addEventListener('change', event => setAlertRules(event.currentTarget.checked));
    document.getElementById('alertRulesAll').addEventListener('click', () => setAlertRules(true));
    document.getElementById('alertRulesNone').addEventListener('click', () => setAlertRules(false));
    document.getElementById('alertSettingsTest').addEventListener('click', async () => {
      const settings = saveAlertSettingsFromUi();
      await unlockScannerAudio();
      if (settings.beep) beepAlert('critical');
      if (settings.voice) {
        const spoke = speakAlert('XRP up three point two percent in five minutes');
        if (!spoke && !settings.beep) beepAlert('critical');
      }
      if (!settings.voice && !settings.beep) beepAlert('critical');
      document.getElementById('alertAudioState').textContent = audioUnlocked ? 'Test played' : 'Test requested';
    });
    document.getElementById('alertSettingsClear').addEventListener('click', () => {
      scannerAlerts = [];
      saveLocalAlerts();
      render();
      document.getElementById('alertAudioState').textContent = 'Local alerts cleared';
    });
    renderColumnControls();
    installWindowControls();
    setupLayoutMode();
    setupFreeLayout();
    setupWorkspaces();
    installDetachButtons(dashboardWidgets, 'dashboardPanels');
    applyWidgetPopoutMode(dashboardWidgets, 'dashboardPanels');
    document.getElementById('layoutReset').addEventListener('click', resetDashboardLayout);
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
    document.getElementById('scan').addEventListener('click', async () => {
      document.getElementById('status').textContent = 'Scanning...';
      await fetch(cacheBust('/api/scan'), { method: 'POST', cache: 'no-store' });
      await load();
    });
    
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
    
    load();
    loadBrief();
    setInterval(load, 15000);
