'use strict';
/*
 * GibCord — aplikacja na komputer (Windows). Cienka powłoka: okno ładuje stronę GibCorda,
 * a do tego dokłada to, czego przeglądarka nie umie: „naciśnij, by mówić” w każdej aplikacji,
 * ikonę w zasobniku, autostart, linki gibcord://, wykrywanie gier i samoczynne aktualizacje.
 */
const { app, BrowserWindow, Tray, Menu, nativeImage, nativeTheme, ipcMain, shell, session, desktopCapturer, screen, clipboard, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { execFile, spawn } = require('child_process');
const { createLogger } = require('./lib/log');
const { createStore } = require('./lib/settings');
const { parseDeepLink, findDeepLinkArg } = require('./lib/deeplink');
const { resolveBinding, matches } = require('./lib/keymap');
const games = require('./lib/games');
const music = require('./lib/music');
const { originOf, isAllowedOrigin, appPathFor } = require('./lib/origins');

/* ---------- adres ---------- */
const DEFAULT_URL = 'https://gibcord.luisboon.pl';
const LEGACY_ORIGINS = ['https://dc.luisboon.pl']; // stary adres — przekierowuje na nowy
const ORIGIN = originOf(process.env.GIBCORD_URL) || DEFAULT_URL;
const ORIGINS = [ORIGIN, ...LEGACY_ORIGINS.filter(o => o !== ORIGIN)];
const allowed = url => isAllowedOrigin(url, ORIGINS);

const IS_WIN = process.platform === 'win32';
// Wersja z Microsoft Store (pakiet MSIX): aktualizacje robi Sklep, a autostart to zadanie startowe z manifestu,
// które użytkownik włącza/wyłącza w Ustawieniach Windows → Aplikacje → Uruchamianie.
const IS_STORE = !!process.windowsStore;
const STARTUP_SETTINGS = 'ms-settings:startupapps';
const DEVTOOLS = process.argv.includes('--devtools');
// Pasek okna w kolorze motywu: system rysuje tylko przyciski — ▢ ✕ (titleBarOverlay), resztę paska dokłada preload.js.
const TITLEBAR = IS_WIN || process.env.GIBCORD_TITLEBAR === '1';
const TB_H = 30; // wysokość paska w px strony (przy powiększeniu rośnie razem ze stroną)
const ASSETS = path.join(__dirname, '..', 'assets');
const asset = (...p) => path.join(ASSETS, ...p);

app.setName('GibCord');
if (IS_WIN) app.setAppUserModelId('pl.luisboon.gibcord');
// Klawisze multimedialne (Play/Pauza) nie mogą zatrzymywać dźwięku rozmowy.
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService');
// Dźwięki i rozmowa grają od razu po starcie, bez czekania na kliknięcie.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  main();
}

function main() {
  const log = createLogger(app.getPath('userData'));
  const store = createStore(app.getPath('userData'));
  log.info(`Start ${app.getVersion()} (${process.platform} ${process.arch}), adres ${ORIGIN}, argv ${JSON.stringify(process.argv.slice(1))}`);
  process.on('uncaughtException', e => log.error('uncaughtException', e));
  process.on('unhandledRejection', e => log.error('unhandledRejection', e));

  /* ---------- rejestracja linków gibcord:// ---------- */
  if (process.defaultApp) {
    if (process.argv.length >= 2) app.setAsDefaultProtocolClient('gibcord', process.execPath, [path.resolve(process.argv[1])]);
  } else app.setAsDefaultProtocolClient('gibcord');

  let win = null;
  let tray = null;
  let quitting = false;
  let rendererReady = false;
  const pendingPaths = [];
  const launchedByAutostart = process.argv.includes('--autostart') || process.argv.includes('--hidden');
  const voice = { inCall: false, muted: false, deaf: false, ptt: { enabled: false, code: '' } };
  const badge = { count: 0, dot: false };
  const update = { state: 'idle', version: null, error: null }; // idle | checking | available | downloading | downloaded | none | error
  let currentGame = null;

  /* ---------- pomocnicze ---------- */
  const send = (ch, data) => { if (win && !win.isDestroyed()) win.webContents.send(ch, data); };
  const fromApp = e => !!(e && e.sender && win && e.sender === win.webContents && e.senderFrame && allowed(e.senderFrame.url));
  const openExternal = url => { try { const u = new URL(url); if (u.protocol === 'https:' || u.protocol === 'http:' || u.protocol === 'mailto:') shell.openExternal(u.href); } catch {} };
  let appReady = false;
  function showWindow() {
    if (!appReady) return; // przed startem okno pokaże się samo
    if (!win || win.isDestroyed()) { createWindow(); return; }
    if (win.isMinimized()) win.restore();
    if (!win.isVisible()) win.show();
    win.focus();
  }
  function visibleOnSomeDisplay(b) {
    return screen.getAllDisplays().some(d => { const a = d.workArea; return b.x + 80 < a.x + a.width && b.x + b.width - 80 > a.x && b.y + 40 < a.y + a.height && b.y > a.y - 40; });
  }

  /* ---------- pasek okna w kolorze motywu ---------- */
  const HEX = /^#[0-9a-f]{6}$/i;
  const titleBarOverlay = () => { const s = store.get(); return { color: s.tbBg, symbolColor: s.tbFg, height: Math.round(TB_H * Math.pow(1.2, s.zoom || 0)) }; };
  const isLight = hex => { const n = parseInt(hex.slice(1), 16); return (0.2126 * (n >> 16 & 255) + 0.7152 * (n >> 8 & 255) + 0.0722 * (n & 255)) / 255 > 0.6; };
  // ramki pozostałych okien (podgląd plików, wybór ekranu) i menu systemowe: jasne albo ciemne jak motyw
  const syncNativeTheme = () => { try { if (TITLEBAR && nativeTheme) nativeTheme.themeSource = isLight(store.get().tbBg) ? 'light' : 'dark'; } catch {} };
  function applyTitleBar() {
    if (!TITLEBAR || !win || win.isDestroyed()) return;
    try { win.setTitleBarOverlay(titleBarOverlay()); } catch (e) { log.warn('setTitleBarOverlay', e && e.message); }
  }
  let tbIcon = null; // Gibek dla paska (data: URL), liczony raz
  const titleBarIcon = () => { if (tbIcon === null) { try { tbIcon = nativeImage.createFromPath(asset('icon.png')).resize({ width: 32, height: 32, quality: 'best' }).toDataURL(); } catch { tbIcon = ''; } } return tbIcon; };

  /* ---------- sesja: uprawnienia i udostępnianie ekranu ---------- */
  function setupSession(ses) {
    const ASK = new Set(['media', 'notifications', 'display-capture', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'speaker-selection', 'idle-detection']);
    const CHECK = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'clipboard-read', 'fullscreen', 'idle-detection']);
    ses.setPermissionRequestHandler((wc, permission, cb, details) => {
      const ok = ASK.has(permission) && allowed(details && (details.requestingUrl || details.securityOrigin));
      if (!ok) log.info(`Odmowa uprawnienia ${permission} dla ${details && details.requestingUrl}`);
      cb(ok);
    });
    ses.setPermissionCheckHandler((wc, permission, origin) => CHECK.has(permission) && allowed(origin));
    ses.setDisplayMediaRequestHandler((request, callback) => {
      if (!allowed(request.securityOrigin || (request.frame && request.frame.url))) { callback({}); return; }
      openPicker(!!request.audioRequested, callback);
    });
    ses.on('will-download', (_e, item) => {
      item.once('done', (_ev, state) => {
        if (state === 'completed' && Notification.isSupported()) {
          const n = new Notification({ title: 'Pobrano plik', body: path.basename(item.getSavePath()), icon: asset('icon.png') });
          n.on('click', () => shell.showItemInFolder(item.getSavePath()));
          n.show();
        }
      });
    });
  }

  /* ---------- okno wyboru ekranu/okna do transmisji ---------- */
  let pick = null; // { win, wc, audio, sources, finish }
  function openPicker(audioRequested, callback) {
    if (pick) pick.finish({}); // poprzednie okno wyboru — anuluj
    const ctx = { audio: audioRequested && IS_WIN, sources: [], done: false };
    ctx.finish = streams => {
      if (ctx.done) return; ctx.done = true;
      try { callback(streams); } catch (e) { log.warn('display media callback', e); }
      if (pick === ctx) pick = null;
      if (ctx.win && !ctx.win.isDestroyed()) ctx.win.close();
    };
    ctx.win = new BrowserWindow({
      parent: win || undefined, modal: !!win, width: 780, height: 580, minWidth: 520, minHeight: 420, show: false, resizable: true,
      title: 'Udostępnij ekran', backgroundColor: '#1b1531', icon: windowIcon(), autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, 'picker-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: DEVTOOLS },
    });
    ctx.win.setMenu(null);
    ctx.wc = ctx.win.webContents;
    ctx.wc.on('will-navigate', e => e.preventDefault());
    ctx.wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    ctx.win.on('closed', () => ctx.finish({}));
    ctx.win.once('ready-to-show', () => { if (!ctx.done) ctx.win.show(); });
    pick = ctx;
    ctx.win.loadFile(path.join(__dirname, 'picker.html'));
  }
  const fromPicker = e => !!(pick && e.sender === pick.wc);
  ipcMain.handle('picker:list', async e => {
    if (!fromPicker(e)) return null;
    const ctx = pick;
    try { ctx.sources = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true }); }
    catch (err) { log.warn('desktopCapturer', err); ctx.sources = []; }
    return {
      audio: ctx.audio,
      sources: ctx.sources.filter(s => s.name !== 'Udostępnij ekran').map(s => ({
        id: s.id, name: s.name, kind: s.id.startsWith('screen:') ? 'screen' : 'window',
        thumb: s.thumbnail && !s.thumbnail.isEmpty() ? s.thumbnail.toDataURL() : '',
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
      })),
    };
  });
  ipcMain.on('picker:choose', (e, d) => {
    if (!fromPicker(e) || !d || typeof d.id !== 'string') return;
    const ctx = pick, src = ctx.sources.find(s => s.id === d.id);
    if (!src) return ctx.finish({});
    const streams = { video: src };
    if (d.audio === true && ctx.audio) streams.audio = 'loopback';
    log.info(`Transmisja: ${src.id} (${src.name})${streams.audio ? ' + dźwięk komputera' : ''}`);
    ctx.finish(streams);
  });
  ipcMain.on('picker:cancel', e => { if (fromPicker(e)) pick.finish({}); });

  /* ---------- główne okno ---------- */
  function windowIcon() { return IS_WIN ? asset('icon.ico') : asset('icon.png'); }
  function createWindow() {
    const st = store.get();
    const opts = {
      width: 1280, height: 800, minWidth: 420, minHeight: 480, show: false, title: 'GibCord', backgroundColor: TITLEBAR ? st.tbBg : '#1b1531',
      icon: windowIcon(), autoHideMenuBar: true,
      ...(TITLEBAR ? { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay() } : {}),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'), partition: 'persist:gibcord',
        contextIsolation: true, sandbox: true, nodeIntegration: false, webviewTag: false,
        backgroundThrottling: false, spellcheck: true, devTools: DEVTOOLS,
      },
    };
    if (st.bounds && visibleOnSomeDisplay(st.bounds)) Object.assign(opts, st.bounds);
    win = new BrowserWindow(opts);
    win.setMenu(null);
    const wc = win.webContents;
    if (st.maximized) win.maximize();

    const startHidden = launchedByAutostart && st.startMinimized;
    win.once('ready-to-show', () => { if (!startHidden) win.show(); });
    if (startHidden) log.info('Start schowany w zasobniku (autostart)');

    /* zapamiętywanie położenia */
    let saveT = null;
    const saveBounds = () => { clearTimeout(saveT); saveT = setTimeout(() => { if (!win || win.isDestroyed()) return; const maximized = win.isMaximized(); store.set(maximized || win.isMinimized() || win.isFullScreen() ? { maximized } : { bounds: win.getBounds(), maximized: false }); }, 500); };
    win.on('resize', saveBounds); win.on('move', saveBounds); win.on('maximize', saveBounds); win.on('unmaximize', saveBounds);

    win.on('focus', () => win.flashFrame(false));
    /* Przy backgroundThrottling:false strona zawsze „widzi się” jako widoczna — więc stan okna podajemy sami
       (powiadomienia na pulpicie i push na telefon zależą od tego, czy GibCord jest na ekranie). */
    const sendWinState = () => { if (win && !win.isDestroyed()) send('window', winState()); };
    for (const ev of ['show', 'hide', 'minimize', 'restore', 'focus', 'blur', 'enter-full-screen', 'leave-full-screen', 'enter-html-full-screen', 'leave-html-full-screen']) win.on(ev, sendWinState);
    wc.on('did-finish-load', sendWinState);
    win.on('close', e => {
      if (quitting || !store.get().closeToTray) return;
      e.preventDefault();
      win.hide();
      if (!store.get().trayHintShown) {
        store.set({ trayHintShown: true });
        if (tray && IS_WIN) tray.displayBalloon({ title: 'GibCord działa w tle', content: 'Rozmowy i powiadomienia działają dalej. Kliknij ikonę obok zegara, żeby wrócić.', iconType: 'info' });
      }
    });
    win.on('closed', () => { win = null; rendererReady = false; });

    /* nawigacja: tylko GibCord w oknie, reszta w przeglądarce */
    wc.on('will-navigate', (e, url) => { if (allowed(url)) return; e.preventDefault(); openExternal(url); });
    wc.on('will-redirect', (e, url) => { if (!allowed(url)) { e.preventDefault(); openExternal(url); } });
    wc.on('did-navigate', () => { rendererReady = false; });
    wc.setWindowOpenHandler(({ url }) => {
      if (allowed(url)) {
        const p = appPathFor(url, ORIGINS);
        if (p) { routeToApp(p); return { action: 'deny' }; }
        return { action: 'allow', overrideBrowserWindowOptions: viewerWindowOptions() };
      }
      openExternal(url);
      return { action: 'deny' };
    });
    wc.on('did-create-window', child => guardViewer(child));

    /* brak internetu / serwera */
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      if (!isMainFrame || code === -3) return; // -3: przerwane (np. przekierowanie)
      log.warn(`Nie udało się wczytać ${url}: ${code} ${desc}`);
      if (!isOfflinePage(url)) win.loadFile(path.join(__dirname, 'offline.html'), { query: { u: ORIGIN, e: String(desc || code) } });
    });
    wc.on('render-process-gone', (_e, d) => { log.error('Proces strony padł', d); if (d.reason !== 'clean-exit' && win) setTimeout(() => win && win.loadURL(ORIGIN), 1000); });

    /* skróty klawiszowe okna */
    wc.on('before-input-event', (e, input) => {
      if (input.type !== 'keyDown') return;
      const ctrl = input.control || input.meta;
      const k = input.key;
      if (k === 'F5' || (ctrl && k.toLowerCase() === 'r')) { e.preventDefault(); input.shift ? wc.reloadIgnoringCache() : wc.reload(); }
      else if (k === 'F11') { e.preventDefault(); win.setFullScreen(!win.isFullScreen()); }
      else if (ctrl && (k === '=' || k === '+')) { e.preventDefault(); setZoom(wc.getZoomLevel() + 0.5); }
      else if (ctrl && k === '-') { e.preventDefault(); setZoom(wc.getZoomLevel() - 0.5); }
      else if (ctrl && k === '0') { e.preventDefault(); setZoom(0); }
      else if (DEVTOOLS && ((ctrl && input.shift && k.toLowerCase() === 'i') || k === 'F12')) { e.preventDefault(); wc.toggleDevTools(); }
    });
    const setZoom = z => { z = Math.max(-3, Math.min(4, z)); wc.setZoomLevel(z); store.set({ zoom: z }); applyTitleBar(); };
    wc.on('did-finish-load', () => { const z = store.get().zoom; if (z) wc.setZoomLevel(z); });

    /* menu pod prawym przyciskiem (tylko tam, gdzie strona nie ma własnego) */
    wc.on('context-menu', (_e, p) => {
      const items = [];
      if (p.misspelledWord && p.dictionarySuggestions.length) { for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) }); items.push({ type: 'separator' }); }
      if (p.linkURL && /^https?:/i.test(p.linkURL)) items.push({ label: 'Otwórz link w przeglądarce', click: () => openExternal(p.linkURL) }, { label: 'Kopiuj link', click: () => clipboard.writeText(p.linkURL) }, { type: 'separator' });
      if (p.mediaType === 'image' && p.srcURL) items.push({ label: 'Kopiuj obraz', click: () => wc.copyImageAt(p.x, p.y) }, { label: 'Zapisz obraz…', click: () => wc.downloadURL(p.srcURL) }, { type: 'separator' });
      if (p.isEditable) items.push({ label: 'Cofnij', role: 'undo', enabled: p.editFlags.canUndo }, { label: 'Ponów', role: 'redo', enabled: p.editFlags.canRedo }, { type: 'separator' }, { label: 'Wytnij', role: 'cut', enabled: p.editFlags.canCut }, { label: 'Kopiuj', role: 'copy', enabled: p.editFlags.canCopy }, { label: 'Wklej', role: 'paste', enabled: p.editFlags.canPaste }, { type: 'separator' }, { label: 'Zaznacz wszystko', role: 'selectAll' });
      else if (p.selectionText && p.selectionText.trim()) items.push({ label: 'Kopiuj', role: 'copy' });
      while (items.length && items[items.length - 1].type === 'separator') items.pop();
      if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
    });

    win.loadURL(ORIGIN);
    return win;
  }
  const winState = () => ({ visible: !!(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized()), focused: !!(win && !win.isDestroyed() && win.isFocused()), fullscreen: !!(win && !win.isDestroyed() && win.isFullScreen()) });
  const isOfflinePage = url => typeof url === 'string' && url.startsWith('file:') && url.split('?')[0].endsWith('/offline.html');

  /* podgląd plików z GibCorda (np. „Otwórz oryginał”) — osobne okno bez dostępu do aplikacji */
  function viewerWindowOptions() {
    // Okno podglądu dziedziczy sesję; most do aplikacji i tak odrzuca wiadomości spoza głównego okna (fromApp).
    return { width: 1000, height: 760, autoHideMenuBar: true, backgroundColor: '#111', icon: windowIcon(), webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: DEVTOOLS } };
  }
  function guardViewer(child) {
    child.setMenu(null);
    const cwc = child.webContents;
    cwc.on('will-navigate', (e, url) => { if (!allowed(url)) { e.preventDefault(); openExternal(url); } });
    cwc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  }

  /* ---------- linki gibcord:// i linki do GibCorda ---------- */
  function routeToApp(p) {
    showWindow();
    if (rendererReady) send('deeplink', p); else pendingPaths.push(p);
  }
  function handleDeepLink(url) {
    const p = parseDeepLink(url);
    log.info(`Link ${url} → ${p || '(nieznany)'}`);
    if (p) routeToApp(p); else showWindow();
  }
  app.on('second-instance', (_e, argv) => {
    const link = findDeepLinkArg(argv);
    if (link) handleDeepLink(link); else showWindow();
  });

  /* ---------- zasobnik (obok zegara) ---------- */
  function trayImage() {
    const unread = badge.count > 0 || badge.dot;
    return nativeImage.createFromPath(asset(IS_WIN ? (unread ? 'tray-unread.ico' : 'tray.ico') : (unread ? 'tray-unread.png' : 'tray.png')));
  }
  function autostartOn() { if (IS_STORE) return false; try { return app.getLoginItemSettings({ args: ['--autostart'] }).openAtLogin; } catch { return false; } }
  function setAutostart(on) {
    if (!app.isPackaged) { log.info('Autostart pominięty (wersja deweloperska)'); return; }
    if (IS_STORE) { shell.openExternal(STARTUP_SETTINGS); return; }
    app.setLoginItemSettings({ openAtLogin: !!on, args: ['--autostart'] });
  }
  function buildTrayMenu() {
    if (!tray) return;
    const items = [
      { label: 'Otwórz GibCord', click: showWindow },
      { type: 'separator' },
      { label: 'Wycisz mikrofon', type: 'checkbox', checked: voice.muted, click: () => send('tray', 'mute') },
      { label: 'Wygłusz (nic nie słyszę)', type: 'checkbox', checked: voice.deaf, click: () => send('tray', 'deaf') },
      { type: 'separator' },
      IS_STORE ? { label: 'Uruchamianie z Windows… (Ustawienia)', click: () => shell.openExternal(STARTUP_SETTINGS) }
        : { label: 'Uruchamiaj razem z Windows', type: 'checkbox', checked: autostartOn(), enabled: app.isPackaged, click: i => { setAutostart(i.checked); buildTrayMenu(); } },
      { label: 'Ustawienia aplikacji', click: () => { showWindow(); send('tray', 'settings'); } },
      update.state === 'downloaded'
        ? { label: `Uruchom ponownie i zaktualizuj (${update.version})`, click: installUpdate }
        : { label: update.state === 'checking' || update.state === 'downloading' ? 'Sprawdzam aktualizacje…' : 'Sprawdź aktualizacje', enabled: app.isPackaged && update.state !== 'checking' && update.state !== 'downloading', click: () => checkUpdates(true) },
      { type: 'separator' },
      { label: 'Zakończ GibCord', click: () => { quitting = true; app.quit(); } },
    ];
    tray.setContextMenu(Menu.buildFromTemplate(items));
    const n = badge.count;
    tray.setToolTip(n ? `GibCord — ${n} ${n === 1 ? 'nowe oznaczenie' : 'nowych oznaczeń'}` : badge.dot ? 'GibCord — nieprzeczytane wiadomości' : 'GibCord');
  }
  function createTray() {
    tray = new Tray(trayImage());
    tray.on('click', () => { if (win && win.isVisible() && win.isFocused()) win.hide(); else showWindow(); });
    tray.on('balloon-click', showWindow);
    buildTrayMenu();
  }

  /* ---------- licznik na pasku zadań ---------- */
  function applyBadge() {
    if (tray) { tray.setImage(trayImage()); buildTrayMenu(); }
    if (!win || win.isDestroyed()) return;
    if (IS_WIN) {
      const n = badge.count;
      if (n > 0) win.setOverlayIcon(nativeImage.createFromPath(asset('badges', n > 9 ? '9plus.png' : `${n}.png`)), n === 1 ? '1 nowe oznaczenie' : `${n} nowych oznaczeń`);
      else win.setOverlayIcon(null, '');
    } else app.setBadgeCount(badge.count);
  }

  /* ---------- naciśnij, by mówić (globalnie) ---------- */
  let hook = null, hookKeys = null, hookOn = false, hookStopT = null, binding = null, pttHeld = false, pttLastSent = 0;
  function loadHook() {
    if (hook !== null) return hook;
    try { const m = require('uiohook-napi'); hook = m.uIOhook; hookKeys = m.UiohookKey; }
    catch (e) { log.error('Nie udało się wczytać uiohook-napi — „naciśnij, by mówić” zadziała tylko w aktywnym oknie', e); hook = false; return false; }
    const down = kind => ev => {
      if (!matches(binding, ev, kind)) return;
      const t = Date.now();
      if (!pttHeld || t - pttLastSent > 250) { pttHeld = true; pttLastSent = t; send('ptt', { down: true }); }
    };
    const up = kind => ev => { if (!matches(binding, ev, kind)) return; if (pttHeld) { pttHeld = false; send('ptt', { down: false }); } };
    hook.on('keydown', down('key')); hook.on('keyup', up('key'));
    hook.on('mousedown', down('mouse')); hook.on('mouseup', up('mouse'));
    return hook;
  }
  function refreshHook() {
    const want = voice.inCall && voice.ptt.enabled && !!voice.ptt.code;
    if (want) {
      if (!loadHook()) return;
      binding = resolveBinding(voice.ptt.code, hookKeys);
      if (!binding) { log.warn(`Klawisza ${voice.ptt.code} nie da się przechwycić globalnie`); return; }
      clearTimeout(hookStopT); hookStopT = null;
      if (!hookOn) { try { hook.start(); hookOn = true; log.info(`PTT globalnie: ${voice.ptt.code}`); } catch (e) { log.error('uiohook start', e); } }
    } else {
      if (pttHeld) { pttHeld = false; send('ptt', { down: false }); }
      if (hookOn && !hookStopT) hookStopT = setTimeout(() => { hookStopT = null; if (!hookOn) return; try { hook.stop(); } catch (e) { log.warn('uiohook stop', e); } hookOn = false; log.info('PTT globalnie wyłączone'); }, 5000);
    }
  }

  /* ---------- wykrywanie gier ---------- */
  const GAME_CACHE = path.join(app.getPath('userData'), 'games-cache.json');
  let gameList = [], gameListAt = 0, gameTimer = null, scanning = false;
  try { const c = JSON.parse(fs.readFileSync(GAME_CACHE, 'utf8')); gameList = games.normalizeGames(c.games); } catch {}
  async function refreshGameList() {
    try {
      const ses = session.fromPartition('persist:gibcord');
      const r = await ses.fetch(`${ORIGIN}/api/games/detectable`, { headers: { accept: 'application/json' }, credentials: 'include' });
      gameListAt = Date.now();
      if (r.status === 404) { log.info('Serwer nie ma jeszcze listy gier (404)'); return; }
      if (!r.ok) { log.warn(`Lista gier: HTTP ${r.status}`); return; }
      const j = await r.json();
      const list = Array.isArray(j) ? j : j && Array.isArray(j.games) ? j.games : [];
      gameList = games.normalizeGames(list);
      fs.writeFileSync(GAME_CACHE, JSON.stringify({ at: Date.now(), games: list }));
      log.info(`Lista gier: ${gameList.length}`);
    } catch (e) { gameListAt = Date.now() - 5.5 * 3600e3; log.warn('Lista gier', e.message); } // ponów za ~30 min
  }
  const run = (cmd, args) => new Promise(res => execFile(cmd, args, { windowsHide: true, timeout: 10000, maxBuffer: 8 * 1024 * 1024 }, (err, out) => res(err ? '' : String(out))));
  async function scanGames() {
    if (scanning) return; scanning = true;
    try {
      if (!store.get().gameDetection) { setGame(null); return; }
      if (Date.now() - gameListAt > 6 * 3600e3) await refreshGameList();
      if (!gameList.length) { setGame(null); return; }
      const rows = games.parseTasklist(await run('tasklist', ['/fo', 'csv', '/nh']), false);
      const running = new Set(rows.map(r => r.exe));
      const titles = new Map();
      for (const exe of games.exesNeedingTitles(gameList, running).slice(0, 5)) {
        const v = games.parseTasklist(await run('tasklist', ['/v', '/fo', 'csv', '/nh', '/fi', `IMAGENAME eq ${exe}`]), true);
        titles.set(exe, v.map(r => r.title).filter(Boolean));
      }
      setGame(games.pickGame(gameList, running, titles, currentGame));
    } catch (e) { log.warn('Wykrywanie gier', e); } finally { scanning = false; }
  }
  function setGame(g) {
    const next = g ? { id: g.id, name: g.name, startedAt: currentGame && currentGame.name === g.name ? currentGame.startedAt : Date.now() } : null;
    if ((next && next.name) === (currentGame && currentGame.name)) return;
    currentGame = next;
    log.info(next ? `Gra: ${next.name}` : 'Gra: brak');
    send('game', currentGame);
  }
  function startGameDetection() {
    if (!IS_WIN || gameTimer) return;
    gameTimer = setInterval(scanGames, 15000);
    setTimeout(scanGames, 8000);
  }

  /* ---------- muzyka: co gra w Spotify (lib/music.js) ---------- */
  let currentMusic = null, musicProc = null, musicRestarts = [], musicTimer = null;
  const tracker = music.createTracker();
  function setMusic(m) {
    if (m === undefined) return;
    currentMusic = m;
    log.info(m ? `Muzyka: ${m.artists} - ${m.title}${m.startedAt ? '' : ' (bez pozycji)'}` : 'Muzyka: brak');
    send('music', currentMusic);
  }
  function startMusic() {
    if (!IS_WIN || musicProc || !store.get().musicDetection) return;
    let child;
    try {
      child = spawn('powershell.exe', music.helperArgs(), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIBCORD_PARENT_PID: String(process.pid) } });
    } catch (e) { log.warn('Muzyka: nie da się uruchomić PowerShell', e.message); return; }
    musicProc = child;
    // pomocnik nie trzyma procesu przy życiu (Electron i tak decyduje sam; w testach node by czekał bez końca)
    try { child.unref(); child.stdout.unref?.(); child.stderr.unref?.(); } catch {}
    let buf = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', d => {
      buf += d; if (buf.length > 1e5) buf = '';
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        let j; try { j = JSON.parse(line); } catch { continue; }
        if (j.ready) { log.info(`Muzyka: pomocnik działa (${j.smtc ? 'sterowanie multimediami Windows' : 'tytuł okna'})`); continue; }
        setMusic(tracker.update(music.parseSample(j)));
      }
    });
    child.stderr.on('data', d => log.warn('Muzyka (PowerShell):', String(d).slice(0, 300)));
    child.on('error', e => log.warn('Muzyka: PowerShell', e.message));
    child.on('exit', code => {
      if (musicProc === child) musicProc = null;
      if (quitting || !store.get().musicDetection) return;
      const now = Date.now(); musicRestarts = musicRestarts.filter(t => now - t < 3600e3);
      if (musicRestarts.length >= 5) { log.warn(`Muzyka: pomocnik kończy się za często (kod ${code}), wyłączam do restartu aplikacji`); setMusic(tracker.reset()); return; }
      musicRestarts.push(now);
      clearTimeout(musicTimer); musicTimer = setTimeout(startMusic, 30000);
    });
  }
  function stopMusic() {
    clearTimeout(musicTimer);
    const p = musicProc; musicProc = null;
    if (p) try { p.kill(); } catch {}
    setMusic(tracker.reset());
  }

  /* ---------- aktualizacje ---------- */
  let updater = null;
  function setupUpdater() {
    if (IS_STORE) { log.info('Wersja ze Sklepu — aktualizacje przez Microsoft Store'); return; }
    if (!app.isPackaged && !process.env.GIBCORD_UPDATE_FEED) return;
    try { updater = require('electron-updater').autoUpdater; } catch (e) { log.error('electron-updater', e); return; }
    updater.logger = { info: m => log.info('[aktualizacje]', String(m)), warn: m => log.warn('[aktualizacje]', String(m)), error: m => log.error('[aktualizacje]', String(m)), debug: () => {} };
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    if (process.env.GIBCORD_UPDATE_FEED) updater.setFeedURL({ provider: 'generic', url: process.env.GIBCORD_UPDATE_FEED });
    const set = (state, extra = {}) => { Object.assign(update, { state, error: null }, extra); buildTrayMenu(); send('update', { ...update }); };
    updater.on('checking-for-update', () => set('checking'));
    updater.on('update-available', i => set('downloading', { version: i && i.version }));
    updater.on('update-not-available', () => set('none'));
    updater.on('download-progress', p => { update.percent = Math.round(p.percent || 0); });
    updater.on('update-downloaded', i => {
      set('downloaded', { version: i && i.version });
      if (Notification.isSupported() && win && !win.isVisible()) {
        const n = new Notification({ title: 'Nowa wersja GibCorda', body: `Wersja ${i.version} zainstaluje się przy następnym uruchomieniu.`, icon: asset('icon.png') });
        n.on('click', showWindow); n.show();
      }
    });
    updater.on('error', e => set('error', { error: String(e && e.message || e).slice(0, 200) }));
    setTimeout(() => checkUpdates(false), 15000);
    setInterval(() => checkUpdates(false), 4 * 3600e3);
  }
  async function checkUpdates(manual) {
    if (!updater) return { ...update, state: 'unavailable' };
    if (update.state === 'downloaded') return { ...update };
    try { await updater.checkForUpdates(); } catch (e) { log.warn('checkForUpdates', e && e.message); if (manual) update.state = 'error'; }
    return { ...update };
  }
  function installUpdate() {
    if (!updater || update.state !== 'downloaded') return;
    quitting = true;
    store.flushNow();
    setImmediate(() => updater.quitAndInstall(true, true));
  }

  /* ---------- komunikacja ze stroną (preload) ---------- */
  ipcMain.on('app:info', e => { e.returnValue = fromApp(e) ? { version: app.getVersion(), platform: process.platform, arch: process.arch, packaged: app.isPackaged, titleBar: TITLEBAR } : null; });
  // pasek okna: GibCord i strona „brak połączenia” w głównym oknie
  ipcMain.on('titlebar:info', e => {
    const url = e && e.senderFrame && e.senderFrame.url;
    const ok = TITLEBAR && win && !win.isDestroyed() && e.sender === win.webContents && (allowed(url) || isOfflinePage(url));
    const s = store.get();
    e.returnValue = ok ? { height: TB_H, bg: s.tbBg, fg: s.tbFg, icon: titleBarIcon(), fullscreen: win.isFullScreen() } : null;
  });
  // motyw się zmienił → przyciski okna, tło przy ładowaniu i ramki innych okien w tym samym kolorze
  ipcMain.on('titlebar', (e, c) => {
    if (!TITLEBAR || !fromApp(e) || !c || typeof c !== 'object' || typeof c.bg !== 'string' || typeof c.fg !== 'string' || !HEX.test(c.bg) || !HEX.test(c.fg)) return;
    const bg = c.bg.toLowerCase(), fg = c.fg.toLowerCase(), s = store.get();
    if (bg === s.tbBg && fg === s.tbFg) return;
    store.set({ tbBg: bg, tbFg: fg });
    try { win.setBackgroundColor(bg); } catch {}
    applyTitleBar(); syncNativeTheme();
  });
  ipcMain.on('deeplink:ready', e => { if (!fromApp(e)) return; rendererReady = true; while (pendingPaths.length) send('deeplink', pendingPaths.shift()); });
  ipcMain.on('badge', (e, d) => {
    if (!fromApp(e) || !d) return;
    const count = Math.max(0, Math.min(9999, Math.floor(+d.count || 0))), dot = !!d.dot;
    if (count === badge.count && dot === badge.dot) return;
    badge.count = count; badge.dot = dot; applyBadge();
  });
  ipcMain.on('flash', e => { if (fromApp(e) && win && !win.isFocused()) win.flashFrame(true); });
  ipcMain.on('focus', e => { if (fromApp(e)) showWindow(); });
  ipcMain.on('voice', (e, s) => {
    if (!fromApp(e) || !s || typeof s !== 'object') return;
    const p = s.ptt && typeof s.ptt === 'object' ? s.ptt : {};
    const next = { inCall: !!s.inCall, muted: !!s.muted, deaf: !!s.deaf, ptt: { enabled: !!p.enabled, code: typeof p.code === 'string' ? p.code.slice(0, 32) : '' } };
    const menuChanged = next.muted !== voice.muted || next.deaf !== voice.deaf;
    Object.assign(voice, next);
    refreshHook();
    if (menuChanged) buildTrayMenu();
  });
  ipcMain.handle('state', e => fromApp(e) ? { game: currentGame, music: currentMusic, update: { ...update }, settings: publicSettings(), window: winState() } : null);
  ipcMain.handle('update:check', e => fromApp(e) ? checkUpdates(true) : null);
  ipcMain.on('update:install', e => { if (fromApp(e)) installUpdate(); });
  function publicSettings() { const s = store.get(); return { autostart: autostartOn(), autostartAvailable: app.isPackaged && !IS_STORE, store: IS_STORE, startMinimized: s.startMinimized, closeToTray: s.closeToTray, gameDetection: s.gameDetection, gameDetectionAvailable: IS_WIN, musicDetection: s.musicDetection, musicDetectionAvailable: IS_WIN }; }
  ipcMain.handle('settings:get', e => fromApp(e) ? publicSettings() : null);
  ipcMain.handle('settings:set', (e, p) => {
    if (!fromApp(e) || !p || typeof p !== 'object') return null;
    const patch = {};
    for (const k of ['startMinimized', 'closeToTray', 'gameDetection', 'musicDetection']) if (typeof p[k] === 'boolean') patch[k] = p[k];
    store.set(patch);
    if (typeof p.autostart === 'boolean') setAutostart(p.autostart);
    if ('gameDetection' in patch) { if (patch.gameDetection) setTimeout(scanGames, 500); else setGame(null); }
    if ('musicDetection' in patch) { if (patch.musicDetection) { musicRestarts = []; startMusic(); } else stopMusic(); }
    buildTrayMenu();
    return publicSettings();
  });

  /* ---------- start ---------- */
  app.on('before-quit', () => { quitting = true; store.flushNow(); });
  app.on('will-quit', () => { try { if (hookOn) hook.stop(); } catch {} try { if (musicProc) musicProc.kill(); } catch {} });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin' && quitting) app.quit(); });
  app.on('activate', showWindow);

  app.whenReady().then(() => {
    appReady = true;
    Menu.setApplicationMenu(null);
    syncNativeTheme();
    setupSession(session.fromPartition('persist:gibcord'));
    // Pierwsze uruchomienie zainstalowanej aplikacji: włącz autostart (jak Discord). Później decyduje użytkownik.
    if (app.isPackaged && !IS_STORE && !store.get().autostartInit) { setAutostart(true); store.set({ autostartInit: true }); }
    createWindow();
    createTray();
    const link = findDeepLinkArg(process.argv);
    if (link) handleDeepLink(link);
    startGameDetection();
    setTimeout(startMusic, 6000);
    setupUpdater();
  });
}
