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

### Fas 2 — resultat hittills (2026-08-27, live via telefon)

Valven konsoliderades först till ETT: `~/Documents/ODEN-valv`, skapat med
`install_system.sh` (dess första skarpa körning ✅) + arbetsträdets plugin-bygge +
kart-nyckeln. Operatören valde egna TNR:er, så mappningen är:
**M1 = TNR271436 · M2 = TNR271415 · M3 = TNR271420.**

| Fall | Utfall |
|---|---|
| M1 (Händelse, "MGRS, adress", spaning) | ✅ eleverad → ⚠️-suspect "mörk keps med ljust emblem", 📍 Vällingevägen. **Koordinatbuggen återbekräftad live** (samma stela 58.62877/16.72219 igen) och räddad av korsningsskyddet — platsnoterna hamnade rätt |
| M2 (legacy-format, full plåt) | ✅ Oden länkade `[[RJK241]]` → fordonsnod, 📍 Norra Grinden (även här fel frontmatter-koordinat, räddad) |
| M3 första försöket | ✅ **avsiktligt intressant fel**: operatören glömde kolonet efter `Sagesman` → seven_s avvisade med tydligt fel (`missing required fields: sagesman`) och Oden föll vidare till generic_template, som skrev meddelandet som vanlig chatt-not (`271446-<uuid>-Oden_Svensson.md`, klassiskt filnamn — DET är filen med "annan filnamnsstruktur"). Utan `typ: 7S-rapport` ignoreras den av analysen. Robust beteende: strikt validering, inget meddelande tappas. Filen kan raderas |
| M3 omsänd (med kolon) | ⚠️→✅ `TNR271420.md` skrevs korrekt, men **partialen `RJK2..` länkades INTE av Oden** — deras partial-regex använder `\b`, och det finns ingen ordgräns mellan punkt och mellanslag, så punkt-kantade masker (`RJK2..`, `..G41.`) kan aldrig matcha. Prosan nådde oss olänkad, och vår `ids.ts` läste då bara FULLA plåtar ur prosa → ingen koppling till RJK241. **Åtgärdat på vår sida samma dag**: `ids.ts` extraherar nu partial-masker ur prosa (explicita lookarounds i stället för `\b`; ≥3 lästa positioner som precisionsspärr så initialer/ellipser aldrig blir re-id-evidens; full-plåt-spann skyddade). Verifierat: M3-filen smälter in i RJK241 (2 obs, `resolvedPartials: ["RJK2.."]`) — `bin1_v3.test.ts` |
| Fixturer | ✅ alla tre live-filerna incheckade i `fixtures/bin1_v3/` (uuid-avsändare, inga telefonnummer) — korpusen är nu 5 riktiga filer och täcker båda kropps-formaten |

| M4 (foto) första försöket, på v3.1.2 | ⚠️ **versionsgap, inte bugg**: rapporten (`TNR271425.md`) skrevs korrekt och signal-cli lagrade fotot lokalt — men bilagan släpptes tyst: bildstöd för 7S-rapporter (`feat: stöd bilder i 7s/fors/pedars`, #245) mergades till oden main 2026-07-01, **fem dagar efter** v3.1.2-releasen. Verifierat i v3.1.2-källan: noll förekomster av save_attachments i 7S-vägen |
| Fas 3-uppgradering → M4 omsänd | ✅ Oden uppgraderad till **snapshot-68b94d5**; omsändningen gav bilagemapp + `## Bilagor` med `![[…]]`-inbäddning (#245 ✓) **och korrekt frontmatter-koordinat direkt från källan** (59.26140, 17.70788 = exakt vår egen rutkonvertering; #257 ✓) — koordinatskyddet är nu tyst, precis som det ska |
| M5 (TNR-kollision) | ✅ **de facto verifierad — med korrigerad attribution**: Odens rå-DB visar att `_2`/`_3` kom från **tre separata Signal-leveranser** av M4 (rå-meddelande 349/350/351, kl 16:14–16:23; dubblettleverans/omtryck på telefonsidan — inte avsiktliga omsändningar). Suffixmekanismen är ändå fullt bevisad: `TNR271425_2/_3.md`, suffixet buret i frontmattern (`tnr: "271425_3"`) enligt spec |
| Fixtur | ✅ `TNR271425_3.md` incheckad (endast .md — fotot är äkta och checkas aldrig in); testet låser inbäddningen, kollisionssuffixet och att korsningsskyddet är TYST när Bin 1 levererar rätt |

Kvar i fas 2: **endast M8 (återkomst)** — M5–M7 är täckta enligt ovan. **Ladda om ODEN-pluginet i Obsidian** (eller starta om Obsidian)
före fortsättningen så att partial-fixen är aktiv i valvet.

### Fas 3 — uppgraderingspass — ✅ UTFÖRD (snapshot-68b94d5, 2026-08-27)

Installera Odens senaste **snapshot** (innehåller MGRS-fixen #257; `~/.oden`-data och
Signal-länkningen överlever app-byte):
`curl -fsSL https://raw.githubusercontent.com/NicklasAndersson/oden/main/scripts/install_snapshot_mac.sh | bash`
Skicka M1-varianten igen med ny TNR — [ ] frontmatter-koordinaten nu korrekt direkt
(vårt skydd ska då vara tyst: ingen parse-issue).

### Fynd under LLM-aktivering (2026-08-27, kväll)

Operatören slog på 📷 och körde bildanalys → **"0 nya"** trots två foton i
valvet. Rotorsak, två staplade: (1) **fel modellfamilj hämtad** — `qwen3:4b/8b/32b`
(text-only) fanns i Ollama men ODEN kräver `qwen3-vl` (vision), och vald modell
`qwen3-vl:32b` fanns inte alls → varje anrop föll tyst; (2) 📝-chippen var av, så
"Tolka text nu" avböjde innan Ollama ens tillfrågades. Åtgärd hos operatören:
`ollama pull qwen3-vl:4b` + välj modellen i inställningarna + slå på 📝.

**UX-fynd åtgärdat på vår sida**: hälsoprickens "online" kollade bara att
SERVERN svarade — en saknad modell degraderade till ett tyst "0 nya". Nu skiljer
alla hälsokontroller på server-nere och modell-saknas: pricken visar
`○ <modell> saknas`, och varje flöde/chip-påslag ger en Notice med exakta
kommandot (`ollama pull <modell>`).

### Fas 4 — efterarbete

- [ ] Komplettera `plugin/test/fixtures/bin1_v3/` med ~4–6 av fas 2-filerna (maska
  telefonnummer) och utöka `bin1_v3.test.ts` (kollisionssuffix, partiell→full-koppling,
  bilage-embed).
- [ ] Fyll i utfallen ovan; datera.
