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
    /** cb({ artists, title, album?, startedAt?, durationMs? } | null) — co gra w Spotify na tym komputerze (1.0.6). */
    onMusic: cb => listen('music', cb),
    /** { game, music, update, settings, window } */
    getState: () => ipcRenderer.invoke('state'),
    checkUpdates: () => ipcRenderer.invoke('update:check'),
    installUpdate: () => ipcRenderer.send('update:install'),
    getSettings: () => ipcRenderer.invoke('settings:get'),
    /** { autostart?, startMinimized?, closeToTray?, gameDetection?, musicDetection? } → nowe ustawienia */
    setSettings: p => ipcRenderer.invoke('settings:set', p && typeof p === 'object' ? { ...p } : {}),
  }));
}

/* Pasek okna w kolorze motywu (Windows). Przyciski — ▢ ✕ rysuje system (titleBarOverlay w main.js),
   a tu dokładamy resztę paska: Gibek, napis „GibCord” i miejsce do przeciągania okna.
   Kolor bierzemy z <meta name="theme-color"> (GibCord zmienia go razem z motywem). Strona dostaje na <html>
   klasę .gctb i zmienną --gctb-h, żeby przesunąć to, co przypięte do okna (app.css). */
const tb = ipcRenderer.sendSync('titlebar:info'); // null: zwykła ramka okna albo obca strona
if (tb) {
  const hex = c => { c = String(c || '').trim().toLowerCase(); if (/^#[0-9a-f]{3}$/.test(c)) c = '#' + [...c.slice(1)].map(x => x + x).join(''); return /^#[0-9a-f]{6}$/.test(c) ? c : null; };
  const fgFor = bg => { const n = parseInt(bg.slice(1), 16); return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255 > 0.6 ? '#1f1b2b' : '#f6f2fb'; };
  let sent = { bg: hex(tb.bg) || '#1b1531', fg: hex(tb.fg) || '#f6f2fb' };
  let full = !!tb.fullscreen, bar = null;
  const CSS = `html.gctb{--gctb-h:${Number(tb.height) || 30}px}
html.gctb>body{box-sizing:border-box!important;padding-top:var(--gctb-h)!important}
#gctb{position:fixed;top:0;left:0;right:0;height:var(--gctb-h,30px);z-index:2147483647;display:flex;align-items:center;gap:7px;margin:0;padding:0 0 0 10px;box-sizing:border-box;
background:var(--gctb-bg);color:var(--gctb-fg);font:600 11.5px/1 var(--f,"Segoe UI"),"Segoe UI",system-ui,sans-serif;letter-spacing:.01em;
-webkit-app-region:drag;user-select:none;-webkit-user-select:none;cursor:default;transition:background-color .3s,color .3s}
#gctb img{width:15px;height:15px;flex:none;-webkit-user-drag:none;pointer-events:none}
#gctb span{opacity:.85;white-space:nowrap;pointer-events:none}
html:not(.gctb)>#gctb{display:none}`;
  const paint = () => {
    if (!bar) return;
    const meta = document.querySelector('meta[name="theme-color"]');
    const bg = (meta && hex(meta.getAttribute('content'))) || sent.bg;
    const fg = meta ? fgFor(bg) : sent.fg;
    bar.style.setProperty('--gctb-bg', bg); bar.style.setProperty('--gctb-fg', fg);
    if (meta && (bg !== sent.bg || fg !== sent.fg)) { sent = { bg, fg }; ipcRenderer.send('titlebar', sent); }
  };
  const mount = () => {
    if (bar || !document.body) return !!bar;
    const root = document.documentElement;
    const st = document.createElement('style'); st.id = 'gctb-css'; st.textContent = CSS;
    (document.head || root).appendChild(st);
    bar = document.createElement('div'); bar.id = 'gctb'; bar.setAttribute('aria-hidden', 'true');
    if (tb.icon) { const img = document.createElement('img'); img.alt = ''; img.src = tb.icon; bar.appendChild(img); }
    const name = document.createElement('span'); name.textContent = 'GibCord'; bar.appendChild(name);
    root.appendChild(bar);
    root.classList.toggle('gctb', !full);
    paint();
    if (document.head) new MutationObserver(paint).observe(document.head, { subtree: true, childList: true, attributes: true, attributeFilter: ['content'] });
    return true;
  };
  // preload startuje, zanim strona ma <html> i <body> — czekamy na <body> (pasek jest od pierwszej klatki)
  if (!mount()) {
    const mo = new MutationObserver(() => { if (mount()) mo.disconnect(); });
    mo.observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => { mo.disconnect(); mount(); }, { once: true });
  }
  ipcRenderer.on('window', (_e, s) => { if (s && typeof s === 'object' && 'fullscreen' in s) { full = !!s.fullscreen; if (bar) document.documentElement.classList.toggle('gctb', !full); } });
}
