# Vision-modell: mätning före val (bake-off)

**Regel (projektets valideringskultur):** modellistan och default-modellen fryses
från VÅRA egna siffror på VÅRA uppgifter — aldrig från leverantörsbenchmarks eller
bloggposter. Harnessen är `plugin/test/vision_harness.ts` (manuell körning, kräver
lokal Ollama — ingår INTE i `npm test`):

    cd plugin && npx tsx test/vision_harness.ts qwen3-vl:8b llava:7b

## Uppgift och mätklasser

ODEN:s första bildscope: **fordon (märke + färg), registreringsskyltar, personer
(kön, åldersband, klädfärger, utrustning)**. Personscope = attributBESKRIVNING,
aldrig identitet (ansiktsigenkänning är uttryckligen utanför — biometri/GDPR).

Skylt-läsningar klassas per bild:
- **exact** — exakt rätt (normaliserad)
- **near** — redigeringsavstånd ≤2 (en mänsklig granskning fångar felet)
- **miss** — modellen svarar NONE (ärlig osäkerhet — HELT OK)
- **WRONG** — en självsäker felaktig skylt: hallucination-klassen. Det är DENNA
  klass som motiverar nomineringsgrinden (§6.7: bilder nominerar, aldrig hävdar).

## Del 1 — syntetiska skyltkort (BÄSTA-FALL-OCR)

20 rena kort (fixtures/vision/, renderade via 7S-generatorns render_plate,
blandade format ABC123/ABC12D med förväxlingsglyfer O/0, I/1, B/8, S/5, G/6, Z/2).
Detta är ett TAK, inte fältprestanda: perfekt ljus, rak vinkel, hög kontrast.

| modell | exact | near | miss | WRONG | ~ms/bild (M1 16 GB) |
|---|---|---|---|---|---|
| llava:7b (baseline) | 3/20 (15 %) | 12 | 0 | **5** | ~5 700 |
| qwen3-vl:8b | _(pågår)_ | | | | |
| qwen3-vl:4b | _(pågår)_ | | | | |
| minicpm-v4.5:8b | _(utmanare)_ | | | | |
| gemma4:12b | _(om den ryms på M1)_ | | | | |

**Baseline-observation (llava:7b):** 15 % exakt på RENA kort, och 5/20 självsäkra
felläsningar (t.ex. XYZ789 → SY79YX789). Mönster: sista tecknet tappas ofta
(BEB838 → BE83). Detta bekräftar två designbeslut: (1) llava:7b är endast
harness-baseline, inte listkandidat; (2) fotoläsningar måste vara operatörsgrindade.

## Del 2 — riktiga fotografier

Operatörens set: **42 bilder** (`plugin/test/fixtures/vision_real/`, git-ignorerat —
riktiga personer/fordon/skyltar; publika repot får bara siffror via denna fil).
Facit författades från bilderna och **verifierades av operatören 2026-07-14**
(perfekt överensstämmelse) — mätningarna nedan vilar alltså på ett granskat facit.
Täcker: rena svenska skyltar (närbild + fält), personliga skyltar (SMILLA, RAMSJÖ),
UTLÄNDSKA skyltar som INTE ska tolkas som svenska (UK, US), skymda/avlägsna skyltar,
hela beteendespektrumet (kikare ×4, teleobjektiv, ghillie-prickskytt, stängselklipp,
stängselklättring ×3, skymningssiluett), benigna gränsfall (svampplockare, turister,
vandrare, hundägare) och svåra «okänd»-fall (ryggtavlor, avstånd, skymning).

### 2a. Skylt-OCR på riktiga foton (auto-poängsatt, 13 säkra svenska skyltar)

| modell | exact | near | miss | WRONG | ~ms/bild |
|---|---|---|---|---|---|
| llava:7b (baseline) | 0/10 (0 %) | 6 | 2 | 2 | ~5 800 |
| qwen3-vl:8b | _(pågår)_ | | | | |
| qwen3-vl:4b | _(pågår)_ | | | | |

_(llava-raden kördes innan de tre närbilderna ä/å/ö lades till → n=10; övriga n=13.)_
**Baseline:** 0 % exakt men 6/10 near (RTZ355 → RTZ365) — hittar rätt skyltregion,
räknar fel tecken. Exakt det gapet en riktig VLM ska stänga.

### 2b. Attribut (fordon/person) — mänsklig granskning

`--sighting` kör den skarpa JSON-prompten (samma som `photo_analysis.ts` kommer
använda) och skriver modell-JSON bredvid facit-noten. Poängsätts av operatören
(fuzzy: är "oliv" == "grön"?). Objektiv delmätning: personantal ±1. Hårda fall är
märkta `expect_unknown` — en modell som GISSAR kön/ålder på en ryggtavla eller
skymningssiluett straffas.

_Resultat fylls i när bake-off körts._

## Beslut

_Fylls i när Del 1+2 körts: vald default, kuraterad VISION_MODELS-lista, kända
begränsningar (ärlighetsnot i README + detektionsscope)._
