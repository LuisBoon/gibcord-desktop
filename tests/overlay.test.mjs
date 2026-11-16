import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ov = require('../src/lib/overlay.js');
const ORIGIN = 'https://gibcord.luisboon.pl';
const allowed = u => u.startsWith(ORIGIN + '/');

test('nakładka: dane od strony — awatary tylko z GibCorda, bez znaków sterujących, bez rozmowy = null', () => {
  assert.equal(ov.sanitizeState(null, allowed), null);
  assert.equal(ov.sanitizeState({ on: false, members: [{ id: 1, name: 'Ola' }] }, allowed), null);
  assert.equal(ov.sanitizeState({ on: true, members: [] }, allowed), null);
  const s = ov.sanitizeState({ on: true, channel: 'Pogadanki\n· Ekipa', members: [
    { id: 1, name: 'Ola', avatar: ORIGIN + '/uploads/a.png', color: '#f49ac1', initial: 'O', talking: true },
    { id: 2, name: 'Kuba\u0000<b>', avatar: 'https://zly.example/x.png', color: 'red; background:url(x)', muted: true },
    { id: 3, name: '', avatar: 'javascript:alert(1)', deaf: true },
  ] }, allowed);
  assert.equal(s.channel, 'Pogadanki · Ekipa');
  assert.equal(s.members[0].avatar, ORIGIN + '/uploads/a.png'); assert.equal(s.members[0].talking, true);
  assert.equal(s.members[1].avatar, null, 'obcy adres awatara odrzucony'); assert.equal(s.members[1].name, 'Kuba <b>'); assert.equal(s.members[1].color, '#8b8599');
  assert.equal(s.members[2].name, '?'); assert.equal(s.members[2].avatar, null); assert.equal(s.members[2].deaf, true);
  assert.equal(s.more, 0);
});

test('nakładka: najwyżej 8 osób, mówiący zawsze widoczni, reszta jako „i N innych”', () => {
  const members = Array.from({ length: 12 }, (_, i) => ({ id: i + 1, name: 'Osoba ' + (i + 1), talking: i === 10 }));
  const s = ov.sanitizeState({ on: true, channel: 'Duży kanał', members }, allowed);
  assert.equal(s.members.length, ov.MAX_ROWS);
  assert.ok(s.members.some(m => m.id === 11 && m.talking), 'mówiący spoza pierwszej ósemki jest na liście');
  assert.equal(s.more, 4);
});

test('nakładka: położenie w rogach i rozmiary', () => {
  const d = { bounds: { x: 0, y: 0, width: 1920, height: 1080 } };
  assert.deepEqual(ov.overlayBounds(d, 'tl', 'm'), { x: 16, y: 16, width: 300, height: 440 });
  assert.deepEqual(ov.overlayBounds(d, 'br', 'l'), { x: 1920 - 375 - 16, y: 1080 - 550 - 16, width: 375, height: 550 });
  assert.deepEqual(ov.overlayBounds(d, 'tr', 's'), { x: 1920 - 255 - 16, y: 16, width: 255, height: 374 });
  assert.deepEqual(ov.overlayBounds({ bounds: { x: -1280, y: 0, width: 1280, height: 720 } }, 'bl', 'm'), { x: -1264, y: 720 - 440 - 16, width: 300, height: 440 }, 'drugi monitor po lewej');
  assert.equal(ov.overlayBounds({ bounds: { x: 0, y: 0, width: 800, height: 300 } }, 'tl', 'l').height, 268, 'niski ekran — okno się mieści');
  assert.deepEqual(ov.overlayBounds(null, 'zły', 'xxl'), { x: 16, y: 16, width: 300, height: 440 });
});

test('nakładka: kiedy widać', () => {
  const state = { channel: 'x', members: [{ id: 1 }], more: 0 };
  assert.equal(ov.shouldShow({ enabled: true, mode: 'game', state, game: null, hidden: false }), false, 'tylko w grze, gry brak');
  assert.equal(ov.shouldShow({ enabled: true, mode: 'game', state, game: { name: 'VALORANT' }, hidden: false }), true);
  assert.equal(ov.shouldShow({ enabled: true, mode: 'always', state, game: null, hidden: false }), true);
  assert.equal(ov.shouldShow({ enabled: true, mode: 'always', state: null, game: null, hidden: false }), false, 'bez rozmowy nic');
  assert.equal(ov.shouldShow({ enabled: true, mode: 'always', state, game: null, hidden: true }), false, 'schowana skrótem');
  assert.equal(ov.shouldShow({ enabled: false, mode: 'always', state, game: { name: 'x' }, hidden: false }), false);
});
