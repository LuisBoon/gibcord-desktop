'use strict';
(() => {
  const q = new URLSearchParams(location.search);
  let target = 'https://gibcord.luisboon.pl';
  try { const u = new URL(q.get('u') || ''); if (u.protocol === 'https:' || u.protocol === 'http:') target = u.origin; } catch {}
  const err = q.get('e'); if (err) document.getElementById('err').textContent = 'Błąd: ' + err.slice(0, 120);
  const go = () => location.replace(target);
  let left = 15;
  const t = setInterval(() => { left--; document.getElementById('sec').textContent = String(Math.max(0, left)); if (left <= 0) { clearInterval(t); go(); } }, 1000);
  document.getElementById('retry').onclick = go;
  addEventListener('online', go);
})();
