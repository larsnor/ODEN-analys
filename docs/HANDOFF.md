# 7S Intelligence Analysis Project — Handoff Summary

> **STATUS — read first (this is a historical handoff).** The plugin is **built and
> shipped (v0.9.1)**; this document is a chronological build log — older sections
> describe the machine/paths/UI of their time. The **code** and the
> validation notes ([`RE-ID_VALIDATION.md`](RE-ID_VALIDATION.md),
> [`BEHAVIOUR_VALIDATION.md`](BEHAVIOUR_VALIDATION.md)) are the source of truth; the
> current developer guide is [`../plugin/README.md`](../plugin/README.md). Known drift
> in the text below: "NOT yet built" / "NEXT STEP: build" are obsolete; the data-mimic
> moved to its own repo **[7S-generator](https://github.com/larsnor/7S-generator)** (so
> `generate_reports*.py` / `feed_reports.py` / `gen_images.py` are historical);
> `RECON_INDICATORS` is now `THREAT_INDICATORS`; the Bin-2 config lives in
> `obsidian-config/`; the scorer is `plugin/test/scoring.ts`; the "7s-dialog" logged
> note was removed; commands are `ODEN:`-prefixed.

## What this is
A system for analysing Swedish Home Guard (Hemvärnet) 7S-format field reports,
landing in an Obsidian vault, for pattern detection / entity re-identification.
Scenario: peacetime guarding of Hemvärnets stridsskola (HvSS) Vällinge
(~59.2622, 17.7120), watching for irregular/recon activity. 7-day synthetic
dataset, ~300 reports.

## The THREE BINS (architectural boundary — keep strict)
- **Bin 1 — central application** (Signal → tidied 7S Markdown). We only MIMIC
  its output for test data; we do NOT build it. Links ONLY deterministic IDs
  (plates, personnummer) — never descriptive marks. We provide it a FORMAT_SPEC.
- **Bin 2 — Obsidian config** (no code): graph colour groups, Map View,
  properties-hidden, default-new-note folder, operator hand-creates entities.
- **Bin 3 — the plugin** (TypeScript, built): all ANALYSIS — entity
  re-id, clustering, suspicion scoring, conversational text interface. Derives
  knowledge the messages don't contain.

Boundary test: "format/regex-link" = Bin 1; "a setting/colour/view" = Bin 2;
"derive/resolve/score" = Bin 3.

## Current state (DONE)
- Data mimic (Bin 1 stand-in): `generate_reports.py`, `gen_images.py`,
  `feed_reports.py`. 300 reports in `reports/`, 6 corroborating plate images in
  `attachments/`, `ground_truth.json` scoring key.
- Format contract for the other developer: `FORMAT_SPEC.md` +
  `7S_frontmatter.schema.json` (all 300 reports validate).
- Plugin design: `PLUGIN_DESIGN.md` (thorough — read this first for Bin 3).
- Bin 3 prototype (re-id logic sketch, Python): `bin3_prototype/` — reference
  only, to be ported to TS, hardcoding removed.

## Step 0 just completed (data now matches the design)
- Marks are PLAIN PROSE (only plates linked as `[[...]]`).
- Recurring recon-cell "tells" are VARIED IN PHRASING across sightings (same
  backpack/logo described differently) -> exact-string match fails by design;
  plugin must normalise/match semantically.
- `källa: bin1-intag` provenance on every report.
- Corroborating placeholder plate images (plate also in text; tests OCR-
  corroboration, detection never depends on vision). Real photos slot in later.
- `ground_truth.json` carries hidden `tells` ids, true `plate`,
  `image_corroborates_plate` for scoring.

## Key design decisions (in PLUGIN_DESIGN.md)
- Plugin has NO custom views. Uses Obsidian's existing graph + Map View (Bin 2).
  Plugin is a TEXT interface: conversational query box (Markdown out, PDF via
  Obsidian's built-in export) + alerts that POINT to where to click — never
  drives the views itself.
- THREE matching jobs: A (IDs) auto-merge on certainty; B (in-vocab marks) and
  C (open-vocab/rephrasing) only NOMINATE for human confirmation. False merge =
  phantom pattern = dangerous, so soft re-id never auto-merges.
- TRANSITIVE cross-type identity: vehicle+person+backpack across non-co-occurring
  messages -> plugin derives the actor, shows the evidence chain, operator
  confirms, plugin writes an actor-node the graph then displays.
  "The graph shows; the plugin reasons."
- WHEN reasoning runs: event-driven (new data / changed params), NOT cyclic.
  Deterministic = recompute on change (idempotent). LLM = once-per-artifact,
  cached. Re-running LLM hoping for a new answer = FORBIDDEN (fishing).
- Operator hunch ("aren't these three the same?"): answer A (deterministic
  evidence + threshold gap) + B (human may assert it, strongest provenance).
  NEVER feed to LLM as "don't you agree?" (primed fishing).
- LLM is OPTIONAL, nominate-only, degraded-but-correct without it. TWO models:
  one multimodal generative (conversation + vision/OCR + open-vocab extraction)
  + one small EMBEDDING model (fuzzy similarity — deterministic, reproducible,
  audit-friendly). Local Ollama, no internet.
- OCR plates: privileged nomination, never auto-write. Show cropped region for
  one-glance confirm; corroboration against human-typed plate speeds it;
  partials when unsure.
- Provenance: `källa` = who wrote file (bin1-intag/operatör/7s-plugin);
  `föreslagen-av`/`bekräftad-av` = whose judgement (deterministisk/llm/operatör).
- Write contract: plugin never touches message files; owns only
  `generator: 7s-plugin` files; enriches operator notes additively in a fenced
  block; idempotent.
- REVIEWABILITY is a governing constraint: pitch is "Obsidian + Map View + one
  small transparent plugin." Minimal Obsidian API surface, no view libs, no PDF
  engine, deterministic core = plain TS testable outside Obsidian.

## Proposed build order (PLUGIN_DESIGN.md §12)
0. [DONE] data change (prose marks, varied tells)
1. [DONE] Plugin skeleton in `7s-plugin/`: scaffold, settings, vault read, 7S
   parse, trivial end-to-end command + text panel. Proves bin boundary + minimal
   API surface. (esbuild/TS; pure core in src/parse.ts; tests via node --test.)
2. [DONE] Deterministic re-id core (Job A): src/reid.ts (de-hardcoded — partials
   resolve only to OBSERVED fulls, no CANONICAL_FULL seed; unique=auto-merge,
   ambiguous=candidate, unresolved=own entity). Writes provenance-marked entity
   notes obeying write-contract §5 (owns only generator:7s-plugin, idempotent,
   prunes stale owned). Measured vs ground_truth.json (src/scoring.ts): 5 tracked
   plates recovered, all partials resolved, 0 false merges. Also clusters 4
   recurring commuter plates (down-ranking them = Step 6, not Job A).
3. [DONE] Extraction + Job B (deterministic floor): src/vocab.ts (declarative
   synonym/exclusion tables), src/marks.ts (clause-segment → classify →
   ATTACH-TRAILING-DETAIL → normalise to a canonical attribute-set + signature),
   src/jobb.ts (nominate by signature equality; NEVER auto-merge, §6.1). Identity
   dims per category make the ~5 varied phrasings of each tell collapse to ONE
   signature; non-distinctive marks (bare noise backpack) never nominated.
   Operator confirm→write materialises a `slag: kannetecken` mark note
   (`bekräftad-av: operatör`, `metod: jobb-b`); decisions persisted; writeOwnedNotes
   now prunes PER-JOB (metod) so Job A never deletes confirmed Job B notes.
   Measured vs ground_truth.json `tells` (src/scoring.ts scoreJobB): extraction
   recall 36/36, 0 false marks, 1 signature/category, 0 noise in nominations,
   pair precision/recall 1. 3 nominations (cap 19 / bag 10 / logo 7).
4. [DONE] Text interface (deterministic, no-LLM mode — LLM translate=Step 7):
   src/query.ts (pure) — parseQuery (keyword→StructuredQuery, Swedish-aware word
   matching) + executeQuery over a KB (reports + Job A vehicles + CONFIRMED Job B
   marks). Intents: entity lookup, recurring, observations (time/place/kind), free
   search. Guardrails: query-echo (interpreted query shown), deterministic answers,
   grounding (KB only), [[TNR]] citations, logged dialogue (7s-dialog.md, typ:
   dialog, metod: dialog), write-wall (retrieval only; identity "är X=Y?" routed to
   §9.3, never asserted). KB = current vault snapshot → reflects gradual buildup.
   Panel frågebox + example chips. 7 query tests; 32 total.
4b. [DONE] §6.4 transitive cross-type actor derivation: src/actor.ts (pure) —
   association graph (edge = co-occurrence in a message, weight = #supporting
   messages) over facets = Job A vehicles + Job B mark clusters; union-find
   components over edges ≥ threshold; a component spanning ≥2 entity TYPES =
   actor hypothesis with the M1→M5→M9 evidence chain. NOMINATE only (§6.1);
   confirm→materialize actor node (src/actor_notes.ts, slag: aktör, bekräftad-av:
   operatör, metod: aktor). Threshold is an operator parameter (§9.3-A) adjustable
   in-panel. On the corpus: ONE actor = 4 vehicles + bag/cap/logo over 21 msgs,
   0 noise. SDG417 (POI but no shared mark) correctly NOT merged — actor is
   evidence-bound, not POI-label-bound (good anti-phantom signal). 5 actor tests;
   38 total. NOTE: with shared marks the cell's vehicles fuse into one actor —
   raise threshold to split; this is the §9.3-A story, surfaced honestly.
5. [DONE] Alerts-with-pointer + vault watcher (§7.2/§9.1) — src/alerts.ts (pure):
   computeAlertItems(bundle) → alerts (förhöjd/aktör/märke/fordon), each a TEXT
   POINTER to where to click (report + Map View location; graph node after
   build/confirm) — NEVER opens/drives views. main.ts: debounced vault watcher
   (1.5s) → full recompute (handles retroactive transitive completion §9.1) →
   newAlerts() vs persisted seenAlerts → Notice + panel. baselineAlerts() on
   layout-ready seeds seen silently (no flood from existing corpus). Command
   "7S: Visa larm" + 🔔 button show current items; watcherEnabled toggle setting.
   Ignores entities-folder writes (no self-trigger). 57 tests.
   - Watcher now AUTO-BUILDS Job A vehicle entities on recompute + baseline
     (autoBuildEntities setting, default on; CERTAIN matches, §5.5). Job B/actors
     stay confirmation-gated (never auto-written, §6.1). Fixes "graph stays empty
     as vault grows". Recon team still has NO entities → graph-invisible by design
     (text suspicion/alerts is their surface).
   - 7S panel now opens as a MOVABLE main-area tab (getLeaf("tab")), not a sidebar
     dock — so it can be split alongside/above graph + Map View (getPanelLeaf()).
   - Graph blank cause noted: new format has no [[links]] → all reports are
     ORPHANS → enable "Orphans" in Graph View to see them; edges appear only once
     entity/mark/actor notes are written.
6. [DONE] Transparent suspicion score (§6.5/§6.6) — src/suspicion.ts (pure, NO
   LLM). Scores PER REPORT (not only per entity — the recon team has no entities):
   proximity to objektet (haversine, works off MGRS-derived coords), time-of-
   day (night), recon-behaviour indicators in Händelse (RECON_INDICATORS = the
   tunable surface, isolated like vocab.ts). Weighted EXPLAINABLE sum, every row
   shows reasons[]. Rollup by location/day + near-object/night counts. Per-entity
   suspicion (recurrence+night) also provided. Command "7S: Misstankeanalys" +
   panel button; protectedLat/Lon setting (default HvSS Vällinge 59.2622,17.7120).
   MEASURED on reports_new (the pure-pattern team the re-id layers scored 0% on):
   recall 1.00, precision 0.93, recon mean 7.88 vs civilian 2.38. The 2 FPs are
   civilians next to the säteri at 23:00 (defensible). 54 tests. → This is the
   architectural piece that catches a pure-pattern team; behaviour-keyword recall
   is the LLM-upgradeable ceiling.
7. LLM adapters (Ollama): generative + embedding, Job C nominations, optional.

## NEW BIN 1 FORMAT — adaptation (DONE M1–M4; 2026-06-26)
Other dev shared 2 real example messages (test/fixtures/TNR260838,TNR260916):
`Händelse` (free prose) REPLACES Slag/Styrka/Sysselsättning; `Symbol` now optional;
new `Sedan` field + `signal_*`/UUID frontmatter; `Stund`=DDHHMM; MGRS grids in
Ställe/plats; lat/lon sometimes absent; NO `[[wikilinks]]`; UTF-8 mojibake.
Operator decisions: domain STAYS road/Vällinge (examples are format illustrations,
vocab.ts still valid); ID-linking behavior UNCONFIRMED → built defensively.
- M1 parse.ts: Händelse/Sedan/Ställe/signal_* fields; mojibake repair
  (repairMojibake); backward-compatible (old corpus parses identically).
- M2 src/ids.ts (NEW): typed deterministic identifier extractor — plate +
  personnummer (actor) / MGRS (location) / signal sender (source), from links AND
  prose, deduped. Decouples analysis from Bin-1 pre-linking (§6.0).
- M3 reid.ts: buildPlateEntities consumes ids.ts (links+prose) → Job A works with
  NO links; old-corpus scores unchanged (regression test). Prose plates also
  caught (extra noise singletons, documented).
- M4 marks.ts: extraction reads Händelse⊕Symbol (old corpus falls back to Symbol).
- 48 tests green. Honest finding (tested): free-prose/out-of-domain Händelse yields
  0 deterministic marks — the empirical case for the LLM (open-vocab).
- DEV CONFIRMED (2026-06-26): Symbol is KEPT for clear marks (may repeat Händelse —
  harmless, dedup by file at nomination); Sedan present-possibly-empty, ignore for
  now; coords will be MGRS *sometimes* → lat/lon conversion needed (DONE, below);
  signal_avsandare_id present when received via Signal (the default channel).
- MGRS→lat/lon DONE: src/mgrs.ts (pure, zero-dep, proj4 algorithm ported), verified
  vs python `mgrs` oracle across Swedish zones 33/34 U/V/W to ~2m (test/mgrs.test.ts,
  37 pts). parse.ts derives lat/lon from an MGRS grid in Ställe/plats when
  frontmatter coords absent; sets `coordsFromMgrs`. 51 tests green.
- STILL TO CONFIRM WITH BIN-1 DEV: will Bin 1 ever wrap IDs in [[ ]] (we handle both)?
  id/tnr stable across re-sends?
- DEFERRED: regenerate road corpus in NEW format (Händelse-based) for realistic
  testing; personnummer ENTITY building (extracted by ids.ts, not yet entity'd — no
  data/GT yet); LLM for Händelse open-vocab + narration.

## NEW-FORMAT CORPUS + OVER-FITTING FINDING (2026-06-26)
generate_reports_newformat.py → reports_new/ (600 msgs, 14 days) +
ground_truth_new.json. NEW format (Händelse prose, signal_*, MGRS, no links).
Scenario: ~575 civilian (benign, high volume) + 25 recon sightings = 7 DISTINCT
individuals (R1-R7, each 2-4x), NO shared hard ID (operator choice) — the cell is
a PURE PATTERN (near protected object, odd hours), distinct marks per person.
sagesman = sector PLATOON callsign (AQ Nord/BQ Öst/CQ Syd/DQ Väst/EQ Vatten),
each platoon = its own Signal account (signal_avsandare_id); ~10% non-Signal
(signal_* omitted). Counts shift slightly with seed 2026 across edits.
Ran the UNCHANGED pipeline over it — STARK honest finding:
- Job A: 0/20 recon have an ID (29 civilian plate singletons, 0 recurring).
- Job B: **0 distinctive marks across all 600** — realistic free-prose marks have
  object+colour but no "marking" word (märke/emblem/tryck), which SIGNATURE_DIMS
  REQUIRES. Job B is over-fit to the old "object-WITH-marking tell". 0/7 members.
- Actors: 0. → current re-id-centric plugin detects ~0% of the recon team.
- BUT pattern is glaring: recon 100% near-object vs 46% civ; 35% odd-hours vs 1%.
→ Empirically justifies: (a) transparent SUSPICION/clustering layer (Step 6,
deterministic, would catch this team) and (b) LLM open-vocab extraction for the
recon marks/behaviour the deterministic floor misses. See [[seven-s-plugin-build-status]].

## RENAME → ODEN + Bin 2 config (2026-06-29)
- Plugin renamed to **ODEN** (manifest name + view title + ribbon + command
  prefixes "ODEN:"). Plugin id/folder KEPT as `7s-analys` (so data.json survives).
  Custom raven-in-compass icon registered via addIcon("oden", svg) — replaces the
  fingerprint on ribbon + view tab. Re-index button removed from panel toolbar +
  header (watcher auto-indexes); summary still available as a command. v0.1.0.
- Bin 2 config written to the live vault `.obsidian/` (with Obsidian CLOSED):
  appearance.json → dark (theme: obsidian); graph.json → color groups (file:/path:
  queries: aktor- red, marke- violet, path:entities blue, TNR grey) + showOrphans
  false; workspace.json → Map+Graph side-by-side on top, ODEN panel below, both
  sidebars collapsed. Repo template at bin2-config/ (graph.json + README) for the
  future operator template-vault zip.
- Portable setup = the vault folder (.obsidian/ incl. plugins) zipped; install
  Obsidian separately + "Open folder as vault". App-binary bundling is an ops/
  rugged-box packaging step, not in-repo.

## OPERATOR UI REDESIGN (Phase A DONE 2026-06-30; Phase B = LLM, pending)
Panel rebuilt as persistent **feed (top) + chat (bottom)**, stacked. New pure
modules: src/feed.ts (buildFeed — event/alarm feed DERIVED from vault files:
reports="mottaget", entity notes="Fordon identifierat", larm notes="⚠ Misstänkt
aktivitet"; sorted by observation time; no separate log), src/present.ts
(suspicionLevel bands Hög/Förhöjd/Att bevaka + reasonPhrase — strips weights/
§/Job/Bin jargon), src/conversation.ts (Conversation seam; DeterministicConversation
= parseQuery + raw answer). main.ts view fully restructured: header (engine toggle
+ ⋯ menu), live feed (click→open note), always-on chat (routes via converse →
executeQuery → addChat; logs dialogue). Review flows (mark/actor confirm) moved to
⋯ menu, rendered into the feed region with ← back, RELABELED (no Job/§/score/+weights).
Engine toggle (settings.engine) present; LLM degrades to deterministic w/ notice.
64 tests. Removed the old mode-switched screens (render/renderQuery/buildToolbar/
revealTextView/revealAlerts). NOTE: big view rewrite — verify in Obsidian (reload).
- Phase B (next): src/llm.ts Ollama adapter — OllamaConversation (toQuery/narrate,
  §7.1 grounding), LlmMarkExtractor (open-vocab → Job B nominations, föreslagen-av:
  llm), EmbeddingSimilarity. Settings engine/ollamaUrl/genModel/embedModel. Fake
  adapter for tests (no live Ollama in CI). Degrades to deterministic if unreachable.

## PREDEFINED PLACES (2026-07-06)
Operator can create locations BEFORE reports exist ("Platser i förväg…" in the
⋯ menu / command / offered right after operation setup): name + position
(lat,lon or MGRS) + vicinity radius (default 100 m) + optional **skyddsvärd**
(sensitive) flag. Stored in settings `predefinedLocations` (wiped with the AOI
like all judgements). Each place materializes immediately as a 📍 `metod: plats`
note (frontmatter `fördefinierad: true`, `radie_m`, `känslig`; sensitive tag
`skyddsvärd`) — written even when the alert layer is off. A coord-bearing report
within the radius links to the NEAREST covering place IN ADDITION to its reported
`plats` (dual relation; actor chains render "(nära [[plats]])" via NearLinker;
plate recurrence at the place emerges from the attachment). Sensitive places are
extra suspicion proximity anchors with bands SCALED by the radius (<R→3, <2R→2,
<4R→1), taken as MAX with objektet (never summed — proximity alone still can't
cross the threshold); reason/alert title names the place ("nära Förrådet").
Pure logic in location_notes/suspicion/derive; 11 new tests (142 total).
MAP (follow-up 2026-07-08): predefined notes are tagged `fördefinierad`
(+ `skyddsvärd` when sensitive) → included in MAP_QUERY (main.ts, mirrored in
obsidian-config/map-view-data.json defaultState.query) with display rules:
green fa-map-pin needle for #fördefinierad, violet fa-shield-halved for
#skyddsvärd. Derived #plats hubs stay off the map. Adding a place refocuses the
map so the needle shows at once. NOTE: the LIVE vault's map-view data.json only
updates with Obsidian CLOSED (template in obsidian-config/; live vault patched
2026-07-08, centre preserved). GRAPH: predefined places link [[Objektet]]
(OBJEKTET_STEM in notes_common) so they + the AOI node show from day 0 despite
showOrphans:false; derived hubs deliberately do NOT get that edge.

## MAP VIEW AS INPUT CHANNEL (2026-07-08)
Decisions (operator): KEEP Map View (its offline tile caching, clustering — an
own in-plugin map rejected per §7.3 minimal surface); predefined-place ownership
does NOT flip to notes (settings stay the single source of truth). Instead the
un-hideable Map View map tools now converge into ODEN's validated flows:
- "New note here (front matter)" → a bare `location:` note; the watcher's create
  hook (layoutReady-gated — startup indexing never prompts) runs `parseMapSeed`
  (parse.ts: location present, no typ, no generator) → MapSeedModal offers
  "Skapa plats i förväg här…" (places screen prefilled via initCoord param)
  or "Namnge platsen <grid> (~N m)…" (nearestNamelessGrid in derive.ts,
  ≤500 m, unnamed MGRS clusters only → promptLocationName). Picking an action
  trashes the seed via fileManager.trashFile (operator-commanded, NOT the owned-
  note prune); "Ignorera" records settings.mapSeedHandled[path] and keeps it.
- "Copy geolocation" (both variants): parseCoord (mgrs.ts) now also accepts
  `[namn](geo:lat,lng)` and `location: "lat,lng"` blocks → paste works in every
  coordinate field (setup, platser i förväg). Hint line added in the dialog.
146 tests (parseCoord clipboard formats, parseMapSeed incl. array/property-editor
forms, nearestNamelessGrid). NOTE: parse.ts's minimal YAML splits `["lat,lng"]`
on the embedded comma — parseMapSeed strips quotes in the array branch.
FOLLOW-UP (2026-07-10): the places manager is a PANEL SCREEN (view.showPlaces,
reviewHead pattern), NOT a modal — an Obsidian modal blocks the whole workspace,
so the operator couldn't right-click the map to copy a position while entering
places. add/removePredefinedPlace no longer call refreshPanel (would yank the
operator back to the feed); ← Tillbaka refreshes instead.
FOLLOW-UP (2026-07-13): hint steers to "Copy geolocation as front matter"
(copies instantly; the plain variant first asks for a marker name and only
writes the clipboard on OK). MAP: derived #plats hubs now INCLUDED on the map
(operator: a reported place like "Uppställningsplatsen" showed in graph but not
map) — MAP_QUERY + template query gained tag:#plats, display rule orange-dark
fa-location-dot placed BEFORE fördefinierad/skyddsvärd (Map View applies rules
in order, later override → predefined keep needle/shield). GOTCHA found live:
an OPEN map pane persists its own query in workspace.json and IGNORES
data.json defaultState — patching data.json changed nothing for the operator's
restored pane. Fix: ⋯ menu + command "Visa ODEN-lagren på kartan"
(focusMapOnOden → focusMapOn(AOI, MAP_QUERY)) re-asserts the query on the live
pane; also the one-click reset when manual filtering drifts.

## VISION (Steg 1 byggt 2026-07-14) — photo-borne observations via local Ollama
Model bake-off DONE (docs/VISION_VALIDATION.md): DEFAULT qwen3-vl:4b (matches 8b
accuracy — 95/85% plate, 0 WRONG — but ~2x faster + no swap timeouts on 16 GB);
8b/32b reserved for higher-RAM machines. New pure modules: src/photo_analysis.ts
(PhotoSighting, reviewed prompt, parse/validate, RECON-only behaviour map
[optik/observation/registrering — severe behaviours are act-not-photograph],
sighting→per-item nominations; 10 CI tests, FakeVision) + src/llm.ts (Ollama client,
health, VISION_MODELS). main.ts: settings visionEnabled/ollamaUrl/visionModel +
photoAnalyses run-once cache (hash+model+promptV, §9.2 no-fishing) + photoPlates/
Annotations confirmations; computePhotoSightings; confirmed photo-plate INJECTED
into Job A via ids.ts source "photo" + Report.photoPlates. UI: panel MODE STRIP
(📷 Bild live-toggle + 📝/💬 future chips + connection dot; deterministic core
always on) NOT a settings toggle; per-item photo-review over the image (plate→Job A,
vehicle/person→annotation, operator may promote a person to actor); "Analysera
bilder nu" command; at-enable consequences warning; settings dropdown + Testa
anslutning. Provenance föreslagen-av: llm-vision. Menu trimmed (Granska koppling/
aktör + Uppdatera lägesbild — feed rows + watcher cover them). Text-reasoning
(role 2) is a SEPARATE later phase on the SAME model + same nomination frame.
Locked-design record: /Users/larsno/.claude/plans/ok-so-we-can-zany-moth.md.

## TEXT-REASONING + CHAT (roles 2 & 3, built 2026-07-15)
The two remaining LLM roles, on the SAME model (qwen3-vl is a full LM) and the SAME
nomination frame as vision. All three capabilities are independent panel chips
(📷 Bild · 📝 Text · 💬 Chat), each degrading to deterministic; deterministic core
always on.
- **Chat (💬, OllamaConversation in conversation.ts):** LLM only REFINES the
  deterministic parseQuery (intent/kind/term/place) and NARRATES the deterministic
  answer (§7.1 — findings never originate in the model). `converse(conversationEngine())`.
  Safe → no validation needed, no warning on enable.
- **Text-reasoning (📝, src/text_reasoning.ts + OllamaText):** open-vocab extractor
  lifting the FROZEN keyword lists' measured recall ceiling (~6–9% marks, ~24–62%
  behaviour). Per report Händelse⊕Symbol → {kännetecken[], beteenden[{begrepp,fras}]},
  run-once cached (content-hash+model+prompt, settings.textExtractions). Behaviours
  classified into the SAME concept space (suspicion.threatConcepts) — FULL spectrum
  (text can carry sabotage, unlike photo's recon-only) — confirmed → confirmedBehaviours
  → score. Marks re-identified across reports by NORMALISED KEY (exact-key floor;
  embeddings/fuzzy = later), clustered ≥2 → nomination → confirm → 🎒 kännetecken hub
  note (metod text-marke, föreslagen-av: llm). Per-item review (📝 Textfynd), command
  "Tolka text nu", at-enable warning (recall UNMEASURED → safe because gated; a
  harness pass over the behaviour OOD corpora quantifies the lift before trust).
- confirmedBehaviours (was photoBehaviours) is now source-agnostic (photo recon +
  text) → suspicion, deduped vs keyword hits. 164 tests (photo_analysis 10,
  text_reasoning 6, ids photo-plate, suspicion confirmedBehaviours). Menu unchanged.

## EXPLICIT DOMAIN MODEL + FARKOST (v0.7.0, 2026-07-19)
src/domain.ts NAMES the observed-thing taxonomy in one place (person/craft/mark/
place/larm — the query targets AND the graph node classes) and OWNS the new
craft/farkost dimension: CRAFT_TAXONOMY (bil/lastbil/…/båt/fartyg/…/drönare/
helikopter/flygplan) with medium (mark/vatten/luft), plated (re-id via Job A),
`threat` weight (drone 3, helicopter 2, boat/fartyg/flygplan 1 — STACKS with
proximity/time in suspicion), queryCue, and precision-gated keywords + compound-
safe stems (one matcher for prose, vision-typ mapping and query steering).
FROZEN re-identifiability boundary: craft TYPE is always a scored observation;
re-id needs a plate (ground), name/reg (water, future) or a distinctive mark —
the machine NEVER merges two generic craft. src/craft.ts extracts one observation
per type per report (sole-full-plate = the re-id bridge → "lastbil RJK241");
query.ts widened to target×shape (farkost target, e.g. "visa drönarobservationer",
"återkommande traktorer"). 184 tests. Tagged v0.7.0.

## CRASH + RESTORE (2026-07-24, new machine)
Laptop crash. Verified NOTHING lost: repo re-cloned at v0.7.0 == origin/main ==
last reflog entry of the old disk's partially-recovered .git; obsidian-config
files byte-identical (the "recovered" OneDrive copies were rate-limited download
stubs, not corruption). New machine user is `larsnordstrom` (was `larsno`) —
old Claude sessions/plans did NOT carry over; this doc + the code are the memory.
Toolchain reinstalled: Homebrew node 26, Python via pyenv, Ollama with
qwen3-vl:4b + :8b already pulled. 7S-generator (separate repo) at v0.3.0,
editable-installed (`pip install -e ".[images]"` → `7s-generator` on PATH).
Live test vault is now **~/ObsidianVaults/ODEN-test** (outside ~/Documents —
OneDrive sync fought the old location) with corpora from 7s-generator
(~/corpus_hvss_vallinge text-only; ~/corpus_hvss_images 371 reports/106 images,
AOI HvSS Vällinge 59.26239628419817,17.712273532270785, seed 2026).

## OPERATOR-SURFACE SIMPLIFICATION (v0.8.0, 2026-07-25)
Verified-redundant analysis: everything the manual analysis commands did also
runs on every debounced watcher recompute (Job A auto-build, suspicion + larm
notes, mark/actor nominations + their clickable feed rows) — so the palette went
**17 → 7 commands**: setup, ny observation, namngivna platser, visa kartlagren,
analysera bilder, tolka text, + ONE escape hatch **"Uppdatera lägesbild"**
(full recompute; for watcher-off / immediate refresh). ⋯ menu → 5 operator items
+ **"Avancerat…"** second-level Menu (public API only, no setSubmenu) holding
refresh/merges/undo/nollställ. NEW: `clearAllJudgements` (new operation area)
also empties the panel chat (`clearChat()` — chat is DOM-only, but answers
grounded in the previous operation must not linger); 🌙/☀︎ header button toggles
Obsidian dark/light (feature-detected vault.setConfig + css-change trigger).
Bin 2 lockdown shipped as templates + applied live: NEW obsidian-config/
core-plugins.json (operator-minimal: canvas/daily-notes/templates/bookmarks/
tag-pane/bases/sync/outgoing-link etc. OFF), ribbon → 3 icons (ODEN/Map/Graph),
Map View controls minimized + saveHistory off; app.json propertiesInDocument
hidden; workspace.json template = pinned map/graph/ODEN tabs (session state
stripped). Tagged v0.8.0.

## NAMNGIVNA PLATSER + PHOTO AUTO + LARM-FLAGG (v0.9.0, 2026-07-25)
- **"Platser i förväg" → "Namngivna platser"** everywhere; the panel screen now
  lists BOTH kinds: operator-created places (radie + skyddsvärd) AND named report
  grids (`📍 namn — grid`, "Ta bort namn" via removeLocationNickname, keeps
  locationNameAsked). Named-by-operator report places deliberately get NO
  skyddsvärd/radius (capability stays with the operator-created kind); storage/
  tags/map icons unchanged — the unification is the operator-facing concept.
- **📷 auto-vision on arrival**: the watcher now auto-runs the VLM on newly
  arrived image reports (NOT in baseline — startup silent). Transient feed rows
  "📷 Bild mottagen, analys startad — TNR…" (synthetic `bildanalys:` path so a
  report's larm row never dedups away; in-memory analyzingPhotos set threaded
  into buildFeedItems like lastCorroboration) → pinned "📷 N bildfynd att
  granska →" (review:"photos"). 60s health backoff; run-once cache unchanged;
  session attachment-hash memo so feed refreshes never re-read image bytes.
- **Operator larm-flag**: file-menu (right-click a TNR note, explorer + tab)
  "ODEN: Flagga som larm"/"Ta bort larmflagga" → settings.operatorFlagged rides
  the confirmedBehaviours channel via OPERATOR_FLAG_SIGNAL (suspicion.ts, weight
  9 = Hög, reason "flaggad av operatör"); wiped by new operation area. Tagged v0.9.0.

## OPERATOR-FEEDBACK FIXES (v0.9.1, 2026-07-26)
All from live operator testing:
- **Graph visibility**: mark notes (Job B + 🎒 text-marks) and place-less person
  suspects were ORPHANS under `-file:TNR` + showOrphans:false (they linked only
  TNR messages) → never showed. Now a direct **[[Objektet]]** edge (marks always;
  suspects only as fallback when no plats/fordon edge resolved).
- **Review UX everywhere** (actors/marks/photo/text): pending first, decided
  after (reversed); deciding the LAST pending item auto-returns to the feed
  (revealActorsOrFeed / revealMarksOrFeed / showPhotoReviewOrFeed /
  showTextReviewOrFeed).
- **Photo review bug**: accepted vehicle/person findings were never counted as
  decided (only plates/rejections) → the row re-rendered untouched. Decisions now
  tracked for all kinds (photoNominationStatus); decided rows stay greyed with
  ✓/✗ + "↺ Ångra beslut" (undoPhotoNomination withdraws plate/annotation + recon
  signals).
- **Chat citations clickable**: MarkdownRenderer builds [[TNR]] anchors but a
  custom view must route internal-link clicks itself (delegated handler on
  chatLogEl → openLinkText).
- **📝 mirrors 📷**: watcher auto-runs text extraction on new reports with
  "📝 Meddelande mottaget, analyseras — TNR…" rows (one row per report when both
  photo+text in flight) → "📝 N textfynd att granska →" (review:"texts").
- **Textfynd evidence**: clusterTextMarks kept only files + first-seen label →
  review rows were unactionable ("röd — 3 rapporter", no references). Nominations
  now carry members[] (tnr/tidpunkt/plats + THAT report's phrasing) and the most
  descriptive variant as title; review renders evidence cards with clickable
  TNRs; the confirmed 🎒 note lists the same observations.
- Map View live vault got showNotePreview:false (marker popups showed
  frontmatter). 190 tests. Tagged v0.9.1.

## OPEN / DEFERRED
- FORMAT_SPEC + schema additions for `källa` and image attachments: AGREED but
  not yet written into the spec — DEFERRED pending the other developer's
  possibly-updated format spec (may change our end anyway).
- Operator template-vault zip (preconfigured `.obsidian/`): deferred until the
  plugin exists (layout must include plugin panel).
- INCREMENTAL/TEMPORAL dynamics (operator-flagged, to REVIEW after Step 4):
  tests run against the COMPLETE vault, but realistically the vault accretes —
  reports arrive gradually, mark nominations are approved over time, and NEW data
  can both complete links (retroactive §6.4) AND invalidate established ones.
  Needs: (a) operator-ASSERTED links the machine never nominated (§9.3-B), (b)
  operator DE-LINK / revoke of previously-confirmed connections, (c) incremental
  recompute that re-evaluates the whole affected component (§9.1). Job B already
  has confirm/reject/undo; the assert-new + revoke-on-drift pieces are Step 5 +
  §9.3. The whole solution to be reviewed once testable end-to-end on a vault
  built up gradually (via feed_reports.py at varying cadence). DEFERRED.
- Operator-note frontmatter completeness: operator-created notes (Bin 2) arrive
  WITHOUT the required 7S frontmatter. Plugin must not silently ingest
  half-finished notes — it should prompt the operator for the missing fields
  (or flag the note as incomplete) rather than dropping malformed notes into the
  corpus. Touches the Bin 2 operator template AND a plugin-side validation nudge.
  DEFERRED (noticed during Step-1 testing).
- Minor: in-water coordinate jitter artifact (cosmetic, undecided); drop-in
  graph.json with colour groups (offered, not built).
- INSTRUCTIONAL SCREENCASTS (planned, not built): 4 × 30–45s silent walkthroughs
  (setup+platser · navigate UI · deterministic-vs-AI+verification · operator
  reactions) as interactive HTML players (screenshots + animated cursor + timed
  captions) rendered to MP4 via Playwright+ffmpeg, for the README. Plan agreed
  2026-07-24; storyboards must target the post-v0.9.1 UI. Operator captures the
  screenshots (shot-list to be provided); everything else reproducible.
- TEXT-MARK DISTINCTIVENESS FLOOR (offered, not built): bare single-attribute
  text-marks ("röd") can nominate — a deterministic stoplist mirroring vocab.ts's
  "bare noise is never nominated" rule would suppress them; today the operator
  handles it via Avvisa (persisted).

## NEXT STEP
The plugin is BUILT and shipped (v0.9.1). Next agreed piece of work: the
instructional screencasts (see OPEN / DEFERRED). After that, candidates:
regenerate/extend corpora for measured runs, the incremental/temporal dynamics
review, and the text-mark distinctiveness floor.

## Environment notes (post-restore, 2026-07-24 →)
- Apple Silicon Mac (user `larsnordstrom` — the pre-crash machine was `larsno`;
  paths in older sections above reflect that machine).
- Node 26 via Homebrew (`/opt/homebrew/bin`), Python 3.14 via pyenv,
  Ollama local with qwen3-vl:4b (default) + :8b.
- Live test vault: **/Users/larsnordstrom/ObsidianVaults/ODEN-test** (kept
  outside ~/Documents — OneDrive sync clobbered a vault there once). Obsidian +
  Map View installed; Bin 2 config applied (see v0.8.0 section). Plugin installed
  by copying plugin/main.js + manifest.json into
  `<vault>/.obsidian/plugins/7s-analys/` (safe while Obsidian runs; `.obsidian`
  CONFIG files only with Obsidian closed).
- Releases are tagged (v0.8.0/v0.9.0/v0.9.1); `npm run package` builds
  dist/ODEN-<version>.zip.

## How to generate + feed test data (7S-generator, replaces the old data mimic)
The Python data-mimic scripts are historical — corpus generation lives in the
separate repo [7S-generator](https://github.com/larsnor/7S-generator) (v0.3.0,
`pip install -e ".[images]"` from its clone → `7s-generator` CLI):
```
7s-generator generate --aoi 59.26239628419817,17.712273532270785 --area suburban \
  --from 2026-06-15 --days 14 --name "HvSS Vällinge" --seed 2026 \
  --images --photos --obsidian --out ~/corpus_hvss_images
7s-generator add-hostiles   --corpus ~/corpus_hvss_images --type recon --photos
7s-generator add-protesters --corpus ~/corpus_hvss_images --type demonstranter
7s-generator feed --corpus ~/corpus_hvss_images --dest ~/ObsidianVaults/ODEN-test/inkorg
# at the > prompt: reset | auto 15 | send N | pause | resume | status | quit
```
