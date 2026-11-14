'use strict';
/* Prosty dziennik do pliku w katalogu danych aplikacji: logs/main.log (z rotacją przy ~1 MB). */
const fs = require('fs');
const path = require('path');

function createLogger(dir) {
  const logDir = path.join(dir, 'logs');
  const file = path.join(logDir, 'main.log');
  try { fs.mkdirSync(logDir, { recursive: true }); } catch {}
  const write = (lvl, args) => {
    const line = `${new Date().toISOString()} [${lvl}] ${args.map(a => a instanceof Error ? (a.stack || a.message) : typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`;
    try {
      const st = fs.statSync(file, { throwIfNoEntry: false });
      if (st && st.size > 1_000_000) fs.renameSync(file, file + '.1');
      fs.appendFileSync(file, line);
    } catch {}
    if (process.env.GIBCORD_DEBUG) process.stdout.write(line);
  };
  return {
    file,
    info: (...a) => write('info', a),
    warn: (...a) => write('warn', a),
    error: (...a) => write('error', a),
    debug: (...a) => { if (process.env.GIBCORD_DEBUG) write('debug', a); },
  };
}

module.exports = { createLogger };
