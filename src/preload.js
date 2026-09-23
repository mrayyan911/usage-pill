'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('usagePill', {
  setExpanded(expanded) {
    ipcRenderer.send('pill:expanded', expanded === true);
  },
  onInspect(callback) {
    const handler = () => callback();
    ipcRenderer.on('pill:inspect', handler);
    return () => ipcRenderer.removeListener('pill:inspect', handler);
  },
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
