# ODEN — 7S-lägesanalys

ODEN är ett Obsidian-plugin som analyserar svenska **7S-lägesrapporter** från
hemvärnet: det känner igen återkommande fordon och kännetecken, kopplar ihop dem
till **aktörer**, poängsätter **misstänkt aktivitet** transparent, visar platser i
graf och karta, och **larmar** vid ny aktivitet. Alla kopplingar bekräftas av
operatören — ODEN föreslår, människan avgör.

All analys är **deterministisk** och körbar utan nätverk eller språkmodell; den är
byggd för att kunna granskas och valideras rad för rad.

## Kom igång på 10 minuter

Man behöver inte känna till Obsidian sedan tidigare – allt är
färdigkonfigurerat och det är tre steg från nedladdning till fungerande system:

1. **Installera Obsidian** (gratis) från
   [obsidian.md/download](https://obsidian.md/download). På macOS drar man
   appen till Program, på Windows kör man installeraren, på Linux finns
   AppImage och .deb.
2. **Ladda ner `ODEN-valv-<version>.zip`** från
   **[senaste releasen](https://github.com/larsnor/ODEN-analys/releases/latest)**
   och packa upp den där du vill ha ditt arbetsvalv, till exempel i Dokument.
3. **Öppna valvet:** starta Obsidian, välj **"Open folder as vault"**, peka ut
   mappen `ODEN-valv` och svara **"Trust author and enable plugins"** när
   Obsidian frågar.

Sedan är det klart. Noten **Välkommen.md** ligger öppen och leder vidare – sätt
operationsområdet, namnge platser och börja.

**Kartnyckel (en minut).** Kartbakgrunden kommer från CartoDB, som numera kräver
en egen nyckel. Hämta en gratis på
[carto.com/basemaps/apikey](https://carto.com/basemaps/apikey) – det tar en
minut, du behöver inget konto, och den räcker till 5 miljoner kartrutor i
månaden. Klistra sedan in den i **Settings → Map View**, sist i kartkällans
adress:

```
https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=DIN_NYCKEL
```

Utan nyckel fungerar kartan ändå, men rutorna får texten *"API key required"*.
Vill du slippa den under tiden byter du kartkälla till **OpenStreetMap (ingen
nyckel)**, som följer med i valvet.

Vill man öva först finns mappen `demo/` i valvet: en syntetisk övningskorpus
över fjorton dygn med drygt 360 rapporter, foton, en dold spaningscell, en
infiltrationscell och en demonstration. Kör kommandot *"ODEN: Mata demodata"* så spelas den upp i
korpusens egen rytm över den tid du väljer – inga extra verktyg behövs, och
facit ligger bredvid. För skarp drift raderar man `demo/`, sätter sitt riktiga
område och låter intaget leverera rapporterna till `inkorg/`.

AI-förmågorna (📷 bild · 📝 text · 💬 chat) är valfria: installera
[Ollama](https://ollama.com) och kör `ollama pull qwen3-vl:4b`, så körs allt
lokalt på den egna datorn. Modellen föreslår bara – du bekräftar. Detektionen
är aldrig beroende av AI.

### Hela systemet: rapporter via Signal

I skarp drift skrivs 7S-rapporterna inte för hand — de kommer via **Signal**
genom intagsappen **[Oden](https://github.com/NicklasAndersson/oden)**, som
lyssnar på en Signal-grupp och skriver varje `7S RAPPORT`-meddelande som en
färdig rapportfil i valvet. ODEN analyserar dem i samma stund de landar. Hela
kedjan installeras med ett kommando:

```bash
curl -fsSL https://raw.githubusercontent.com/larsnor/ODEN-analys/main/scripts/install_system.sh | bash
```

Skriptet hämtar valvet, installerar Oden via dess officiella installations­skript
och skriver ut de tre manuella stegen (Obsidian, setup-wizarden, kartnyckeln).
Viktigast i wizarden: peka **vault-sökvägen på ODEN-valv-mappen** och **hoppa
över Obsidian-mallsteget** — valvet är redan komplett, och Oden rör aldrig en
befintlig `.obsidian`-mapp. Rapporterna landar i en mapp med Signal-gruppens
namn; ODEN analyserar hela valvet, så `inkorg/` behövs bara för demo och
handmatning.

Fler installationsvägar och felsökning finns i **[`INSTALL.md`](INSTALL.md)**.

### Skärmfilmer (30–45 s, utan ljud)

| Film | Visar |
|---|---|
| [Installation & första start](docs/screencasts/out/installation.mp4) | De tre stegen från nedladdning till fungerande valv. |
| [Operationsområde & namngivna platser](docs/screencasts/out/omrade.mp4) | Sätt området, namnge platser, se karta och graf fyllas. |
| [Flödet: larm, granskning och AI](docs/screencasts/out/flodet.mp4) | Demodata i verklig rytm, larm med synliga skäl, bildfynd att bekräfta. |
| [Operatörens verktyg](docs/screencasts/out/verktyg.mp4) | Flagga som larm, 🔭 bevakningslistan, aktörsgranskning, chatten. |

Filmerna finns även som bilagor på [senaste releasen](https://github.com/larsnor/ODEN-analys/releases/latest).

## Struktur

| Mapp | Vad |
|------|-----|
| [`plugin/`](plugin/) | Obsidian-pluginet (TypeScript). Självständigt — testerna kör mot fixturerna i [`plugin/test/fixtures/`](plugin/test/fixtures/). |
| [`obsidian-config/`](obsidian-config/) | Färdig Obsidian-konfiguration: graffärger, Map View-regler, arbetsyta och ett "lås panelerna"-snitt. |
| [`packaging/`](packaging/) | Onboarding-material som paketeras in i valv-zippen (Välkommen-noten). |
| [`docs/`](docs/) | Format-spec, plugin-design, överlämningsanteckningar och frontmatter-schema. |
| [`archive/`](archive/) | Avvecklat/referens: äldre generator, tidig Python-prototyp, dataset-zip. Ingår inte i pipelinen. |

## Utveckling

### Bygg och testa pluginet
```bash
cd plugin
npm install
npm run typecheck   # inga typfel
npm test            # kör hela testsviten mot fixturerna
npm run build       # skapar main.js
npm run package     # bygger dist/ODEN-plugin-<v>.zip + dist/ODEN-valv-<v>.zip
```
Kopiera `plugin/main.js` + `plugin/manifest.json` till
`<din-vault>/.obsidian/plugins/7s-analys/` och aktivera pluginet i Obsidian.
(`main.js` byggs lokalt och versionshanteras inte — kör `npm run build`.)

Paketeringen kräver dessutom `7s-generator` på PATH (demokorpusen genereras
deterministiskt vid paketering) och nätverk första gången (Map View-releasen
hämtas pinnad och cachas; MIT-licens, licensfilen följer med i zippen).

### Generera och mata in testdata
Testkorpusar skapas och matas in med det fristående verktyget
**[7S-generator](https://github.com/larsnor/7S-generator)** (eget repo, CLI, inga
beroenden). Det producerar samma 7S-format som pluginet läser:
```bash
7s-generator generate --aoi 60.345,17.422 --area airport \
  --from 2026-06-15 --days 14 --callsigns AQ,BQ,CQ,DQ --out ./corpus_tierp
7s-generator add-hostiles --corpus ./corpus_tierp --type recon
7s-generator feed --corpus ./corpus_tierp --dest /sökväg/till/valv/inkorg
```
Sätt sedan Objektets koordinat i ODEN till samma AOI (kommandot
"Konfigurera operationsområde"). Pluginets egna tester är självständiga och
behöver inte verktyget — de kör mot den incheckade snapshoten i
[`plugin/test/fixtures/`](plugin/test/fixtures/).

### Obsidian-konfiguration
Se [`obsidian-config/README.md`](obsidian-config/README.md). Graffärgerna och
kartinställningarna behöver skrivas medan Obsidian är **stängt** (Obsidian skriver
över dem annars vid stängning).

## Designprinciper

- **Skrivkontrakt:** pluginet rör aldrig meddelandefiler. Det skapar bara sina
  egna noter (märkta `generator: 7s-plugin`) och är idempotent.
- **Föreslå, bekräfta aldrig automatiskt:** säkra ID-matchningar (samma
  registreringsnummer) slås ihop; allt annat föreslås och bekräftas av operatören.
- **Transparent poäng:** misstankepoängen är en förklarbar viktad summa — varje
  rad visar sina skäl, ingen svart låda.
- **Pekar, styr inte:** pluginet pekar mot var operatören ska titta i graf och
  karta; operatören klickar själv.

Detaljerad design finns i [`docs/PLUGIN_DESIGN.md`](docs/PLUGIN_DESIGN.md) och
meddelandeformatet i [`docs/FORMAT_SPEC.md`](docs/FORMAT_SPEC.md).

## Detekteringens räckvidd (ärligt)
Den **regplåtsbaserade** re-identifieringen (exakt matchning) och **geometrin/tiden**
(närhet + tid på dygnet) är robusta. De två **fasta vokabulärerna** är
högprecisions-*frön* med validerad men begränsad täckning på oberoende formulerad
prosa — de hittar aldrig på bevis mot en civil, men missar mycket:
- **kännetecken-baserad re-identifiering** (`vocab.ts`) — mätt i
  [`docs/RE-ID_VALIDATION.md`](docs/RE-ID_VALIDATION.md);
- **beteendevokabulären** (`suspicion.ts THREAT_INDICATORS`) — mätt i
  [`docs/BEHAVIOUR_VALIDATION.md`](docs/BEHAVIOUR_VALIDATION.md) (~24 % → ~62–74 %
  recall efter en avgränsad, precisionsspärrad utökning; resten är öppen vokabulär =
  språkmodellens 📝-förmåga).

**Bildanalys (valfri, lokal LLM):** ODEN kan läsa bifogade foton med en lokal
vision-modell (Ollama, `qwen3-vl:4b` — mätt i
[`docs/VISION_VALIDATION.md`](docs/VISION_VALIDATION.md)): skyltar, fordon (märke/
färg), personer (kön/ålder/klädfärg/utrustning). Den är **avstängd som standard**
och slås på med 📷-chippen i panelen; modellen föreslår, operatören bekräftar
varje fynd. Störst nytta: registreringsskyltar och låg bemanning. Detektionen
beror aldrig på den; driftläget (deterministiskt + valfria LLM-lager) syns
direkt i panelens lägesstrip.

## Licens
MIT — se [`LICENSE`](LICENSE). Den paketerade valv-zippen innehåller även
[Map View](https://github.com/esm7/obsidian-map-view) (MIT, © esm7) med dess
licensfil.
