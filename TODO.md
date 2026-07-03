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

- [ ] **Offline geocoding (name → coordinate) — separate from tiles.** Downloading
  tiles only makes the map *visible*; name search still hits OSM Nominatim (a live
  API). For air-gapped use: (1) prefer **MGRS / lat-lon** input — already offline via
  `mgrs.ts`, no lookup needed; (2) optionally build a small **AOI gazetteer** (local
  place name → coordinate, extracted from OSM data for the region). A full local
  Nominatim instance gives real offline geocoding but is heavy (OSM → PostgreSQL).

## Detection vocabulary (deterministic layer)

- [ ] **New `vocab.ts` mark categories for recon gear.** The mark subsystem only
  knows 3 tells (dark backpack / cap / vehicle decal), so new-format gear —
  binoculars, cameras+teleobjektiv, tripods, hi-vis-without-work, shoulder bags —
  never clusters for re-id. Add categories (e.g. `optik`, `skyddsväst`) with
  `SIGNATURE_DIMS` + `marks.ts` logic. Precision-sensitive (a tourist has a camera):
  gate distinctiveness carefully and add a held-out mark test.

- [ ] **Enrich the generator's recon templates.** The corpora still use the
  *original* recon phrasings, so they don't exercise the expanded
  `RECON_INDICATORS`. Add varied, realistic phrasings drawing on the wider
  vocabulary so future corpora stress the matcher (recall is validated by
  `recon_indicators.test.ts`, but the corpora themselves are narrow).

## Testing / repo hygiene

- [ ] **Permanent Tierp regression test.** Currently Tierp detection is validated
  ad-hoc (regenerable). Commit a small Tierp fixture + `tierp.test.ts` asserting
  recall/precision thresholds so the site-independence guarantee is locked in CI.

- [ ] **LICENSE + CI workflow.** Add a `LICENSE` and a `.github/workflows` that runs
  `npm run typecheck && npm test && npm run build` on push, so the repo is
  review-ready and regressions are caught automatically.

## Minor

- [ ] **Tierp corpus with plate images.** The Tierp corpus is generated without
  images; add corroborating plate photos (as Vällinge has) if a Tierp image demo is
  wanted. Low priority — images are plate-corroboration only.
