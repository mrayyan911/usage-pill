'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usagePill', {
  onState(callback) {
    const handler = (_event, state) => callback(state);
    ipcRenderer.on('pill:state', handler);
    return () => ipcRenderer.removeListener('pill:state', handler);
  },
  onHover(callback) {
    const handler = (_event, isHovering) => callback(isHovering);
    ipcRenderer.on('pill:hover', handler);
    return () => ipcRenderer.removeListener('pill:hover', handler);
  },
});
