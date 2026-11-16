'use strict';
/* Ustawienia aplikacji zapisywane w pliku JSON w katalogu danych (userData). */
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  bounds: null,            // {x, y, width, height}
  maximized: false,
  closeToTray: true,       // zamknięcie okna chowa do zasobnika
  startMinimized: true,    // przy autostarcie startuj schowany
  gameDetection: true,     // wykrywanie gier
  musicDetection: true,    // „czego słuchasz” — Spotify na tym komputerze (1.0.4)
  trayHintShown: false,    // czy pokazaliśmy już dymek „GibCord działa w tle”
  autostartInit: false,    // czy przy pierwszym uruchomieniu włączyliśmy już autostart
  zoom: 0,                 // powiększenie strony (Ctrl + / Ctrl -)
  tbBg: '#1b1531',         // kolor paska okna — ostatni motyw GibCorda (żeby od startu był właściwy)
  tbFg: '#f6f2fb',         // kolor napisu i przycisków na pasku
};
const HEX = /^#[0-9a-f]{6}$/i;

function sanitize(obj) {
  const out = Object.assign({}, DEFAULTS);
  if (!obj || typeof obj !== 'object') return out;
  for (const k of ['closeToTray', 'startMinimized', 'gameDetection', 'musicDetection', 'trayHintShown', 'maximized', 'autostartInit']) if (typeof obj[k] === 'boolean') out[k] = obj[k];
  if (Number.isFinite(obj.zoom)) out.zoom = Math.max(-3, Math.min(4, obj.zoom));
  for (const k of ['tbBg', 'tbFg']) if (typeof obj[k] === 'string' && HEX.test(obj[k])) out[k] = obj[k].toLowerCase();
  const b = obj.bounds;
  if (b && ['x', 'y', 'width', 'height'].every(k => Number.isFinite(b[k])) && b.width >= 400 && b.height >= 300 && b.width < 20000 && b.height < 20000) out.bounds = { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  return out;
}

function createStore(dir) {
  const file = path.join(dir, 'gibcord-settings.json');
  let data;
  try { data = sanitize(JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { data = sanitize(null); }
  let timer = null;
  const flush = () => { try { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(file + '.tmp', JSON.stringify(data, null, 2)); fs.renameSync(file + '.tmp', file); } catch {} };
  return {
    get: () => Object.assign({}, data),
    set(patch) { data = sanitize(Object.assign({}, data, patch)); clearTimeout(timer); timer = setTimeout(flush, 400); return this.get(); },
    flushNow() { clearTimeout(timer); flush(); },
  };
}

module.exports = { createStore, sanitize, DEFAULTS };
