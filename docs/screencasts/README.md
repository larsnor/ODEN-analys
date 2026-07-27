# Skärmfilmer

Fyra korta, tysta instruktionsfilmer (30–45 s): riktiga skärmbilder ur ODEN med
en animerad muspekare och tidsatta textrutor. Ingen inspelning behövs — filmerna
byggs av stillbilder.

## Pipeline

1. **Skärmbilder** (görs en gång, av operatören) → `assets/<ämne>/…png`
   enligt tagningslistan nedan.
2. **Förhandsgranska** i webbläsare: öppna `player.html?topic=<ämne>` via en
   lokal server (t.ex. `python3 -m http.server` i den här mappen) — spela,
   pausa, dra i tidslinjen.
3. **Rendera MP4**: `node capture.mjs` (kräver `npx playwright install chromium`
   i `plugin/` samt `ffmpeg`). Resultat: `out/<ämne>.mp4`, 30 fps, utan ljud.

Tidslinjerna (`timelines/*.json`) styr allt: vilka bilder som visas när, var
pekaren rör sig och vilka textrutor som visas. Pekarens koordinater kalibreras
mot de faktiska skärmbilderna efter tagning.

## Tagning — så här

- Kör det **färdiga demovalvet** (`ODEN-valv`, v1.1.2+) med mörkt tema.
- Gör Obsidian-fönstret ungefär **1440 × 900** (exakt storlek är inte kritisk —
  spelaren passar in bilden, men håll samma storlek genom hela tagningen).
- macOS: `Cmd-Shift-4` → `mellanslag` → **Alt-klick** på fönstret ger en ren
  bild utan skugga. Döp om filerna enligt listan och lägg dem i rätt mapp.
- Demodata: kör "Mata demodata" en bit in (5–10 min) innan flödesbilderna tas,
  så det finns larm, förslag och foton i flödet.

## Tagningslista (22 bilder)

### `assets/installation/` — Installation & första start
| Fil | Motiv |
|---|---|
| `01-release.png` | GitHub-releasesidan med `ODEN-valv-…zip` synlig (webbläsare). |
| `02-unzip.png` | Finder: den uppackade mappen `ODEN-valv` (gärna i Dokument). |
| `03-open-vault.png` | Obsidians valv-väljare med "Open folder as vault". |
| `04-trust.png` | Dialogen "Trust author and enable plugins". |
| `05-first-start.png` | Hela arbetsytan vid första start: karta + Välkommen uppe, graf + ODEN-panel nere. |

### `assets/omrade/` — Operationsområde & namngivna platser
| Fil | Motiv |
|---|---|
| `01-palette.png` | Kommandopaletten med "ODEN: Konfigurera operationsområde" markerad. |
| `02-modal.png` | Områdesdialogen med demokoordinaten ifylld. |
| `03-map.png` | Kartan centrerad med 🎯 Objektet-markören. |
| `04-places.png` | "Namngivna platser"-skärmen med formuläret ifyllt (namn + position + skyddsvärd ikryssad). |
| `05-place-map.png` | Kartan med 📌 grön nål + 🛡️ violett sköld synliga. |

### `assets/flodet/` — Flödet: larm, granskning och AI
| Fil | Motiv |
|---|---|
| `01-mata.png` | "Mata demodata"-dialogen (speltid 15). |
| `02-feed.png` | Flödet med några mottagna händelser + fordonsrader. |
| `03-larm.png` | Ett rött ⚠-larm i flödet, gärna med kartmarkör synlig samtidigt. |
| `04-chips.png` | Panelen med 📷/📝/💬-chipsen påslagna och ● qwen3-vl:4b-punkten. |
| `05-bildanalys.png` | Flödet med "📷 Bild mottagen, analys startad — TNR…". |
| `06-bildfynd.png` | "Bildfynd att granska" med foto + Bekräfta/Avvisa. |

### `assets/verktyg/` — Operatörens verktyg
| Fil | Motiv |
|---|---|
| `01-rightclick.png` | Högerklick på en rapport i filpanelen — den förenklade menyn med ODEN-valen. |
| `02-flagga.png` | Flödet med ett larm "flaggad av operatör". |
| `03-bevaka.png` | 🔭 Bevakningslistan överst i panelen med en rad "+N nya" (amber). |
| `04-aktor.png` | "Aktörsförslag att granska" med Evidenskedjan utfälld. |
| `05-namnge.png` | "Namnge aktör"-dialogen. |
| `06-chat.png` | Frågelådan med en fråga + svar som innehåller klickbara TNR-hänvisningar. |

## Efter tagning

Lägg bilderna i mapparna och säg till — pekarkoordinater och textrutornas
placering kalibreras mot bilderna, förhandsgranskning godkänns, och därefter
renderas `out/*.mp4` och länkas i README.
