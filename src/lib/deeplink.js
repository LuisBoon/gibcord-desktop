'use strict';
/* Linki gibcord://… → ścieżka w GibCordzie. Przyjmujemy tylko znane, bezpieczne kształty. */

const RULES = [
  [/^i\/([A-Za-z0-9]{4,32})$/, m => `/i/${m[1]}`],
  [/^(?:zaproszenie|invite)\/([A-Za-z0-9]{4,32})$/, m => `/i/${m[1]}`],
  [/^kanal\/(\d{1,12})\/(\d{1,12})$/, m => `/kanal/${m[1]}/${m[2]}`],
  [/^serwer\/(\d{1,12})$/, m => `/serwer/${m[1]}`],
  [/^dm\/(\d{1,12})$/, m => `/dm/${m[1]}`],
  [/^wydarzenia\/(\d{1,12})$/, m => `/wydarzenia/${m[1]}`],
  [/^$/, () => '/'],
];

/** Zwraca ścieżkę ('/i/KOD', '/kanal/1/2' …) albo null dla nieznanego linku. */
function parseDeepLink(url) {
  if (typeof url !== 'string' || url.length > 300) return null;
  const m = url.match(/^gibcord:\/\/\/?(.*)$/i);
  if (!m) return null;
  const rest = m[1].split(/[?#]/)[0].replace(/\/+$/, '');
  for (const [re, fn] of RULES) { const r = rest.match(re); if (r) return fn(r); }
  return null;
}

/** Wyciąga pierwszy link gibcord:// z argumentów procesu (Windows podaje go jako argument). */
function findDeepLinkArg(argv) {
  if (!Array.isArray(argv)) return null;
  for (const a of argv) if (typeof a === 'string' && /^gibcord:/i.test(a)) return a;
  return null;
}

module.exports = { parseDeepLink, findDeepLinkArg };
