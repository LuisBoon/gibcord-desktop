import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const keymap = require('../src/lib/keymap.js');
const { parseDeepLink, findDeepLinkArg } = require('../src/lib/deeplink.js');
const games = require('../src/lib/games.js');
const { originOf, isAllowedOrigin, appPathFor } = require('../src/lib/origins.js');
const { createStore, sanitize } = require('../src/lib/settings.js');

/* Nazwy klawiszy z uiohook-napi — wczytywane w osobnym procesie, bo moduł natywny bez ekranu (serwer, CI) potrafi zakończyć proces błędem. */
let UiohookKey = null;
try {
  const r = spawnSync(process.execPath, ['-e', "process.stdout.write(JSON.stringify(require('uiohook-napi').UiohookKey))"], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8', timeout: 15000 });
  UiohookKey = JSON.parse(r.stdout);
} catch { /* brak modułu natywnego na tej maszynie */ }

test('keymap: każdy znany KeyboardEvent.code ma odpowiednik w uiohook', { skip: !UiohookKey && 'brak uiohook-napi' }, () => {
  const codes = [];
  for (let c = 65; c <= 90; c++) codes.push('Key' + String.fromCharCode(c));
  for (let d = 0; d <= 9; d++) codes.push('Digit' + d, 'Numpad' + d);
  for (let f = 1; f <= 24; f++) codes.push('F' + f);
  codes.push(...Object.keys(keymap.NAMED));
  for (const code of codes) {
    const b = keymap.resolveBinding(code, UiohookKey);
    assert.ok(b && b.kind === 'key' && typeof b.keycode === 'number', `brak mapowania dla ${code}`);
  }
  assert.equal(keymap.resolveBinding('KeyV', UiohookKey).keycode, UiohookKey.V);
  assert.equal(keymap.resolveBinding('ControlLeft', UiohookKey).keycode, UiohookKey.Ctrl);
  assert.equal(keymap.resolveBinding('AltRight', UiohookKey).keycode, UiohookKey.AltRight);
  assert.equal(keymap.resolveBinding('Backquote', UiohookKey).keycode, UiohookKey.Backquote);
});

test('keymap: przyciski myszy, nieznane i złośliwe wartości', () => {
  assert.deepEqual(keymap.resolveBinding('Mouse4', {}), { kind: 'mouse', button: 4 });
  assert.deepEqual(keymap.resolveBinding('Mouse5', {}), { kind: 'mouse', button: 5 });
  assert.equal(keymap.resolveBinding('IntlBackslash', { A: 1 }), null);
  assert.equal(keymap.resolveBinding('__proto__', { A: 1 }), null);
  assert.equal(keymap.resolveBinding('constructor', { A: 1 }), null);
  assert.equal(keymap.resolveBinding('', { A: 1 }), null);
  assert.equal(keymap.resolveBinding(null, { A: 1 }), null);
  assert.equal(keymap.codeToUiohookName('F25'), null);
  assert.equal(keymap.codeToUiohookName('KeyAB'), null);
});

test('keymap: dopasowanie zdarzeń', () => {
  const k = { kind: 'key', keycode: 47 }, m = { kind: 'mouse', button: 4 };
  assert.ok(keymap.matches(k, { keycode: 47 }, 'key'));
  assert.ok(!keymap.matches(k, { keycode: 48 }, 'key'));
  assert.ok(!keymap.matches(k, { button: 47 }, 'mouse'));
  assert.ok(keymap.matches(m, { button: 4 }, 'mouse'));
  assert.ok(!keymap.matches(m, { keycode: 4 }, 'key'));
  assert.ok(!keymap.matches(null, { keycode: 47 }, 'key'));
});

test('deeplink: obsługiwane linki', () => {
  assert.equal(parseDeepLink('gibcord://i/AbC123'), '/i/AbC123');
  assert.equal(parseDeepLink('gibcord://i/AbC123/'), '/i/AbC123');
  assert.equal(parseDeepLink('gibcord:///i/AbC123'), '/i/AbC123');
  assert.equal(parseDeepLink('GIBCORD://zaproszenie/xyz9'), '/i/xyz9');
  assert.equal(parseDeepLink('gibcord://kanal/12/345'), '/kanal/12/345');
  assert.equal(parseDeepLink('gibcord://kanal/12/345?x=1#y'), '/kanal/12/345');
  assert.equal(parseDeepLink('gibcord://serwer/7'), '/serwer/7');
  assert.equal(parseDeepLink('gibcord://dm/99'), '/dm/99');
  assert.equal(parseDeepLink('gibcord://wydarzenia/3'), '/wydarzenia/3');
  assert.equal(parseDeepLink('gibcord://'), '/');
});

test('deeplink: odrzuca obce i podejrzane linki', () => {
  for (const bad of ['https://evil.example/i/abc', 'gibcord://i/../../x', 'gibcord://kanal/a/b', 'gibcord://i/ab', 'gibcord://javascript:alert(1)',
    'gibcord://i/abc%2F..', 'gibcord://admin', 'gibcord://' + 'a'.repeat(400), 'gibcord://dm/1/2', null, 42]) {
    assert.equal(parseDeepLink(bad), null, String(bad).slice(0, 40));
  }
  assert.equal(findDeepLinkArg(['C:\\GibCord.exe', '--autostart', 'gibcord://dm/5']), 'gibcord://dm/5');
  assert.equal(findDeepLinkArg(['C:\\GibCord.exe']), null);
  assert.equal(findDeepLinkArg(null), null);
});

test('origins: nowy i stary adres GibCorda', () => {
  const O = ['https://gibcord.luisboon.pl', 'https://dc.luisboon.pl'];
  assert.equal(originOf('https://gibcord.luisboon.pl/kanal/1/2?x'), 'https://gibcord.luisboon.pl');
  assert.equal(originOf('file:///C:/x/offline.html'), null);
  assert.equal(originOf('javascript:alert(1)'), null);
  assert.ok(isAllowedOrigin('https://gibcord.luisboon.pl/', O));
  assert.ok(isAllowedOrigin('https://dc.luisboon.pl/i/abcd', O));
  assert.ok(!isAllowedOrigin('http://gibcord.luisboon.pl/', O));
  assert.ok(!isAllowedOrigin('https://gibcord.luisboon.pl.evil.example/', O));
  assert.ok(!isAllowedOrigin('https://evil.example/?https://gibcord.luisboon.pl', O));
  assert.ok(!isAllowedOrigin('https://luisboon.pl/', O));
  assert.equal(appPathFor('https://gibcord.luisboon.pl/kanal/1/2', O), '/kanal/1/2');
  assert.equal(appPathFor('https://dc.luisboon.pl/i/AbCd12', O), '/i/AbCd12');
  assert.equal(appPathFor('https://gibcord.luisboon.pl/', O), '/');
  assert.equal(appPathFor('https://gibcord.luisboon.pl/uploads/a/b.png', O), null);
  assert.equal(appPathFor('https://gibcord.luisboon.pl/api/state', O), null);
  assert.equal(appPathFor('https://evil.example/kanal/1/2', O), null);
});

const TASKLIST = [
  '"System Idle Process","0","Services","0","8 K"',
  '"explorer.exe","4321","Console","1","120 456 K"',
  '"VALORANT-Win64-Shipping.exe","9001","Console","1","2 001 234 K"',
  '"javaw.exe","7777","Console","1","900 000 K"',
  '"Weird, ""Name"".exe","1","Console","1","1 K"',
  '',
  'INFO: No tasks are running which match the specified criteria.',
].join('\r\n');

test('games: parser wyjścia tasklist (CSV z cudzysłowami)', () => {
  assert.deepEqual(games.parseCsvLine('"a","b,c","d""e"'), ['a', 'b,c', 'd"e']);
  const rows = games.parseTasklist(TASKLIST, false);
  assert.equal(rows.length, 5);
  assert.deepEqual(rows[2], { exe: 'valorant-win64-shipping.exe', pid: 9001 });
  assert.equal(rows[4].exe, 'weird, "name".exe');
  const v = games.parseTasklist('"javaw.exe","7777","Console","1","900 000 K","Running","PC\\Hubert","0:10:00","Minecraft 1.21.1"\r\n"javaw.exe","7778","Console","1","9 K","Unknown","N/A","0:00:00","N/A"', true);
  assert.deepEqual(v.map(r => r.title), ['Minecraft 1.21.1', '']);
});

test('games: normalizacja listy z serwera i wybór gry', () => {
  const list = games.normalizeGames([
    { id: 1, name: 'VALORANT', executables: ['VALORANT-Win64-Shipping.exe'] },
    { id: 2, name: 'Minecraft', executables: ['javaw.exe', 'Minecraft.exe'], titleHint: 'Minecraft' },
    { id: 3, name: 'Zła', executables: 'x.exe' },
    { name: 42, executables: ['a.exe'] },
    null,
    { id: 4, name: 'Pusta', executables: [] },
  ]);
  assert.deepEqual(list.map(g => g.name), ['VALORANT', 'Minecraft']);
  const running = new Set(games.parseTasklist(TASKLIST).map(r => r.exe));
  assert.deepEqual(games.exesNeedingTitles(list, running), ['javaw.exe']);
  // javaw.exe bez tytułu „Minecraft” to nie Minecraft
  assert.equal(games.pickGame(list, running, new Map([['javaw.exe', ['IntelliJ IDEA']]]), null).name, 'VALORANT');
  // gdy działa i Minecraft, i VALORANT — zostajemy przy tej, która już jest pokazana (bez przeskakiwania)
  const titles = new Map([['javaw.exe', ['Minecraft 1.21.1']]]);
  assert.equal(games.pickGame(list, running, titles, { name: 'Minecraft' }).name, 'Minecraft');
  assert.equal(games.pickGame(list, running, titles, { name: 'VALORANT' }).name, 'VALORANT');
  assert.equal(games.pickGame(list, new Set(['explorer.exe']), titles, { name: 'VALORANT' }), null);
});

test('settings: wartości domyślne, walidacja i zapis na dysk', async () => {
  const s = sanitize({ closeToTray: 'tak', gameDetection: false, bounds: { x: 10, y: 20, width: 50, height: 50 }, zoom: 99, evil: 1 });
  assert.equal(s.closeToTray, true);
  assert.equal(s.gameDetection, false);
  assert.equal(s.bounds, null);
  assert.equal(s.zoom, 4);
  assert.equal(s.evil, undefined);
  const dir = mkdtempSync(join(tmpdir(), 'gc-set-'));
  try {
    const st = createStore(dir);
    st.set({ startMinimized: false, bounds: { x: 1.4, y: 2, width: 1200, height: 800 } });
    st.flushNow();
    const disk = JSON.parse(readFileSync(join(dir, 'gibcord-settings.json'), 'utf8'));
    assert.equal(disk.startMinimized, false);
    assert.deepEqual(disk.bounds, { x: 1, y: 2, width: 1200, height: 800 });
    assert.equal(createStore(dir).get().startMinimized, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
