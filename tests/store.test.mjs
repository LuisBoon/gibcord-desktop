/*
 * Test procesu głównego w wersji z Microsoft Store (process.windowsStore = true) — ta sama atrapa co main.test.mjs.
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
const USER_DATA = mkdtempSync(path.join(tmpdir(), 'gc-store-'));
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
  setOverlayIcon(img, desc) { this.overlay = img ? img.path : null; this.overlayDesc = desc; }
  loadURL(u) { this.loaded.push(u); } loadFile(f, o) { this.loaded.push({ file: f, query: o && o.query }); }
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
  nativeImage: { createFromPath: p => ({ path: p, isEmpty: () => !existsSync(p) }) },
  shell: { openExternal: u => { calls.external.push(u); return Promise.resolve(); }, showItemInFolder() {} },
  session: { fromPartition: () => ses },
  desktopCapturer: { getSources: async () => [
    { id: 'screen:0:0', name: 'Entire screen', thumbnail: { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,AA' }, appIcon: null },
    { id: 'window:42:0', name: 'VALORANT', thumbnail: { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,BB' }, appIcon: { isEmpty: () => false, toDataURL: () => 'data:image/png;base64,CC' } },
  ] },
  screen: { getAllDisplays: () => [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }] },
  clipboard: { writeText() {} },
  Notification: Object.assign(class extends EventEmitter { show() {} }, { isSupported: () => true }),
};
const hook = Object.assign(new EventEmitter(), { start() { calls.hookStart++; }, stop() { calls.hookStop++; } });
const UiohookKey = { V: 47, Ctrl: 29, Space: 57 };
const updater = Object.assign(new EventEmitter(), { checks: 0, async checkForUpdates() { this.checks++; }, quitAndInstall() { calls.quitAndInstall++; }, setFeedURL() {} });
let tasklistOut = '"explorer.exe","1","Console","1","1 K"';
const fakeExecFile = (cmd, args, opts, cb) => { setImmediate(() => cb(null, args.includes('/v') ? '"javaw.exe","7","Console","1","9 K","Running","PC\\\\u","0:00:01","Minecraft 1.21"' : tasklistOut)); };

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') return electron;
  if (request === 'uiohook-napi') return { uIOhook: hook, UiohookKey };
  if (request === 'electron-updater') return { autoUpdater: updater };
  if (request === 'child_process' && parent && parent.filename === MAIN) return { ...origLoad.call(this, request, parent, isMain), execFile: fakeExecFile };
  return origLoad.apply(this, arguments);
};

let updaterRequires = 0;
const loadWithCount = Module._load;
Module._load = function (request) { if (request === 'electron-updater') updaterRequires++; return loadWithCount.apply(this, arguments); };

test('wersja z Microsoft Store: bez electron-updater, autostart przez Ustawienia Windows', async t => {
  const realPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: 'win32' });
  process.windowsStore = true;
  const realArgv = process.argv;
  process.argv = [process.execPath, 'GibCord.exe'];
  delete process.env.GIBCORD_URL; delete process.env.GIBCORD_UPDATE_FEED;
  mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now: Date.now() });
  t.after(() => {
    mock.timers.reset(); Module._load = origLoad; process.argv = realArgv; delete process.windowsStore;
    Object.defineProperty(process, 'platform', realPlatform);
    rmSync(USER_DATA, { recursive: true, force: true });
  });

  require(MAIN);
  resolveReady(); await tick(); await tick();
  mock.timers.tick(60 * 60 * 1000); await tick();
  const win = windows[0], wc = win.webContents;
  const fromApp = (url = ORIGIN + '/') => ({ sender: wc, senderFrame: { url } });

  assert.equal(updaterRequires, 0, 'electron-updater nie jest nawet ładowany — aktualizuje Sklep');
  assert.equal(updater.checks, 0);
  assert.equal(calls.login.length, 0, 'pierwsze uruchomienie nie rusza autostartu (robi to manifest MSIX)');
  const s = await handlers.get('settings:get')(fromApp());
  assert.equal(s.store, true); assert.equal(s.autostartAvailable, false);
  const item = tray.menu.items.find(i => /Uruchamianie z Windows/.test(i.label || ''));
  assert.ok(item, 'w zasobniku jest skrót do ustawień uruchamiania');
  item.click(); await tick();
  assert.ok(calls.external.includes('ms-settings:startupapps'));
  await handlers.get('settings:set')(fromApp(), { autostart: true });
  assert.equal(calls.login.length, 0, 'przełącznik w ustawieniach otwiera Ustawienia Windows zamiast setLoginItemSettings');
  assert.equal(calls.external.filter(u => u === 'ms-settings:startupapps').length, 2);
  assert.ok(!tray.menu.items.some(i => /zaktualizuj/i.test(i.label || '')));
});
