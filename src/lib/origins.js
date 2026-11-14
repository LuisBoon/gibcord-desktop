'use strict';
/* Które adresy należą do GibCorda i jak zamienić link do GibCorda na ścieżkę w aplikacji. */

/** 'https://gibcord.luisboon.pl/x?y' → 'https://gibcord.luisboon.pl'; tylko http(s), inaczej null. */
function originOf(url) {
  if (typeof url !== 'string' || !url) return null;
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.origin : null; } catch { return null; }
}

function isAllowedOrigin(url, origins) {
  const o = originOf(url);
  return !!o && origins.includes(o);
}

/* Ścieżki, które obsługuje sama strona (SPA) — takie linki otwieramy w oknie aplikacji, a nie w nowym oknie. */
const APP_PATHS = [/^\/$/, /^\/kanal\/\d+\/\d+$/, /^\/serwer\/\d+$/, /^\/dm\/\d+$/, /^\/wydarzenia\/\d+$/, /^\/i\/[A-Za-z0-9]{4,32}$/, /^\/admin$/];

/** Dla linku do GibCorda zwraca ścieżkę w aplikacji ('/kanal/1/2') albo null (np. /uploads/…, /api/…). */
function appPathFor(url, origins) {
  if (!isAllowedOrigin(url, origins)) return null;
  const p = new URL(url).pathname.replace(/\/+$/, '') || '/';
  return APP_PATHS.some(re => re.test(p)) ? p : null;
}

module.exports = { originOf, isAllowedOrigin, appPathFor, APP_PATHS };
