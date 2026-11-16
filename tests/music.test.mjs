import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const music = require('../src/lib/music.js');

test('music: tytuł okna Spotify → wykonawca i utwór (polskie znaki, „ - Remastered”)', () => {
  assert.deepEqual(music.parseWindowTitle('Dawid Podsiadło - Małomiasteczkowy'), { artists: 'Dawid Podsiadło', title: 'Małomiasteczkowy' });
  assert.deepEqual(music.parseWindowTitle('Lady Pank - Tańcz, głupia, tańcz - Remastered 2011'), { artists: 'Lady Pank', title: 'Tańcz, głupia, tańcz - Remastered 2011' });
  assert.deepEqual(music.parseWindowTitle('Sanah, Vito Bambino - Ostatnia nadzieja'), { artists: 'Sanah, Vito Bambino', title: 'Ostatnia nadzieja' });
  for (const t of ['Spotify', 'Spotify Premium', 'Spotify Free', 'Advertisement', '', 'N/A', 'Bez myślnika']) assert.equal(music.parseWindowTitle(t), null, t);
});

test('music: próbka z Windows (sterowanie multimediami) → pozycja i początek utworu', () => {
  const now = 1_000_000_000;
  const s = music.parseSample({ src: 'smtc', title: 'Małomiasteczkowy', artist: 'Dawid Podsiadło', album: 'Małomiasteczkowy', playing: true, pos: 60_000, dur: 221_000, upd: now - 4_000, now }, now);
  assert.equal(s.artists, 'Dawid Podsiadło'); assert.equal(s.album, 'Małomiasteczkowy'); assert.equal(s.durationMs, 221_000);
  assert.equal(s.startedAt, now - 64_000); // pozycja z chwili upd + 4 s grania
  const paused = music.parseSample({ src: 'smtc', title: 'X', artist: 'Y', playing: false, pos: 10_000, dur: 200_000, upd: now - 50_000, now }, now);
  assert.equal(paused.playing, false); assert.equal(paused.startedAt, now - 10_000);
  assert.equal(music.parseSample({ src: 'smtc', title: 'Advertisement', artist: '', playing: true }, now), null, 'reklama bez wykonawcy');
  const noTl = music.parseSample({ src: 'smtc', title: 'A', artist: 'B', playing: true, pos: 0, dur: 0 }, now);
  assert.equal(noTl.startedAt, undefined, 'bez osi czasu — bez pozycji');
  assert.deepEqual(music.parseSample({ src: 'title', window: 'Kult - Arahja' }, now), { artists: 'Kult', title: 'Arahja', playing: true });
  assert.equal(music.parseSample({}, now), null);
});

test('music: pauza krótsza niż 20 s nie miga, dłuższa chowa status, wznowienie przesuwa początek', () => {
  const t = music.createTracker({ graceMs: 20_000, intervalMs: 4_000 });
  const song = { artists: 'Kult', title: 'Arahja', playing: true };
  let r = t.update(song, 0);
  assert.deepEqual(r, { artists: 'Kult', title: 'Arahja', startedAt: null, durationMs: null }, 'pierwszy raz: pozycja nieznana');
  assert.equal(t.update(song, 4_000), undefined);
  assert.equal(t.update(null, 8_000), undefined, 'pauza — jeszcze nic');
  assert.equal(t.update(null, 20_000), undefined);
  assert.equal(t.update(song, 24_000), undefined, 'wznowienie przed upływem 20 s, pozycja dalej nieznana');
  assert.equal(t.update({ ...song, playing: false }, 28_000), undefined);
  assert.equal(t.update(null, 48_100), null, 'po 20 s pauzy status znika');
  assert.equal(t.update(null, 52_000), undefined);
});

test('music: przeskok na kolejny utwór na żywo daje pasek postępu, wznowienie go przesuwa', () => {
  const t = music.createTracker({ graceMs: 20_000, intervalMs: 4_000 });
  t.update({ artists: 'A', title: 'Jeden', playing: true }, 0);
  const r = t.update({ artists: 'A', title: 'Dwa', playing: true }, 4_000);
  assert.equal(r.title, 'Dwa'); assert.equal(r.startedAt, 2_000, 'kolejny utwór startuje od zera (± pół odstępu)');
  assert.equal(t.update(null, 8_000), undefined);
  const back = t.update({ artists: 'A', title: 'Dwa', playing: true }, 18_000);
  assert.equal(back.startedAt, 12_000, 'pauza 10 s przesuwa początek o 10 s');
});

test('music: dokładna pozycja z Windows wygrywa, przewinięcie aktualizuje', () => {
  const t = music.createTracker();
  const r = t.update({ artists: 'A', title: 'B', playing: true, startedAt: 1_000, durationMs: 180_000 }, 5_000);
  assert.equal(r.startedAt, 1_000); assert.equal(r.durationMs, 180_000);
  assert.equal(t.update({ artists: 'A', title: 'B', playing: true, startedAt: 2_500, durationMs: 180_000 }, 9_000), undefined, 'drobna różnica — bez wysyłania');
  assert.equal(t.update({ artists: 'A', title: 'B', playing: true, startedAt: -40_000, durationMs: 180_000 }, 13_000).startedAt, -40_000, 'przewinięcie do przodu');
  assert.equal(t.reset(), null); assert.equal(t.reset(), undefined);
});

test('music: skrypt pomocnika — kodowanie i najważniejsze elementy', () => {
  const args = music.helperArgs();
  const ps = Buffer.from(args[args.length - 1], 'base64').toString('utf16le');
  assert.equal(ps, music.HELPER_PS);
  assert.ok(ps.includes("'IAsyncOperation`1'"), 'nazwa typu z odwrotnym apostrofem');
  assert.ok(ps.includes('GlobalSystemMediaTransportControlsSessionManager'));
  assert.ok(ps.includes('GIBCORD_PARENT_PID'), 'pomocnik kończy się razem z aplikacją');
  assert.ok(ps.includes('UTF8Encoding'), 'wyjście w UTF-8, nie w kodowaniu konsoli');
  assert.ok(!ps.includes('${'), 'bez przypadkowej interpolacji JS');
});

/* Na prawdziwym Windows (GitHub Actions przed zbudowaniem wydania): pomocnik startuje, ładuje się bez błędów i wypisuje próbki. */
test('music: pomocnik PowerShell działa na Windows', { skip: process.platform !== 'win32' && 'tylko Windows', timeout: 60_000 }, async () => {
  const { spawn } = await import('node:child_process');
  const child = spawn('powershell.exe', music.helperArgs(), { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIBCORD_PARENT_PID: String(process.pid) } });
  let out = '', err = '';
  child.stdout.setEncoding('utf8'); child.stdout.on('data', d => { out += d; });
  child.stderr.on('data', d => { err += d; });
  try {
    const t0 = Date.now();
    while (out.split('\n').filter(Boolean).length < 2 && Date.now() - t0 < 45_000 && child.exitCode == null) await new Promise(r => setTimeout(r, 250));
    const lines = out.split('\n').map(l => l.trim()).filter(Boolean);
    assert.ok(lines.length >= 2, `pomocnik nic nie wypisał. stderr: ${err.slice(0, 2000)}`);
    const first = JSON.parse(lines[0]);
    assert.equal(first.ready, true);
    console.log('pomocnik: sterowanie multimediami Windows =', first.smtc);
    const sample = JSON.parse(lines[1]);
    assert.equal(typeof sample, 'object');
    assert.equal(music.parseSample(sample), null, 'na maszynie do budowania nic nie gra');
    assert.ok(!/Exception|CategoryInfo|FullyQualifiedErrorId/.test(err), `błąd PowerShell: ${err.slice(0, 2000)}`);
  } finally {
    child.kill();
    child.stdout.destroy(); child.stderr.destroy(); // na Windows otwarte potoki potrafią trzymać proces testów
    await Promise.race([new Promise(r => child.exitCode != null || child.signalCode != null ? r() : child.once('exit', r)), new Promise(r => setTimeout(r, 5000))]);
  }
});
