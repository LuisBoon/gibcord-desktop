'use strict';
/* Wykrywanie gier: parsowanie `tasklist /fo csv /nh` i dopasowanie do listy gier z serwera GibCorda. */

/** Parser jednej linii CSV z cudzysłowami (tasklist zawsze cytuje pola). */
function parseCsvLine(line) {
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Z wyjścia `tasklist /fo csv /nh` robi listę { exe (małymi literami), pid, title? (z /v) }. */
function parseTasklist(text, verbose) {
  const rows = [];
  for (const raw of String(text || '').split(/\r?\n/)) {
    const line = raw.trim(); if (!line || line[0] !== '"') continue;
    const f = parseCsvLine(line);
    if (!f[0]) continue;
    const row = { exe: f[0].toLowerCase(), pid: +f[1] || 0 };
    if (verbose) { const t = f[f.length - 1]; row.title = t && t !== 'N/A' ? t : ''; }
    rows.push(row);
  }
  return rows;
}

/** Normalizuje listę gier z serwera: [{id, name, executables:[...], titleHint?}] → wewnętrzny kształt. */
function normalizeGames(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  for (const g of list) {
    if (!g || typeof g.name !== 'string' || !Array.isArray(g.executables)) continue;
    const exes = g.executables.filter(e => typeof e === 'string' && e.length <= 128).map(e => e.toLowerCase());
    if (!exes.length) continue;
    out.push({ id: g.id ?? null, name: g.name.slice(0, 64), exes, titleHint: typeof g.titleHint === 'string' && g.titleHint ? g.titleHint.toLowerCase() : null });
  }
  return out;
}

/**
 * Wybiera grę: games — znormalizowana lista; running — Set nazw exe; titles — Map exe → [tytuły okien] (tylko dla gier z titleHint);
 * current — aktualnie zgłoszona gra (wolimy ją zostawić, żeby nie przeskakiwać między dwiema uruchomionymi).
 */
function pickGame(games, running, titles, current) {
  const ok = g => g.exes.some(e => running.has(e) && (!g.titleHint || (titles && (titles.get(e) || []).some(t => t.toLowerCase().includes(g.titleHint)))));
  if (current) { const still = games.find(g => g.name === current.name && ok(g)); if (still) return still; }
  return games.find(ok) || null;
}

/** Które exe trzeba sprawdzić dokładniej (z tytułami okien), bo gra ma titleHint i exe działa. */
function exesNeedingTitles(games, running) {
  const s = new Set();
  for (const g of games) if (g.titleHint) for (const e of g.exes) if (running.has(e)) s.add(e);
  return [...s];
}

module.exports = { parseCsvLine, parseTasklist, normalizeGames, pickGame, exesNeedingTitles };
