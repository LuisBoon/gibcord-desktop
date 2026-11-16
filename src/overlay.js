'use strict';
/* Rysowanie nakładki. Wszystko przez textContent / atrybuty — nazwy ludzi nigdy nie trafiają do innerHTML. */
(() => {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = (cls, d) => { const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('class', cls); for (const p of d) { const e = document.createElementNS(NS, 'path'); e.setAttribute('d', p); s.appendChild(e); } return s; };
  const MIC_OFF = ['M3 3l18 18', 'M9 9v3a3 3 0 0 0 5 2', 'M15 10V5a3 3 0 0 0-6 0', 'M5 11a7 7 0 0 0 12 4', 'M12 19v3'];
  const HEAD_OFF = ['M3 3l18 18', 'M4 15v-3a8 8 0 0 1 13-6.2', 'M20 12v3', 'M4 15h3v5H5a1 1 0 0 1-1-1z', 'M20 15h-3v5h2a1 1 0 0 0 1-1z'];
  const SPEAKER = ['M4 9h4l5-4v14l-5-4H4z', 'M17 9a4 4 0 0 1 0 6'];
  const ch = document.getElementById('ch'), list = document.getElementById('list'), more = document.getElementById('more');
  const plural = n => n === 1 ? 'osoba' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'osoby' : 'osób';
  const rows = new Map(); // id → wiersz (bez migania obrazków przy każdej zmianie „kto mówi”)

  function row(m) {
    let r = rows.get(m.id);
    const key = `${m.name}|${m.avatar || ''}|${m.color}|${m.initial}`;
    if (!r || r.key !== key) {
      r = { el: document.createElement('div'), key };
      r.el.className = 'r';
      const av = document.createElement('span'); av.className = 'av';
      if (m.avatar) { const img = document.createElement('img'); img.alt = ''; img.src = m.avatar; img.onerror = () => { img.remove(); av.style.background = m.color; av.textContent = m.initial; }; av.appendChild(img); }
      else { av.style.background = m.color; av.textContent = m.initial; }
      const n = document.createElement('span'); n.className = 'n'; n.textContent = m.name;
      r.el.append(av, n);
      r.icon = null;
      rows.set(m.id, r);
    }
    r.el.classList.toggle('t', m.talking && !m.muted && !m.deaf);
    r.el.classList.toggle('q', m.muted || m.deaf);
    const want = m.deaf ? 'deaf' : m.muted ? 'mute' : '';
    if ((r.icon && r.icon.kind) !== want) {
      if (r.icon) r.icon.el.remove();
      r.icon = want ? { kind: want, el: svg('ic', want === 'deaf' ? HEAD_OFF : MIC_OFF) } : null;
      if (r.icon) r.el.appendChild(r.icon.el);
    }
    return r.el;
  }

  function render(d) {
    const s = d && d.state;
    document.documentElement.style.setProperty('--k', String(d && d.scale || 1));
    document.body.className = d && d.corner ? `${d.corner[0] === 'b' ? 'cb' : ''} ${d.corner[1] === 'r' ? 'cr' : ''}`.trim() : ''; // nie „r” — tak nazywa się wiersz
    if (!s) { ch.hidden = true; more.hidden = true; list.replaceChildren(); rows.clear(); return; }
    ch.hidden = !s.channel;
    if (s.channel) { ch.replaceChildren(svg('sp', SPEAKER), document.createTextNode(s.channel)); }
    const seen = new Set(s.members.map(m => m.id));
    for (const id of [...rows.keys()]) if (!seen.has(id)) rows.delete(id);
    list.replaceChildren(...s.members.map(row));
    more.hidden = !s.more;
    if (s.more) more.textContent = `i ${s.more} ${s.more === 1 ? 'inna' : plural(s.more) === 'osoby' ? 'inne' : 'innych'} ${plural(s.more)}`;
  }

  window.gcOverlay.onState(render);
})();
