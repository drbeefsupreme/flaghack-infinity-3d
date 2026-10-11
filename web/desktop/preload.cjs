'use strict';
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('launcher', Object.freeze({
  get: () => ipcRenderer.invoke('launcher:get'),
  channel: value => ipcRenderer.invoke('launcher:channel', value),
  check: () => ipcRenderer.invoke('launcher:check'),
  download: () => ipcRenderer.invoke('launcher:download'),
  install: () => ipcRenderer.invoke('launcher:install'),
  play: () => ipcRenderer.invoke('launcher:play'),
  onState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('launcher:state', listener); return () => ipcRenderer.removeListener('launcher:state', listener); },
}));
