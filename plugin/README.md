# 7s-plugin — Bin 3 (analys)

Obsidian-plugin för analys av 7S-meddelanden. **Steg 1–2** av byggordningen
i `../PLUGIN_DESIGN.md §12`. Separat från Python-datamimiken (Bin 1) med flit.

## Steg 1 (skelett) — bevisar bin-gränsen + minimal API-yta
- ✅ Läser 7S-meddelanden (read-only), parsar frontmatter + 7S-kropp + `[[länkar]]`.
- ✅ Kommando **7S: Indexera och sammanfatta** → Markdown i en textpanel (enda UI:t, §7).
- ✅ Deterministisk kärna (`src/parse.ts`) utan Obsidian-import → testbar utanför Obsidian.

## Steg 2 (Jobb A — deterministisk ID-återidentifiering)
- ✅ Kommando **7S: Bygg entiteter (Jobb A)** → slår ihop fordon via nummerplåtar.
- ✅ **Avhårdkodad** mot prototypen: partiella plåtar löses ENBART mot plåtar som
  faktiskt observerats i korpus (ingen `CANONICAL_FULL`-frölista). Unik match →
  auto-sammanslagning (säker, §6.1); tvetydig → kandidat (nomineras, ej sammanslås);
  olöst → egen partiell entitet.
- ✅ **Skriv-kontrakt (§5):** skriver bara filer pluginet äger (`generator: 7s-plugin`),
  rör aldrig meddelande-/operatörsnoter, idempotent, rensar föråldrade egna filer.
- ✅ Mätt mot `../ground_truth.json`: 5 spårade plåtar återfunna, alla partialer rätt
  lösta, **0 falska sammanslagningar**. (Hittar även 4 återkommande pendlarfordon —
  nedviktning av dem är Steg 6, inte Jobb A.)

## Steg 3 (Jobb B — beskrivande märken, med operatörsbekräftelse)
- ✅ Kommando **7S: Bygg märkesnomineringar (Jobb B)** → extraherar märken ur
  Symbol-prosan (ryggsäck/keps/fordonsdekal), normaliserar varierad formulering
  till ett kanoniskt attributset, och **nominerar** kluster (slår ALDRIG ihop
  automatiskt, §6.1).
- ✅ **Operatörsbekräftelse:** panelen visar varje nominering med **Bekräfta /
  Avvisa**. Bekräfta → `slag: kannetecken`-not (`bekräftad-av: operatör`,
  `metod: jobb-b`). Beslut sparas; avvisade döljs.
- ✅ **Per-jobb-rensning:** `writeOwnedNotes` rensar bara filer med samma `metod`,
  så en Jobb A-körning aldrig raderar bekräftade Jobb B-noter.
- ✅ Mätt vs `ground_truth.json` `tells`: extraktionsrecall 36/36, 0 falska märken,
  1 signatur/kategori (perfekt normalisering), 0 brus i nomineringar.

## Steg 4 (text-gränssnitt — deterministiskt, §7.1)
- ✅ **💬 Fråga**: frågebox → tolkad query (eko) → deterministiskt svar med
  `[[TNR]]`-källor. Avsikter: entitet, återkommande, observationer (tid/plats/typ),
  fritext. Loggad dialog (`7s-dialog.md`); skrivvägg (identitetsfrågor routas till §9.3).

## §6.4 (transitiv aktörshärledning)
- ✅ **🕸️ Härled aktörer**: associationsgraf (kant = samförekomst i meddelande)
  över facetter (Jobb A-fordon + Jobb B-märken); sammanhängande komponenter över
  evidenströskel; komponent som spänner ≥2 typer = **aktör-hypotes** med
  evidenskedja (M1→M5→M9). **Nominerar** (§6.1); bekräfta→aktörsnod (`slag: aktör`,
  `bekräftad-av: operatör`). Tröskel justeras i panelen (§9.3-A).
- ✅ Evidensbunden, inte POI-bunden: ett POI-fordon utan delat märke (SDG417)
  dras INTE in — bra signal mot fantommönster.

### Inte ännu (Steg 5–7)
- ❌ Larm-med-pekare + inkrementell watcher, misstankepoäng, LLM.
  ❌ Rör aldrig graf/Map View/workspace-API.

## Filer

| Fil | Roll |
|-----|------|
| `src/parse.ts` | Ren TS: parser + sammanfattning. **Inga** Obsidian-importer. |
| `src/reid.ts`  | Ren TS: Jobb A — plåt-återidentifiering (avhårdkodad). |
| `src/vocab.ts` | Ren TS (data): synonym-/exklusionstabeller, identitetsdimensioner. |
| `src/marks.ts` | Ren TS: Jobb B-extraktion + normalisering till signatur. |
| `src/jobb.ts`  | Ren TS: Jobb B-nominering (nominerar, slår aldrig ihop). |
| `src/entity_notes.ts`, `src/mark_notes.ts` | Ren TS: idempotent rendering av provenance-märkta noter (fordon resp. kännetecken). |
| `src/scoring.ts` | Ren TS: mätning mot `ground_truth.json` (Jobb A + Jobb B). |
| `src/main.ts`  | Tunt Obsidian-skal: inställningar, vault-läsning, kommandon, textpanel, skriv-kontrakt (per-jobb-rensning). Enda filen som rör Obsidian-API. |
| `test/*.test.ts` | Kör mot riktiga `../reports` + `../ground_truth.json` via `node --test`. |

## Utveckling

```bash
cd 7s-plugin
npm install
npm test          # parser mot fixtures, utanför Obsidian
npm run typecheck # tsc --noEmit
npm run build     # esbuild → main.js
```

### Installera i en testvault

Kopiera `manifest.json` + `main.js` till
`<vault>/.obsidian/plugins/7s-analys/`, aktivera i Obsidian, peka inställningen
*Meddelandemapp* mot rapportmappen (default `reports`).

## Anteckning om format

Riktiga `bin1-intag`-rapporter bär `källa` och `bilagor` i frontmatter; dessa är
**överenskomna men ännu inte införda i `../FORMAT_SPEC.md` (v1.0)**. Parsern läser
dem därför defensivt (valfria) — se kommentar i `src/parse.ts`.
