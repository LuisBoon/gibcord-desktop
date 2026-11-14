# GibCord na Windows

Aplikacja na komputer dla GibCorda. To „cienka” powłoka (Electron): okno ładuje stronę
**https://gibcord.luisboon.pl** (stary adres `dc.luisboon.pl` też jest dozwolony, bo przekierowuje na nowy),
a aplikacja dokłada to, czego przeglądarka nie potrafi:

| Funkcja | Jak działa |
| --- | --- |
| **Naciśnij, by mówić wszędzie** | Klawisz z *Ustawienia → Głos i dźwięk* działa też w grze i gdy okno jest schowane (uiohook-napi). Można ustawić boczny przycisk myszy. Hak klawiatury włącza się tylko w trybie „naciśnij, by mówić” i tylko w rozmowie. |
| **Zasobnik i autostart** | Krzyżyk chowa okno obok zegara (rozmowa trwa dalej). Menu ikony: otwórz, wycisz mikrofon, wygłusz, uruchamiaj z Windows, ustawienia, aktualizacje, zakończ. Przy pierwszym uruchomieniu autostart jest włączony (ze startem schowanym) — można to wyłączyć. |
| **Licznik i miganie** | Liczba oznaczeń na ikonie na pasku zadań, czerwona kropka na ikonie w zasobniku, miganie przy nowym oznaczeniu. |
| **Linki `gibcord://`** | `gibcord://i/KOD` (zaproszenie), `gibcord://kanal/SERWER/KANAŁ`, `gibcord://serwer/ID`, `gibcord://dm/ID`, `gibcord://wydarzenia/ID`. Linki do GibCorda w czacie otwierają się w aplikacji. |
| **W co grasz** | Co 15 s `tasklist` porównywany z listą gier z serwera (`GET /api/games/detectable`, odświeżana co 6 h, kopia na dysku). Gra trafia na serwer przez `/ws?client=desktop` (`game_set` / `game_clear`). Do wyłączenia w ustawieniach. |
| **Udostępnianie ekranu** | Własne okno wyboru ekranu/okna z miniaturami i opcją dźwięku z komputera. |
| **Aktualizacje** | Same się pobierają z wydań na GitHubie (electron-updater) i instalują przy ponownym uruchomieniu; strona pokazuje pasek „Uruchom ponownie”. |
| **Brak internetu** | Zamiast białego okna — ekran „Nie mogę połączyć się z GibCordem” z ponawianiem co 15 s. |

Po stronie strony całą obsługę robi `js/desktop.js` (most `window.gibcordDesktop` z `src/preload.js`).

## Bezpieczeństwo

- Strona nie ma dostępu do Node ani plików: `contextIsolation`, `sandbox`, bez `nodeIntegration`; most udostępnia tylko kilka funkcji, a proces główny sprawdza, że wiadomość przyszła z głównego okna i z adresu GibCorda.
- W oknie otwiera się tylko GibCord; każda inna strona (także logowanie do Spotify) idzie do zwykłej przeglądarki.
- Mikrofon, kamera, ekran i powiadomienia — tylko dla adresu GibCorda.
- Narzędzia deweloperskie są wyłączone (włącza je tylko `npm run dev` / `--devtools`).
- Aplikacja nie jest podpisana certyfikatem — Windows SmartScreen przy pierwszej instalacji pokaże „System Windows ochronił komputer”: **Więcej informacji → Uruchom mimo to**. Aktualizacje nie wymagają podpisu (w konfiguracji celowo nie ma `publisherName`).

## Praca nad aplikacją

```bash
npm install
npm test                 # testy (node:test) — działają też bez ekranu
npm start                # uruchom (na komputerze z ekranem)
npm run dev              # z narzędziami deweloperskimi (Ctrl+Shift+I)
GIBCORD_URL=http://127.0.0.1:8094 npm start   # inna kopia serwera
GIBCORD_DEBUG=1 npm start                     # dziennik także na konsolę
```

Ikony generuje skrypt z logo SVG — po zmianie logo:

```bash
node build/make-icons.mjs /var/www/dc-next/icon.svg   # potrzebny Chromium/Chrome/Edge (zmienna CHROME, jeśli nie w standardowym miejscu)
```

Zapisuje `build/icon.ico` (program i instalator), `assets/icon.*`, `assets/tray*.ico/png` (zasobnik, także z kropką)
i `assets/badges/*.png` (liczniki). Wygenerowane pliki trzeba zatwierdzić w repozytorium.

## Wydawanie (GitHub Actions)

Pierwszy raz:

1. Utwórz **publiczne** repozytorium `gibcord-desktop` (aktualizacje pobierają się bez tokenu tylko z publicznych wydań).
2. Wpisz nazwę konta zamiast `OWNER` w `package.json` (`build.publish[0].owner`) oraz w `js/desktop.js` strony (`DESKTOP_DOWNLOAD_URL`).
3. `git remote add origin git@github.com:KONTO/gibcord-desktop.git && git push -u origin main`
4. `git tag v1.0.0 && git push origin v1.0.0` — Actions (*Wydanie*) zbuduje instalator na Windows i opublikuje wydanie
   z `GibCord-Setup-1.0.0.exe` i `latest.yml`.

Każda kolejna wersja:

```bash
npm version patch          # 1.0.0 → 1.0.1 (zmienia package.json i robi tag v1.0.1)
git push && git push --tags
```

Zainstalowane aplikacje same sprawdzają aktualizacje przy starcie i co 4 godziny (oraz z menu w zasobniku).
Ręczne zbudowanie bez wydania: *Actions → Wydanie → Run workflow* (instalator w artefaktach).
Lokalnie na Windows: `npm run dist` → `dist/GibCord-Setup-X.Y.Z.exe`.

## Gdzie co leży (u użytkownika)

- Program: `%LOCALAPPDATA%\Programs\GibCord` (instalacja bez uprawnień administratora).
- Dane, sesja, ustawienia (`gibcord-settings.json`), lista gier: `%APPDATA%\GibCord`.
- Dziennik: `%APPDATA%\GibCord\logs\main.log` (aktualizacje, błędy, wykryte gry — bez treści wiadomości).

## Znane ograniczenia

- **Dźwięk z komputera** przy transmisji obejmuje wszystko, co gra komputer — także głosy z rozmowy (widzowie słyszą siebie z opóźnieniem). Electron nie umie pominąć dźwięku samego GibCorda; dlatego opcja jest opisana w oknie wyboru.
- **Gra uruchomiona jako administrator**: Windows nie przekazuje wtedy klawiszy do zwykłych programów, więc „naciśnij, by mówić” nie zadziała w tej grze (tak samo jak w Discordzie bez uprawnień administratora).
- Web Push w aplikacji jest wyłączony (Electron go nie obsługuje) — powiadomienia pokazuje działająca w tle aplikacja.
