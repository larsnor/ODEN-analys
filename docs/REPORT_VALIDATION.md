# Djupanalysen — mätprotokoll (tier 2 av "Genomför analys")

**Lager:** `plugin/src/report.ts` (prompter, roster-digest, vakter) · `promptversion 1`

Syskon till `BEHAVIOUR_VALIDATION.md`/`CRAFT_VALIDATION.md`: samma kultur —
LLM-lagrets värde MÄTS innan det påstås. Tier 1 (den deterministiska rapporten
med E19-lista) är produkten och behöver ingen modell; tier 2 är additiv.

## Utdatakontraktet

Djupanalysen producerar **enbart hypoteser att verifiera** — aldrig fakta:

1. Underlaget är deterministiskt: ODEN:s fynd + **SAMTLIGA meddelanden i
   perioden** (fullständig roster, ordagrann Händelse/Symbol-prosa — mönstret
   kan gömma sig i meddelanden som fått poäng 0).
2. Varje påstående måste citera `[[TNR…]]`; `sanitizeHypotheses` avlänkar och
   flaggar varje TNR som inte finns i underlaget ("okänd källa — kontrollera")
   — en hallucinerad källa kan aldrig bli en klickbar länk. (`ensureCitations`
   används INTE här: den återinför den deterministiska textens källor — rätt
   för chatten, men skulle dumpa hela rostern som Källor-rad; uppmätt.)
3. Sektionen är märkt _föreslagen-av: llm_; misslyckas körningen skrivs ett
   ärligt fel in i rapporten — aldrig tyst.

## Kontextfönstret (automatiskt, ingen ratt)

`computeNumCtx` = min(behov + 1500, modelltak via /api/show, RAM-tak) med golv
8192; RAM-tak 16384 (≤16 GB) / 32768 (större). Uppmätt: qwen3-vl tränad till
262144, qwen3:32b till 40960; KV-cachen kostar ≈144 KB/token på 4b. Valet och
dess indata skrivs i rapportens Underlag. Överskrids taket delas underlaget
per dygn (map-reduce).

## Protokoll

```
S=<korpus med facit>   # 7s-generator + add-hostiles (recon + infiltration)
npx tsx test/run_report_eval.ts "$S" qwen3-vl:4b
npx tsx test/run_report_eval.ts "$S" qwen3-vl:32b
```

Skarpaste testet är **infiltrationscellen**: var för sig oskyldiga
observationer vars mönster bara finns ÖVER meddelanden — exakt operatörens
scenario. Människan läser hypoteserna bredvid facit (medlem/subtyp/TNR) och
bedömer träff.

## Resultat

Korpus: suburban seed 2026, 360 rapporter (336 civila + recon- och
infiltrationscell), "allt"-spann, 48 GB-maskin, prompt 9 508 tokens uppmätt.

| datum | modell | anropsform | cellträffar (av 3) | hallucinerade TNR | körtid | utfall |
| --- | --- | --- | --- | --- | --- | --- |
| 2026-09-04 | qwen3-vl:4b | map-reduce 14 dygn (dimensioneringsbugg) | 0 | – | 1622 s | syntessteget gav inget svar |
| 2026-09-04 | qwen3-vl:4b | single-shot | 0 | – | 88–160 s | **tom output: hela genereringsbudgeten gick till tänkande** |
| 2026-09-04 | qwen3-vl:8b | single-shot | 0 | – | 60 s | samma tänkspiral, tomt innehåll |
| 2026-09-04 | **qwen3:32b** | single-shot, think:false | **2 (H2 recon + infiltrationscellen)** | 1 (TNR-siffra skiftad — vakten flaggar exakt sådana) | **59 s** | 5 välformade, källhänvisade hypoteser |
| 2026-09-04 | qwen3:8b (text) | single-shot, think:false | 1 (en samordningshypotes med 5 cell-TNR av 7 citat, H2+H3 blandade) | **0** | 25 s | marginell: övriga hypoteser benignt brus med 30–90-citats-dumpar; budget slut mitt i listan |
| 2026-09-04 | qwen3:4b (text) | single-shot, think:false | 0 | – | 17 s | **oanvändbar: engelsk tankekedja läckte in i innehållet, ingen hypotes** — struken ur modellstegen |

## Uppmätta lärdomar (inbyggda i koden)

1. **Ollamas qwen3-vl-taggar är THINKING-varianter** som ignorerar både
   `think:false` och `/no_think`: på en 9,5k-tokens analysuppgift spenderade
   4b/8b hela genereringsbudgeten på resonemang och returnerade TOMT innehåll.
   Textfamiljen qwen3 lyder `think:false`. → `pickDeepModel` väljer bästa
   dragna qwen3-textmodell (32b→14b→8b→4b) och faller tillbaka på
   visionsmodellen (som då ger en ärlig felrad, aldrig tystnad).
2. **Uppgiften måste ligga SIST i prompten** (data först, sedan UPPGIFT): med
   instruktionerna först tappade modellen bort uppdraget bakom den långa
   rostern. → `buildDeepPrompt`.
3. **Generering måste kapas** (`num_predict 1500`) så en tänkande modell inte
   kan äta hela fönstret. → `numPredict` i OllamaOpts.
4. **Dimensionering på ett ställe**: två anropare med egen chars↔tokens-mattematik
   gav first-eval-buggen (chunkade ett underlag som rymdes i ett anrop). →
   `planDigest`. Verklig tokenisering uppmätt: ~4,4 tecken/token på
   roster-materialet — 3,2-estimatet är konservativt åt rätt håll.
5. **Vakten behövdes på riktigt**: 32b citerade TNR260939 — en siffra ifrån
   den planterade TNR260940. I produktion avlänkas och flaggas den
   ("okänd källa — kontrollera").

## Operatörens modellval

Modalen listar ALLA dragna Ollama-modeller (även nyss hämtade) i en väljare:
förvalet är den uppmätta rekommendationen (`pickDeepModel`), uppmätt
oanvändbara modeller märks "(avråds — uppmätt oanvändbar)", och omärkta
modeller är helt enkelt omätta — kör evalen och fyll i tabellen innan de
rekommenderas. Ett dåligt val är ofarligt: formatvakten gör svamlet till den
ärliga felraden. Tillgänglighetsspärren gäller den VALDA modellen (djupanalysen
är ren text — visionsmodellen behöver inte vara dragen), och kontexttaket
hämtas från den valda modellen via /api/show.

## Ärliga förväntningar (efter mätning)

- **qwen3:32b** (48 GB-klass): levererar användbara, källhänvisade hypoteser
  på ~1 min och pekade ut infiltrationscellen — exakt operatörsscenariot
  ("var för sig oskyldiga händelser"). Brus förekommer (paketbud,
  häckklippning) — operatören triagerar.
- **qwen3:8b (text)**: fungerar med förbehåll — noll hallucinationer och en
  äkta cellpekande samordningshypotes, men bruset dominerar och
  citatsdisciplinen är svag (dumpar halva rostern som "evidens"). Näst-bästa
  val i modellstegen; operatören bör vänta sig mer triage.
- **qwen3:4b (text)** och **qwen3-vl 4b/8b (thinking-varianterna)**: klarar
  INTE djupanalysen — 4b-text läcker tankekedja i svaret (formatvakten
  looksLikeHypotheses fångar det → ärlig felrad), vl-varianterna tänker upp
  hela budgeten. Koden väljer aldrig 4b-text; vl bara som sista utväg.
  Maskiner utan användbar textmodell får tier-1-rapporten + ärlig felrad.
- **Degradering**: 💬 av → kryssrutan avstängd; Ollama nere vid start →
  tier-1-rapport + ärlig Notice; fel mitt i → felrad i rapporten; hallucinerad
  källa → avlänkad + flaggad + varningsrad.
