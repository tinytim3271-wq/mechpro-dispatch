const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, params) {
  const response = await ipcRenderer.invoke(channel, params);
  if (!response?.ok) throw new Error(response?.error || 'Diagnostic IPC failed');
  return response.result;
}

contextBridge.exposeInMainWorld('mechproDesktop', Object.freeze({
  platform: process.platform,
  version: process.versions.electron,
}));

contextBridge.exposeInMainWorld('mechproDiagnostics', Object.freeze({
  listAdapters: () => invoke('diagnostics:listAdapters'),
  connect: (params) => invoke('diagnostics:connect', params),
  disconnect: () => invoke('diagnostics:disconnect'),
  getConnectionStatus: () => invoke('diagnostics:getConnectionStatus'),
  readVin: () => invoke('diagnostics:readVin'),
  identifyEcus: () => invoke('diagnostics:identifyEcus'),
  readDtcs: () => invoke('diagnostics:readDtcs'),
  clearDtcs: () => invoke('diagnostics:clearDtcs'),
  startLiveLog: () => invoke('diagnostics:startLiveLog'),
  stopLiveLog: () => invoke('diagnostics:stopLiveLog'),
  pollLiveLog: (since) => invoke('diagnostics:pollLiveLog', since),
  identifyVehicle: () => invoke('diagnostics:identifyVehicle'),
}));
