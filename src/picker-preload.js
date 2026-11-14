'use strict';
/* Okno wyboru ekranu: tylko lista źródeł, wybór i anulowanie. */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', Object.freeze({
  list: () => ipcRenderer.invoke('picker:list'),
  choose: (id, audio) => ipcRenderer.send('picker:choose', { id: String(id), audio: audio === true }),
  cancel: () => ipcRenderer.send('picker:cancel'),
}));
