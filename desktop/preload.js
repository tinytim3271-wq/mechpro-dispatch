const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('mechproDesktop', Object.freeze({
  platform: process.platform,
  version: process.versions.electron,
}));