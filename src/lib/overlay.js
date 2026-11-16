'use strict';
/* Nakładka w grze (GibCord 1.0.7, wariant A „lista w rogu”): kto jest na kanale głosowym i kto mówi.
   Osobne, przezroczyste okno zawsze na wierzchu, przez które klikanie przechodzi do gry — bez wstrzykiwania
   do gier (anty-cheaty). Dane przychodzą ze strony (główne okno) i są tu sprawdzane, zanim trafią do nakładki. */

const CORNERS = ['tl', 'tr', 'bl', 'br'];
const SIZES = { s: 0.85, m: 1, l: 1.25 };
const MODES = ['game', 'always'];
const BASE_W = 300, BASE_H = 440, MARGIN = 16;
const MAX_ROWS = 8;
const HOTKEY = 'CommandOrControl+Shift+O';

const str = (v, n) => typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, n) : '';
const COLOR = /^#[0-9a-f]{3,8}$/i;

/**
 * Stan od strony → bezpieczny stan dla nakładki albo null (brak rozmowy).
 * Awatary tylko z adresów GibCorda (isAllowed), reszta jako kolor + litera. Najwyżej MAX_ROWS osób, reszta jako „i N innych”.
 */
function sanitizeState(s, isAllowed) {
  if (!s || typeof s !== 'object' || s.on !== true || !Array.isArray(s.members)) return null;
  const all = s.members.filter(m => m && typeof m === 'object').slice(0, 100).map(m => {
    const name = str(m.name, 40) || '?';
    const avatar = typeof m.avatar === 'string' && m.avatar.length <= 2048 && /^https:\/\//.test(m.avatar) && isAllowed(m.avatar) ? m.avatar : null;
    return { id: Number.isSafeInteger(m.id) ? m.id : 0, name, avatar, color: typeof m.color === 'string' && COLOR.test(m.color) ? m.color : '#8b8599',
      initial: str(m.initial, 4) || [...name][0] || '?', talking: m.talking === true, muted: m.muted === true, deaf: m.deaf === true };
  });
  if (!all.length) return null;
  // mówiący zawsze widoczni, nawet gdy osób jest więcej niż MAX_ROWS
  let shown = all.slice(0, MAX_ROWS);
  const hiddenTalk = all.slice(MAX_ROWS).filter(m => m.talking);
  if (hiddenTalk.length) shown = shown.filter(m => m.talking).concat(hiddenTalk, shown.filter(m => !m.talking)).slice(0, MAX_ROWS);
  return { channel: str(s.channel, 60), members: shown, more: all.length - shown.length };
}

/** Położenie okna nakładki w rogu ekranu (cały ekran, nie obszar roboczy — gry zasłaniają pasek zadań). */
function overlayBounds(display, corner, size) {
  const b = (display && display.bounds) || { x: 0, y: 0, width: 1920, height: 1080 };
  const k = SIZES[size] || 1;
  const w = Math.round(BASE_W * k), h = Math.min(Math.round(BASE_H * k), Math.max(200, b.height - 2 * MARGIN));
  const c = CORNERS.includes(corner) ? corner : 'tl';
  return { x: c[1] === 'l' ? b.x + MARGIN : b.x + b.width - w - MARGIN, y: c[0] === 't' ? b.y + MARGIN : b.y + b.height - h - MARGIN, width: w, height: h };
}

/** Czy nakładka ma być widoczna: włączona, jest rozmowa, (w trybie „tylko w grze”) wykryta gra i nie schowana skrótem. */
function shouldShow({ enabled, mode, state, game, hidden }) {
  if (!enabled || hidden || !state) return false;
  return mode === 'always' || !!game;
}

module.exports = { CORNERS, SIZES, MODES, HOTKEY, MAX_ROWS, sanitizeState, overlayBounds, shouldShow };
