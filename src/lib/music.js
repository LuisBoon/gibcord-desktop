'use strict';
/* „Czego słuchasz” — Spotify na tym komputerze (GibCord 1.0.5).
   Jeden lekki proces PowerShell co 4 s wypisuje (UTF-8, JSON w linii), co gra:
   1) przez systemowe sterowanie multimediami Windows (to samo, co pokazuje się przy przyciskach głośności):
      tytuł, wykonawca, album, pauza, pozycja i długość utworu — dokładnie;
   2) awaryjnie z tytułu okna Spotify („Wykonawca - Utwór”) — bez pauzy i pozycji.
   tasklist nie nadaje się do tytułów piosenek: zwraca je w kodowaniu konsoli (CP852), więc „ł”, „ż” by się psuły. */

/* ---------- skrypt pomocnika (Windows PowerShell 5.1) ---------- */
const HELPER_PS = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$out = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), (New-Object System.Text.UTF8Encoding $false))
$out.AutoFlush = $true
$parentId = [int]$env:GIBCORD_PARENT_PID
$mgr = $null
$asTask = $null
function Wait-Op($op, [Type]$type) {
  $t = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  [void]$t.Wait(5000)
  return $t.Result
}
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties, Windows.Media.Control, ContentType = WindowsRuntime]
  $asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation` + '`' + String.raw`1' } | Select-Object -First 1
  $mgr = Wait-Op ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
} catch { $mgr = $null }
$out.WriteLine((ConvertTo-Json @{ ready = $true; smtc = [bool]$mgr } -Compress))
while ($true) {
  if ($parentId -gt 0 -and -not (Get-Process -Id $parentId -ErrorAction SilentlyContinue)) { exit 0 }
  $r = $null
  if ($mgr) {
    try {
      foreach ($s in $mgr.GetSessions()) {
        if ([string]$s.SourceAppUserModelId -notmatch 'spotify') { continue }
        $p = Wait-Op ($s.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
        $i = $s.GetPlaybackInfo()
        $tl = $s.GetTimelineProperties()
        $r = @{ src = 'smtc'; title = [string]$p.Title; artist = [string]$p.Artist; album = [string]$p.AlbumTitle
          playing = ([string]$i.PlaybackStatus -eq 'Playing')
          pos = [int64]$tl.Position.TotalMilliseconds; dur = [int64]$tl.EndTime.TotalMilliseconds
          upd = [int64]$tl.LastUpdatedTime.ToUnixTimeMilliseconds(); now = [int64][DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() }
        break
      }
    } catch { $r = $null }
  }
  if (-not $r) {
    try {
      $w = Get-Process -Name Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1 -ExpandProperty MainWindowTitle
      if ($w) { $r = @{ src = 'title'; window = [string]$w } }
    } catch { $r = $null }
  }
  if ($r) { $out.WriteLine((ConvertTo-Json $r -Compress)) } else { $out.WriteLine('{}') }
  Start-Sleep -Seconds 4
}
`;
/** -EncodedCommand: base64 z UTF-16LE — bez kłopotów z cudzysłowami w wierszu poleceń. */
const helperArgs = () => ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from(HELPER_PS, 'utf16le').toString('base64')];

/* ---------- odczyt próbek ---------- */
const SKIP_TITLES = new Set(['spotify', 'spotify free', 'spotify premium', 'advertisement', 'reklama', 'spotify advertisement']);
/** Tytuł okna Spotify → { artists, title } albo null (pauza, reklama, sam program). Dzielimy na PIERWSZYM „ - ”, bo tytuły mają „ - Remastered”. */
function parseWindowTitle(t) {
  t = String(t || '').replace(/\s+/g, ' ').trim();
  if (!t || SKIP_TITLES.has(t.toLowerCase())) return null;
  const i = t.indexOf(' - ');
  if (i <= 0) return null;
  const artists = t.slice(0, i).trim(), title = t.slice(i + 3).trim();
  if (!artists || !title) return null;
  return { artists: artists.slice(0, 200), title: title.slice(0, 200) };
}
/**
 * Linia JSON od pomocnika → próbka { artists, title, album?, playing, startedAt?, durationMs? } albo null (nic nie gra / reklama).
 * startedAt (kiedy utwór by się zaczął, gdyby grał bez przerwy) liczymy tylko z dokładnej pozycji Windows.
 */
function parseSample(j, now = Date.now()) {
  if (!j || typeof j !== 'object') return null;
  if (j.src === 'smtc') {
    const title = String(j.title || '').trim(), artists = String(j.artist || '').trim();
    if (!title || !artists || SKIP_TITLES.has(title.toLowerCase())) return null; // reklama: brak wykonawcy
    const s = { artists: artists.slice(0, 200), title: title.slice(0, 200), album: String(j.album || '').trim().slice(0, 200), playing: !!j.playing };
    const dur = Number(j.dur) || 0, pos = Number(j.pos) || 0;
    if (dur >= 10e3 && dur <= 3 * 3600e3 && pos >= 0 && pos <= dur + 5e3) {
      // pozycja jest „na chwilę upd”; zegar pomocnika i aplikacji to ten sam komputer
      const at = Number(j.upd) > 0 ? Number(j.upd) : now;
      const posNow = s.playing ? pos + Math.max(0, (Number(j.now) || now) - at) : pos;
      s.durationMs = dur;
      if (posNow <= dur + 5e3) s.startedAt = now - Math.min(posNow, dur);
    }
    return s;
  }
  if (j.src === 'title') { const w = parseWindowTitle(j.window); return w ? { ...w, playing: true } : null; }
  return null;
}

/* ---------- co zgłaszamy (pauza, wznowienie, zmiana utworu) ---------- */
/**
 * Pilnuje, żeby status nie migał: pauza krótsza niż graceMs nic nie zmienia, dłuższa chowa status.
 * Pasek postępu (startedAt) tylko gdy wiadomo, gdzie jest utwór: z Windows albo po zmianie utworu na żywo
 * (następny utwór zawsze startuje od 0). Po wznowieniu tego samego utworu przesuwamy start o czas pauzy.
 * update(próbka|null, teraz) → nowy stan do wysłania albo undefined, gdy bez zmian.
 */
function createTracker({ graceMs = 20000, intervalMs = 4000 } = {}) {
  let cur = null, pausedAt = null, lastPlaying = null;
  const same = (a, b) => !!a && !!b && a.artists === b.artists && a.title === b.title;
  const pub = () => cur ? { artists: cur.artists, title: cur.title, ...(cur.album ? { album: cur.album } : {}), startedAt: cur.startedAt || null, durationMs: cur.durationMs || null } : null;
  return {
    get current() { return pub(); },
    update(s, now = Date.now()) {
      const playing = s && s.playing ? s : null;
      if (!playing) {
        if (!cur) { lastPlaying = null; return undefined; }
        if (pausedAt == null) pausedAt = now;
        if (now - pausedAt >= graceMs) { cur = null; pausedAt = null; lastPlaying = null; return null; }
        return undefined;
      }
      const prev = lastPlaying; lastPlaying = { artists: playing.artists, title: playing.title, at: now };
      if (same(cur, playing)) {
        let changed = false;
        if (playing.startedAt) {
          if (!cur.startedAt || Math.abs(cur.startedAt - playing.startedAt) > 3000) { cur.startedAt = playing.startedAt; changed = true; } // przewinięcie / pierwsza dokładna pozycja
        } else if (pausedAt != null && cur.startedAt) { cur.startedAt += now - pausedAt; changed = true; }
        if (playing.durationMs && cur.durationMs !== playing.durationMs) { cur.durationMs = playing.durationMs; changed = true; }
        pausedAt = null;
        return changed ? pub() : undefined;
      }
      // inny utwór
      let startedAt = playing.startedAt || null;
      if (!startedAt && prev && !same(prev, playing) && now - prev.at <= intervalMs * 2.5) startedAt = now - Math.round(intervalMs / 2); // przeskok na żywo
      cur = { artists: playing.artists, title: playing.title, album: playing.album || '', startedAt, durationMs: playing.durationMs || null };
      pausedAt = null;
      return pub();
    },
    reset() { const had = !!cur; cur = null; pausedAt = null; lastPlaying = null; return had ? null : undefined; },
  };
}

module.exports = { HELPER_PS, helperArgs, parseWindowTitle, parseSample, createTracker };
