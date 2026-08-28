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
karttiles, och den valfria AI:n pratar bara med din egen dator. Var medveten om
att karttiles hämtas med din egen API-nyckel (se *Kartnyckel* nedan) – de
anropen är alltså knutna till din installation och visar vilka områden som
tittas på. Kartkällan **OpenStreetMap (ingen nyckel)** går utan nyckel, men går
fortfarande ut på nätet.

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

### Kartnyckel – en minut, gratis

Kartbakgrunden ritas med kartrutor från CartoDB, som sedan en tid kräver en egen
API-nyckel. Utan nyckel fungerar kartan – markörer, klick och lager är opåverkade
– men varje kartruta får en påstämplad text, *"API key required"*.

1. Hämta en nyckel på [carto.com/basemaps/apikey](https://carto.com/basemaps/apikey).
   Det går på en minut, kräver inget CARTO-konto, och nyckeln mejlas direkt.
   Fri användning upp till 5 miljoner kartrutor per månad.
2. Öppna **Settings → Map View** och leta upp kartkällan **CartoDB** i listan
   över kartkällor.
3. Lägg till `?key=DIN_NYCKEL` sist i adressen, så att den lyder:

   ```
   https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png?key=DIN_NYCKEL
   ```

4. Stäng inställningarna. Kartan ritas om utan stämpel.

Nyckeln är personlig – CARTO:s villkor tillåter inte att samma nyckel delas
mellan orelaterade installationer, så den kan inte följa med i valv-zippen. Vill
du hoppa över steget helt byter du kartkälla till **OpenStreetMap (ingen
nyckel)**, som ligger färdig i valvet. Notera dock att OpenStreetMaps
kartservrar drivs på donerad kapacitet och att deras villkor förbjuder att man
laddar ned kartrutor i förväg – kör du air-gapped (se *Felsökning*) är CartoDB
med egen nyckel det rätta valet.

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
4. **Lägg in din kartnyckel** enligt *Kartnyckel* under Väg A ovan – kartkällorna
   följer med i `map-view-data.json`, men nyckeln är personlig och måste läggas
   till i efterhand.

## Hela systemet — rapporter via Signal (Oden)

I skarp drift levereras 7S-rapporterna av intagsappen
[Oden](https://github.com/NicklasAndersson/oden) (Bin 1): den länkas till ett
Signal-konto, lyssnar på gruppmeddelanden som börjar med `7S RAPPORT` och
skriver varje sådant som en färdig rapportfil i valvet — som ODEN analyserar
direkt. Snabbast är samlingsskriptet:

```bash
curl -fsSL https://raw.githubusercontent.com/larsnor/ODEN-analys/main/scripts/install_system.sh | bash
```

Det hämtar senaste ODEN-valv, installerar Oden.app via **dess eget officiella
installationsskript**, hoppar över allt som redan finns och skriver aldrig över
ett befintligt valv. Manuellt är det samma tre delar, **i denna ordning**:

1. **Valvet först** (Väg A ovan) — packa upp `ODEN-valv-<v>.zip`.
2. **Oden** (kräver **v3.2.0 eller senare** — äldre tappar foton i 7S-rapporter
   och kan skriva fel koordinater):
   `curl -fsSL https://raw.githubusercontent.com/NicklasAndersson/oden/main/scripts/install_mac.sh | bash`
   (Windows/Docker: se Odens README.)
3. **Setup-wizarden** (öppnas på `http://127.0.0.1:8080`):
   - **Länka Signal-kontot** med QR-koden. Använd ett **dedikerat nummer** —
     inte ditt privata (Odens egen starka rekommendation).
   - **Vault-sökväg** = ODEN-valv-mappen från steg 1.
   - **Obsidian-mallsteget: hoppa över.** Valvet är redan komplett konfigurerat,
     och Oden rör aldrig en befintlig `.obsidian`-mapp — ordningen valv-först är
     det som gör att ODEN:s konfiguration (graf, karta, lås) står orörd kvar.

Bra att veta i drift:

- Rapporterna landar i en **mapp med Signal-gruppens namn** (Odens
  group-split). ODEN identifierar rapporter på frontmatter (`typ: 7S-rapport`)
  och analyserar hela valvet — mappen spelar ingen roll. `inkorg/` är demo- och
  handmatningsvägen, inget krav.
- Plåtar i Symbol-fältet länkas `[[SÅ HÄR]]` av Oden själv; ODEN läser dem både
  som länkar och som ren prosa.
- **Versionsnot:** Oden **t.o.m. v3.1.2** har två kända luckor (E2E-verifierade
  2026-08-27, se `docs/E2E_BIN1.md`): fel `lat`/`lon` när Ställe har en
  MGRS-ruta med mellanslag, och **foton i 7S-meddelanden släpps tyst**. Båda är
  fixade i **v3.2.0** (släppt 2026-08-28) — använd den eller senare.
  ODEN-analys korsar dessutom alltid frontmatter-koordinaten mot rutan i Ställe
  och låter **rutan vinna** vid grov avvikelse — positionen på kartan och
  närhetslarmen förblir rätt även mot äldre Oden-versioner.
- Nätverksbilden: ODEN-analys gör fortfarande inga egna nätverksanrop; Oden
  pratar med Signals servrar (det är dess uppgift) och kartan hämtar tiles med
  din nyckel enligt ovan.

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

Sätt operationsområdet till `59.2622,17.712` och kör kommandot **"ODEN: Mata
demodata"** – välj speltid (15 minuter är lagom) så droppar rapporterna in i
korpusens egen rytm; samma kommando pausar och återupptar. Granska förslag,
flagga larm, bevaka och fråga i chatten under tiden. Den som hellre matar för
hand drar innehållet i `demo/batch-01/` till `inkorg/`, batch för batch. Facit
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
- **Kartan har texten "API key required" på varje ruta** – CartoDB kräver en
  egen API-nyckel. Hämta en gratis och klistra in den enligt *Kartnyckel* ovan,
  eller byt kartkälla till **OpenStreetMap (ingen nyckel)** i Map Views
  inställningar. Kartan i sig fungerar hela tiden; stämpeln är bara en påminnelse.
- **Kartan visar inte ODEN-lagren** – en öppen kartpanel behåller sin egen
  filtrering; kör `⋯ → "Visa ODEN-lagren på kartan"` så återställs den.
- **Grafen är tom** – noderna syns först när entitetsnoter skapats; mata in
  data och bekräfta förslag.
- **Högerklicksmenyerna saknar alternativ** – det är inställningen *Förenklade
  menyer* (på som standard), som bara visar ODEN-valen och det vanligaste.
  Stäng av den under **Settings → ODEN** om du behöver hela Obsidian-menyn.
- **AI-chipsen blir grå** – kontrollera att Ollama kör (`ollama list`) och
  testa anslutningen i inställningarna. ODEN arbetar deterministiskt vidare
  tills anslutningen är tillbaka.
- **Signal-meddelandet blev ingen rapport** – öppna Odens dashboard
  (`http://127.0.0.1:8080`) och titta i loggarna/meddelandevyn: meddelandet
  måste börja med `7S RAPPORT` och ha fälten TNR/Stund/Ställe/Sagesman (plus
  Händelse, eller Styrka/Slag/Sysselsättning/Symbol). Kontrollera också att
  gruppen inte är ignorerad i Oden.
- **Rapporten kom men syns inte i ODEN-flödet** – kontrollera att frontmattern
  har `typ: 7S-rapport` (bara sådana filer analyseras) och att filen inte
  ligger i `demo/`.
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
