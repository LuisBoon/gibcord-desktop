#!/usr/bin/env node
/*
 * Generuje wszystkie ikony aplikacji z logo SVG.
 *
 *   node build/make-icons.mjs [ścieżka/do/logo.svg]
 *
 * Domyślne logo: /var/www/dc-next/icon.svg (albo zmienna GIBCORD_LOGO).
 * Potrzebny Chromium/Chrome/Edge (bez okna) — ścieżkę można podać w zmiennej CHROME.
 * Po zmianie logo uruchom skrypt jeszcze raz i zatwierdź zmienione pliki w build/ i assets/.
 *
 * Tworzy:
 *   build/icon.ico            — ikona programu i instalatora (16–256 px)
 *   build/icon.png            — 512 px
 *   assets/icon.ico, icon.png — ikona okna
 *   assets/tray.ico/.png      — ikona w zasobniku (16–64 px)
 *   assets/tray-unread.ico/.png — to samo z czerwoną kropką (nieprzeczytane)
 *   assets/badges/1..9.png, 9plus.png — liczniki nakładane na ikonę na pasku zadań
 */
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SVG_PATH = resolve(process.argv[2] || process.env.GIBCORD_LOGO || '/var/www/dc-next/icon.svg');
const svgText = readFileSync(SVG_PATH, 'utf8');
if (!/<svg[\s>]/i.test(svgText)) throw new Error(`To nie wygląda na plik SVG: ${SVG_PATH}`);

/* ---------- PNG i ICO bez zewnętrznych bibliotek ---------- */
const CRC = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = buf => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
/* Wpis BMP (DIB 32 bpp) — najlepiej rozumiany przez Windows, NSIS i stare narzędzia. */
function encodeDib(w, h, rgba) {
  const maskRow = Math.ceil(w / 32) * 4;
  const hdr = Buffer.alloc(40);
  hdr.writeUInt32LE(40, 0); hdr.writeInt32LE(w, 4); hdr.writeInt32LE(h * 2, 8); hdr.writeUInt16LE(1, 12); hdr.writeUInt16LE(32, 14);
  hdr.writeUInt32LE(0, 16); hdr.writeUInt32LE(w * h * 4 + maskRow * h, 20);
  const px = Buffer.alloc(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const s = (y * w + x) * 4, d = ((h - 1 - y) * w + x) * 4;
    px[d] = rgba[s + 2]; px[d + 1] = rgba[s + 1]; px[d + 2] = rgba[s]; px[d + 3] = rgba[s + 3];
  }
  return Buffer.concat([hdr, px, Buffer.alloc(maskRow * h)]);
}
function encodeIco(images) { // images: [{w, h, rgba}], 256 px jako PNG, mniejsze jako BMP
  const parts = images.map(im => im.w >= 256 ? encodePng(im.w, im.h, im.rgba) : encodeDib(im.w, im.h, im.rgba));
  const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  const dir = Buffer.alloc(16 * images.length);
  let off = 6 + dir.length;
  images.forEach((im, i) => {
    const o = i * 16;
    dir[o] = im.w >= 256 ? 0 : im.w; dir[o + 1] = im.h >= 256 ? 0 : im.h; dir[o + 2] = 0; dir[o + 3] = 0;
    dir.writeUInt16LE(1, o + 4); dir.writeUInt16LE(32, o + 6); dir.writeUInt32LE(parts[i].length, o + 8); dir.writeUInt32LE(off, o + 12);
    off += parts[i].length;
  });
  return Buffer.concat([head, dir, ...parts]);
}

/* ---------- przeglądarka bez okna (CDP) ---------- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
function findChrome() {
  const list = [process.env.CHROME, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
  const hit = list.find(p => existsSync(p));
  if (!hit) throw new Error('Nie znalazłem Chromium/Chrome/Edge. Podaj ścieżkę w zmiennej CHROME.');
  return hit;
}
async function withBrowser(fn) {
  const prof = mkdtempSync(join(tmpdir(), 'gibcord-icons-'));
  const proc = spawn(findChrome(), ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${prof}`, 'about:blank'], { stdio: 'ignore' });
  try {
    let port;
    for (let i = 0; i < 100 && !port; i++) { try { port = +readFileSync(join(prof, 'DevToolsActivePort'), 'utf8').split('\n')[0]; } catch {} if (!port) await sleep(100); }
    if (!port) throw new Error('Przeglądarka nie wystartowała');
    let page;
    for (let i = 0; i < 50 && !page; i++) { try { page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page'); } catch {} if (!page) await sleep(100); }
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    let id = 0; const pend = new Map();
    ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); } };
    const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async expr => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    const out = await fn(evaluate);
    ws.close();
    return out;
  } finally { proc.kill(); await sleep(300); try { rmSync(prof, { recursive: true, force: true }); } catch {} }
}

/* Kod wykonywany w przeglądarce: rysuje logo / licznik na płótnie i zwraca piksele RGBA (base64). */
const PAGE_CODE = `
window.__svg = ${JSON.stringify(svgText)};
window.__logo = async (size) => {
  const doc = new DOMParser().parseFromString(window.__svg, 'image/svg+xml');
  const root = doc.documentElement; root.setAttribute('width', size); root.setAttribute('height', size);
  const url = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(doc))));
  const img = new Image(); img.src = url; await img.decode();
  return img;
};
window.__pixels = (cv) => { const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let s = ''; for (let i = 0; i < d.length; i += 0x8000) s += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000)); return btoa(s); };
window.__render = async (spec) => {
  const n = spec.size, cv = document.createElement('canvas'); cv.width = cv.height = n;
  const g = cv.getContext('2d'); g.imageSmoothingQuality = 'high';
  if (spec.kind === 'logo') {
    g.drawImage(await window.__logo(n), 0, 0, n, n);
    if (spec.dot) {
      const r = Math.max(3, n * 0.25), cx = n - r - n * 0.02, cy = n - r - n * 0.02;
      g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(cx, cy, r + Math.max(1, n * 0.07), 0, Math.PI * 2); g.fill();
      g.globalCompositeOperation = 'source-over'; g.fillStyle = '#f23f43'; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    }
  } else if (spec.kind === 'badge') {
    g.fillStyle = '#f23f43'; g.beginPath(); g.arc(n / 2, n / 2, n / 2, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = '800 ' + Math.round(n * (spec.text.length > 1 ? 0.5 : 0.66)) + 'px "Segoe UI", Arial, "Liberation Sans", "DejaVu Sans", sans-serif';
    g.fillText(spec.text, n / 2, n / 2 + n * 0.04);
  }
  return { w: n, h: n, b64: window.__pixels(cv) };
};
true;`;

const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256];
const TRAY_SIZES = [16, 20, 24, 32, 40, 48, 64];

const t0 = Date.now();
const result = await withBrowser(async evaluate => {
  await evaluate(PAGE_CODE);
  const get = async spec => { const r = await evaluate(`window.__render(${JSON.stringify(spec)})`); return { w: r.w, h: r.h, rgba: Buffer.from(r.b64, 'base64') }; };
  const icon = []; for (const s of ICON_SIZES) icon.push(await get({ kind: 'logo', size: s }));
  const big = await get({ kind: 'logo', size: 512 });
  const unread = []; for (const s of TRAY_SIZES) unread.push(await get({ kind: 'logo', size: s, dot: true }));
  const badges = {}; for (const t of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']) badges[t] = await get({ kind: 'badge', size: 32, text: t });
  return { icon, big, unread, badges };
});

const W = (rel, buf) => { const p = join(ROOT, rel); mkdirSync(dirname(p), { recursive: true }); writeFileSync(p, buf); return rel; };
const pick = (list, sizes) => list.filter(im => sizes.includes(im.w));
const written = [
  W('build/icon.ico', encodeIco(pick(result.icon, [16, 20, 24, 32, 40, 48, 64, 128, 256]))),
  W('build/icon.png', encodePng(512, 512, result.big.rgba)),
  W('assets/icon.ico', encodeIco(pick(result.icon, [16, 20, 24, 32, 40, 48, 64, 128, 256]))),
  W('assets/icon.png', encodePng(256, 256, result.icon.find(i => i.w === 256).rgba)),
  W('assets/tray.ico', encodeIco(pick(result.icon, TRAY_SIZES))),
  W('assets/tray.png', encodePng(32, 32, result.icon.find(i => i.w === 32).rgba)),
  W('assets/tray-unread.ico', encodeIco(result.unread)),
  W('assets/tray-unread.png', encodePng(32, 32, result.unread.find(i => i.w === 32).rgba)),
  ...Object.entries(result.badges).map(([t, im]) => W(`assets/badges/${t === '9+' ? '9plus' : t}.png`, encodePng(im.w, im.h, im.rgba))),
];
console.log(`Logo: ${SVG_PATH}\nZapisano ${written.length} plików w ${((Date.now() - t0) / 1000).toFixed(1)} s:\n  ` + written.join('\n  '));
