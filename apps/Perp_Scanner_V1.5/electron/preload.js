const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('bitunixElectron', {
  detachWidget: payload => ipcRenderer.invoke('bitunix:detach-widget', payload),
  openWorkspace: payload => ipcRenderer.invoke('bitunix:open-workspace', payload),
  saveSession: () => ipcRenderer.invoke('bitunix:save-session'),
  clearSession: () => ipcRenderer.invoke('bitunix:clear-session'),
  getZoomFactor: () => ipcRenderer.invoke('bitunix:get-zoom'),
  setZoomFactor: factor => ipcRenderer.invoke('bitunix:set-zoom', factor),
  zoomIn: () => ipcRenderer.invoke('bitunix:zoom-step', 0.05),
  zoomOut: () => ipcRenderer.invoke('bitunix:zoom-step', -0.05),
  resetZoom: () => ipcRenderer.invoke('bitunix:set-zoom', 1),
  windowAction: action => ipcRenderer.invoke('bitunix:window-action', action)
});
