# E2E — ODEN-analys mot den riktiga Bin 1 (oden) — 2026-08-27

Första riktiga kedjetestet: **Signal-meddelande → Oden (Bin 1) → valv → ODEN-analys**.
Tidigare har Bin 1 alltid ersatts av demo-korpusar. Detta dokument är både protokoll
och resultatlogg; ofyllda rutor är ännu inte körda.

## Miljö (verifierad)

| | |
|---|---|
| Bin 1 | Oden.app **v3.1.2** (= senaste release), signal-cli 0.14.5, kör som daemon |
| Signal | länkat nummer +46703580024; testgrupp **"TEST - Oden"** |
| Valv | `~/oden-vault` — Oden pekar hit (group-split på → rapporter under `TEST - Oden/`) |
| Analys | ODEN-analys byggd från arbetsträdet (post-koordinatskydd), installerad i valvet Väg B-style tillsammans med Bin 2-konfig + Map View 6.1.4 + operatörens kart-nyckel |
| Oden-konfig | **orörd** — varken vault-sökväg, konto eller pipelines ändrade |

## Fas 1 — backlog (två riktiga, redan mottagna rapporter) — ✅ KLAR (headless)

Verifierat via `plugin/test/bin1_v3.test.ts` över de två riktiga filerna (incheckade som
fixturer, telefonnummer maskat):

| Kontroll | Utfall |
|---|---|
| Formatkontrakt (typ/tnr/tidpunkt/signal_*/sagesman/Händelse/Ställe/Sedan) | ✅ fält för fält |
| **Koordinatbugg i Bin 1 ≤3.1.2 bekräftad**: båda filerna bär samma stela frontmatter-koordinat (58.62877, 16.72219) oavsett sina — olika — MGRS-rutor | ✅ (fixad uppströms i oden PR #257, ännu oreleasad) |
| Vårt koordinatskydd (parse.ts): rutan vinner vid >10 km-avvikelse + parse-issue | ✅ Vällingevägen → 59.2614, 17.7079 · Teknikringen → 59.3496, 18.0738 |
| Identifierare: signal-avsändare + MGRS-plats extraheras | ✅ |
| Kännetecken: "grön ryggsäck … Fjällräven logga" → ryggsäcksmärke detekterat, **ej** särskiljande (grön saknas i den frysta färgvokabulären — 📝-lagrets jobb) | ✅ ärlig gräns |
| **Larmkedjan räddad av koordinatskyddet**: TNR271039 ("observerade HvSS med kikare", ~250 m från objektet) når Förhöjd (närhet 3 + övervakning 2 + optik 2 = 7). Med den felaktiga koordinaten (75 km bort) hade larmet tystats. | ✅ |
| TNR261132 (klättrar över staket, Stockholm — annat AOI) får beteendesignal men elevereras inte härifrån | ✅ rätt beteende |

## Fas 2 — live-meddelanden (kräver operatör: skicka från telefonen)

Öppna `~/oden-vault` i Obsidian (**Open folder as vault** → *Trust author…*), kör
**"ODEN: Konfigurera operationsområde"** → `59.2622,17.712` (HvSS Vällinge). Panelens
flöde ska visa backlog-raderna. Skicka sedan meddelandena nedan **ett i taget** till
gruppen *TEST - Oden* och bocka av.

### Meddelandeskript (klistra in i Signal)

**M1 — Händelse-format, "MGRS, adress"-Ställe, spaningsfraserad (ska eleveras):**
```text
7S RAPPORT
Till: QO
Från: AQ
TNR: 271410
Stund: 271408
Ställe: 33VXF 54366 72296, Vällingevägen
Händelse: Man står stilla länge och betraktar grindarna med kikare
Symbol: Mörk keps med ljust emblem
Sagesman: AQ
Sedan: -
```
- [ ] Fil under `TEST - Oden/TNR271410.md` · [ ] koordinat ≈ 59.261, 17.708 (rätt eller
  räddad av skyddet — notera vilket!) · [ ] röd larmrad i flödet · [ ] kartmarkör vid
  Vällinge

**M2 — legacy-format, full regplåt i Symbol (ska ge fordonsnod):**
```text
7S RAPPORT
Till: QO
Från: BQ
TNR: 271415
Stund: 271414
Ställe: 33VXF 54100 72500, Norra grinden
Styrka: 1 fordon
Slag: Fordon
Sysselsättning: Parkerad vid vägkanten
Symbol: Mörk skåpbil, reg RJK241
Sagesman: BQ
Sedan: -
```
- [ ] Plåten `[[RJK241]]`-länkad av Oden · [ ] "Fordon RJK241 identifierat" i flödet

**M3 — bar MGRS-ruta (utan komma → Oden skriver inga frontmatter-koordinater; vår
parser ska härleda dem, `coordsFromMgrs`), partiell plåt:**
```text
7S RAPPORT
Till: QO
Från: CQ
TNR: 271420
Stund: 271419
Ställe: 33VXF 54366 72296
Händelse: Samma skåpbil passerar igen söderut
Symbol: reg RJK2..
Sagesman: CQ
Sedan: -
```
- [ ] Koordinat härledd ur rutan · [ ] partialen kopplas mot RJK241 (auto — entydig)

**M4 — foto som bilaga:** skicka ett foto med texten:
```text
7S RAPPORT
Till: QO
Från: AQ
TNR: 271425
Stund: 271424
Ställe: 33VXF 54366 72296, Vällingevägen
Händelse: Se bild
Sagesman: AQ
Sedan: -
```
- [ ] Bilagemapp bredvid rapporten, `![[…]]`-inbäddning renderar · [ ] (om Ollama kör:
  📷-kedjan ger bildfynd)

**M5 — TNR-kollision:** skicka M1 igen, oförändrad.
- [ ] `TNR271410_2.md` skapas, båda syns i flödet

**M6 — icke-kanonisk sagesman:**
```text
7S RAPPORT
Till: QO
Från: OP1
TNR: 271430
Stund: 271429
Ställe: Vällingevägen
Händelse: Lugnt vid grinden
Sagesman: OP1
Sedan: -
```
- [ ] Oden varnar men skriver · [ ] ODEN: "mottaget"-rad, ingen elevering

**M7 — icke-7S-meddelande:** `Hej, det här är bara ett test.`
- [ ] Ingen 7S-rapport; ev. generisk fil från annan pipeline **ignoreras** av analysen
  (saknar `typ: 7S-rapport`) — ingen flödesrad

**M8 — återkomst:** skicka M2 igen med `TNR: 271435`, `Stund: 271434`.
- [ ] "Fordon RJK241 identifierat (3 observationer)" · [ ] ev. 🔁-återkomstnod vid platsen

### Fas 3 — uppgraderingspass (efter fas 2, med godkännande)

Installera Odens senaste **snapshot** (innehåller MGRS-fixen #257; `~/.oden`-data och
Signal-länkningen överlever app-byte):
`curl -fsSL https://raw.githubusercontent.com/NicklasAndersson/oden/main/scripts/install_snapshot_mac.sh | bash`
Skicka M1-varianten igen med ny TNR — [ ] frontmatter-koordinaten nu korrekt direkt
(vårt skydd ska då vara tyst: ingen parse-issue).

### Fas 4 — efterarbete

- [ ] Komplettera `plugin/test/fixtures/bin1_v3/` med ~4–6 av fas 2-filerna (maska
  telefonnummer) och utöka `bin1_v3.test.ts` (kollisionssuffix, partiell→full-koppling,
  bilage-embed).
- [ ] Fyll i utfallen ovan; datera.
