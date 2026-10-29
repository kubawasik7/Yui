const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yuiSetup', {
  getInfo: () => ipcRenderer.invoke('setup:info'),
  chooseFolder: () => ipcRenderer.invoke('setup:choose-folder'),
  validate: (target) => ipcRenderer.invoke('setup:validate', target),
  install: (options) => ipcRenderer.invoke('setup:install', options),
  launch: (path) => ipcRenderer.invoke('setup:launch', path),
  minimize: () => ipcRenderer.invoke('setup:minimize'),
  close: () => ipcRenderer.invoke('setup:close'),
  onState: (callback) => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('setup:state', listener);
    return () => ipcRenderer.removeListener('setup:state', listener);
  }
});
