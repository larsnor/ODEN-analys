# ODEN — TODO / deferred work

**Struck 2026-08-28 (operator decision): the open TODO items are retired — open
work is tracked as [GitHub issues](https://github.com/larsnor/ODEN-analys/issues)
from now on.** What remains below is the RECORD: delivered items ([x]) and the
cross-repo reference notes (contracts and observations), kept because they
document decisions, not pending work.

## LLM / vision layer (the big cluster — "Phase B")

- [x] **Local LLM layer (Ollama), behind the engine toggle.** DONE (2026-07-14/15 —
  the 📷/📝/💬 capability chips: vision, open-vocab text extraction, chat
  translate/narrate; all nomination-gated, degrade to deterministic). Original scope: The deterministic
  ⇄ LLM toggle already exists (`settings.engine`, `conversation.ts`). Add a local
  Ollama adapter for: (a) chat *translate/narrate* (`Conversation.toQuery` /
  `narrate` with §7.1 grounding), and (b) open-vocabulary *mark extraction* feeding
  Job B nominations. Must run fully local (no cloud API), degrade gracefully if
  Ollama is absent, and ship with a fake adapter for tests. This lifts the
  keyword-vocabulary ceiling the deterministic layer can't reach.

- [x] **Broaden the vision adapter to general image analysis (§6.7).** DONE —
  `photo_analysis.ts` PhotoSighting: 0+ plates, vehicles, persons (incl.
  aktivitet, prompt v3) and scene nominations; privileged plate corroboration.
  Original scope: Today
  `vision.ts` is a narrow `PlateVision` (plate-corroboration only). Widen to a
  `VisionAnalyzer` returning a structured result: **0+ plates, 0+ marks, a scene
  description** (an image may contain no plate, or several). Feed novel findings
  into the existing nominate→confirm review flow (privileged plate nominations;
  Job B marks). Keep the iron rule: vision **nominates, never asserts**.

- [x] **Run-once-per-artifact cache for vision/LLM.** DONE — `photoAnalyses` /
  `textExtractions` keyed by content-hash + model + prompt version. Original scope: A real VLM/LLM is expensive
  and non-deterministic, so it must NOT re-run on every watcher tick (the current
  stub re-reads images each build — fine for a byte-scan, not for a model). Cache
  by (image/text hash + model/config), persisted as provenance, so results stay
  reproducible and auditable.

## Detection vocabulary (deterministic layer)

- [x] **`vocab.ts` mark categories for recon gear** — DONE (bounded, frozen): added
  `optik` (distinctive only on a specific sub-type — teleobjektiv/nattkikare/… — so
  plain binoculars are birdwatcher-safe), `verktyg` (breaching tools), `teknik`
  (signals gear), with fine per-item signatures. `skyddsväst`/hi-vis was deliberately
  NOT added (too close to benign workers). OOD-measured in `docs/RE-ID_VALIDATION.md`.

## Testing / repo hygiene

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
  frontmatter lat/lon can be grossly wrong while the grid in the body is right.
  RESOLVED upstream: their **v3.2.0 (2026-08-28)** ships both #257 (coordinates) and
  #245 (7S photos); install guidance now floors at 3.2.0. Our parse.ts coordinate
  cross-check stays as the defence against any older install or future regression.
- **Partial-plate linking broken in oden**: its `_PARTIAL_PLATE_RE` is
  `\b`-delimited, and no word boundary exists between a dot and a space — so
  dot-edged masks (`RJK2..`, `..G41.`, i.e. the spec's canonical forms) are never
  wrapped in `[[ ]]`. Confirmed live in E2E (M3). Compensated on our side:
  `ids.ts` extracts partial masks from prose (2026-08-27).
- Reports land under `vault/<Signal-gruppnamn>/` (group-split default) or the vault
  root — `inkorg/` is OUR demo/manual convention, not their contract. Analysis scans
  the whole vault by `typ:`, so layout is cosmetic.

