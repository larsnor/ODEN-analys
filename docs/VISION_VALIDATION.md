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
| qwen3-vl:8b | 0/20 rått · **18/20 (90 %) efter S-normalisering** | 20 rått → 2 | 0 | **0** | ~39 700 |
| qwen3-vl:4b | 1/20 rått · **19/20 (95 %) efter S-normalisering** | 19 rått → 1 | 0 | **0** | ~68 000 |
| minicpm-v4.5:8b | _(ej kört — 4b/8b räckte för beslut)_ | | | | |
| gemma4:12b | _(ej kört — 4b/8b räckte för beslut)_ | | | | |

**Baseline-observation (llava:7b):** 15 % exakt på RENA kort, och 5/20 självsäkra
felläsningar (t.ex. XYZ789 → SY79YX789). Mönster: sista tecknet tappas ofta
(BEB838 → BE83). Detta bekräftar två designbeslut: (1) llava:7b är endast
harness-baseline, inte listkandidat; (2) fotoläsningar måste vara operatörsgrindade.

**qwen3-vl:8b-fynd (syntetiskt):** ALLA 20 «near» hade samma orsak — modellen läser
den blå EU-remsans nationsbokstav och prefixar «S» (ABC123 → SABC123). Det är inte
ett OCR-fel utan en normaliseringsfråga: integrationens `normalizePlate` ska
strippa ett inledande S när resten matchar skyltmönstret. Efter S-strippning:
**18/20 exakt, 2 near (SKXXK747: dubblerat X; SDL525: tappat L), 0 WRONG.**
Priset är latensen: ~40 s/bild på M1 (mot llavas ~6 s) — precis den avvägning
den kuraterade modellistan (4b/8b/32b) finns för.

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
| qwen3-vl:8b | **12/13 (92 %)** | 1 | 0 | **0** | ~27 400 |
| qwen3-vl:4b | **11/13 (85 %)** | 2 | 0 | **0** | ~15 200 |

_(llava-raden kördes innan de tre närbilderna ä/å/ö lades till → n=10; övriga n=13.)_
**Baseline:** 0 % exakt men 6/10 near (RTZ355 → RTZ365) — hittar rätt skyltregion,
räknar fel tecken. Exakt det gapet en riktig VLM ska stänga.

**qwen3-vl:8b:** rått rapporterade harnessen 10 exakt + 2 «WRONG» — men de två
«felen» (7777↔88888) visade sig vara ett FACITFEL: filparet var förväxlat i
ground truth (upptäckt just för att modellen svarade «fel» konsekvent i kors;
rättat 2026-07-14). Korrigerat: **12/13 exakt, 1 near, 0 WRONG.** Den enda
near-läsningen är RAMSJÖ → RAMSJO (Ö-translitteration på personlig skylt) —
en normaliseringsfråga (vik Ö→O vid jämförelse), inte ett läsfel. Läser även
personliga skyltar (SMILLA, RAMSJÖ) och avstår korrekt på det som saknar skylt.
Metodnotering: att en mätning kan avslöja fel i sitt eget facit är precis
varför harnessen finns.

### 2b. Attribut (fordon/person) — mänsklig granskning

`--sighting` kör den skarpa JSON-prompten (samma som `photo_analysis.ts` kommer
använda) och skriver modell-JSON bredvid facit-noten. Poängsätts av operatören
(fuzzy: är "oliv" == "grön"?). Objektiv delmätning: personantal ±1. Hårda fall är
märkta `expect_unknown` — en modell som GISSAR kön/ålder på en ryggtavla eller
skymningssiluett straffas.

**qwen3-vl:8b, första svep (2026-07-14):** 42 bilder → 22 giltiga JSON, 19
trunkerade («ogiltig JSON»), 1 hårt kontextfel. **Rotorsaken var harnessens, inte
modellens:** Ollamas DEFAULT-kontext är 4096 tokens och en VLM-bild äter ~2–4k →
strukturerad JSON trunkeras mitt i. `options.num_ctx ≥ 8192` åtgärdar det —
**OBLIGATORISKT även i integrationen** (fotgun dokumenterad här med flit).

Kvaliteten NÄR svaret kom fram:
- **«okänd»-disciplinen håller.** Ghillie-prickskytten: kon/alder «okänd», klädsel
  «grön textil med nätliknande struktur», utrustning «optisk enhet» — exemplariskt
  ärligt. Ryggtavlorna (3 pers), vandrarna och skymningssiluetten: «okänd» på kön
  genomgående; ålder gissades i 1 av 4 (medelålders på ryggtavla — mild).
- **Attributskärpa:** läste Volvo-loggan PÅ hoodien (101010), såg mobiltelefonen i
  handen (22222), kikare/teleobjektiv/handskar/hattar konsekvent rätt, klädfärger
  korrekta i samtliga granskade svar.
- **Facit-fynd nr 2 och 3:** modellen hittade en traktor i ladan (444444) och
  räknade poliserna i bakgrunden (iiiii) — båda saknades i facit; rättade.
  (Fynd nr 1 var 7777↔88888-förväxlingen i Del 2a.)
- **Fel:** ett märkesfel (röd Audi → «Volvo», åååååå); en persondubblering
  (vvvvvv: samma man två gånger); tre tomma `{}`-svar på benigna personbilder
  (99999, rrrrrr, wwwww) — utreds efter num_ctx-fixen.
- **Personantal:** 16/22 rätt (±1 för grupper ≥4).
- **Latens:** 100–290 s/bild för full JSON på M1 — integrationen MÅSTE vara
  asynkron/köad (aldrig i watcherns heta väg), och 4b-nivån finns av detta skäl.

**Omkörning med num_ctx=8192 (23 bilder):** trunkeringarna BOTADE — 0 ogiltiga
JSON bland de 9 svar som hann fram, inklusive fler exemplariska «okänd»-läsningar
(svartklädd ryggtavla: kon/alder okänd + svart ryggsäck ✓) och en perfekt
klädfärgsläsning (ljusblå skjorta med rullade ärmar/olivgröna byxor/vita
sneakers/klocka/solglasögon). MEN: 14/23 hårda timeouts (>300 s×2) — den större
kontexten pressade M1:ans 16 GB till swap.

**Operativ slutsats (M1 16 GB):** qwen3-vl:8b är TRÄFFSÄKER men för långsam för
fulla sighting-anrop på denna klass av maskin (100–600 s/bild). Det är exakt
nischen 4b-nivån reserverades för — mätningen fortsätter där. 8b/32b hör hemma
på insatsmaskinen. Integrationens design påverkas: asynkron kö, nedskalning av
bilder före anrop, och modellval per maskinklass.

**`{}`-beteendet reproducerat** på samma benigna bilder (99999, rrrrrr, wwwww,
+6666) även med rätt kontext — verkligt modellbeteende, inte trunkering. Mönstret
(person-nära, «inget säkerhetsrelevant»?) utreds i 4b-passet; tills orsaken är
känd är det ännu ett argument för att fotoanalys NOMINERAR och aldrig får vara
den enda detektionsvägen (§8.2: detektionen beror aldrig på vision).

### 2c. qwen3-vl:4b — den avgörande överraskningen

4b kördes på num_ctx=8192 med 600 s timeout, både plåtpass och de 18 luckor 8b
lämnade. Utfall:
- **Skyltar: 4b ≈ 8b.** Syntetiskt 19/20 (mot 8b:s 18/20) efter S-strippning;
  riktiga svenska 11/13 (mot 12/13), **0 WRONG i BÅDA fallen.** OCR-förmågan
  sitter alltså i VL-familjen, inte i parameterantalet — och 4b är ~1,8× snabbare
  på fältskyltar (~15 s mot ~27 s/bild).
- **Sighting: 4b klarade sig UTAN timeouts** där 8b föll 14/23 — och gav skarpa
  attribut: läste US-skylten på RAV4:n (svår), räknade turistgruppen 4/4, fångade
  «orange sovmatta» på ryggsäcken (bbbbbb), klädfärgstestet komplett (wwwww).
  Personantal 11/17 rätt.
- **Samma svagheter som 8b, inte värre:** samma `{}` på 3333/6666/ggggg/ppppp
  (nu 4 st — den gemensamma bristen är alltså familjens, inte storlekens);
  gissade ålder «ung» på intrångsklättraren (sssss). Inga NYA felklasser.

## Beslut (2026-07-14)

**Kuraterad `VISION_MODELS` (frozen; dropdown i inställningar):**

| tag | storlek | roll | belägg |
|---|---|---|---|
| **qwen3-vl:4b** | 3,3 GB | **DEFAULT** (dev + M1/16 GB-klass) | 95 %/85 % skylt, 0 WRONG, inga timeouts, ~2× snabbare än 8b |
| qwen3-vl:8b | 6,1 GB | noggrannhetsläge (≥32 GB-maskin) | 90 %/92 % skylt, marginellt vassare attribut — men 100–600 s/bild på 16 GB |
| qwen3-vl:32b | 21 GB | insatsmaskin (GPU/stor RAM) | ej mätt här; samma familj, reserverad för kraftfull hårdvara |

llava:7b UTGÅR som kandidat (15 %/0 % skylt, 5 self-WRONG) — endast baseline.
minicpm/gemma kördes ej: 4b/8b räckte för ett tryggt beslut, och att stanna vid
en modellfamilj håller prompt + normalisering konsekvent.

**Bekräftade designkrav som mätningen tvingade fram:**
1. `normalizePlate` måste strippa inledande nations-«S» (alla near-fel var detta)
   och vika Ö→O/Ä→A/Å→A vid jämförelse.
2. `num_ctx ≥ 8192` OBLIGATORISKT i varje sighting-anrop (default 4096 trunkerar).
3. Fotoanalys är ASYNKRON och köad, aldrig i watcherns heta väg; bilder skalas
   ned före anrop; modell väljs per maskinklass.
4. Nomineringsgrinden är load-bearing, inte kosmetisk: 0 WRONG på skyltar är
   utmärkt, MEN `{}`-luckorna och enstaka ålders-/märkesgissningar betyder att
   vision ALDRIG får vara enda detektionsväg (§8.2).
5. «okänd»-disciplinen håller hos BÅDA storlekar — kön gissas i princip aldrig på
   ryggtavlor/siluetter; det är själva förutsättningen för persondelen.

**Steg 1 BYGGT (2026-07-14):** src/llm.ts (Ollama-klient + health + VISION_MODELS),
src/photo_analysis.ts (PhotoSighting-typer, den granskade prompten, parse/validering,
recon-behaviour-mappning, sighting→per-item-nomineringar; 10 CI-tester med FakeVision).
main.ts: settings (visionEnabled/ollamaUrl/visionModel/photoAnalyses-cache/
photoPlates/photoAnnotations), computePhotoSightings (kör-en-gång per bild-hash+
modell+promptversion), Job A-injektion av bekräftade foto-plåtar (ids.ts source
"photo"), panel-lägesstrip (📷/📝/💬-chippar + anslutningsprick), per-item
granskningsskärm över fotot, kommando "Analysera bilder nu", varning vid påslag,
inställnings-dropdown + "Testa anslutning". 157 tester gröna. De 5 mätkraven ovan
hedrade (normalizePlateRead, num_ctx 8192, async/kommando-styrt, nomineringsgrind,
modell per maskinklass). Provenance: föreslagen-av llm-vision, bekräftad-av operatör.
