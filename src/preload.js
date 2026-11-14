'use strict';
/* Most między stroną GibCorda a aplikacją: window.gibcordDesktop. Strona nie dostaje dostępu do Node ani do plików. */
const { contextBridge, ipcRenderer } = require('electron');

const info = ipcRenderer.sendSync('app:info'); // null, gdy strona nie jest GibCordem — wtedy nic nie wystawiamy
if (info) {
  const listen = (channel, cb) => {
    if (typeof cb !== 'function') return () => {};
    const h = (_e, data) => { try { cb(data); } catch (err) { console.error(err); } };
    ipcRenderer.on(channel, h);
    return () => ipcRenderer.removeListener(channel, h);
  };
  contextBridge.exposeInMainWorld('gibcordDesktop', Object.freeze({
    version: String(info.version),
    platform: String(info.platform),
    packaged: !!info.packaged,
    /** Licznik oznaczeń na ikonie (count) i kropka „są nieprzeczytane” (dot). */
    setBadge: (count, dot) => ipcRenderer.send('badge', { count: Number(count) || 0, dot: !!dot }),
    /** Mignięcie ikoną na pasku zadań, gdy okno nie jest aktywne. */
    flash: () => ipcRenderer.send('flash'),
    /** Pokaż i aktywuj okno (np. po kliknięciu powiadomienia). */
    focus: () => ipcRenderer.send('focus'),
    /** Stan rozmowy: { inCall, muted, deaf, ptt: { enabled, code } } — do globalnego „naciśnij, by mówić” i menu w zasobniku. */
    setVoiceState: s => ipcRenderer.send('voice', s && typeof s === 'object' ? { inCall: !!s.inCall, muted: !!s.muted, deaf: !!s.deaf, ptt: { enabled: !!(s.ptt && s.ptt.enabled), code: String((s.ptt && s.ptt.code) || '') } } : null),
    /** cb({ down: true|false }) — wciśnięcie/puszczenie klawisza „naciśnij, by mówić” w dowolnej aplikacji. */
    onPtt: cb => listen('ptt', cb),
    /** cb('mute' | 'deaf' | 'settings') — kliknięcia w menu ikony w zasobniku. */
    onTray: cb => listen('tray', cb),
    /** cb('/kanal/1/2') — otwarcie linku gibcord:// albo linku do GibCorda. Wywołanie oznacza, że strona jest gotowa. */
    onDeepLink: cb => { const off = listen('deeplink', cb); ipcRenderer.send('deeplink:ready'); return off; },
    /** cb({ state, version, error }) — stan aktualizacji aplikacji. */
    onUpdate: cb => listen('update', cb),
    /** cb({ visible, focused }) — okno pokazane/schowane/zminimalizowane, aktywne lub nie. */
    onWindowState: cb => listen('window', cb),
    /** cb({ id, name, startedAt } | null) — wykryta gra. */
    onGame: cb => listen('game', cb),
    /** { game, update, settings, window } */
    getState: () => ipcRenderer.invoke('state'),
    checkUpdates: () => ipcRenderer.invoke('update:check'),
    installUpdate: () => ipcRenderer.send('update:install'),
    getSettings: () => ipcRenderer.invoke('settings:get'),
    /** { autostart?, startMinimized?, closeToTray?, gameDetection? } → nowe ustawienia */
    setSettings: p => ipcRenderer.invoke('settings:set', p && typeof p === 'object' ? { ...p } : {}),
  }));
}
