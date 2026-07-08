# Bin 3 — Obsidian-plugin för 7S-analys: designdokument (rev. 2)

> **STATUS — historiskt designdokument.** Detta är den ursprungliga
> arkitekturspecifikationen. Pluginet är sedan dess **byggt och släppt (v0.1.0)** och
> har på några punkter avvikit från specen — **koden är sanningskällan**, se
> [`../plugin/README.md`](../plugin/README.md). Känd avvikelse: pluginet rör i praktiken
> Map View på *en* punkt (`focusMapOn` centrerar kartan på explicit operatörsåtgärd —
> "pekar, styr inte", en medveten uppmjukning av §7.3); den "loggade dialogen"
> (`7s-dialog`) togs bort; interface-skisserna i §8 (`FuzzyMatcher`, `VisionAnalyzer`)
> och den additiva berikningen i §5.3 implementerades inte som skrivet. Detektionens
> faktiska räckvidd är mätt i [`RE-ID_VALIDATION.md`](RE-ID_VALIDATION.md) och
> [`BEHAVIOUR_VALIDATION.md`](BEHAVIOUR_VALIDATION.md).

**Status:** ursprunglig arkitektur/specifikation (historisk — se statusrutan ovan).
**Datum:** 2026-06-24
**Omfattning:** endast Bin 3 (analys). Bin 1 (central app / data-mimik) och
Bin 2 (Obsidian-konfiguration, inkl. graf och Map View) ligger utanför.

> **Rev. 2 ändringar:** pluginet har **inga egna visuella vyer**. All visuell
> presentation sker i Obsidians befintliga grafvy och Map View (Bin 2).
> Pluginet är ett **text-gränssnitt**: tar emot frågor, ger textsvar (Markdown),
> och larmar om ny misstänkt aktivitet med en *pekare* till var operatören ska
> klicka i de befintliga vyerna. Härlett kart-/tidslinjedashboard borttaget.

---

## 1. Syfte och avgränsning

Pluginet läser 7S-meddelanden i vaulten och **härleder kunskap som meddelandena
inte explicit innehåller** (återidentifiering, kluster, mönster, misstankegrad).
Det **skriver tillbaka** härledda entitetsnoter (provenance-märkta) och
**kommunicerar med operatören i text** — frågor in, Markdown ut, plus larm som
pekar mot var i grafen/kartan något nytt syns.

Pluginet **renderar ingenting visuellt självt** utöver sin textpanel.

### 1.1 Bin 3 (hör hemma här)
- Återidentifiering (partiell→full plåt, sammanslagning av varianter).
- Klustring (tid/rum/entitet) och mönster-/avvikelsedetektering.
- Aggregering per entitet och transparent misstankepoäng (§6.4).
- Skrivning av provenance-märkta entitetsnoter (§5).
- Text-gränssnitt: frågebox, textsvar, larm-med-pekare (§7).

### 1.2 INTE Bin 3
| Frestelse | Rätt bin |
|-----------|----------|
| Lägga `[[länk]]` på plåt i meddelande | Bin 1 |
| Datummappar för meddelanden | Bin 1 |
| **Egen kartvy / tidslinje / graf i pluginet** | **Bin 2 (befintlig graf + Map View)** |
| Graffärger, kartfilter, dölja egenskaper | Bin 2 |
| Operatör skapar stub för hand | Bin 2 |
| Avgöra att `.JK..1` = `RJK241` | Bin 3 |
| Skapa/berika entitetsnot från analys | Bin 3 |

**Borttaget i rev. 2:** kartdashboard, tidslinjevy och plugin-egen analytisk
karta. Dessa uppnås genom att operatören tittar i Obsidians **befintliga** grafvy
och Map View, filtrerade på provenance-/`typ`-fält (Bin 2). Pluginet *pekar dit*
men *renderar inte*.

---

## 2. Tre provenance-klasser (krav från operatören)

Varje not tillhör exakt en klass, märkt i frontmatter, separerad i bakgrunden
och **filtrerbar i grafen/kartan** (Bin 2-filter på detta fält):

| Klass | `källa`-värde | Ägare | Skrivbar av plugin? |
|-------|---------------|-------|---------------------|
| Rå inkommande meddelande | `bin1-intag` | Bin 1 / matare | **Nej** (read-only) |
| Operatörsskapad entitet | `operatör` | människa (Bin 2) | Endast additivt (§5.3) |
| Plugin-genererad analysnot | `7s-plugin` | pluginet (Bin 3) | Ja (äger helt) |

- Bin 1 ska sätta `källa: bin1-intag` på varje meddelande → **läggs till i
  FORMAT_SPEC.md** som krav (uppdatering av spec + schema krävs).
- Operatörens mall (Bin 2) sätter `källa: operatör`.
- Pluginet sätter `källa: 7s-plugin` + `generator: 7s-plugin` på allt det skriver.
- Grafens färggrupper och Map Views filter använder detta fält. Det är
  **Bin 2-konfiguration**, inte plugin-kod.

---

## 3. Arkitektur (minimal yta — designkrav, se §11)

```
┌──────────────────────────────────────────────────────────┐
│  Obsidian-plugin (TypeScript) — liten, granskbar          │
│                                                            │
│  ┌─────────────┐   ┌──────────────┐   ┌────────────────┐  │
│  │ Ingest/Index │──▶│ Analys-kärna │──▶│ Text-gränssnitt│  │
│  │ (läs vault)  │   │ (determinist)│   │ - frågebox     │  │
│  └─────────────┘   │  re-id,      │   │ - textsvar(md) │  │
│         ▲          │  kluster,    │   │ - larm + pekare│  │
│         │          │  mönster     │   └────────────────┘  │
│  ┌──────┴──────┐   └──────┬───────┘                        │
│  │Vault watcher│   ┌──────▼──────┐    ┌────────────────┐   │
│  │(filändring) │   │ Persist     │    │ LLM-adapter    │   │
│  └─────────────┘   │ (skriv      │    │ (VALFRITT, ej  │   │
│                    │  entitets-  │    │  nu; no-op-    │   │
│                    │  noter §5)  │    │  default)      │   │
│                    └─────────────┘    └────────────────┘   │
└──────────────────────────────────────────────────────────┘
        │ läser meddelanden / skriver entitetsnoter
        ▼
   Vault  ──(operatören tittar)──▶  Obsidian-graf + Map View (Bin 2)
```

**Ingen** pil från pluginet till graf/Map View. Pluginet rör inte deras API.
Operatören klickar i de inbyggda vyerna, vägledd av pluginets textpekare.

Lager och enda ansvar:
1. **Ingest/Index** — läs meddelandefiler, parsa frontmatter + 7S + `[[länkar]]`,
   bygg modell i minnet. Ren läsning.
2. **Analys-kärna** — deterministisk, sidoeffektsfri, **testbar utan Obsidian**.
   (Logiken i `bin3_prototype/entity_lib.py`, portad till TS, hårdkodning bort.)
3. **Persist** — skriv provenance-märkta entitetsnoter enligt §5.
4. **Text-gränssnitt** — frågebox in, Markdown ut, larm-med-pekare. Enda UI.
5. **Vault watcher** — reagera på nya/ändrade meddelanden, inkrementell omräkning.
6. **LLM-adapter** — gränssnitt nu, no-op default (§8).

---

## 4. Datamodell (i minnet)

```
Report   { id, tnr, tidpunkt, plats, lat, lon, sagesman,
           styrka, slag, sysselsattning, symbol, links[], källa, file }
EntityRef{ raw, kind: plate-full|plate-partial|mark, reportIds[] }
Entity   { id, kind, members: EntityRef[], candidateMembers,
           observations[], firstSeen, lastSeen, count, sectors[],
           suspicion, suspicionReasons[] }
```

**EntityRef vs Entity** = bin-gränsen i kod: meddelanden ger råa refs; pluginet
*härleder* Entities genom sammanslagning. Bin 1 producerar aldrig Entities.

---

## 5. Skriv-kontrakt mot vaulten (kritiskt)

1. **Rör aldrig meddelandefiler** (`källa: bin1-intag`). Read-only.
2. **Äg endast filer med `generator: 7s-plugin`.** Endast dessa skrivs över.
3. **Operatörsnoter** (`källa: operatör`) berikas **additivt** i avgränsat block
   (`%% 7s-plugin start %%` … `%% slut %%`); aldrig överskrivning.
4. **Idempotens** — omkörning ger samma filer (deterministiskt).
5. **Säkert skrivs direkt, osäkert föreslås** (§6.3).

> Operatören skapar entiteter för hand (Bin 2), därför är §5.3 (additiv
> berikning, aldrig överskrivning av operatörsnoter) **bärande** — inte valfri.

---

## 6. Analys-kärnan (deterministisk)

### 6.0 Bin 1-antagande (bekräftat)
Bin 1 länkar **endast strikt deterministiska identifierare** (nummerplåtar,
personnummer, ev. telefonnummer/koordinater). **Inget beskrivande** länkas —
ryggsäckar, kläder, loggor, färger står som **ren prosa** i Symbol-fältet.
Konsekvens: beskrivande märken är inte grafnoder förrän pluginet skapar dem.
All "mjuk" återidentifiering ägs av pluginet.

### 6.1 Tre matchningsjobb (stege)
| Jobb | Vad | Metod | Åtgärd |
|------|-----|-------|--------|
| A — ID:n | plåtar, personnummer | regex, partiell=wildcard | **auto-slå ihop** vid säkerhet |
| B — i-vokabulär märken | kända föremål/attribut, normaliserade | deterministisk extraktion + synonymvikning + token-överlapp | **föreslå** (aldrig auto) |
| C — öppen vokabulär / omformulering | märken utanför vokabulären, samma sak olika ord | LLM (valfritt) | **föreslå** (aldrig auto) |

**Asymmetri-princip:** en falsk hopslagning skapar ett *fantommönster* — farligt
i underrättelsesammanhang. Därför: endast Jobb A (säker ID-match) auto-slås ihop.
Jobb B och C **nominerar kandidater** som operatören bekräftar/avvisar. Bekräftad
koppling skrivs med proveniens (`bekräftad-av: operatör`, `föreslagen-av:
deterministisk|llm`).

### 6.2 Extraktionspipeline (beskrivande märken)
1. **Extraktion** (deterministisk golv): dela Symbol-prosan på komma/konjunktion;
   per sats mönstret `(attribut)* substantiv (med detalj)?` mot en kontrollerad
   vokabulär (föremål: ryggsäck/keps/jacka…; attribut: färg, mörk/ljus…).
   Hanterar negation ("inga särskilda kännetecken", "utan väska") explicit.
   Flaggar koreferens ("samma man som igår") — löser den inte.
2. **Normalisering** (deterministisk): synonymtabell (svart→mörk, väska→ryggsäck…).
3. **Matchning/nominering**: jämför normaliserade attributmängder mellan rapporter,
   poängsätt överlapp transparent ("2 av 4 normaliserade token"), **föreslå** länk.

**Golv/tak:** den deterministiska extraktionen klarar den telegrafiska,
i-vokabulär-majoriteten (inkl. planterade tells när de är konsekvent formulerade).
Den **missar** öppen vokabulär, viss koreferens och tvetydig attribut-bindning.
Det är taket; LLM (§8) höjer det.

### 6.3 LLM:s roll (nominering, aldrig fakta)
LLM (valfritt, lokal Ollama) får **endast nominera**: extrahera märken utanför
vokabulären, och föreslå semantiska omformulerings-matchningar. LLM skriver
**aldrig** en slutsats till en entitetsnot autonomt. Granskningspåståendet:
*systemets hävdade fynd är deterministiska eller människo-bekräftade; LLM:n
nominerade bara kandidater en människa bedömde.* Se §8, §11.

### 6.4 Sammanslagning och transitiv identitetshärledning
Union-find över refs; **endast Jobb A-kanter** (säkra ID-matchningar) bildar
Entity automatiskt. Jobb B/C hålls som förslag tills operatören bekräftar.

**Transitiv, korstypsidentitet över distribuerad evidens (kärnvärdet).**
En *aktör* kan framträda som flera entiteter av olika typ (fordon, person,
ryggsäck) som **aldrig alla syns i samma meddelande**. Grafen visar bara
samförekomst via delade länkar; den kan inte *hävda* att tre skilda noder är
samma aktör. Pluginet gör det:

Exempel (det illustrerande fallet):
- M1: fordon `V` samförekommer med ryggsäck `B`.
- M5: ryggsäck `B` samförekommer med person `P`.
- M9: fordon `V` samförekommer med person `P`.
- Inget meddelande har alla tre. Transitivt: `V`, `B`, `P` är facetter av en
  aktör.

Mekanik:
1. Bygg en **associationsgraf** mellan entiteter där kant = samförekomst i ett
   meddelande, viktad av (a) antal meddelanden som stöder kanten, (b)
   kant-typens styrka (delad plåt > delat normaliserat märke > vagt märke),
   (c) tids-/rumsnärhet.
2. Hitta **sammanhängande komponenter** över kanter som passerar en
   evidenströskel. En komponent som spänner flera entitetstyper är en
   **aktör-hypotes**.
3. **Nominera, aldrig auto-slå-ihop** (utom rena Jobb A-ID:n): aktör-hypotesen
   presenteras med **kedjan av observationer som stöder den** (M1→M5→M9), så
   operatören ser *varför*. Operatören bekräftar/avvisar.
4. Vid bekräftelse materialiseras en **aktör-nod** (egen not, `källa:
   7s-plugin`, `bekräftad-av: operatör`) som länkar till facett-entiteterna och
   deras meddelanden. **Nu** syns slutsatsen i grafen — en aktörsnod som drar
   ihop fordon+person+ryggsäck med meddelandespåret.

> **Två provenans-axlar, blanda inte ihop:** `källa` säger *vem skrev filen*
> (aktör-noter skrivs av pluginet → `källa: 7s-plugin`, även när människan
> hävdade kopplingen). `föreslagen-av`/`bekräftad-av` säger *vems omdöme* ligger
> bakom kopplingen (`deterministisk` / `llm` / `operatör`). En operatör-hävdad
> aktör (§9.3-B) är alltså `källa: 7s-plugin` men `föreslagen-av: operatör,
> bekräftad-av: operatör`.

Detta är gränsen Bin 2/Bin 3 i sin skarpaste form: grafen (Bin 2) *visar
samförekomst och låter en människa ana*; pluginet (Bin 3) *härleder* distribuerad
transitiv identitet, motiverar den med evidenskedjan, och skriver — efter
bekräftelse — en nod grafen sedan visar. **Grafen visar; pluginet resonerar.**

### 6.5 Transparent misstankepoäng
Viktad, förklarbar summa. Signaler t.ex. återkomst över dygn, nattaktivitet,
geografisk koncentration nära objektet, spaningsindikatorer i sysselsättning,
delade (bekräftade) märken mellan olika fordon. Varje entitet får
`suspicionReasons[]` — aldrig bara en siffra. Närhetssignalen mäter mot objektet
OCH operatörens skyddsvärda fördefinierade platser (band skalade efter platsens
radie: <R→3, <2R→2, <4R→1); starkaste ankaret vinner, aldrig summerat — närhet
ensam når därmed aldrig larmtröskeln.

### 6.6 Klustring
Temporal (fönster), spatial (haversine), entitetsbaserad.

### 6.7 Bilder (bilagor till 7S-meddelanden)
Bilder hanteras på två arkitektoniskt åtskilda nivåer:

**Lagring och referens — Bin 1 (inte pluginet).** Den centrala applikationen
sparar bifogad bild i vaultens bilage-mapp och bäddar in en referens i
meddelandet (`![[bild_<tnr>.jpg]]` i kroppen och/eller `bilagor: [...]` i
frontmatter). Ingen tolkning. → **läggs till i FORMAT_SPEC.md** (mapp, namnschema
knutet till TNR, referensfält). Obsidian renderar `![[...]]` och visar bilagor i
grafen automatiskt (Bin 2, gratis).

**Innehållsanalys — Bin 3 (pluginet), en andra nominator.** Bildanalys matar
**samma** pipeline som textextraktion (§6.2): bild → kandidatmärken/-plåtar →
normalisera → matcha → **nominera** → operatör bekräftar → skriv med proveniens
(`föreslagen-av: llm-vision`). Ingen ny subsystem; en adapter till.

**Iron-regel gäller även bild:** vision-modellen **nominerar, hävdar aldrig**.
Vision-modeller hallucinerar med självsäkerhet — en obekräftad "RJK241 i foto"
får aldrig auto-slås ihop.

**OCR-plåtar — privilegierad nominering (aldrig auto-skrivning):**
- En OCR-läst plåt är skild från ett vagt märke, men *verifierad ≠ hävdad*: en
  människa skrev plåten i textrapporten; en modell *hävdar* tecknen i ett foto.
  OCR-fel är just de farliga för plåtar (8/B, 0/O/D, ifylld skymd position), och
  plåten är systemets starkaste identifierare — ett feltecken splittrar eller
  sammanfogar entiteter med hög tillit. Därför **ingen skrivundantag**.
- I stället: **privilegierad nominering** — pluginet visar den **beskurna
  bildregionen** bredvid föreslagna tecken, så bekräftelse blir en blick, inte en
  bedömning.
- **Korroborering snabbar på:** om OCR-plåten exakt matchar en redan
  människo-skriven plåt i korpus, bekräftar fotot ett mänskligt påstående
  (stark evidens, nära ett-klicks-bekräftelse). Matchar den inget bestående,
  förblir den en vanlig nominering som kräver en riktig titt.
- **Osäkerhet → partiell:** om OCR är osäker mellan `RJK241`/`RJK247`, emittera
  en **partiell** (`RJK24.`) in i den befintliga kandidatmatchningen (§6.2) i
  stället för att gissa hela strängen.

Granskningspåstående bevarat: *varje plåt i systemet är antingen människo-skriven
eller människo-bekräftad; vision-modellen skrev aldrig en i tysthet.*

---

## 7. Text-gränssnitt (enda UI)

### 7.1 Frågebox — konversationellt gränssnitt (med skyddsräcken)
Operatören för en **konversation** i naturligt språk; pluginet svarar i
**Markdown**. Det konversationella är medvetet valt (förväntat idiom idag).
Auditerbarheten bevaras inte genom att hålla LLM:n borta, utan genom att göra
LLM:ns *tolkning synlig* och hålla *fynden deterministiska*.

**Princip: LLM:n är översättare och berättare — aldrig orakel.** Den (a)
översätter luddig fråga → exakt deterministisk query, och (b) berättar exakt
deterministiskt resultat → flytande språk. Underrättelse-**fynden uppstår
aldrig i LLM:n**.

Skyddsräcken:
1. **Query-eko.** Den tolkade strukturerade queryn visas: "lurking nära
   grindarna i natt" → `sektor=Nordsektorn, tid=22:00–05:00, misstanke>baslinje`.
   Feltolkning syns direkt och rättas vid *frågan*, inte begravd i svaret.
2. **Deterministiskt svar.** Fynden (entiteter, observationer, poäng, skäl)
   kommer från den deterministiska motorn; LLM:n *formulerar* dem. Råresultatet
   alltid åtkomligt ("visa underliggande data").
3. **Grundning / ingen uppfinning.** LLM:n får **endast** queryresultatet som
   kontext, inte hela vaulten, och får inte nämna entiteter/TNR utanför
   resultatet (efterkontroll stryker/flaggar avvikelser).
4. **Källhänvisning.** Varje påstående länkar till sin TNR/entitet
   (`[[TNR140755]]`) — ett klick till primärkällan.
5. **Loggad dialog.** Chatten *inklusive varje turs tolkade query* sparas
   (`källa: 7s-plugin`, `typ: dialog`) — granskningsspår för det
   konversationella lagret.
6. **Skrivvägg.** Konversationen kan *föreslå* men aldrig hävda identitet eller
   skriva fynd; "är dessa tre samma?" routas till §9.3 A+B, inte till ett
   LLM-ja/nej.

**Kvarvarande, ärligt:** själva *översättningen* är LLM-omdöme — query-ekot gör
den *synlig* men inte *deterministisk*. En feltolkning ger en synligt fel query
operatören rättar, inte ett tyst fel fynd. Det är priset för konversations-UX.

**Degraderat läge (ingen LLM):** samma frågebox fungerar — operatören skriver
den strukturerade queryn direkt (eller via enkel syntax/meny) och får identiskt
deterministiskt svar. Konversation är *förbättringen*, inte grunden. (Samma
valfria Ollama-beroende som matchningslagret, inte ett extra.)

**Markdown only** — vidarebefordran via Obsidians inbyggda *Export to PDF*
(ingen PDF-kod, inget extra beroende).

### 7.2 Larm med pekare
När watcher + analys upptäcker något nytt larmar pluginet i text och **pekar**
mot var det syns:
> "Ny misstänkt koppling: 3 observationer delar `[[logotyp-fragment DGE]]`,
> sydsektorn, 02:00–04:00. Öppna grafen och titta på noden
> `logotyp-fragment DGE`, eller filtrera Map View på sydsektorn."

Pluginet **öppnar/filtrerar inte vyerna självt** — det beskriver vart man
klickar. (Operatörens uttryckliga val: larm + klick-förslag, inte automatik.)

### 7.3 Inga andra vyer
Ingen karta, ingen tidslinje, ingen graf i pluginet. Allt visuellt = Obsidians
befintliga graf + Map View (Bin 2).

---

## 8. Modell-lager (valfritt — två modeller, tre uppgifter)

Tre LLM-uppgifter, olika krav → **en multimodal generativ modell + en liten
embedding-modell**. (Inte fyra modeller; inte en enda heavyweight för allt.)

| Uppgift | Modellsort | Delas med |
|---------|-----------|-----------|
| Konversation (översätt fråga→query, berätta resultat) | generativ text/VLM | bild |
| Bildigenkänning (OCR-plåtar + scen/märken) | multimodal VLM | konversation |
| Fuzzy **extraktion** (öppen-vokab-rest ur prosa) | generativ VLM | konversation+bild |
| Fuzzy **likhet** (märkes-matchning) | **embedding-modell** | — (egen, liten, deterministisk) |

```ts
interface FuzzyMatcher {
  extractMarks(symbolText: string): Promise<MarkCandidate[]>;   // generativ VLM
  similarity(a: Mark, b: Mark): Promise<number>;                // EMBEDDING (deterministisk)
}
interface VisionAnalyzer {                                       // bild-nominator (§6.7)
  extractFromImage(img: ImageRef): Promise<MarkCandidate[]>;     // multimodal VLM
}
interface Conversation {                                         // §7.1
  toQuery(utterance: string, ctx: Dialog): Promise<StructuredQuery>; // generativ
  narrate(result: QueryResult): Promise<string>;                     // generativ
}
```

### 8.1 Varför embedding för fuzzy likhet (granskbarhet)
Kortsträngslikhet ("mörk ryggsäck" vs "svart väska med tryck") tjänar **bättre**
på en embedding-modell än en chatt-modell: embeddings är **deterministiska**
(samma indata → samma vektor varje gång), små, snabba — en likhetspoäng från en
fast embedding är **reproducerbar**, en chatt-modells "0.7, verkar lika" är det
inte. Detta gör det mest audit-känsliga steget (det som nominerar
entitets-sammanslagningar) till det mest reproducerbara. Försvarbart:
*"fuzzy-matchningen använder en fast embedding-modell med reproducerbara poäng."*

> Notera uppdelningen av fuzzy linking: **extraktion** av öppen-vokab-märken ur
> rörig prosa är generativt (VLM); **likhets-poängsättning** mellan märken är
> embedding (deterministisk). Embeddern matchar; VLM:n fyller bara
> extraktions-resten som den deterministiska parsern (§6.2) missade.

### 8.2 Degraderat men korrekt
- **Ingen modell:** deterministisk kärna (Jobb A auto, Jobb B-nomineringar,
  strukturerad frågebox §7.1) fungerar fullt ut. Bilder lagras/visas men
  analyseras inte. Konversation faller tillbaka till strukturerad query.
- **Med modeller:** lokal Ollama (LAN/host, inga nycklar, ingen internet). Allt
  generativt **nominerar/formulerar endast**; embeddern **poängsätter**; inget
  skrivs som fakta utan deterministik eller mänsklig bekräftelse.

### 8.3 Modellval — begränsning (beslut skjuts upp)
- **Multimodal generativ modell** täcker konversation + bild + fuzzy-extraktion.
  En modell för det generativa (enkelhet, minimal yta), framför separata
  text/vision-modeller eller en YOLO+VLM-kedja (bättre plåt-OCR men fler
  beroenden, sämre "ett litet plugin"-argument).
- **Embedding-modell** är liten — knappt mätbar på hårdvarubudgeten, och
  förbättrar granskbarheten snarare än belastar den.
- Konsekvens: multimodala modeller har vision-encoder → mer VRAM, ~30–60 %
  långsammare än text-only av samma storlek (jfr rugged-box-dimensionering).
  OCR-styrka varierar; plåtläsning vill ha dokument-stark vision. Urvalskriterier,
  inte beslut här.
- Båda modellerna byts utan kodändring (Ollama-API bakom adaptrarna).

---

## 9. När resonemanget körs (händelsestyrt, inte cykliskt)

En människa "ser plötsligt mönstret" genom att titta länge — maskinen gör inte
så. Givet samma indata ger den deterministiska kärnan samma svar varje gång.
Därför körs resonemanget **händelsestyrt**, inte i en cyklisk loop.

### 9.1 Tre triggrar
1. **Ny/ändrad data** (vault watcher). Ett enda nytt meddelande kan *stänga en
   transitiv kedja* och få **gamla** entiteter att lösas upp i en aktör (M9
   fullbordar M1→M5→M9, §6.4). **Krav:** den inkrementella omräkningen måste
   omvärdera hela den **berörda sammanhängande komponenten**, inte bara lägga
   till den nya noden — annars missas retroaktiva fullbordanden.
2. **Ändrad parameter** (operatören sänker evidenströskeln e.d.). Samma data,
   nya hypoteser. Legitim omkörning per (data, parametrar).
3. **Ändrad modell/konfiguration** (uppgraderad vision-/text-modell, utökad
   vokabulär, justerad prompt). Legitim **operatörsinitierad, loggad**
   "omanalysera korpus"-åtgärd — en genuint annan analysator, inte nya tärningar.

### 9.2 Determinism vs LLM — körningsregel
- **Deterministiska lager (Jobb A, B):** kör om endast vid data- eller
  parameterändring. Omkörning på identiska (data, parametrar) är meningslös —
  idempotent (§5.4). (Detta matchar den rena "en körning räcker"-intuitionen.)
- **LLM-/vision-lager (Jobb C):** körs **en gång per artefakt, resultatet
  cachas** med proveniens. Gamla artefakter körs **inte** om i hopp om nytt
  utfall.
- **Förbud mot "fiske":** att köra om LLM:n upprepade gånger över oförändrad
  data tills en hypotes dyker upp är **otillåtet**. LLM-utfall är stokastiskt;
  ett positivt utfall på sjunde försöket av tio är *svag* evidens, inte
  sjufaldig bekräftelse. Att frysa första svaret gör LLM-bidraget **stabilt**
  trots en stokastisk modell. Omkörning av LLM är legitim **endast** vid
  trigger 3 (modellen/konfigurationen ändrades), aldrig som automatisk loop.

### 9.3 Operatörens hunch (mänskligt mönster maskinen missat)
Operatören tittar på grafen och *anar* att tre entiteter (t.ex. fordon, person,
ryggsäck) är samma aktör — något pluginet inte härlett. Hunchen är **värdefull
evidens** och får inte slösas bort, men får heller inte korrumperas av
partiskt LLM-fiske. GUI:t markerar tre entiteter; svaret är **A + B**, aldrig
"håller du med?":

**A — Deterministiskt evidenssvar (default).** Frågan "är dessa tre samma?"
översätts **inte** till en LLM-prompt utan till en deterministisk redovisning:
visa **evidenskedjan** som (inte) binder dem (vilka meddelanden, vilka kanter,
kantstyrka), och **vilken tröskel** som skulle förena dem ("vid nuvarande
tröskel når V–B och B–P inte fram; sänk till T så kopplas komponenten"). Hunchen
*styrde var man tittar*; maskinen gav *granskbar evidens*. Detta är trigger 2
(parameterförfrågan), inte fiske.

**B — Mänsklig utsaga (åtgärden).** Operatören får **själv bekräfta** en
aktör-hypotes maskinen aldrig föreslog: markera de tre, "dessa är en aktör",
skrivs med proveniens `bekräftad-av: operatör, föreslagen-av: operatör`. En
människa är också en sensor — en bekräftad mänsklig bedömning är den
**starkaste** provenansklassen, inte den svagaste. Spåret redovisar ärligt
"människan hävdade detta, maskinen härledde det inte".

**Förbjudet:** att mata operatörens hunch till LLM:n som "stämmer inte det här?"
och köra om tills den instämmer. Det är *primat fiske* — operatören har gett både
hypotesen och önskad riktning; en lokal modell tenderar att hålla med. Det är
inte svag evidens utan **partisk** svag evidens, den värsta sorten. (Ett
neutralt, enskott, provenansflaggat LLM-andrahandsutlåtande vore tänkbart men
ingår inte nu — A+B räcker och håller interaktionen på rätt sida linjen.)

### 9.4 Sammanfattning
Deterministiskt resonemang = händelsestyrt (ny data / ändrad parameter).
LLM-nominering = en gång per artefakt, cachad. Full LLM-omanalys = avsiktlig,
loggad operatörsåtgärd kopplad till modell-/konfigändring. Operatörens hunch =
deterministiskt evidenssvar (A) + mänsklig utsaga (B); aldrig primat
LLM-omkörning. "Punkterna kopplas ihop över tid" sker på riktigt — drivet av
**inkommande evidens som fullbordar kedjor** och av **mänsklig bedömning**, inte
av att modellen körs om.

---

## 10. Teststrategi
- `ground_truth.json` = facit: precision/recall för re-id (hittas cellen? slås
  rätt partialer ihop? avvisas pendlarna?).
- Deterministisk kärna enhetstestas **utanför Obsidian** mot fixtures — centralt
  för granskbarhet.
- Matare i olika takt → verifiera inkrementell korrekthet mot batch.

---

## 11. Granskbarhet som arkitekturkrav (operatörens punkt 3)

Pluginet ska kunna försvaras som: *"Obsidian + Map View + ett enda litet,
transparent plugin vi byggt själva — här är koden."* Det styr designen:

- **Minimal Obsidian-API-yta.** Endast: läs vault, skriv egna filer, en
  textpanel. **Ingen** manipulation av graf-, kart- eller workspace-API.
- **Inga vy-bibliotek, ingen PDF-motor, inga tunga beroenden.** Markdown ut;
  PDF via Obsidians inbyggda export.
- **Deterministisk kärna = ren TS**, körbar och testbar utan Obsidian, läsbar i
  ett sittande. Modeller bakom valfria gränssnitt, default av.
- **Konversations-LLM som översättare/berättare, aldrig orakel** (§7.1): fynden
  är deterministiska, LLM:ns tolkning visas (query-eko) och loggas, svaren
  källhänvisar, och inget skrivs som fakta utan deterministik eller bekräftelse.
  Fuzzy-likhet via **deterministisk embedding** (reproducerbar), inte chatt-omdöme.
- **Transparent poäng** med förklaring, ingen svart låda.
- **Provenance-separation** gör att en granskare ser att pluginet bara skriver
  sin egen klass av noter och aldrig rör rå intagsdata.
- **Litet kodfotavtryck** prioriteras framför funktioner.

---

## 12. Föreslagen byggordning (för senare beslut)
0. **Datagenerator-ändring (förutsättning):** uppdatera mimiken så att märken är
   **ren prosa** (endast plåtar/ID:n länkas), och så att återkommande tells
   **varieras i formulering** mellan observationer (testar Jobb B/C realistiskt,
   inte den smickrande konsekventa varianten). Signalen (spaningscellen) finns
   kvar, men uttryckt i varierad prosa.
1. **Skelett**: plugin-skal, inställningar, vault-läsning, parsning, ett trivialt
   textsvar end-to-end. Bevisar bin-gränsen + minimal yta.
2. **Jobb A (ID-re-id)** (ren TS) + skriv entitetsnoter enligt §5; mätt mot facit.
3. **Extraktion + Jobb B** (deterministiskt golv): extrahera märken ur prosa,
   normalisera, nominera matchningar för operatörsbekräftelse.
4. **Text-gränssnitt**: frågebox + grundfrågor → Markdown-svar.
5. **Larm-med-pekare** + inkrementell drift (watcher).
6. **Transparent poäng** + förklaringar i svaren.
7. **LLM-adapter** (Ollama) — Jobb C-nomineringar, valfritt lager (degraderat
   utan).

> **Öppet beslut kvar:** §7.1 frågebox och LLM (struktur-fråga nu + LLM översätter
> fråga→query senare, eller LLM-konversation direkt, eller ren syntax). Skjuts upp.

Inget påbörjas förrän designen är godkänd.
