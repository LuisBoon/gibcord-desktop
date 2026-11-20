'use strict';
/*
 * Przesiadka na GibCord 6 — nową, natywną aplikację na Windows (C# + WinUI 3).
 * Sterowana z serwera: GET /api/info → desktop.native = { version, setupUrl, migrate }.
 * Dopóki serwer nie ustawi migrate: true, nic się nie dzieje.
 *
 * Kolejność jest bezpieczna: najpierw instalujemy nową aplikację i sprawdzamy, że jest na dysku,
 * dopiero potem wyłączamy autostart starej i ją odinstalowujemy. Gdy coś pójdzie nie tak — stara działa dalej.
 * Logowanie przechodzi jednorazowym kodem (POST /api/auth/handoff) zapisanym w %LocalAppData%\GibCord6-dane\przesiadka.json.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

/** Gdzie Velopack instaluje nową aplikację (packId GibCord6). */
function nativeExe(env = process.env) {
  const base = env.LOCALAPPDATA;
  return base ? path.join(base, 'GibCord6', 'current', 'GibCord.exe') : null;
}

function dataDir(env = process.env) {
  const base = env.LOCALAPPDATA;
  return base ? path.join(base, 'GibCord6-dane') : null;
}

/** Czy przesiadać się teraz: tylko Windows, tylko zainstalowana wersja spoza Sklepu, tylko gdy serwer każe. */
function shouldMigrate(info, { isWin, isStore, packaged }) {
  const n = info && info.desktop && info.desktop.native;
  if (!isWin || isStore || !packaged || !n || n.migrate !== true) return null;
  if (typeof n.setupUrl !== 'string' || !/^https:\/\//.test(n.setupUrl)) return null;
  return n;
}

function waitExit(child, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('instalator nie skończył w czasie')), ms);
    child.on('error', e => { clearTimeout(t); reject(e); });
    child.on('exit', code => { clearTimeout(t); code === 0 ? resolve() : reject(new Error('instalator zakończył się kodem ' + code)); });
  });
}

/**
 * Jedna próba przesiadki. Zwraca true, gdy nowa aplikacja jest zainstalowana i stara ma się zamknąć.
 * deps: { ses, origin, log, notify, tmpDir, execPath, isWin, isStore, packaged, setAutostart, env }
 */
async function migrate(deps) {
  const { ses, origin, log, notify = () => {}, tmpDir, execPath, setAutostart = () => {}, env = process.env } = deps;
  const info = await (await ses.fetch(origin + '/api/info', { cache: 'no-store' })).json();
  const n = shouldMigrate(info, deps);
  if (!n) return false;
  const exe = nativeExe(env), dir = dataDir(env);
  if (!exe || !dir) return false;
  log.info(`Przesiadka na GibCord ${n.version || '6'} — start`);

  // 1) kod logowania dla nowej aplikacji (gdy ktoś jest zalogowany)
  try {
    const r = await ses.fetch(origin + '/api/auth/handoff', { method: 'POST', headers: { 'X-DC': '1' } });
    if (r.ok) {
      const { code } = await r.json();
      if (typeof code === 'string' && /^[0-9a-f]{48}$/.test(code)) {
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, 'przesiadka.json'), JSON.stringify({ code, server: origin, at: Date.now() }));
      }
    }
  } catch (e) { log.warn('Przesiadka: kod logowania', e && e.message); }

  // 2) instalacja nowej aplikacji (Velopack sam ją uruchamia po instalacji)
  if (!fs.existsSync(exe)) {
    notify('Nowy GibCord', 'Instaluję nową, szybszą wersję GibCorda. To potrwa chwilę — nie musisz nic klikać.');
    const r = await ses.fetch(n.setupUrl);
    if (!r.ok) throw new Error('pobieranie instalatora: HTTP ' + r.status);
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length < 1e6) throw new Error('instalator za mały (' + buf.length + ' B)');
    const setup = path.join(tmpDir, 'GibCord6-Setup.exe');
    fs.writeFileSync(setup, buf);
    await waitExit(spawn(setup, [], { stdio: 'ignore', windowsHide: false }), 10 * 60e3);
    if (!fs.existsSync(exe)) throw new Error('po instalacji brak ' + exe);
  } else {
    const c = spawn(exe, [], { detached: true, stdio: 'ignore' });
    c.on('error', e => log.warn('Przesiadka: uruchomienie nowej aplikacji', e && e.message));
    c.unref();
  }

  // 3) stara aplikacja ustępuje miejsca: bez autostartu, odinstalowanie w tle po zamknięciu
  try { setAutostart(false); } catch {}
  const uninst = path.join(path.dirname(execPath), 'Uninstall GibCord.exe');
  if (fs.existsSync(uninst)) {
    try {
      const u = spawn(uninst, ['/S'], { detached: true, stdio: 'ignore' });
      u.on('error', e => log.warn('Przesiadka: odinstalowanie', e && e.message));
      u.unref();
    } catch (e) { log.warn('Przesiadka: odinstalowanie', e && e.message); }
  }
  log.info('Przesiadka zakończona — zamykam starą aplikację');
  return true;
}

module.exports = { nativeExe, dataDir, shouldMigrate, migrate };
