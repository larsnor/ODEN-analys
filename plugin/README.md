# ODEN plugin (`7s-analys`) — developer guide

The Obsidian plugin that analyses 7S field reports. For what it does and how to
install it, see the repo root [`README.md`](../README.md) and
[`INSTALL.md`](../INSTALL.md); this file is the developer/reviewer guide to the code.

## Architecture — pure core, thin shell
Every analysis module is **pure TypeScript with no Obsidian import**, so the whole
pipeline is unit-tested outside Obsidian with `node --test`. **Only `src/main.ts`
imports `obsidian`** (commands, the panel view, vault I/O, the write-contract, and a
best-effort Map View hand-off). Grep confirms the boundary:

```bash
grep -rl "from \"obsidian\"" src   # -> only src/main.ts
```

## The pipeline (report → notes/graph/map)
- **Parse** (`parse.ts`, `ids.ts`, `mgrs.ts`, `places.ts`) — frontmatter + 7S body +
  `[[links]]`; MGRS→lat/lon when coords are absent.
- **Job A — plate re-identification** (`reid.ts`, `entity_notes.ts`) — CERTAIN
  registration-plate matches; auto-merged (§6.1); de-hardcoded (partials resolve only
  to observed fulls).
- **Job B — mark nominations** (`vocab.ts`, `marks.ts`, `jobb.ts`, `mark_notes.ts`) —
  distinctive *kännetecken* normalised to a signature; **nominated, never auto-merged**;
  operator-confirmed.
- **Actors** (`actor.ts`, `suspects.ts`, `actor_notes.ts`) — transitive facet
  derivation (Job A + Job B) + single-agent suspects; nominate → confirm.
- **Suspicion** (`suspicion.ts`, `present.ts`, `alerts.ts`, `feed.ts`) — a transparent
  weighted score (proximity + time + behaviour keywords) with an explained reason list.
- **Places / recurrence** (`location_notes.ts`, `recurrence_notes.ts`) — spatial hubs
  and "same entity ≥2× here" nodes, with direct graph links.
- **Query** (`query.ts`, `conversation.ts`) — a deterministic keyword query engine
  behind a `Conversation` seam (a local LLM can drop in later — Phase B).
- **Safety** (`mdsafe.ts`, `notenames.ts`) — report text is attacker-controlled;
  `mdText` escapes it before any Markdown render; filenames are sanitised.

`main.ts` owns the write-contract (`writeOwnedNotes`, per-`metod` pruning), the panel,
commands, the watcher, and the operator flows (setup, naming, merges, recurrence).

## Honest detection scope
Both fixed vocabularies are high-precision *seeds* with validated-but-limited recall on
independently-authored prose — see [`../docs/RE-ID_VALIDATION.md`](../docs/RE-ID_VALIDATION.md)
(marks) and [`../docs/BEHAVIOUR_VALIDATION.md`](../docs/BEHAVIOUR_VALIDATION.md)
(behaviour). Plate re-id and the geometry/time signals are vocabulary-independent.

## Develop
```bash
cd plugin
npm install
npm run typecheck   # tsc --noEmit (strict)
npm test            # node --test over test/*.test.ts (fixtures in test/fixtures/)
npm run build       # esbuild -> main.js
npm run package     # build + assemble ../dist/ODEN-<version>.zip
```
`main.js` is a build artifact (git-ignored); end users get it from the release zip.
The OOD validation harnesses (`test/reid_ood.test.ts`, `test/behaviour_ood.test.ts`)
print recall/precision to the test log.

## Format note
Real `bin1-intag` reports carry extra frontmatter (`källa`, `bilagor`, `signal_*`);
the parser reads them defensively (optional). See the header in `src/parse.ts` and
[`../docs/FORMAT_SPEC.md`](../docs/FORMAT_SPEC.md).
