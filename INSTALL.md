# Installera ODEN

ODEN är ett plugin till [Obsidian](https://obsidian.md) och distribueras via
[GitHub-releaser](https://github.com/larsnor/ODEN-analys/releases/latest) – inte
via Obsidians community-katalog. Varje release innehåller två zippar, och vilken
man väljer beror på var man börjar:

| Zip | För vem |
|---|---|
| `ODEN-valv-<v>.zip` | **Ny användare (rekommenderas)** – ett komplett, färdigkonfigurerat valv med ODEN, kartpluginet Map View, demodata och en Välkommen-guide. |
| `ODEN-plugin-<v>.zip` | Den som redan har ett eget Obsidian-valv och vill lägga in ODEN där. |

ODEN gör inga nätverksanrop. Det enda som någonsin rör nätet är Map Views
karttiles, och den valfria AI:n pratar bara med din egen dator.

---

## Väg A – Färdigt valv (rekommenderas)

Tre steg, sedan är allt igång:

1. **Installera Obsidian** (gratis) från
   [obsidian.md/download](https://obsidian.md/download). På macOS öppnar man
   dmg-filen och drar Obsidian till Program, på Windows kör man installeraren,
   och på Linux finns AppImage och .deb.
2. **Ladda ner `ODEN-valv-<v>.zip`** från senaste releasen och packa upp den
   där du vill ha ditt arbetsvalv, till exempel i Dokument. Du får en mapp som
   heter `ODEN-valv`.
3. **Öppna valvet:** starta Obsidian, välj **"Open folder as vault"**, peka ut
   `ODEN-valv` och svara **"Trust author and enable plugins"** när Obsidian
   frågar.

Vid första start ska det se ut så här: mörkt tema, tre ikoner i vänsterlisten
(ODEN, kartan och grafen), fyra paneler – kartan och Välkommen-noten överst,
grafen och ODEN-panelen under – och noten **Välkommen.md** öppen med den
fortsatta checklistan. Därifrån tar guiden vid: sätt operationsområdet, namnge
platser, och testa gärna demodatan innan skarp drift.

Kartpluginet [Map View](https://github.com/esm7/obsidian-map-view) följer med
förinstallerat (MIT-licens, licensfilen ligger bredvid pluginet) – inget behöver
hämtas från Obsidians katalog.

## Väg B – Manuell installation i eget valv

Har man redan ett valv man vill använda tar man `ODEN-plugin-<v>.zip` i stället:

1. Kopiera mappen `7s-analys/` (med `main.js` och `manifest.json`) till
   `<ditt-valv>/.obsidian/plugins/7s-analys/` och aktivera **ODEN** under
   **Settings → Community plugins**. Frågar Obsidian om *Restricted mode* så
   stäng av det.
2. Installera **Map View**, som behövs för kartan: **Settings → Community
   plugins → Browse**, sök på *"Map View"* (av esm7), installera och aktivera.
   ODEN fungerar för övrigt utan den – text- och grafanalysen påverkas inte –
   men utan Map View blir det förstås ingen karta.
3. Applicera konfigurationen – **med Obsidian helt avslutat**, eftersom Obsidian
   annars skriver över filerna när det stängs:

   | Från zippen | Till |
   |---|---|
   | `obsidian-config/graph.json` | `<valv>/.obsidian/graph.json` |
   | `obsidian-config/app.json` | `<valv>/.obsidian/app.json` |
   | `obsidian-config/core-plugins.json` | `<valv>/.obsidian/core-plugins.json` |
   | `obsidian-config/workspace.json` | `<valv>/.obsidian/workspace.json` |
   | `obsidian-config/map-view-data.json` | `<valv>/.obsidian/plugins/obsidian-map-view/data.json` |
   | `obsidian-config/oden-lock.css` | `<valv>/.obsidian/snippets/oden-lock.css` |

   Starta sedan om Obsidian och aktivera `oden-lock` under **Settings →
   Appearance → CSS snippets**. Vad varje fil gör beskrivs i
   `obsidian-config/README.md`. Graffärgerna syns för övrigt först när det
   finns entitetsnoter att färglägga.

## Efter installationen: sätt operationsområdet

Kör kommandot **"ODEN: Konfigurera operationsområde"** (`Cmd/Ctrl-P`) och ange
det skyddade objektets koordinat, som `lat,lon` eller en MGRS-ruta. ODEN mäter
närhet mot den punkten och centrerar kartan dit. Byter man område senare rensas
operatörens beslut – man varnas först.

## Demoläge – lär dig ODEN utan verktyg

I det färdiga valvet ligger mappen `demo/`: en syntetisk övningskorpus över
fjorton dygn kring HvSS Vällinge, knappt 350 rapporter varav en del med foton,
en dold spaningscell och en demonstration. Inga riktiga personer eller fordon
förekommer.

Sätt operationsområdet till `59.2622,17.712`, dra innehållet i `demo/batch-01/`
till `inkorg/`, och se ODEN analysera direkt. Fortsätt sedan batch för batch i
egen takt – granska förslag, flagga larm, bevaka och fråga i chatten. Facit
ligger i `demo/facit.json` när du vill rätta dig själv.

Egna korpusar, med andra platser och hotbilder, genereras med
[7S-generator](https://github.com/larsnor/7S-generator).

## Skarp drift

Radera `demo/` och eventuellt övningsinnehåll i `inkorg/`, sätt ditt riktiga
operationsområde och namnge kända platser i förväg (`⋯ → Namngivna platser…` –
skyddsvärda platser larmar vid närhet). Låt sedan intaget leverera
7S-rapporterna till `inkorg/`, så analyserar ODEN dem automatiskt.

## Valfritt: lokal AI (Ollama)

ODENs kärna är deterministisk och detektionen är aldrig beroende av AI. Chipsen
i panelen ger extra räckvidd: **📷 Bild** läser foton – störst nytta vid
registreringsskyltar och låg bemanning – **📝 Text** hittar kännetecken och
beteenden i fritext som de fasta ordlistorna missar, och **💬 Chat** svarar på
frågor i naturligt språk. Allt körs lokalt, och varje fynd är ett förslag som
du bekräftar eller avvisar (`föreslagen-av: llm`).

1. Installera [Ollama](https://ollama.com), en lokal modellserver som kör helt
   offline.
2. Kör `ollama pull qwen3-vl:4b` i en terminal (cirka 3 GB; standardvalet.
   `:8b` är noggrannare men kräver minst 32 GB RAM – siffror finns i
   `docs/VISION_VALIDATION.md`).
3. Öppna **Settings → ODEN**, kontrollera adress och modell, och tryck
   **"Testa anslutning"**.
4. Slå på chipsen i panelen (en engångsvarning om hastighet visas). Ollama kan
   för övrigt köras på en starkare maskin i nätverket – ändra bara adressen.

## Felsökning

- **"Restricted mode" blockerar pluginen** – Settings → Community plugins →
  Turn off Restricted mode, eller svara *"Trust author…"* när valvet öppnas.
- **macOS vägrar öppna Obsidian** – högerklicka på appen och välj Öppna
  (Gatekeeper, bara första gången).
- **Kartan visar inte ODEN-lagren** – en öppen kartpanel behåller sin egen
  filtrering; kör `⋯ → "Visa ODEN-lagren på kartan"` så återställs den.
- **Grafen är tom** – noderna syns först när entitetsnoter skapats; mata in
  data och bekräfta förslag.
- **AI-chipsen blir grå** – kontrollera att Ollama kör (`ollama list`) och
  testa anslutningen i inställningarna. ODEN arbetar deterministiskt vidare
  tills anslutningen är tillbaka.
- **Air-gapped drift** – Map View sparar visade karttiles lokalt; panorera och
  zooma igenom området i förväg medan nät finns, så finns kartan kvar när nätet
  försvinner. (Automatiserad förprovisionering av tiles är planerad, se
  `TODO.md`.)

## Detekteringens räckvidd

Se `docs/RE-ID_VALIDATION.md`, `docs/BEHAVIOUR_VALIDATION.md` och, för
vision-modellen, `docs/VISION_VALIDATION.md`. I korthet: re-identifiering via
regplåt och närhet/tid-poängen är de robusta delarna. Den
kännetecken-baserade re-identifieringen är ett högprecisions-frö – den hittar
aldrig på bevis, men har begränsad täckning på fri prosa. AI-lagren föreslår
bara; operatören bekräftar varje fynd.
