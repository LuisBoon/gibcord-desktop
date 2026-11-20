import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { shouldMigrate, nativeExe, migrate } = require('../src/lib/migrate.js');
const on = { isWin: true, isStore: false, packaged: true };
const info = (native) => ({ desktop: { native } });

test('przesiadka: tylko gdy serwer każe i tylko zainstalowana wersja spoza Sklepu', () => {
  const n = { version: '6.0.0', setupUrl: 'https://example.com/s.exe', migrate: true };
  assert.ok(shouldMigrate(info(n), on));
  assert.equal(shouldMigrate(info({ ...n, migrate: false }), on), null);
  assert.equal(shouldMigrate(info(null), on), null);
  assert.equal(shouldMigrate({}, on), null);
  assert.equal(shouldMigrate(info(n), { ...on, isStore: true }), null);
  assert.equal(shouldMigrate(info(n), { ...on, packaged: false }), null);
  assert.equal(shouldMigrate(info(n), { ...on, isWin: false }), null);
  assert.equal(shouldMigrate(info({ ...n, setupUrl: 'http://zly.pl/s.exe' }), on), null);
});

test('przesiadka: ścieżka nowej aplikacji z LOCALAPPDATA', () => {
  assert.equal(nativeExe({}), null);
  assert.ok(nativeExe({ LOCALAPPDATA: 'C:\\U\\AppData\\Local' }).endsWith(join('GibCord6', 'current', 'GibCord.exe')));
});

test('przesiadka: gdy nowa aplikacja już jest — kod logowania na dysk, autostart wyłączony, bez pobierania', async () => {
  const base = mkdtempSync(join(tmpdir(), 'gc-mig-'));
  const exe = nativeExe({ LOCALAPPDATA: base });
  mkdirSync(join(base, 'GibCord6', 'current'), { recursive: true });
  writeFileSync(exe, '');
  const calls = [];
  const ses = { fetch: async (url, o) => {
    calls.push(url);
    if (url.endsWith('/api/info')) return { ok: true, json: async () => info({ version: '6.0.0', setupUrl: 'https://example.com/s.exe', migrate: true }) };
    if (url.endsWith('/api/auth/handoff')) return { ok: true, json: async () => ({ code: 'a'.repeat(48) }) };
    throw new Error('nieoczekiwane ' + url);
  } };
  let auto = null;
  const log = { info() {}, warn() {} };
  const started = [];
  const run = (cmd, args) => { started.push([cmd, ...args]); return { on() {}, unref() {} }; };
  const done = await migrate({ ses, origin: 'https://gc.test', log, tmpDir: base, execPath: join(base, 'stara', 'GibCord.exe'), ...on, setAutostart: v => { auto = v; }, env: { LOCALAPPDATA: base }, run });
  assert.equal(done, true);
  assert.deepEqual(started, [[exe]], 'uruchamia nową aplikację (starej nie odinstalowuje, bo w teście nie ma deinstalatora)');
  assert.equal(auto, false);
  const h = JSON.parse(readFileSync(join(base, 'GibCord6-dane', 'przesiadka.json'), 'utf8'));
  assert.equal(h.code, 'a'.repeat(48));
  assert.equal(h.server, 'https://gc.test');
  assert.ok(!calls.some(u => u.includes('example.com')), 'nie powinien pobierać instalatora');
});

test('przesiadka: nie da się uruchomić nowej aplikacji → przerywamy, stara zostaje', async () => {
  const base = mkdtempSync(join(tmpdir(), 'gc-mig-'));
  const exe = nativeExe({ LOCALAPPDATA: base });
  mkdirSync(join(base, 'GibCord6', 'current'), { recursive: true });
  writeFileSync(exe, '');
  const ses = { fetch: async url => url.endsWith('/api/info') ? { ok: true, json: async () => info({ version: '6', setupUrl: 'https://x/s.exe', migrate: true }) } : { ok: false } };
  let auto = null;
  const run = () => { throw Object.assign(new Error('spawn EFTYPE'), { code: 'EFTYPE' }); };
  await assert.rejects(migrate({ ses, origin: 'https://gc.test', log: { info() {}, warn() {} }, tmpDir: base, execPath: '/x', ...on, setAutostart: v => { auto = v; }, env: { LOCALAPPDATA: base }, run }));
  assert.equal(auto, null, 'autostart starej aplikacji zostaje');
});

test('przesiadka: serwer nie każe → nic nie robi', async () => {
  const ses = { fetch: async () => ({ ok: true, json: async () => info({ version: '6', setupUrl: 'https://x/s.exe', migrate: false }) }) };
  assert.equal(await migrate({ ses, origin: 'https://gc.test', log: { info() {}, warn() {} }, tmpDir: tmpdir(), execPath: '/x', ...on, env: { LOCALAPPDATA: tmpdir() } }), false);
});
