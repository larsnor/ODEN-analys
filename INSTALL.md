# Installera ODEN

ODEN är ett Obsidian-plugin. Det distribueras via
[GitHub-releaser](https://github.com/larsnor/ODEN-analys/releases/latest) som två
zippar — **inte** via Obsidians community-katalog:

| Zip | För vem |
|---|---|
| `ODEN-valv-<v>.zip` | **Nya användare (rekommenderas)** — ett komplett, färdigkonfigurerat valv med ODEN, kartpluginet Map View, demodata och en Välkommen-guide. |
| `ODEN-plugin-<v>.zip` | Den som redan har ett eget Obsidian-valv och vill lägga in ODEN där. |

ODEN gör **inga nätverksanrop**; det enda som någonsin rör nätet är Map Views
karttiles (och den valfria lokala AI:n pratar bara med din egen dator).

---

## Väg A — Färdigt valv (rekommenderas)

1. **Installera Obsidian** (gratis): [obsidian.md/download](https://obsidian.md/download).
   - macOS: öppna dmg-filen, dra Obsidian till Program.
   - Windows: kör installeraren.
   - Linux: AppImage eller .deb.
2. **Ladda ner och packa upp `ODEN-valv-<v>.zip`** där du vill ha valvet
   (t.ex. Dokument). Du får en mapp `ODEN-valv/`.
3. **Öppna valvet:** starta Obsidian → **"Open folder as vault"** → välj
   `ODEN-valv` → svara **"Trust author and enable plugins"**.

Vid första start ska du se: mörkt tema, tre ikoner i vänsterlisten (ODEN, karta,
graf), fyra paneler (karta · Välkommen-noten / graf · ODEN-panelen) och noten
**Välkommen.md** öppen med den fortsatta checklistan (operationsområde → platser →
demodata eller skarp drift).

Det medföljande kartpluginet [Map View](https://github.com/esm7/obsidian-map-view)
(MIT-licens, licensfil medföljer) är förinstallerat — inget behöver hämtas från
Obsidians katalog.

## Väg B — Manuell installation i eget valv

Ur `ODEN-plugin-<v>.zip`:

1. Kopiera mappen `7s-analys/` (innehåller `main.js` + `manifest.json`) till
   `<ditt-valv>/.obsidian/plugins/7s-analys/`. Aktivera sedan **ODEN** under
   **Settings → Community plugins** (stäng av Restricted mode om det frågas).
2. Installera **Map View** (krävs för kartan): **Settings → Community plugins →
   Browse → sök "Map View" (av esm7) → Install → Enable**. ODEN fungerar utan den
   (text/graf-analysen påverkas inte), men kartan behöver den.
3. **Applicera konfigurationen — med Obsidian HELT AVSLUTAT** (Obsidian skriver
   annars över filerna när det stängs):

   | Från zippen | Till |
   |---|---|
   | `obsidian-config/graph.json` | `<valv>/.obsidian/graph.json` |
   | `obsidian-config/app.json` | `<valv>/.obsidian/app.json` |
   | `obsidian-config/core-plugins.json` | `<valv>/.obsidian/core-plugins.json` |
   | `obsidian-config/workspace.json` | `<valv>/.obsidian/workspace.json` |
   | `obsidian-config/map-view-data.json` | `<valv>/.obsidian/plugins/obsidian-map-view/data.json` |
   | `obsidian-config/oden-lock.css` | `<valv>/.obsidian/snippets/oden-lock.css` |

   Starta om Obsidian och aktivera `oden-lock` under **Settings → Appearance →
   CSS snippets**. Se `obsidian-config/README.md` för vad varje fil gör.
   (Graffärgerna syns först när entitetsnoter finns.)

## Efter installation: sätt operationsområdet

Kör kommandot **"ODEN: Konfigurera operationsområde"** (`Cmd/Ctrl-P`) och ange
det skyddade objektets koordinat (`lat,lon` eller MGRS). ODEN mäter närhet mot
punkten och centrerar kartan dit. Byte av område senare **rensar operatörens
beslut** (du varnas först).

## Demoläge (lär dig ODEN utan verktyg)

I det färdiga valvet finns `demo/` — en syntetisk övningskorpus (14 dygn kring
HvSS Vällinge, ~480 rapporter varav foton, en dold spaningscell och en
demonstration; inga riktiga personer/fordon):

1. Sätt operationsområdet till `59.2622,17.712`.
2. Dra innehållet i `demo/batch-01/` till `inkorg/` — ODEN analyserar direkt.
3. Fortsätt batch för batch; granska förslag, flagga larm, bevaka, fråga i chatten.

Egna korpusar (andra platser/hotbilder) genereras med
[7S-generator](https://github.com/larsnor/7S-generator).

## Skarp drift

1. Radera `demo/` och ev. övningsinnehåll i `inkorg/`.
2. Sätt ditt riktiga operationsområde; namnge kända platser i förväg
   (`⋯ → Namngivna platser…`, skyddsvärda platser larmar vid närhet).
3. Låt intaget (källappen) leverera 7S-rapporter till `inkorg/` — ODEN:s
   bevakare analyserar automatiskt.

## Valfritt: lokal AI (Ollama)

ODEN:s kärna är deterministisk — **detektionen beror aldrig på AI**. Chipsen i
panelen ger extra räckvidd: **📷 Bild** (skyltar/fordon/personer i foton — mest
värde vid registreringsskyltar och låg bemanning), **📝 Text** (kännetecken och
beteenden i fritext som de fasta vokabulärerna missar), **💬 Chat** (naturligt
språk i frågelådan). Allt körs lokalt; varje fynd är ett **förslag** du bekräftar
eller avvisar (`föreslagen-av: llm`).

1. Installera **[Ollama](https://ollama.com)** (lokal, offline modellserver).
2. `ollama pull qwen3-vl:4b` (≈3 GB; standard. `:8b` är noggrannare men kräver
   ≥32 GB RAM — siffror i `docs/VISION_VALIDATION.md`).
3. Obsidian → **Settings → ODEN** → kontrollera adress + modell → **"Testa
   anslutning"**.
4. Slå på chipsen i panelen (engångsvarning om hastighet visas). Ollama kan även
   köras på en starkare maskin i nätverket (ändra adressen).

## Felsökning

- **"Restricted mode" blockerar pluginen** → Settings → Community plugins →
  Turn off Restricted mode (eller svara "Trust author…" när valvet öppnas).
- **macOS säger att Obsidian inte kan öppnas** → högerklicka på appen → Öppna
  (Gatekeeper, endast första gången).
- **Kartan visar inte ODEN-lagren** (en öppen kartpanel behåller sin egen
  filtrering) → `⋯ → "Visa ODEN-lagren på kartan"`.
- **Grafen är tom** → färgerna/noderna syns först när entitetsnoter skapats;
  mata in data och bekräfta förslag.
- **Ollama-chipsen blir grå** → kontrollera att Ollama kör (`ollama list`) och
  testa anslutningen i inställningarna; ODEN faller tillbaka till
  deterministiskt läge tills anslutningen är tillbaka.
- **Air-gapped drift**: Map View cachar visade karttiles lokalt; för-ladda
  området genom att panorera/zooma i förväg med nät. (Automatiserad
  tile-förprovisionering är planerad — se `TODO.md`.)

## Detekteringens räckvidd

Se `docs/RE-ID_VALIDATION.md`, `docs/BEHAVIOUR_VALIDATION.md` och (för
vision-modellen) `docs/VISION_VALIDATION.md`. Kort: den deterministiska
kännetecken-re-identifieringen är ett högprecisions-*frö* — den hittar aldrig på
bevis, men har begränsad täckning på fri prosa. Plåt-re-identifiering och
närhet/tid-poängen är de robusta delarna. AI-lagren är nomineringsgrindade —
modellen föreslår, operatören bekräftar.
