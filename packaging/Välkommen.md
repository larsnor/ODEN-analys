# Välkommen till ODEN 👁️

ODEN analyserar 7S-lägesrapporter: känner igen återkommande fordon och kännetecken,
kopplar ihop dem till aktörer, poängsätter misstänkt aktivitet och larmar vid ny
aktivitet. **ODEN föreslår — du som operatör avgör.** Ingen koppling skapas utan din
bekräftelse, och all analys går att granska i efterhand.

Det här valvet är färdigkonfigurerat: ODEN-panelen (nere till höger), kartan och
grafen är på plats, och allt fungerar utan internet.

## Kom igång (checklista)

1. **Sätt operationsområdet.** Tryck `Cmd/Ctrl-P` och kör
   **"ODEN: Konfigurera operationsområde"**. Ange koordinaten för det som ska
   bevakas (`lat,lon` eller en MGRS-ruta). Kartan centreras dit och 🎯 Objektet
   skapas.
2. **Namnge kända platser.** Panelens `⋯`-meny → **"Namngivna platser…"** — lägg in
   grindar, förråd och infarter i förväg. Markera känsliga platser som
   **skyddsvärda** så larmar ODEN vid aktivitet i närheten. Tips: högerklicka i
   kartan → *"Copy geolocation as front matter"* och klistra in positionen.
3. **Lär känna panelen.** Överst: 🌙/☀︎ (tema), `＋ Obs` (egen observation),
   `⋯` (meny). Chipsen **📷 Bild · 📝 Text · 💬 Chat** slår på de valfria
   AI-förmågorna (kräver Ollama, se nedan) — utan dem kör ODEN helt
   deterministiskt. I flödet **Händelser & larm** dyker allt nytt upp; klickbara
   förslagsrader (🔗 🎒 📷 📝) öppnar granskning där du bekräftar eller avvisar.
   Längst ner: frågelådan — fråga t.ex. *"vilka larm har vi?"* eller ange en
   registreringsskylt.
4. **Dina operatörsverktyg.** Högerklicka på en rapport →
   **"ODEN: Flagga som larm"** (rapporten larmas med skälet *flaggad av
   operatör*). Högerklicka på en rapport, ett fordon, en aktör eller ett
   kännetecken → **"ODEN: Bevaka"** — den hamnar i 🔭 **Bevakningslistan** överst
   i panelen och ny aktivitet markeras med *+N nya*. Bevakning påverkar aldrig
   misstankepoängen.

## Testa med demodata (rekommenderas första gången)

Mappen `demo/` innehåller en syntetisk övningskorpus: 14 dygn kring **HvSS
Vällinge** med ~480 rapporter (varav foton), en dold spaningscell och en
demonstration. Så här "matar" du in den — inga verktyg behövs:

1. Sätt operationsområdet till demokoordinaten: `59.2622,17.712`.
2. Dra mappen **`demo/batch-01`**:s innehåll till **`inkorg/`** (i Obsidians
   filpanel eller i Finder/Utforskaren). ODEN läser rapporterna direkt — se
   flödet reagera.
3. Fortsätt med `batch-02`, `batch-03` … i din egen takt. Granska förslag,
   flagga, bevaka, fråga i chatten.
4. Med **Ollama** igång: slå på 📷-chipet och dra en batch med foton — se
   *"Bild mottagen, analys startad"* följt av bildfynd att granska.

Klart att börja om? **"ODEN: Konfigurera operationsområde"** med ny koordinat
rensar alla beslut (du varnas först); radera sedan innehållet i `inkorg/`.

Vill du generera egna korpusar (andra platser, andra hotbilder)? Se
[7S-generator](https://github.com/larsnor/7S-generator).

## Skarp drift

1. Radera mappen `demo/` (och ev. övningsinnehåll i `inkorg/`).
2. Sätt ditt riktiga operationsområde och namnge platserna i förväg.
3. Låt intaget (t.ex. Signal-appen/källappen) leverera 7S-rapporter till
   `inkorg/` — ODEN:s bevakare plockar upp dem automatiskt.

## Ollama — valfri AI-förstärkning

ODEN:s kärna är deterministisk och **detektionen är aldrig beroende av AI**.
Chipsen 📷/📝/💬 ger extra räckvidd (läser foton, hittar kännetecken i fritext,
svarar i naturligt språk) via en **lokal** språkmodell — inget lämnar datorn.

1. Installera [Ollama](https://ollama.com) (gratis, macOS/Windows/Linux).
2. I en terminal: `ollama pull qwen3-vl:4b` (≈3 GB, engångsnedladdning).
3. Obsidian → **Inställningar → ODEN** → knappen **"Testa anslutning"**.
4. Slå på chipsen i panelen. Allt modellen hittar är **förslag** som du
   bekräftar eller avvisar — aldrig automatiska beslut.

## Mer

- Installationsalternativ och felsökning: `INSTALL.md` i releasen /
  [GitHub](https://github.com/larsnor/ODEN-analys).
- Skärmfilmer (korta genomgångar): *kommer — länkas här när de är publicerade.*
- Den här noten kan raderas när du inte behöver den längre.
