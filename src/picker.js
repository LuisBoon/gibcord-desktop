'use strict';
/* Okno wyboru: ekrany i okna z miniaturami. Dwuklik albo Enter udostępnia, Esc anuluje. */
(() => {
  const $ = s => document.querySelector(s);
  let data = { audio: false, sources: [] }, kind = 'screen', chosen = null;

  function tile(s) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'src' + (s.id === chosen ? ' on' : ''); b.dataset.id = s.id; b.title = s.name;
    const th = document.createElement('span'); th.className = 'th'; if (s.thumb) th.style.backgroundImage = `url("${s.thumb}")`;
    const nm = document.createElement('span'); nm.className = 'nm';
    if (s.icon) { const i = document.createElement('img'); i.src = s.icon; i.alt = ''; nm.appendChild(i); }
    const t = document.createElement('span'); t.textContent = s.kind === 'screen' && /^(Entire screen|Screen \d+)$/i.test(s.name) ? s.name.replace(/^Entire screen$/i, 'Cały ekran').replace(/^Screen (\d+)$/i, 'Ekran $1') : s.name;
    nm.appendChild(t);
    b.append(th, nm);
    b.onclick = () => select(s.id);
    b.ondblclick = () => { select(s.id); share(); };
    return b;
  }
  function draw() {
    const g = $('#grid'); g.textContent = '';
    const list = data.sources.filter(s => s.kind === kind);
    if (!list.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = kind === 'screen' ? 'Nie widzę żadnego ekranu.' : 'Brak otwartych okien do pokazania.'; g.appendChild(p); }
    for (const s of list) g.appendChild(tile(s));
    document.querySelectorAll('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.k === kind));
    $('#ok').disabled = !chosen || !data.sources.some(s => s.id === chosen);
  }
  function select(id) { chosen = id; draw(); }
  function share() { if (!chosen) return; window.picker.choose(chosen, data.audio && $('#audio').checked); }

  document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => { kind = b.dataset.k; draw(); });
  $('#cancel').onclick = () => window.picker.cancel();
  $('#ok').onclick = share;
  addEventListener('keydown', e => { if (e.key === 'Escape') window.picker.cancel(); else if (e.key === 'Enter' && chosen) share(); });

  window.picker.list().then(d => {
    data = d || data;
    $('#aud').hidden = !data.audio;
    $('#audio').checked = !!data.audio;
    const screens = data.sources.filter(s => s.kind === 'screen');
    if (screens.length === 1) chosen = screens[0].id; // jeden monitor — od razu zaznaczony
    draw();
  });
})();
