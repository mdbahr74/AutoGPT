const { app, BrowserWindow, Menu, ipcMain, shell, screen } = require('electron');
const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const path = require('path');

process.env.ELECTRON_DISABLE_GPU = '1';
app.commandLine.appendSwitch('ignore-gpu-blacklist');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('disable-gpu-vsync');
app.commandLine.appendSwitch('disable-accelerated-2d-canvas');
app.commandLine.appendSwitch('disable-accelerated-video-decode');
app.commandLine.appendSwitch('disable-accelerated-video-encode');
app.commandLine.appendSwitch('use-gl', 'swiftshader');
app.commandLine.appendSwitch('enable-features', 'UseOzonePlatform');
app.disableHardwareAcceleration();

const HOST = process.env.BITUNIX_DASHBOARD_HOST || '127.0.0.1';
const PORT = Number(process.env.BITUNIX_DASHBOARD_PORT || 8765);
const BASE_URL = `http://${HOST}:${PORT}`;
const DEFAULT_ZOOM = Number(process.env.BITUNIX_ELECTRON_ZOOM || 0.7);
const AUTO_SAVE_INTERVAL_MS = 30 * 60 * 1000;
function defaultLinuxOzonePlatform() {
  if (process.env.BITUNIX_ELECTRON_OZONE) return process.env.BITUNIX_ELECTRON_OZONE;
  if (process.env.BITUNIX_ELECTRON_USE_WAYLAND === '1') return 'wayland';
  return process.env.XDG_SESSION_TYPE === 'wayland' ? 'wayland' : process.env.XDG_SESSION_TYPE === 'x11' ? 'x11' : '';
}

const LINUX_OZONE_PLATFORM = defaultLinuxOzonePlatform();

let mainWindow = null;
let dashboardProcess = null;
let mainWindowCloseConfirmed = false;
let saveSessionOnQuit = true;
let sessionSavedForShutdown = false;
let autoSaveTimer = null;
const detachedWindows = new Map();
const managedWindows = new Map();

if (process.platform === 'linux') {
  app.commandLine.appendSwitch('disable-vulkan');
  if (LINUX_OZONE_PLATFORM) app.commandLine.appendSwitch('ozone-platform', LINUX_OZONE_PLATFORM);
}

function dashboardReady() {
  return new Promise(resolve => {
    const request = http.get(`${BASE_URL}/api/config`, response => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(1500, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForDashboard(timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await dashboardReady()) return true;
    await new Promise(resolve => setTimeout(resolve, 350));
  }
  return false;
}

async function ensureDashboard() {
  if (await dashboardReady()) return;
  const dashboardCwd = path.resolve(__dirname, '..');
  const dashboardEnv = {
    ...process.env,
    PYTHONPATH: dashboardCwd
  };
  dashboardProcess = spawn(
    process.env.PYTHON || 'python3',
    ['-m', 'bitunix_scanner', 'dashboard', '--host', HOST, '--port', String(PORT)],
    {
      cwd: dashboardCwd,
      env: dashboardEnv,
      stdio: ['ignore', 'pipe', 'pipe']
    }
  );
  dashboardProcess.stdout.on('data', chunk => process.stdout.write(`[dashboard] ${chunk}`));
  dashboardProcess.stderr.on('data', chunk => process.stderr.write(`[dashboard] ${chunk}`));
  dashboardProcess.on('error', error => {
    console.error(`[dashboard] spawn error: ${error.message}`);
  });
  dashboardProcess.on('exit', async code => {
    dashboardProcess = null;
    if (!app.isQuitting && !(await dashboardReady())) {
      console.warn(`Dashboard process exited with code ${code}`);
    }
  });
  await waitForDashboard();
}

function windowStatePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function zoomStatePath() {
  return path.join(app.getPath('userData'), 'window-zoom.json');
}

function sessionStatePath() {
  return path.join(app.getPath('userData'), 'window-session.json');
}

function readWindowState() {
  try {
    return JSON.parse(fs.readFileSync(windowStatePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeWindowState(state) {
  try {
    fs.mkdirSync(path.dirname(windowStatePath()), { recursive: true });
    fs.writeFileSync(windowStatePath(), JSON.stringify(state, null, 2));
  } catch (error) {
    console.warn(`Unable to save window state: ${error.message}`);
  }
}

function readZoomState() {
  try {
    return JSON.parse(fs.readFileSync(zoomStatePath(), 'utf8'));
  } catch {
    return {};
  }
}

function writeZoomState(state) {
  try {
    fs.mkdirSync(path.dirname(zoomStatePath()), { recursive: true });
    fs.writeFileSync(zoomStatePath(), JSON.stringify(state, null, 2));
  } catch (error) {
    console.warn(`Unable to save window zoom: ${error.message}`);
  }
}

function readSessionState() {
  try {
    const parsed = JSON.parse(fs.readFileSync(sessionStatePath(), 'utf8'));
    return Array.isArray(parsed.windows) ? parsed : { windows: [] };
  } catch {
    return { windows: [] };
  }
}

function writeSessionState(state) {
  try {
    fs.mkdirSync(path.dirname(sessionStatePath()), { recursive: true });
    fs.writeFileSync(sessionStatePath(), JSON.stringify(state, null, 2));
  } catch (error) {
    console.warn(`Unable to save session state: ${error.message}`);
  }
}

function relativeRouteForWindow(win) {
  const url = win?.webContents?.getURL?.() || '';
  if (!url || !url.startsWith(BASE_URL)) return '/';
  return url.slice(BASE_URL.length) || '/';
}

function sessionTitleForWindow(win) {
  return win?.getTitle?.() || 'Bitunix';
}

function saveWindowSessionNow() {
  const windows = BrowserWindow.getAllWindows()
    .filter(win => win && !win.isDestroyed() && !win.__bitunixSkipSessionSave)
    .map((win, index) => ({
      route: relativeRouteForWindow(win),
      title: sessionTitleForWindow(win),
      bounds: win.getBounds(),
      boundsKey: win.__bitunixBoundsKey || `session:${index}`,
      reuseKey: win.__bitunixReuseKey || '',
      viewKey: win.__bitunixViewKey || viewKeyForRoute(relativeRouteForWindow(win)),
      isMain: win === mainWindow
    }))
    .filter(item => item.route.startsWith('/'));
  writeSessionState({ savedAt: new Date().toISOString(), windows });
}

function clearWindowSession() {
  writeSessionState({ savedAt: new Date().toISOString(), windows: [] });
}

function saveFullWindowState({ forShutdown = false } = {}) {
  saveAllWindowBoundsNow();
  saveWindowSessionNow();
  sessionSavedForShutdown = Boolean(forShutdown);
}

function saveWindowBoundsNow(win, key) {
  if (!win || win.isDestroyed() || !key) return;
  const state = readWindowState();
  state[key] = win.getBounds();
  writeWindowState(state);
}

function savedBounds(key) {
  if (!key) return {};
  const state = readWindowState();
  const item = state[key];
  if (!item) return {};
  return {
    x: Number.isFinite(item.x) ? item.x : undefined,
    y: Number.isFinite(item.y) ? item.y : undefined,
    width: Number.isFinite(item.width) ? item.width : undefined,
    height: Number.isFinite(item.height) ? item.height : undefined
  };
}

function numericBounds(item = {}) {
  const bounds = {
    x: Number.isFinite(item.x) ? item.x : undefined,
    y: Number.isFinite(item.y) ? item.y : undefined,
    width: Number.isFinite(item.width) ? item.width : undefined,
    height: Number.isFinite(item.height) ? item.height : undefined
  };
  if (bounds.width !== undefined) bounds.width = Math.max(420, Math.round(bounds.width));
  if (bounds.height !== undefined) bounds.height = Math.max(260, Math.round(bounds.height));
  return bounds;
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.width
    && a.x + a.width > b.x
    && a.y < b.y + b.height
    && a.y + a.height > b.y;
}

function boundsOnDisplay(bounds) {
  if (!Number.isFinite(bounds.x) || !Number.isFinite(bounds.y)) return false;
  const width = Math.max(120, Number(bounds.width || 420));
  const height = Math.max(100, Number(bounds.height || 260));
  const rect = { x: bounds.x, y: bounds.y, width, height };
  return screen.getAllDisplays().some(display => rectsOverlap(rect, display.workArea || display.bounds));
}

function usableWindowBounds(bounds = {}) {
  const next = numericBounds(bounds);
  if (boundsOnDisplay(next)) return next;
  return {
    width: next.width,
    height: next.height
  };
}

function viewKeyForRoute(route = '/') {
  const value = String(route || '/');
  if (value.startsWith('/symbol/')) return 'data';
  return 'home';
}

function zoomForKey(key) {
  const state = readZoomState();
  const value = Number(state[key] ?? DEFAULT_ZOOM);
  return Number.isFinite(value) ? Math.max(0.45, Math.min(1.4, value)) : DEFAULT_ZOOM;
}

function saveZoomForKey(key, factor) {
  if (!key) return;
  const state = readZoomState();
  state[key] = Math.max(0.45, Math.min(1.4, Number(factor) || DEFAULT_ZOOM));
  writeZoomState(state);
}

function applyZoom(win) {
  const syncZoom = () => {
    if (win.isDestroyed()) return;
    win.webContents.setZoomFactor(zoomForKey(win.__bitunixViewKey || 'home'));
  };
  syncZoom();
  win.webContents.on('did-finish-load', syncZoom);
}

function rememberWindowBounds(win, key) {
  if (!key) return;
  let timer = null;
  const save = () => {
    if (win.__bitunixSkipBoundsSave) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (win.isDestroyed() || win.__bitunixSkipBoundsSave) return;
      saveWindowBoundsNow(win, key);
    }, 250);
  };
  const saveImmediate = () => {
    if (win.__bitunixSkipBoundsSave || win.isDestroyed()) return;
    clearTimeout(timer);
    saveWindowBoundsNow(win, key);
  };
  win.on('move', save);
  win.on('resize', save);
  win.on('close', saveImmediate);
}

function auxiliaryWindows() {
  return BrowserWindow.getAllWindows().filter(win => win && !win.isDestroyed() && win !== mainWindow);
}

function saveAllWindowBoundsNow() {
  const state = readWindowState();
  BrowserWindow.getAllWindows().forEach(win => {
    if (!win || win.isDestroyed()) return;
    const key = win.__bitunixBoundsKey;
    if (key) state[key] = win.getBounds();
  });
  writeWindowState(state);
}

function closeAuxiliaryWindows({ skipSave = false } = {}) {
  auxiliaryWindows().forEach(win => {
    try {
      if (skipSave) win.__bitunixSkipBoundsSave = true;
      win.close();
    } catch {}
  });
}

function handleMainWindowClose(event) {
  if (mainWindowCloseConfirmed || app.isQuitting) return;
  const openAux = auxiliaryWindows();
  if (!openAux.length) {
    saveFullWindowState({ forShutdown: true });
    return;
  }

  event.preventDefault();
  mainWindowCloseConfirmed = true;
  saveSessionOnQuit = true;
  saveFullWindowState({ forShutdown: true });
  closeAuxiliaryWindows();
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close();
}

function createWindow(route = '/', options = {}) {
  const bounds = usableWindowBounds(options.bounds || savedBounds(options.boundsKey));
  const useNativeFrame = String(process.env.BITUNIX_NATIVE_FRAME || '').trim() === '1';
  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width || options.width || 1500,
    height: bounds.height || options.height || 950,
    minWidth: 420,
    minHeight: 260,
    title: options.title || 'Bitunix Perp Scanner',
    frame: useNativeFrame,
    titleBarStyle: useNativeFrame ? 'default' : 'hidden',
    autoHideMenuBar: true,
    backgroundColor: '#0b0d10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  win.__bitunixBoundsKey = options.boundsKey;
  win.__bitunixReuseKey = options.reuseKey || '';
  win.__bitunixViewKey = options.viewKey || viewKeyForRoute(route);
  win.__bitunixRoute = route;
  win.setMenuBarVisibility(false);
  rememberWindowBounds(win, options.boundsKey);
  win.on('closed', () => {
    if (!app.isQuitting && !sessionSavedForShutdown) saveWindowSessionNow();
  });
  applyZoom(win);
  win.loadURL(`${BASE_URL}${route}`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(BASE_URL)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  if (options.devtools) win.webContents.openDevTools({ mode: 'detach' });
  return win;
}

function routeSearchParams(route = '') {
  try {
    return new URL(String(route || '/'), 'http://bitunix.local').searchParams;
  } catch {
    return new URLSearchParams();
  }
}

function isPopoutRoute(route = '') {
  return routeSearchParams(route).get('popout') === '1';
}

function isDetachedBoundsKey(key = '') {
  return String(key || '').startsWith('detached:');
}

function managedWindowKeyForRoute(route = '') {
  if (isPopoutRoute(route)) return '';
  if (String(route).startsWith('/symbol/')) return 'data';
  return '';
}

function createOrReuseWindow(route = '/', options = {}) {
  const reuseKey = String(options.reuseKey || managedWindowKeyForRoute(route) || '');
  if (reuseKey) {
    const existing = managedWindows.get(reuseKey);
    if (existing && !existing.isDestroyed()) {
      existing.__bitunixRoute = route;
      existing.__bitunixViewKey = options.viewKey || viewKeyForRoute(route);
      existing.loadURL(`${BASE_URL}${route}`);
      existing.focus();
      return { win: existing, reused: true };
    }
  }
  const win = createWindow(route, options);
  if (reuseKey) {
    managedWindows.set(reuseKey, win);
    win.on('closed', () => managedWindows.delete(reuseKey));
  }
  return { win, reused: false };
}

function restoreWindowSession() {
  const session = readSessionState();
  const windows = Array.isArray(session.windows) ? session.windows.filter(item => item?.route) : [];
  if (!windows.length) return false;
  windows.forEach((item, index) => {
    const boundsKey = item.boundsKey || `session:${index}`;
    const detached = isDetachedBoundsKey(boundsKey) || isPopoutRoute(item.route);
    const reuseKey = detached ? '' : item.reuseKey || managedWindowKeyForRoute(item.route) || (boundsKey === 'data' ? 'data' : '');
    const latestBounds = savedBounds(boundsKey);
    const win = createWindow(item.route, {
      bounds: Object.keys(latestBounds).length ? latestBounds : item.bounds,
      boundsKey,
      title: item.title || 'Bitunix',
      reuseKey,
      viewKey: item.viewKey || viewKeyForRoute(item.route)
    });
    if (String(item.boundsKey || '').startsWith('detached:')) {
      const detachedKey = String(item.boundsKey).replace(/^detached:/, '');
      detachedWindows.set(detachedKey, win);
      win.on('closed', () => detachedWindows.delete(detachedKey));
    }
    if (reuseKey) {
      managedWindows.set(reuseKey, win);
      win.on('closed', () => managedWindows.delete(reuseKey));
    }
    if (item.isMain || index === 0) mainWindow = win;
  });
  return true;
}

function activeZoomWindow(sender = null) {
  return sender ? BrowserWindow.fromWebContents(sender) : BrowserWindow.getFocusedWindow() || mainWindow;
}

function getZoom(win = activeZoomWindow()) {
  if (!win || win.isDestroyed()) return DEFAULT_ZOOM;
  return zoomForKey(win.__bitunixViewKey || viewKeyForRoute(relativeRouteForWindow(win)));
}

function setZoom(factor, win = activeZoomWindow()) {
  if (!win || win.isDestroyed()) return DEFAULT_ZOOM;
  const next = Math.max(0.45, Math.min(1.4, Number(factor) || DEFAULT_ZOOM));
  const key = win.__bitunixViewKey || viewKeyForRoute(relativeRouteForWindow(win));
  win.__bitunixViewKey = key;
  saveZoomForKey(key, next);
  win.webContents.setZoomFactor(next);
  return next;
}

function buildMenu() {
  const openBlankWorkspace = () => {
    const name = `Blank Workspace ${new Date().toLocaleTimeString().replace(/[^0-9]/g, '')}`;
    createWindow(`/?workspace=${encodeURIComponent(name)}`, {
      width: 1400,
      height: 900,
      title: `Bitunix - ${name}`,
      boundsKey: 'workspace',
      viewKey: 'home'
    });
  };
  const openAlertsWindow = () => {
    createWindow('/?widget=alerts&popout=1', {
      width: 720,
      height: 620,
      title: 'Bitunix - Alerts',
      boundsKey: 'detached:control:alerts'
    });
  };
  const saveSession = () => {
    saveFullWindowState();
    sessionSavedForShutdown = false;
  };
  return Menu.buildFromTemplate([
    {
      label: 'Bitunix',
      submenu: [
        { label: 'Open Scanner', click: () => createWindow('/', { boundsKey: 'main' }) },
        { label: 'Save Window Session', accelerator: 'CmdOrCtrl+Shift+S', click: saveSession },
        {
          label: 'Clear Saved Window Session',
          click: () => {
            saveSessionOnQuit = false;
            clearWindowSession();
          }
        },
        {
          label: 'Detach Current Page',
          click: () => {
            const current = mainWindow?.webContents.getURL() || `${BASE_URL}/`;
            const route = current.startsWith(BASE_URL) ? current.slice(BASE_URL.length) || '/' : '/';
            createWindow(route, { width: 1100, height: 780, title: 'Bitunix Detached Page', boundsKey: `page:${route}` });
          }
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'View',
      submenu: [
        { label: 'Open Blank Workspace', accelerator: 'CmdOrCtrl+Shift+N', click: openBlankWorkspace },
        { label: 'Open Alerts Window', accelerator: 'CmdOrCtrl+Shift+A', click: openAlertsWindow },
        { label: 'Open Scanner Control Center', click: () => createWindow('/', { boundsKey: 'main' }) },
        { type: 'separator' },
        { label: '70%', click: () => setZoom(0.7) },
        { label: '80%', click: () => setZoom(0.8) },
        { label: '90%', click: () => setZoom(0.9) },
        { label: '100%', click: () => setZoom(1) },
        { type: 'separator' },
        { label: 'Zoom In', accelerator: 'CmdOrCtrl+=', click: () => setZoom(getZoom() + 0.05) },
        { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => setZoom(getZoom() - 0.05) },
        { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => setZoom(1) },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    }
  ]);
}

ipcMain.handle('bitunix:get-zoom', event => getZoom(activeZoomWindow(event.sender)));
ipcMain.handle('bitunix:set-zoom', (event, factor) => setZoom(factor, activeZoomWindow(event.sender)));
ipcMain.handle('bitunix:zoom-step', (event, delta) => {
  const win = activeZoomWindow(event.sender);
  return setZoom(getZoom(win) + Number(delta || 0), win);
});
ipcMain.handle('bitunix:save-session', () => {
  saveFullWindowState();
  sessionSavedForShutdown = false;
  return { ok: true };
});
ipcMain.handle('bitunix:clear-session', () => {
  saveSessionOnQuit = false;
  clearWindowSession();
  return { ok: true };
});
ipcMain.handle('bitunix:window-action', (event, actionName) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return { ok: false };
  const action = String(actionName || '').trim();
  if (action === 'minimize') {
    win.minimize();
  } else if (action === 'toggle-maximize') {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  } else if (action === 'close') {
    win.close();
  }
  return { ok: true, maximized: win.isMaximized() };
});
ipcMain.handle('bitunix:open-workspace', (_event, payload = {}) => {
  const workspace = String(payload.workspace || 'Workspace').replace(/[^\w .-]/g, '').trim() || 'Workspace';
  const requestedPath = String(payload.path || '');
  const route = requestedPath.startsWith('/') ? requestedPath : `/?workspace=${encodeURIComponent(workspace)}`;
  const fallbackBoundsKey = route.startsWith('/symbol/') ? 'data' : 'workspace';
  const boundsKey = String(payload.boundsKey || fallbackBoundsKey).replace(/[^A-Za-z0-9_/:.-]/g, '_');
  const reuseKey = String(payload.reuseKey || '').replace(/[^A-Za-z0-9_/:.-]/g, '_');
  const { win, reused } = createOrReuseWindow(route, {
    width: Number(payload.width || 1400),
    height: Number(payload.height || 900),
    title: String(payload.title || (route.startsWith('/symbol/') ? 'Bitunix - Data' : `Bitunix - ${workspace}`)),
    boundsKey,
    reuseKey,
    viewKey: route.startsWith('/symbol/') ? 'data' : 'home'
  });
  return { ok: true, id: win.id, reused };
});
ipcMain.handle('bitunix:detach-widget', (_event, payload = {}) => {
  const panelId = String(payload.panelId || '').replace(/[^A-Za-z0-9_-]/g, '');
  const title = String(payload.title || panelId || 'Widget');
  const currentPath = String(payload.path || '/');
  const [pathname, search = ''] = currentPath.split('?');
  const params = new URLSearchParams(search);
  params.set('widget', panelId);
  params.set('popout', '1');
  const route = `${pathname || '/'}?${params.toString()}`;
  const detachedKey = String(payload.detachedKey || `${pathname || '/'}:${panelId}`).replace(/[^A-Za-z0-9_/:.-]/g, '_');
  const existing = detachedWindows.get(detachedKey);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return { ok: true, id: existing.id, focused: true };
  }
  const win = createWindow(route, {
    width: Number(payload.width || 900),
    height: Number(payload.height || 650),
    title: `Bitunix - ${title}`,
    boundsKey: `detached:${detachedKey}`
  });
  detachedWindows.set(detachedKey, win);
  win.on('closed', () => detachedWindows.delete(detachedKey));
  return { ok: true, id: win.id };
});

app.whenReady().then(async () => {
  await ensureDashboard();
  Menu.setApplicationMenu(buildMenu());
  autoSaveTimer = setInterval(() => {
    if (BrowserWindow.getAllWindows().length) saveFullWindowState();
  }, AUTO_SAVE_INTERVAL_MS);
  autoSaveTimer.unref?.();
  const restored = restoreWindowSession();
  if (!restored) {
    mainWindow = createWindow('/', { devtools: process.argv.includes('--devtools'), boundsKey: 'main' });
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = BrowserWindow.getAllWindows()[0] || createWindow('/', { boundsKey: 'main' });
  }
  mainWindow.on('close', event => handleMainWindowClose(event));
  mainWindow.on('closed', () => {
    mainWindow = null;
    mainWindowCloseConfirmed = false;
  });
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    mainWindow = createWindow('/', { boundsKey: 'main' });
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  if (saveSessionOnQuit && !sessionSavedForShutdown) {
    saveFullWindowState({ forShutdown: true });
  }
  if (dashboardProcess) dashboardProcess.kill();
});

app.on('will-quit', () => {
  if (autoSaveTimer) clearInterval(autoSaveTimer);
});
