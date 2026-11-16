/*
 * Test procesu głównego (src/main.js) na atrapie Electrona — bez ekranu, działa też na serwerze i w CI.
 * Udajemy Windows (process.platform = 'win32'), zainstalowaną aplikację (app.isPackaged) i sterujemy zegarem.
 */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import Module, { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = path.join(import.meta.dirname, '..');
const MAIN = path.join(ROOT, 'src', 'main.js');
const ORIGIN = 'https://gibcord.luisboon.pl';
const tick = () => new Promise(r => setImmediate(r));

/* ---------------- atrapa Electrona ---------------- */
const USER_DATA = mkdtempSync(path.join(tmpdir(), 'gc-main-'));
const calls = { external: [], login: [], quitAndInstall: 0, hookStart: 0, hookStop: 0, balloons: [], menus: [] };
const ev = () => ({ defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } });

class WebContents extends EventEmitter {
  constructor() { super(); this.sent = []; this.zoom = 0; this.openHandler = null; }
  send(ch, data) { this.sent.push([ch, data]); }
  setWindowOpenHandler(fn) { this.openHandler = fn; }
  reload() {} reloadIgnoringCache() {} toggleDevTools() {} replaceMisspelling() {} copyImageAt() {} downloadURL() {}
  getZoomLevel() { return this.zoom; } setZoomLevel(z) { this.zoom = z; }
  lastSent(ch) { const l = this.sent.filter(s => s[0] === ch); return l.length ? l[l.length - 1][1] : undefined; }
}
const windows = [];
class BrowserWindow extends EventEmitter {
  constructor(opts) { super(); this.opts = opts; this.webContents = new WebContents(); this.visible = false; this.destroyed = false; this.loaded = []; this.overlay = undefined; this.flashed = false; windows.push(this); }
  setMenu() {} maximize() {} restore() {} focus() { this.focused = true; } setFullScreen() {}
  isMaximized() { return false; } isMinimized() { return false; } isFullScreen() { return false; } isFocused() { return !!this.focused; }
  isVisible() { return this.visible; } isDestroyed() { return this.destroyed; }
  show() { this.visible = true; } hide() { this.visible = false; this.focused = false; }
  getBounds() { return { x: 10, y: 10, width: 1200, height: 800 }; }
  flashFrame(on) { this.flashed = on; }
  setTitleBarOverlay(o) { this.tbo = o; } setBackgroundColor(c) { this.bgc = c; }
  setOverlayIcon(img, desc) { this.overlay = img ? img.path : null; this.overlayDesc = desc; }
  loadURL(u) { this.loaded.push(u); } loadFile(f, o) { this.loaded.push({ file: f, query: o && o.query }); }
  setAlwaysOnTop(on, level) { this.aot = [on, level]; } setIgnoreMouseEvents(v) { this.ignoreMouse = v; }
  showInactive() { this.visible = true; this.inactive = true; } setBounds(b) { this.bounds = b; }
  close() { const e = ev(); this.emit('close', e); if (!e.defaultPrevented) { this.destroyed = true; this.emit('closed'); } }
}
let tray = null;
class Tray extends EventEmitter {
  constructor(img) { super(); this.img = img.path; tray = this; }
  setContextMenu(m) { this.menu = m; } setToolTip(t) { this.tip = t; } setImage(img) { this.img = img.path; }
  displayBalloon(o) { calls.balloons.push(o); }
}
const handlers = new Map();
const ipcMain = Object.assign(new EventEmitter(), {
  handle(ch, fn) { if (handlers.has(ch)) throw new Error('drugi handler ' + ch); handlers.set(ch, fn); },
  removeHandler(ch) { handlers.delete(ch); },
});
const ses = Object.assign(new EventEmitter(), {
  setPermissionRequestHandler(fn) { this.req = fn; }, setPermissionCheckHandler(fn) { this.check = fn; }, setDisplayMediaRequestHandler(fn) { this.display = fn; },
  fetched: [],
  async fetch(url) { this.fetched.push(url); return { ok: true, status: 200, json: async () => GAME_LIST }; },
});
const GAME_LIST = [{ id: 7, name: 'VALORANT', executables: ['valorant-win64-shipping.exe'] }, { id: 9, name: 'Minecraft', executables: ['javaw.exe'], titleHint: 'Minecraft' }];
const loginState = { openAtLogin: false };
const app = Object.assign(new EventEmitter(), {
  isPackaged: true,
  commandLine: { appendSwitch() {} },
  setName() {}, setAppUserModelId(id) { this.aumid = id; }, requestSingleInstanceLock: () => true, quit() { this.quitCalled = true; },
  getPath: () => USER_DATA, getVersion: () => '1.2.3', setAsDefaultProtocolClient(p) { this.protocol = p; return true; },
  getLoginItemSettings: () => ({ ...loginState }),
  setLoginItemSettings(o) { calls.login.push(o); loginState.openAtLogin = o.openAtLogin; },
  setBadgeCount() {},
  ready: null, whenReady() { return this.ready.promise; },
});
let resolveReady; app.ready = { promise: new Promise(r => { resolveReady = r; }) };
const electron = {
  app, BrowserWindow, Tray, ipcMain,
  Menu: { buildFromTemplate: items => { const m = { items, popup() { calls.menus.push(items); } }; return m; }, setApplicationMenu() {} },
  nativeImage: { createFromPath: p => ({ path: p, isEmpty: () => !existsSync(p), resize() { return this; }, toDataURL: () => 'data:image/png;base64,GIB' }) },
  nativeTheme: { themeSource: 'system' },
  shell: { openExternal: u => { calls.external.push(u); return Promise.resolve(); }, showItemInFolder() {} },
  session: { fromPartition: () => ses },
  desktopCapturer: { getSources: async () => [
    { id: 'screen:0:0', name: 'Entire screen', thumbnail: { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AA' }, appIcon: null },
    { id: 'window:42:0', name: 'VALORANT', thumbnail: { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,BB' }, appIcon: { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,CC' } },
  ] },
  screen: Object.assign(new EventEmitter(), { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }], getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1920, height: 1080 }, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }) }),
  globalShortcut: { keys: new Map(), register(k, fn) { this.keys.set(k, fn); return true; }, unregister(k) { this.keys.delete(k); }, unregisterAll() { this.keys.clear(); } },
  clipboard: { writeText() {} },
  Notification: Object.assign(class extends EventEmitter { show() {} }, { isSupported: () => true }),
};
const hook = Object.assign(new EventEmitter(), { start() { calls.hookStart++; }, stop() { calls.hookStop++; } });
const UiohookKey = { V: 47, Ctrl: 29, Space: 57 };
const updater = Object.assign(new EventEmitter(), { checks: 0, async checkForUpdates() { this.checks++; }, quitAndInstall() { calls.quitAndInstall++; }, setFeedURL() {} });
let tasklistOut = '"explorer.exe","1","Console","1","1 K"';
/* pomocnik muzyki (PowerShell): atrapa procesu — na prawdziwym Windows test nie może uruchamiać powershell.exe, bo proces trzymałby test bez końca */
const spawned = [];
const fakeSpawn = (cmd, args, opts) => {
  const ch = new EventEmitter();
  ch.stdout = Object.assign(new EventEmitter(), { setEncoding() {} });
  ch.stderr = new EventEmitter();
  ch.cmd = cmd; ch.args = args; ch.opts = opts; ch.killed = false;
  ch.kill = () => { ch.killed = true; setImmediate(() => ch.emit('exit', null)); };
  spawned.push(ch);
  return ch;
};
const fakeExecFile = (cmd, args, opts, cb) => { setImmediate(() => cb(null, args.includes('/v') ? '"javaw.exe","7","Console","1","9 K","Running","PC\\\\u","0:00:01","Minecraft 1.21"' : tasklistOut)); };

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electron;
  if (request === 'uiohook-napi') return { uIOhook: hook, UiohookKey };
  if (request === 'electron-updater') return { autoUpdater: updater };
  if (request === 'child_process' && parent && parent.filename === MAIN) return { ...origLoad.call(this, request, parent, isMain), execFile: fakeExecFile, spawn: fakeSpawn };
  return origLoad.apply(this, arguments);
};

test('proces główny GibCorda (atrapa Electrona, Windows)', async t => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  const realArgv = process.argv;
  process.argv = [process.execPath, 'GibCord.exe'];
  delete process.env.GIBCORD_URL; delete process.env.GIBCORD_UPDATE_FEED;
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  t.after(() => {
    mock.timers.reset(); Module._load = origLoad; process.argv = realArgv;
    Object.defineProperty(process, 'platform', realPlatform);
    rmSync(USER_DATA, { recursive: true, force: true });
  });

  require(MAIN);
  // link przed startem okna (np. kliknięty w przeglądarce, gdy aplikacja się uruchamia)
  app.emit('second-instance', ev(), ['GibCord.exe', 'gibcord://kanal/5/6']);
  resolveReady(); await tick(); await tick();

  const win = windows[0], wc = win.webContents;
  const fromApp = (url = ORIGIN + '/kanal/1/2') => ({ sender: wc, senderFrame: { url } });

  await t.test('start: okno, bezpieczne ustawienia, adres, protokół, autostart', () => {
    assert.equal(app.protocol, 'gibcord');
    assert.equal(app.aumid, 'pl.luisboon.gibcord');
    const wp = win.opts.webPreferences;
    assert.equal(wp.contextIsolation, true); assert.equal(wp.sandbox, true); assert.equal(wp.nodeIntegration, false);
    assert.equal(wp.partition, 'persist:gibcord'); assert.equal(wp.devTools, false);
    assert.ok(existsSync(wp.preload));
    assert.ok(existsSync(win.opts.icon), 'ikona okna istnieje');
    assert.deepEqual(win.loaded, [ORIGIN]);
    assert.deepEqual(calls.login, [{ openAtLogin: true, args: ['--autostart'] }], 'autostart włączony raz przy pierwszym uruchomieniu');
    assert.ok(tray && existsSync(tray.img) && tray.img.endsWith('tray.ico'));
    win.emit('ready-to-show'); assert.equal(win.visible, true);
  });

  await t.test('nawigacja: obce strony w przeglądarce, stary adres dozwolony', () => {
    const nav = url => { const e = ev(); wc.emit('will-navigate', e, url); return e.defaultPrevented; };
    calls.external.length = 0;
    assert.equal(nav(ORIGIN + '/kanal/1/2'), false);
    assert.equal(nav('https://dc.luisboon.pl/'), false);
    assert.equal(nav('https://accounts.spotify.com/authorize?x=1'), true);
    assert.equal(nav('file:///C:/Windows/win.ini'), true);
    assert.equal(nav('javascript:alert(1)'), true);
    assert.equal(nav('https://gibcord.luisboon.pl.evil.example/'), true);
    assert.deepEqual(calls.external, ['https://accounts.spotify.com/authorize?x=1', 'https://gibcord.luisboon.pl.evil.example/']);
    const r = ev(); wc.emit('will-redirect', r, 'https://evil.example/'); assert.equal(r.defaultPrevented, true);
  });

  await t.test('linki gibcord:// czekają, aż strona będzie gotowa', () => {
    assert.equal(wc.lastSent('deeplink'), undefined);
    ipcMain.emit('deeplink:ready', fromApp());
    assert.equal(wc.lastSent('deeplink'), '/kanal/5/6');
    app.emit('second-instance', ev(), ['GibCord.exe', '--x', 'gibcord://i/AbCd12']);
    assert.equal(wc.lastSent('deeplink'), '/i/AbCd12');
    const n = wc.sent.length;
    app.emit('second-instance', ev(), ['GibCord.exe', 'gibcord://cokolwiek/../../']);
    assert.equal(wc.sent.length, n, 'nieznany link nic nie wysyła');
    // po przeładowaniu strony znowu czekamy
    wc.emit('did-navigate');
    app.emit('second-instance', ev(), ['GibCord.exe', 'gibcord://dm/3']);
    assert.equal(wc.sent.length, n);
    ipcMain.emit('deeplink:ready', fromApp());
    assert.equal(wc.lastSent('deeplink'), '/dm/3');
  });

  await t.test('nowe okna: linki do GibCorda w aplikacji, pliki w podglądzie, reszta w przeglądarce', () => {
    calls.external.length = 0;
    assert.deepEqual(wc.openHandler({ url: 'https://dc.luisboon.pl/kanal/1/9' }), { action: 'deny' });
    assert.equal(wc.lastSent('deeplink'), '/kanal/1/9');
    const up = wc.openHandler({ url: ORIGIN + '/uploads/a/b.png' });
    assert.equal(up.action, 'allow'); assert.equal(up.overrideBrowserWindowOptions.webPreferences.sandbox, true);
    assert.deepEqual(wc.openHandler({ url: 'https://youtube.com/watch?v=x' }), { action: 'deny' });
    assert.deepEqual(wc.openHandler({ url: 'ms-settings:privacy' }), { action: 'deny' });
    assert.deepEqual(calls.external, ['https://youtube.com/watch?v=x']);
  });

  await t.test('most: odpowiada tylko GibCordowi z głównego okna', async () => {
    const e1 = fromApp(); ipcMain.emit('app:info', e1); assert.equal(e1.returnValue.version, '1.2.3');
    const e2 = fromApp('https://evil.example/'); ipcMain.emit('app:info', e2); assert.equal(e2.returnValue, null);
    const other = new WebContents(); const e3 = { sender: other, senderFrame: { url: ORIGIN } }; ipcMain.emit('app:info', e3); assert.equal(e3.returnValue, null);
    assert.equal(await handlers.get('settings:get')(fromApp('file:///C:/x/offline.html')), null);
    const s = await handlers.get('settings:get')(fromApp());
    assert.deepEqual(s, { autostart: true, autostartAvailable: true, startMinimized: true, closeToTray: true, gameDetection: true, gameDetectionAvailable: true, musicDetection: true, musicDetectionAvailable: true, overlay: true, overlayMode: 'game', overlayCorner: 'tl', overlaySize: 'm', overlayHotkey: 'Ctrl + Shift + O', overlayAvailable: true, store: false });
  });

  await t.test('pasek okna w kolorze motywu: przyciski systemowe, kolor ze strony, powiększenie', () => {
    assert.equal(win.opts.titleBarStyle, 'hidden');
    assert.deepEqual(win.opts.titleBarOverlay, { color: '#1b1531', symbolColor: '#f6f2fb', height: 30 });
    assert.equal(win.opts.backgroundColor, '#1b1531');
    assert.equal(electron.nativeTheme.themeSource, 'dark');
    const info = (url, sender = wc) => { const e = { sender, senderFrame: { url } }; ipcMain.emit('titlebar:info', e); return e.returnValue; };
    assert.deepEqual(info(ORIGIN + '/'), { height: 30, bg: '#1b1531', fg: '#f6f2fb', icon: 'data:image/png;base64,GIB', fullscreen: false });
    assert.equal(info('file:///C:/GibCord/resources/app.asar/src/offline.html?u=x').height, 30, 'strona „brak połączenia” też ma pasek');
    assert.equal(info('https://evil.example/'), null);
    assert.equal(info(ORIGIN, new WebContents()), null, 'tylko główne okno');
    // motyw „Jasny”
    ipcMain.emit('titlebar', fromApp(), { bg: '#F5F2F9', fg: '#1f1b2b' });
    assert.deepEqual(win.tbo, { color: '#f5f2f9', symbolColor: '#1f1b2b', height: 30 });
    assert.equal(win.bgc, '#f5f2f9'); assert.equal(electron.nativeTheme.themeSource, 'light');
    assert.equal(info(ORIGIN).bg, '#f5f2f9', 'zapamiętany na następny start');
    // śmieci i obce strony nic nie zmieniają
    win.tbo = null;
    ipcMain.emit('titlebar', fromApp(), { bg: 'red; x', fg: '#000000' });
    ipcMain.emit('titlebar', fromApp('https://evil.example/'), { bg: '#000000', fg: '#ffffff' });
    ipcMain.emit('titlebar', fromApp(), null);
    ipcMain.emit('titlebar', fromApp(), { bg: { toString: () => '#000000' }, fg: '#ffffff' });
    assert.equal(win.tbo, null);
    // Ctrl + : pasek rośnie razem ze stroną
    const key = k => wc.emit('before-input-event', ev(), { type: 'keyDown', key: k, control: true });
    key('='); assert.equal(win.tbo.height, Math.round(30 * Math.pow(1.2, 0.5)));
    key('0'); assert.equal(win.tbo.height, 30);
    ipcMain.emit('titlebar', fromApp(), { bg: '#1b1531', fg: '#f6f2fb' });
    assert.equal(electron.nativeTheme.themeSource, 'dark');
  });

  await t.test('uprawnienia: mikrofon i ekran tylko dla GibCorda', () => {
    const ask = (perm, url) => { let r; ses.req(wc, perm, v => { r = v; }, { requestingUrl: url }); return r; };
    assert.equal(ask('media', ORIGIN + '/kanal/1/2'), true);
    assert.equal(ask('notifications', 'https://dc.luisboon.pl/'), true);
    assert.equal(ask('media', 'https://evil.example/'), false);
    assert.equal(ask('geolocation', ORIGIN), false);
    assert.equal(ses.check(wc, 'media', ORIGIN), true);
    assert.equal(ses.check(wc, 'media', 'https://evil.example'), false);
  });

  await t.test('licznik na ikonie i w zasobniku', () => {
    ipcMain.emit('badge', fromApp(), { count: 3, dot: false });
    assert.ok(win.overlay.endsWith(path.join('badges', '3.png')) && existsSync(win.overlay));
    assert.ok(tray.img.endsWith('tray-unread.ico'));
    ipcMain.emit('badge', fromApp(), { count: 27 });
    assert.ok(win.overlay.endsWith('9plus.png'));
    ipcMain.emit('badge', fromApp(), { count: 0, dot: true });
    assert.equal(win.overlay, null); assert.ok(tray.img.endsWith('tray-unread.ico'));
    ipcMain.emit('badge', fromApp(), { count: 0, dot: false });
    assert.ok(tray.img.endsWith('tray.ico'));
    ipcMain.emit('badge', fromApp('https://evil.example/'), { count: 5 });
    assert.equal(win.overlay, null);
    win.focused = false; ipcMain.emit('flash', fromApp()); assert.equal(win.flashed, true);
    win.emit('focus'); assert.equal(win.flashed, false);
  });

  await t.test('naciśnij, by mówić: hak tylko w rozmowie, wciśnięcie i puszczenie', () => {
    const ptt = () => wc.sent.filter(s => s[0] === 'ptt').map(s => s[1].down);
    ipcMain.emit('voice', fromApp(), { inCall: false, ptt: { enabled: true, code: 'KeyV' } });
    assert.equal(calls.hookStart, 0, 'poza rozmową bez haka');
    ipcMain.emit('voice', fromApp(), { inCall: true, muted: false, ptt: { enabled: true, code: 'KeyV' } });
    assert.equal(calls.hookStart, 1);
    hook.emit('keydown', { keycode: 30 });
    hook.emit('keydown', { keycode: 47 });
    hook.emit('keydown', { keycode: 47 }); // auto-powtarzanie: nie spamujemy
    mock.timers.tick(300);
    hook.emit('keydown', { keycode: 47 }); // …ale co 250 ms przypominamy (po utracie fokusu strona puszcza klawisz)
    hook.emit('keyup', { keycode: 47 });
    hook.emit('keyup', { keycode: 47 });
    assert.deepEqual(ptt(), [true, true, false]);
    ipcMain.emit('voice', fromApp(), { inCall: true, ptt: { enabled: true, code: 'Mouse4' } });
    hook.emit('mousedown', { button: 4 }); hook.emit('mouseup', { button: 4 });
    assert.deepEqual(ptt().slice(-2), [true, false]);
    ipcMain.emit('voice', fromApp(), { inCall: false, ptt: { enabled: true, code: 'Mouse4' } });
    mock.timers.tick(4000); assert.equal(calls.hookStop, 0);
    ipcMain.emit('voice', fromApp(), { inCall: true, ptt: { enabled: true, code: 'KeyV' } }); // wrócił przed upływem 5 s
    mock.timers.tick(6000); assert.equal(calls.hookStop, 0); assert.equal(calls.hookStart, 1);
    ipcMain.emit('voice', fromApp(), { inCall: false, ptt: { enabled: false, code: 'KeyV' } });
    mock.timers.tick(5100); assert.equal(calls.hookStop, 1);
  });

  await t.test('menu w zasobniku: wyciszenie i stan', () => {
    ipcMain.emit('voice', fromApp(), { inCall: true, muted: true, deaf: false, ptt: { enabled: false, code: '' } });
    const items = tray.menu.items;
    const mute = items.find(i => i.label === 'Wycisz mikrofon');
    assert.equal(mute.checked, true);
    mute.click(); assert.equal(wc.lastSent('tray'), 'mute');
    items.find(i => (i.label || '').startsWith('Wygłusz')).click(); assert.equal(wc.lastSent('tray'), 'deaf');
    assert.ok(items.some(i => i.label === 'Zakończ GibCord'));
  });

  await t.test('udostępnianie ekranu: własne okno wyboru, dźwięk komputera, anulowanie', async () => {
    let got;
    ses.display({ securityOrigin: 'https://evil.example', audioRequested: true }, s => { got = s; });
    assert.deepEqual(got, {});
    got = undefined;
    ses.display({ securityOrigin: ORIGIN, audioRequested: true, frame: { url: ORIGIN + '/kanal/1/2' } }, s => { got = s; });
    const picker = windows[windows.length - 1];
    assert.ok(picker.opts.webPreferences.preload.endsWith('picker-preload.js'));
    assert.ok(picker.loaded[0].file.endsWith('picker.html') && existsSync(picker.loaded[0].file));
    assert.equal(await handlers.get('picker:list')({ sender: wc }), null, 'główne okno nie czyta listy');
    const list = await handlers.get('picker:list')({ sender: picker.webContents });
    assert.equal(list.audio, true); assert.deepEqual(list.sources.map(s => s.kind), ['screen', 'window']);
    ipcMain.emit('picker:choose', { sender: picker.webContents }, { id: 'window:42:0', audio: true });
    assert.equal(got.video.id, 'window:42:0'); assert.equal(got.audio, 'loopback');
    assert.equal(picker.destroyed, true);
    got = undefined;
    ses.display({ securityOrigin: ORIGIN, audioRequested: false }, s => { got = s; });
    const p2 = windows[windows.length - 1];
    const l2 = await handlers.get('picker:list')({ sender: p2.webContents });
    assert.equal(l2.audio, false);
    ipcMain.emit('picker:choose', { sender: p2.webContents }, { id: 'screen:0:0', audio: true });
    assert.equal(got.audio, undefined, 'bez dźwięku, gdy strona go nie prosiła');
    got = undefined;
    ses.display({ securityOrigin: ORIGIN, audioRequested: true }, s => { got = s; });
    windows[windows.length - 1].close();
    assert.deepEqual(got, {}, 'zamknięcie okna = anulowanie');
  });

  await t.test('wykrywanie gier: lista z serwera, tasklist, tytuł okna, bez przeskakiwania', async () => {
    const games = () => wc.sent.filter(s => s[0] === 'game').map(s => s[1] && s[1].name);
    mock.timers.tick(8000); for (let i = 0; i < 6; i++) await tick();
    assert.deepEqual(ses.fetched, [ORIGIN + '/api/games/detectable']);
    assert.deepEqual(games(), [], 'nic nie działa — nic nie wysyłamy');
    tasklistOut = '"explorer.exe","1","Console","1","1 K"\r\n"VALORANT-Win64-Shipping.exe","2","Console","1","9 K"';
    mock.timers.tick(15000); for (let i = 0; i < 6; i++) await tick();
    assert.deepEqual(games(), ['VALORANT']);
    const started = wc.lastSent('game').startedAt;
    assert.ok(Number.isFinite(started));
    tasklistOut += '\r\n"javaw.exe","7","Console","1","9 K"';
    mock.timers.tick(15000); for (let i = 0; i < 8; i++) await tick();
    assert.deepEqual(games(), ['VALORANT'], 'została gra, która była pierwsza');
    tasklistOut = '"javaw.exe","7","Console","1","9 K"';
    mock.timers.tick(15000); for (let i = 0; i < 8; i++) await tick();
    assert.deepEqual(games(), ['VALORANT', 'Minecraft']);
    await handlers.get('settings:set')(fromApp(), { gameDetection: false });
    assert.equal(wc.lastSent('game'), null);
    assert.deepEqual((await handlers.get('state')(fromApp())).game, null);
  });

  await t.test('muzyka: pomocnik PowerShell, utwór do strony, wyłączenie', async () => {
    assert.equal(spawned.length, 1, 'pomocnik uruchomiony raz (6 s po starcie)');
    const ch = spawned[0];
    assert.equal(ch.cmd, 'powershell.exe'); assert.equal(ch.opts.windowsHide, true);
    assert.equal(ch.opts.env.GIBCORD_PARENT_PID, String(process.pid));
    assert.ok(ch.args.includes('-EncodedCommand'));
    const now = Date.now();
    ch.stdout.emit('data', '{"ready":true,"smtc":true}\n{"src":"smtc","title":"Arahja","artist":"Kult","album":"Kult","playing":true,"pos":30000,');
    ch.stdout.emit('data', `"dur":200000,"upd":${now},"now":${now}}\n`);
    const m = wc.lastSent('music');
    assert.equal(m.artists, 'Kult'); assert.equal(m.title, 'Arahja'); assert.equal(m.durationMs, 200000);
    assert.equal(m.startedAt, now - 30000);
    assert.deepEqual((await handlers.get('state')(fromApp())).music, m);
    const s = await handlers.get('settings:get')(fromApp());
    assert.equal(s.musicDetection, true); assert.equal(s.musicDetectionAvailable, true);
    await handlers.get('settings:set')(fromApp(), { musicDetection: false });
    assert.equal(ch.killed, true, 'wyłączenie zatrzymuje pomocnika');
    assert.equal(wc.lastSent('music'), null);
    await tick(); mock.timers.tick(31000); await tick();
    assert.equal(spawned.length, 1, 'po wyłączeniu nie wstaje sam');
    await handlers.get('settings:set')(fromApp(), { musicDetection: true });
    assert.equal(spawned.length, 2, 'włączenie uruchamia pomocnika od nowa');
  });

  await t.test('nakładka w grze: okno, dane, skrót, rogi, tylko w grze', async () => {
    const gs = electron.globalShortcut;
    assert.ok(gs.keys.has('CommandOrControl+Shift+O'), 'skrót zarejestrowany przy starcie');
    const n0 = windows.length;
    const st = { on: true, channel: 'Pogadanki · Ekipa', members: [
      { id: 1, name: 'Ola', avatar: ORIGIN + '/uploads/a.png', color: '#f49ac1', initial: 'O', talking: true },
      { id: 2, name: 'Kuba', avatar: 'https://zly.example/x.png', color: '#6fe3a5', initial: 'K', muted: true }] };
    ipcMain.emit('overlay:state', fromApp(), st);
    assert.equal(windows.length, n0, 'tylko w grze — gry brak, okna nie ma');
    ipcMain.emit('overlay:state', { sender: new WebContents(), senderFrame: { url: ORIGIN + '/' } }, st);
    await handlers.get('settings:set')(fromApp(), { overlayMode: 'always' });
    const ov = windows[windows.length - 1];
    assert.equal(windows.length, n0 + 1, 'zawsze w rozmowie — okno nakładki');
    assert.equal(ov.opts.transparent, true); assert.equal(ov.opts.focusable, false); assert.equal(ov.opts.skipTaskbar, true); assert.equal(ov.opts.frame, false);
    assert.equal(ov.opts.webPreferences.sandbox, true); assert.equal(ov.opts.webPreferences.contextIsolation, true);
    assert.equal(ov.ignoreMouse, true, 'klikanie przechodzi do gry'); assert.deepEqual(ov.aot, [true, 'screen-saver']);
    assert.equal(ov.inactive, true, 'bez zabierania fokusu grze');
    assert.ok(String(ov.loaded[0].file).endsWith('overlay.html'));
    assert.deepEqual(ov.bounds, { x: 16, y: 16, width: 300, height: 440 });
    ipcMain.emit('overlay:ready', { sender: ov.webContents });
    const p = ov.webContents.lastSent('overlay');
    assert.equal(p.state.members[0].avatar, ORIGIN + '/uploads/a.png'); assert.equal(p.state.members[1].avatar, null, 'obcy awatar odrzucony');
    assert.equal(p.corner, 'tl'); assert.equal(p.scale, 1);
    gs.keys.get('CommandOrControl+Shift+O')(); assert.equal(ov.visible, false, 'skrót chowa');
    gs.keys.get('CommandOrControl+Shift+O')(); assert.equal(ov.visible, true, 'i pokazuje');
    await handlers.get('settings:set')(fromApp(), { overlayCorner: 'br', overlaySize: 'l' });
    assert.deepEqual(ov.bounds, { x: 1920 - 375 - 16, y: 1080 - 550 - 16, width: 375, height: 550 });
    assert.equal(ov.webContents.lastSent('overlay').scale, 1.25);
    const s = await handlers.get('settings:get')(fromApp());
    assert.equal(s.overlay, true); assert.equal(s.overlayMode, 'always'); assert.equal(s.overlayCorner, 'br'); assert.equal(s.overlayAvailable, true);
    ipcMain.emit('overlay:state', fromApp(), { on: false });
    assert.equal(ov.visible, false, 'koniec rozmowy — nakładka znika');
    await handlers.get('settings:set')(fromApp(), { overlayMode: 'game' });
    ipcMain.emit('overlay:state', fromApp(), st);
    assert.equal(ov.visible, false, 'tylko w grze — dalej schowana');
    await handlers.get('settings:set')(fromApp(), { overlay: false });
    assert.equal(gs.keys.has('CommandOrControl+Shift+O'), false, 'wyłączona — skrót zwolniony');
    assert.equal(windows.length, n0 + 1, 'jedno okno nakładki na całe życie aplikacji');
  });

  await t.test('zamknięcie chowa do zasobnika (raz dymek), stan okna idzie do strony', async () => {
    win.focused = true; win.emit('blur'); win.focused = false; win.emit('blur');
    assert.deepEqual(wc.lastSent('window'), { visible: true, focused: false, fullscreen: false });
    win.close(); assert.equal(win.destroyed, false); assert.equal(win.visible, false); assert.equal(calls.balloons.length, 1);
    win.emit('hide'); assert.deepEqual(wc.lastSent('window'), { visible: false, focused: false, fullscreen: false });
    assert.deepEqual((await handlers.get('state')(fromApp())).window, { visible: false, focused: false, fullscreen: false });
    win.show(); win.close(); assert.equal(calls.balloons.length, 1);
    win.show();
  });

  await t.test('aktualizacje: sprawdzanie, gotowa wersja, instalacja', async () => {
    mock.timers.tick(15000); await tick();
    assert.equal(updater.checks >= 1, true);
    updater.emit('update-available', { version: '1.3.0' });
    assert.equal(wc.lastSent('update').state, 'downloading');
    updater.emit('update-downloaded', { version: '1.3.0' });
    assert.deepEqual({ ...wc.lastSent('update'), percent: undefined }, { state: 'downloaded', version: '1.3.0', error: null, percent: undefined });
    assert.ok(tray.menu.items.some(i => i.label === 'Uruchom ponownie i zaktualizuj (1.3.0)'));
    ipcMain.emit('update:install', fromApp('https://evil.example/')); await tick();
    assert.equal(calls.quitAndInstall, 0);
    ipcMain.emit('update:install', fromApp()); await tick();
    assert.equal(calls.quitAndInstall, 1);
  });

  await t.test('brak internetu: strona „brak połączenia” z adresem powrotu', () => {
    wc.emit('did-fail-load', ev(), -3, 'ERR_ABORTED', ORIGIN, true);
    wc.emit('did-fail-load', ev(), -105, 'ERR_NAME_NOT_RESOLVED', ORIGIN + '/x.png', false);
    const n = win.loaded.length;
    wc.emit('did-fail-load', ev(), -106, 'ERR_INTERNET_DISCONNECTED', ORIGIN + '/', true);
    assert.equal(win.loaded.length, n + 1);
    const last = win.loaded[n];
    assert.ok(last.file.endsWith('offline.html') && existsSync(last.file));
    assert.equal(last.query.u, ORIGIN);
    const settings = JSON.parse(readFileSync(path.join(USER_DATA, 'gibcord-settings.json'), 'utf8'));
    assert.equal(settings.autostartInit, true); assert.equal(settings.trayHintShown, true); assert.equal(settings.gameDetection, false);
  });
});
