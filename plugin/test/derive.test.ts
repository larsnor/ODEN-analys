/*
 * Derivation layer (src/derive.ts) — pure free functions over an explicit
 * PluginState; the node suite exercises recurrence counting, actor dedup/fold,
 * location linking, and feed mapping.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildFeedItems,
  buildRecurrences,
  buildWatchStatus,
  confirmedActorNotes,
  foldedConfirmedActors,
  locationLinker,
  mergedActors,
  stemForKey,
  PluginState,
} from "../src/derive.ts";
import { parseReport, Report } from "../src/parse.ts";
import { buildLocations } from "../src/location_notes.ts";
import { analyzeSuspicion, DEFAULT_SUSPICION } from "../src/suspicion.ts";
import { buildActorHypotheses } from "../src/actor.ts";
import { buildMarkNominations } from "../src/jobb.ts";
import { buildPlateEntities } from "../src/reid.ts";
import { AnalysisBundle } from "../src/alerts.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PROT = { protectedLat: 59.0, protectedLon: 17.0, threshold: 5 };

function report(over: Partial<Report>): Report {
  return {
    id: over.tnr ?? "x", typ: "7S-rapport", tnr: over.tnr ?? "000000",
    tidpunkt: "2026-06-16T03:00:00", plats: "Norra grinden", lat: 59.001, lon: 17.0,
    sagesman: "AQ", links: [], embeds: [], file: `reports/TNR${over.tnr ?? "000000"}.md`, ...over,
  } as Report;
}

/** A PluginState with everything empty — override just the fields a test cares about. */
function state(over: Partial<PluginState> = {}): PluginState {
  return {
    entitiesFolder: "entities",
    locationNicknames: {}, locationMerges: {}, locationNameAsked: {},
    actorNames: {}, actorMerges: {}, actorDecisions: {}, markDecisions: {},
    actorThreshold: 1, ...over,
  };
}

function loadCorpus(): Report[] {
  const dir = join(here, "fixtures", "reports");
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports/${f}`));
}
function bundleFrom(reports: Report[]): AnalysisBundle {
  return {
    reports,
    suspicion: analyzeSuspicion(reports, DEFAULT_SUSPICION),
    jobB: buildMarkNominations(reports),
    actors: buildActorHypotheses(reports, { threshold: 1 }),
    jobA: buildPlateEntities(reports),
  };
}

// --- buildRecurrences (the ≥2 counting) ------------------------------------

test("buildRecurrences: a plate seen 2+ times at one place → one fordon pair", () => {
  const reports = [
    report({ tnr: "1", handelse: "Fordon RJK241." }),
    report({ tnr: "2", handelse: "Fordon RJK241." }),
  ];
  const clusters = buildLocations(reports, analyzeSuspicion(reports, PROT));
  const recs = buildRecurrences(clusters, [], state());
  const fordon = recs.pairs.filter((p) => p.entityKind === "fordon");
  assert.equal(fordon.length, 1);
  assert.equal(fordon[0].key, "RJK241@@📍 Norra grinden");
  assert.equal(fordon[0].count, 2);
  // the byVehicle map routes that pair-key to the recurrence-note stem
  assert.equal(recs.byVehicle.get("RJK241@@📍 Norra grinden"), "🔁 RJK241 ×2 · Norra grinden");
});

test("buildRecurrences: a plate seen once is below the ≥2 threshold (no pair)", () => {
  const reports = [report({ tnr: "1", handelse: "Fordon RJK241." })];
  const clusters = buildLocations(reports, analyzeSuspicion(reports, PROT));
  const recs = buildRecurrences(clusters, [], state());
  assert.equal(recs.pairs.length, 0);
  assert.equal(recs.byVehicle.size, 0);
});

test("buildRecurrences: actor recurrence keys are well-formed and past the threshold", () => {
  const reports = loadCorpus();
  const susp = analyzeSuspicion(reports, DEFAULT_SUSPICION);
  const clusters = buildLocations(reports, susp);
  const actors = mergedActors(reports, susp, 1).hypotheses;
  const recs = buildRecurrences(clusters, actors, state());
  for (const p of recs.pairs.filter((p) => p.entityKind === "aktör")) {
    assert.ok(p.count >= 2, "recurrence means seen 2+ times");
    assert.match(p.key, /@@/, "key is entityStem@@placeStem");
    assert.equal(recs.byActor.get(p.key)?.startsWith("🔁 "), true);
  }
});

// --- location linking ------------------------------------------------------

test("locationLinker maps a raw plats to its location-note stem; unknown → undefined", () => {
  const reports = [report({ tnr: "1", handelse: "Fordon RJK241." })];
  const clusters = buildLocations(reports, analyzeSuspicion(reports, PROT));
  const linker = locationLinker(clusters, state());
  assert.equal(stemForKey(clusters, clusters[0].key, {}), "📍 Norra grinden");
  assert.equal(linker("Norra grinden"), "📍 Norra grinden");
  assert.equal(linker("Någon annanstans"), undefined);
  assert.equal(stemForKey(clusters, "no-such-key", {}), "");
});

test("locationLinker respects operator place-merges (both raw names → one stem)", () => {
  const reports = [
    report({ tnr: "1", plats: "Grind A", handelse: "Fordon RJK241." }),
    report({ tnr: "2", plats: "Grind B", handelse: "Fordon RJK241." }),
  ];
  const merges = { "Grind B": "Grind A" };
  const clusters = buildLocations(reports, analyzeSuspicion(reports, PROT), merges);
  const linker = locationLinker(clusters, state({ locationMerges: merges }));
  assert.ok(linker("Grind A"), "the surviving place resolves");
  assert.equal(linker("Grind B"), linker("Grind A"), "the absorbed place folds to the same node");
});

// --- actors: dedup + confirm/fold ------------------------------------------

test("mergedActors: suspect agents never reuse a facet already inside a transitive actor", () => {
  const reports = loadCorpus();
  const susp = analyzeSuspicion(reports, DEFAULT_SUSPICION);
  const base = buildActorHypotheses(reports, { threshold: 1 });
  const baseFacets = new Set(base.hypotheses.flatMap((h) => h.facets.map((f) => f.id)));
  const res = mergedActors(reports, susp, 1);
  assert.ok(res.hypotheses.length >= base.hypotheses.length, "merged ⊇ transitive base");
  const extra = res.hypotheses.slice(base.hypotheses.length);
  for (const h of extra) for (const f of h.facets) {
    assert.ok(!baseFacets.has(f.id), `suspect actor reuses base facet ${f.id}`);
  }
});

test("foldedConfirmedActors: filters to the operator-confirmed hypotheses only", () => {
  // (The merge-folding this delegates to — two confirmed actors → one node — is
  //  covered directly in actor_merge.test.ts; here we own the confirmed-only gate.)
  const reports = loadCorpus();
  const susp = analyzeSuspicion(reports, DEFAULT_SUSPICION);
  const all = mergedActors(reports, susp, 1).hypotheses;
  assert.ok(all.length >= 1, "this fixture yields ≥1 hypothesis");
  const h = all[0];
  assert.equal(foldedConfirmedActors(reports, susp, state()).length, 0, "nothing confirmed → none");
  const confirmed = foldedConfirmedActors(reports, susp, state({ actorDecisions: { [h.id]: "confirmed" } }));
  assert.equal(confirmed.length, 1, "the confirmed hypothesis survives");
  assert.equal(confirmed[0].id, h.id);
  assert.equal(
    foldedConfirmedActors(reports, susp, state({ actorDecisions: { [h.id]: "rejected" } })).length,
    0,
    "a rejected decision is not 'confirmed' → excluded",
  );
});

test("confirmedActorNotes renders one note per folded actor, operator name winning the title", () => {
  const reports = loadCorpus();
  const susp = analyzeSuspicion(reports, DEFAULT_SUSPICION);
  const [h] = mergedActors(reports, susp, 1).hypotheses;
  const s = state({ actorDecisions: { [h.id]: "confirmed" }, actorNames: { [h.id]: "Röd grupp" } });
  const folded = foldedConfirmedActors(reports, susp, s);
  const notes = confirmedActorNotes(folded, s);
  assert.equal(notes.length, folded.length);
  assert.ok(notes.length >= 1);
  assert.match(notes[0].name, /Röd grupp/, "operator name titles the note");
  assert.ok(notes[0].body.length > 0);
});

// --- feed mapping ----------------------------------------------------------

test("buildFeedItems: fordon rows carry the photo flag from the corroboration map", () => {
  const reports = loadCorpus();
  const bundle = bundleFrom(reports);
  assert.ok(bundle.jobA.entities.length >= 1, "corpus has identified vehicles");
  const plate = bundle.jobA.entities[0].canonical;
  const corr = new Map<string, Set<string>>([[plate, new Set(["reports/x.md"])]]);
  const fordon = buildFeedItems(bundle, state(), corr).filter((i) => i.kind === "fordon");
  assert.equal(fordon.length, bundle.jobA.entities.length);
  assert.equal(fordon.find((i) => i.label === plate)!.photo, true);
  assert.ok(fordon.filter((i) => i.label !== plate).every((i) => i.photo === false));
});

test("buildFeedItems: pending-review rows count the un-decided hypotheses / nominations", () => {
  const bundle = bundleFrom(loadCorpus());
  const items = buildFeedItems(bundle, state(), new Map());
  const pa = items.find((i) => i.kind === "förslag-aktör");
  const pm = items.find((i) => i.kind === "förslag-märke");
  if (bundle.actors.hypotheses.length > 0) assert.equal(pa!.pending, bundle.actors.hypotheses.length);
  if (bundle.jobB.nominations.length > 0) assert.equal(pm!.pending, bundle.jobB.nominations.length);
});

test("buildFeedItems: a mark surfaces only once its signature is confirmed", () => {
  const bundle = bundleFrom(loadCorpus());
  if (bundle.jobB.nominations.length === 0) return; // corpus-dependent
  const sig = bundle.jobB.nominations[0].signature;
  assert.equal(buildFeedItems(bundle, state(), new Map()).filter((i) => i.kind === "kännetecken").length, 0);
  assert.equal(
    buildFeedItems(bundle, state({ markDecisions: { [sig]: "confirmed" } }), new Map()).filter((i) => i.kind === "kännetecken").length,
    1,
  );
});

test("buildFeedItems: an un-named MGRS grid place nudges for a nickname; naming/asking suppresses it", () => {
  const grid = "33VXG12345678";
  const reports = [
    report({ tnr: "1", plats: grid, handelse: "Fordon RJK241." }),
    report({ tnr: "2", plats: grid, handelse: "Fordon RJK241." }),
  ];
  const bundle = bundleFrom(reports);
  const nudge = (s: PluginState) => buildFeedItems(bundle, s, new Map()).filter((i) => i.kind === "namnge-plats");
  const n = nudge(state());
  assert.equal(n.length, 1);
  assert.equal(n[0].place, grid);
  assert.equal(nudge(state({ locationNicknames: { [grid]: "Grinden" } })).length, 0, "a nickname clears the nudge");
  assert.equal(nudge(state({ locationNameAsked: { [grid]: true } })).length, 0, "already-asked clears the nudge");
});

test("buildFeedItems: analysing photos pin 'bildanalys' rows; pending findings one 'förslag-bild' review row", () => {
  const reports = [report({ tnr: "150900" })];
  const bundle = bundleFrom(reports);
  const items = buildFeedItems(bundle, state(), new Map(), new Set(["reports/TNR150900.md"]), 3);
  const analysing = items.find((i) => i.kind === "bildanalys");
  assert.ok(analysing, "bildanalys row present");
  assert.equal(analysing!.path, "bildanalys:reports/TNR150900.md", "synthetic path — never dedups the report's larm row");
  assert.equal(analysing!.file, "reports/TNR150900.md", "real click target");
  assert.equal(analysing!.tnr, "150900");
  const rev = items.find((i) => i.kind === "förslag-bild");
  assert.ok(rev, "review row present");
  assert.equal(rev!.pending, 3);
  assert.equal(rev!.review, "photos");
  assert.ok(rev!.time > analysing!.time, "review rows pin above the transient analysing rows");
  // Nothing analysing / pending → neither row.
  const none = buildFeedItems(bundle, state(), new Map());
  assert.equal(none.filter((i) => i.kind === "bildanalys" || i.kind === "förslag-bild").length, 0);
});

test("buildWatchStatus: vehicle watch resolves count/lastSeen; fresh counts from baseline; -1 baseline = no fresh yet", () => {
  const reports = loadCorpus();
  const bundle = bundleFrom(reports);
  const plate = bundle.jobA.entities[0];
  assert.ok(plate, "corpus yields a plate entity");
  const key = `fordon:${plate.canonical}`;
  const mk = (baseline: number) =>
    state({ watchlist: { [key]: { kind: "fordon", label: plate.canonical, ref: plate.canonical, addedAt: "2026-06-15", baseline } } });
  // Un-initialised baseline (-1): treated as current count → fresh 0.
  const fresh0 = buildWatchStatus(bundle, mk(-1));
  assert.equal(fresh0.length, 1);
  assert.equal(fresh0[0].count, plate.count);
  assert.equal(fresh0[0].fresh, 0);
  assert.equal(fresh0[0].lastSeen, plate.lastSeen);
  assert.ok(fresh0[0].stem, "note stem resolvable");
  // Baseline below current count → fresh = delta.
  const fresh = buildWatchStatus(bundle, mk(plate.count - 2));
  assert.equal(fresh[0].fresh, 2);
});

test("buildWatchStatus: a watched report (händelse) is a static bookmark — never fresh", () => {
  const reports = loadCorpus();
  const bundle = bundleFrom(reports);
  const r = reports[0];
  const s = state({ watchlist: { [`händelse:${r.file}`]: { kind: "händelse", label: `TNR${r.tnr}`, ref: r.file, addedAt: "x", baseline: 0 } } });
  const [row] = buildWatchStatus(bundle, s);
  assert.equal(row.count, 1);
  assert.equal(row.fresh, 0, "baseline 0 vs count 1 must NOT read as new activity");
  assert.equal(row.lastSeen, r.tidpunkt);
});

test("buildFeedItems: a watched entity with fresh activity yields an amber 🔭 row; without fresh it does not", () => {
  const reports = loadCorpus();
  const bundle = bundleFrom(reports);
  const plate = bundle.jobA.entities[0];
  const watchFresh = buildWatchStatus(
    bundle,
    state({ watchlist: { [`fordon:${plate.canonical}`]: { kind: "fordon", label: plate.canonical, ref: plate.canonical, addedAt: "x", baseline: plate.count - 1 } } }),
  );
  const items = buildFeedItems(bundle, state(), new Map(), new Set(), 0, new Set(), 0, watchFresh);
  const row = items.find((i) => i.kind === "bevakad");
  assert.ok(row, "bevakad row present");
  assert.equal(row!.count, 1);
  assert.equal(row!.watchKey, `fordon:${plate.canonical}`);
  // No fresh → no row.
  const watchSeen = watchFresh.map((w): typeof w => ({ ...w, fresh: 0 }));
  assert.equal(buildFeedItems(bundle, state(), new Map(), new Set(), 0, new Set(), 0, watchSeen).filter((i) => i.kind === "bevakad").length, 0);
});
