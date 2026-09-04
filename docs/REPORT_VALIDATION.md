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
   flaggar varje TNR som inte finns i underlaget ("okänd källa — kontrollera"),
   `ensureCitations` återinför tappade källor. En hallucinerad källa kan aldrig
   bli en klickbar länk.
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

| datum | modell | rapporter | roster-tokens | num_ctx | cellträffar (av 2 celler) | hallucinerade TNR (efter vakt) | körtid |
| --- | --- | --- | --- | --- | --- | --- | --- |
| _(fylls i vid körning)_ | | | | | | | |

## Ärliga förväntningar

- **qwen3-vl:4b** (standard): flytande omformuleringar av larmen + ytliga
  tidsmönster; källdisciplinen kommer från vakterna, inte modellen.
- **8b/32b**: verklig chans till dygnsöverskridande syntes (sektorklustring,
  återkomstmönster) — men påstå inget innan tabellen ovan har raden.
- **Degradering**: 💬 av → kryssrutan avstängd; Ollama nere vid start →
  tier-1-rapport + ärlig Notice; fel mitt i → felrad i rapporten; svag modell
  → hypoteserna överlever bara som flaggade, källhänvisade förslag.
