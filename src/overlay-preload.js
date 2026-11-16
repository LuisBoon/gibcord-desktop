'use strict';
/* Okno nakładki w grze: tylko odbiór stanu (kto jest na kanale, kto mówi) i wyglądu (róg, rozmiar). */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('gcOverlay', Object.freeze({
  /** cb({ state: { channel, members, more } | null, corner, scale }) */
  onState: cb => { ipcRenderer.on('overlay', (e, d) => cb(d)); ipcRenderer.send('overlay:ready'); },
}));
