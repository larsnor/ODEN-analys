# ODEN — TODO / deferred work

Features and improvements discussed and consciously deferred during the build.
Ordered roughly by value. Each item notes *what*, *why*, and any decisions already
made, so work can resume without re-deriving context.

## LLM / vision layer (the big cluster — "Phase B")

- [ ] **Local LLM layer (Ollama), behind the engine toggle.** The deterministic
  ⇄ LLM toggle already exists (`settings.engine`, `conversation.ts`). Add a local
  Ollama adapter for: (a) chat *translate/narrate* (`Conversation.toQuery` /
  `narrate` with §7.1 grounding), and (b) open-vocabulary *mark extraction* feeding
  Job B nominations. Must run fully local (no cloud API), degrade gracefully if
  Ollama is absent, and ship with a fake adapter for tests. This lifts the
  keyword-vocabulary ceiling the deterministic layer can't reach.

- [ ] **Broaden the vision adapter to general image analysis (§6.7).** Today
  `vision.ts` is a narrow `PlateVision` (plate-corroboration only). Widen to a
  `VisionAnalyzer` returning a structured result: **0+ plates, 0+ marks, a scene
  description** (an image may contain no plate, or several). Feed novel findings
  into the existing nominate→confirm review flow (privileged plate nominations;
  Job B marks). Keep the iron rule: vision **nominates, never asserts**.

- [ ] **Run-once-per-artifact cache for vision/LLM.** A real VLM/LLM is expensive
  and non-deterministic, so it must NOT re-run on every watcher tick (the current
  stub re-reads images each build — fine for a byte-scan, not for a model). Cache
  by (image/text hash + model/config), persisted as provenance, so results stay
  reproducible and auditable.

- [ ] **Option B — operator-gated message enrichment (DECIDED).** For a brief,
  image-only message, the VLM drafts the **Händelse + Symbol** text; the operator
  verifies; then the note is stored. Since we do NOT control the Bin 1 intake, this
  is a deliberate, explicit, operator-gated **exception to the write-contract (§5)**:
  the plugin writes message content only on operator accept, stamped
  `föreslagen-av: llm-vision` + a `verifierad` flag, never automatically. Needs a
  small vision-review lane in the panel (show the cropped region beside the draft).

## Operational / offline

- [ ] **Offline map-tile pre-download helper.** A `simulator/`-style tool that,
  given the AOI (lat/lon + radius + zoom range), downloads OSM tiles into a local
  Map View source (custom `mapSource` / `.mbtiles`), so an operation can run
  air-gapped. Map View already caches viewed tiles (`cacheAllTiles`, 2 GB); this is
  for *pre-provisioning* an area before going dark. Network is used only at prep
  time — nothing at operation time. (Map tiles are ODEN's only external dependency;
  the plugin itself makes zero network calls.)
  NB (2026-08): CARTO now requires an API key for its basemaps, so the one external
  dependency is also an *attributable* one — tile requests are tied to the operator's
  key and reveal which areas are being viewed. That strengthens the case for this
  item: a local tile source removes the key, the watermark and the disclosure at once.

- [ ] **Offline geocoding (name → coordinate) — separate from tiles.** Downloading
  tiles only makes the map *visible*; name search still hits OSM Nominatim (a live
  API). For air-gapped use: (1) prefer **MGRS / lat-lon** input — already offline via
  `mgrs.ts`, no lookup needed; (2) optionally build a small **AOI gazetteer** (local
  place name → coordinate, extracted from OSM data for the region). A full local
  Nominatim instance gives real offline geocoding but is heavy (OSM → PostgreSQL).

## Detection vocabulary (deterministic layer)

### GitHub issues #1–#4 — agreed roadmap (2026-08-27, work in this order)

- [ ] **#3 — infiltration recall 0.22 (vs 0.80–1.00 for other threat modes).** Add
  elicitation stems ("frågor om rutiner", "frågade om passertider", …) and
  false-authority phrases to `THREAT_INDICATORS.infiltration`. Two verified caveats:
  (a) NOT a bare `passerkort` stem — `recon_indicators.test.ts` asserts "Personal
  visade passerkort vid grinden." fires nothing; key on the fuller phrase ("kändes
  inte igen"). (b) Promoting infiltration weight 2→3 pulls its whole stem list under
  `behaviour_ood.test.ts`'s WEIGHT3 = {sabotage, attentat} safety assertion — requires
  re-running BOTH OOD corpora and updating that set, never just the constant. Update
  `docs/BEHAVIOUR_VALIDATION.md` numbers either way. Repro: the reporter's seed-21
  corpus recipe in the issue (7s-generator now installed locally).
- [ ] **#4 — craft threat weight lacks area context** (civil helicopter traffic near an
  airfield AOI → false-alarm swarm; measured precision 0.90 → 0.50–0.63). Preferred
  fix: require ≥1 behaviour hit before a craft weight ≥2 may carry a report over the
  elevation threshold — surgical, and drones keep self-elevating via the frozen
  `drönar` stem (beteende:optik); only helicopter/boat/aircraft stop elevating on
  type+proximity alone. Alternative (more work, closer to ODEN's grain): operator
  setting "förväntade farkosttyper vid objektet" zeroing the type weight per AOI,
  shown in the reason line. Do BEFORE #2's remainder (which raises recall on exactly
  these threat-bearing types).
- [ ] **#2 — morphological rework of the craft matcher** (the stopgap keywords shipped
  2026-08-27; this is the general fix). Head-suffix matching for compound-final heads
  (`-bil`, `-båt`, `-cykel`) with most-specific-head-wins (else lastbil→bil,
  motorcykel→cykel) + small stoplist (`mobil`); agent-noun suffixes (`-ist`, `-are`,
  `-ör`); bounded edit-distance 1 for tokens ≥6 chars (real typos — NOT slang like
  `kajja`, which stays the 📝 layer's job). Validate on a blind-authored, held-out
  corpus with a precision gate per the BEHAVIOUR_VALIDATION protocol;
  `test/fixtures/craft_phrases.ts` CRAFT_BENIGN is the guard rail.
- [ ] **#1 — close as duplicate of #2** once #2 closes (no code).

- [x] **`vocab.ts` mark categories for recon gear** — DONE (bounded, frozen): added
  `optik` (distinctive only on a specific sub-type — teleobjektiv/nattkikare/… — so
  plain binoculars are birdwatcher-safe), `verktyg` (breaching tools), `teknik`
  (signals gear), with fine per-item signatures. `skyddsväst`/hi-vis was deliberately
  NOT added (too close to benign workers). OOD-measured in `docs/RE-ID_VALIDATION.md`.

- [ ] **Enrich the generator's recon templates.** 7S-generator work — its corpora
  still lean on the original phrasings. NB: the plugin-side behaviour vocabulary
  (`THREAT_INDICATORS`, renamed from RECON_INDICATORS) has now been OOD-validated and
  tense-expanded independently — see `docs/BEHAVIOUR_VALIDATION.md`; this item is only
  about broadening the *generator's* prose.

## Testing / repo hygiene

- [ ] **Permanent Tierp regression test.** Currently Tierp detection is validated
  ad-hoc (regenerable). Commit a small Tierp fixture + `tierp.test.ts` asserting
  recall/precision thresholds so the site-independence guarantee is locked in CI.

- [x] **LICENSE + CI workflow** — DONE. MIT `LICENSE` at the repo root and
  `.github/workflows/test.yml` (typecheck + test + build on push/PR).

## Cross-repo (7S-generator)

The corpus generator now lives in its own repo,
[7S-generator](https://github.com/larsnor/7S-generator). Two notes:

- **Parity contract.** `plugin/src/mgrs.ts` and the 7S report format are mirrored
  (copied, not shared) in 7S-generator's `corpusgen/mgrs.py` / `render.py`, and the
  `7SPLATE:` image marker is a shared contract. If you change the report format,
  the marker, or MGRS handling here, mirror it in 7S-generator so fed corpora keep
  parsing. No build coupling — only the contract.
- Some earlier items now belong to that repo: **enriching the generator's recon
  templates** and **corpus plate-image generation** are 7S-generator work (its own
  `TODO.md` tracks them).

## Cross-repo (oden — the real Bin 1)

The real intake app exists and is mature: [NicklasAndersson/oden](https://github.com/NicklasAndersson/oden)
(Signal → 7S Markdown via a dedicated `seven_s` pipeline). Verified against its code
(commit 68b94d5) and against real received reports, 2026-08-27. Decision: **we change
nothing in that repo** — ODEN-analys engineers around its current behaviour. Observations
recorded so they are not re-derived:

- **Composition is safe by construction**: its installer only installs Oden.app; its
  wizard skips `.obsidian` entirely when one exists → "ODEN-valv first, then wizard"
  needs no code on either side. Its bundled Map View template (6.1.2) never installs
  over ours (pinned 6.1.4).
- **It wraps plates in `[[ ]]` itself** — in Symbol only (full + partial); Händelse
  stays prose. `ids.ts` handles both, so the old open question in HANDOFF is closed.
- **`källa: bin1-intag` never landed** in its spec or output (agreed long ago,
  PLUGIN_DESIGN §2). Our parser treats it as optional — tolerated, not forgotten.
- **Coordinate bug in ≤3.1.2**: spaced MGRS grids in Ställe mis-convert, so emitted
  frontmatter lat/lon can be grossly wrong while the grid in the body is right. Fixed
  upstream (their PR #257, merged 2026-08-26) but in no release yet. Our defence is the
  parse.ts coordinate cross-check (see E2E work); prefer their ≥ first release
  containing #257 in production guidance.
- **Partial-plate linking broken in oden**: its `_PARTIAL_PLATE_RE` is
  `\b`-delimited, and no word boundary exists between a dot and a space — so
  dot-edged masks (`RJK2..`, `..G41.`, i.e. the spec's canonical forms) are never
  wrapped in `[[ ]]`. Confirmed live in E2E (M3). Compensated on our side:
  `ids.ts` extracts partial masks from prose (2026-08-27).
- Reports land under `vault/<Signal-gruppnamn>/` (group-split default) or the vault
  root — `inkorg/` is OUR demo/manual convention, not their contract. Analysis scans
  the whole vault by `typ:`, so layout is cosmetic.

## Minor

- [ ] **Tierp corpus with plate images.** A Tierp image demo (plate photos) is a
  7S-generator run (`generate --images`); low priority — images are
  plate-corroboration only.
