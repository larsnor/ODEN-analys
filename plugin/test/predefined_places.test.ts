/*
 * Predefined places — operator-created locations that exist BEFORE any reports:
 * day-0 📍 nodes, vicinity linking (nearest place whose radius covers the report,
 * kept ALONGSIDE the reported place → the dual relation), and sensitive places as
 * extra suspicion proximity anchors with bands scaled by the vicinity radius
 * (<R → 3, <2R → 2, <4R → 1; max over anchors, never summed).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  buildLocations,
  renderLocationNote,
  PredefinedLocation,
} from "../src/location_notes.ts";
import { analyzeSuspicion, SuspicionOpts } from "../src/suspicion.ts";
import { parseReport, Report } from "../src/parse.ts";
import { computeAlertItems } from "../src/alerts.ts";
import { buildMarkNominations } from "../src/jobb.ts";
import { buildActorHypotheses } from "../src/actor.ts";
import { buildPlateEntities } from "../src/reid.ts";
import { renderActorNote } from "../src/actor_notes.ts";
import { buildRecurrences, predefNearLinker, PluginState } from "../src/derive.ts";
import { reasonPhrases } from "../src/present.ts";

// Objektet at 59.0,17.0. 0.0100° lat ≈ 1112 m, so "Förrådet" at 59.0100 sits well
// outside the tight objektet band but carries its own scaled bands (R = 100 m).
const PROT: SuspicionOpts = { protectedLat: 59.0, protectedLon: 17.0, threshold: 5 };
const FORRAD = { name: "Förrådet", lat: 59.01, lon: 17.0, radiusM: 100 };
const SENS: SuspicionOpts = { ...PROT, sensitivePlaces: [FORRAD] };
const PREDEF: Record<string, PredefinedLocation> = {
  Grinden: { lat: 59.01, lon: 17.0, radiusM: 100 },
};

function report(over: Partial<Report>): Report {
  return {
    id: over.tnr ?? "x", typ: "7S-rapport", tnr: over.tnr ?? "000000",
    tidpunkt: "2026-06-16T12:00:00", plats: "Vägen", lat: 59.0105, lon: 17.0,
    sagesman: "AQ", links: [], embeds: [], file: `reports/TNR${over.tnr ?? "000000"}.md`, ...over,
  } as Report;
}

function state(over: Partial<PluginState> = {}): PluginState {
  return {
    entitiesFolder: "entities",
    locationNicknames: {}, locationMerges: {}, locationNameAsked: {},
    actorNames: {}, actorMerges: {}, actorDecisions: {}, markDecisions: {},
    actorThreshold: 1, ...over,
  };
}

// --- suspicion: sensitive places as scaled proximity anchors -----------------

test("sensitive place: scaled bands <R/<2R/<4R, and the label names the place", () => {
  const at = (lat: number) => analyzeSuspicion([report({ lat })], SENS).rows[0];
  // 55.6 m — inside R=100 → weight 3.
  const near = at(59.0105).reasons.find((x) => x.key === "känslig-plats");
  assert.equal(near?.weight, 3);
  assert.match(near!.label, /nära Förrådet/);
  // 167 m — inside 2R → weight 2 (also beats objektet's equal band: nearer wins).
  const mid = at(59.0115).reasons.find((x) => x.key === "känslig-plats");
  assert.equal(mid?.weight, 2);
  assert.match(mid!.label, /i närområdet av Förrådet/);
  // 445 m — outside 4R=400 → the sensitive place is silent; objektet band applies.
  const far = at(59.014).reasons.find((x) => x.key === "proximity");
  assert.equal(far?.weight, 2);
  assert.doesNotMatch(far!.label, /Förrådet/);
  assert.equal(at(59.014).reasons.some((x) => x.key === "känslig-plats"), false);
});

test("proximity is MAX over anchors, never summed — alone it cannot cross the threshold", () => {
  // Night report 56 m from Förrådet AND 1167 m from objektet: were anchors summed
  // (3+2), score would be 7; max keeps it 3 (+2 natt) = 5.
  const r = report({ tidpunkt: "2026-06-16T03:00:00" });
  const row = analyzeSuspicion([r], SENS).rows[0];
  const prox = row.reasons.filter((x) => x.key === "proximity" || x.key === "känslig-plats");
  assert.equal(prox.length, 1, "exactly ONE proximity-family signal");
  assert.equal(row.score, 5); // 3 (nära Förrådet) + 2 (natt)
  assert.equal(analyzeSuspicion([r], SENS).elevated.length, 1, "reaches the threshold");
});

test("a NON-sensitive predefined place adds no suspicion signal", () => {
  const row = analyzeSuspicion([report({})], PROT).rows[0]; // no sensitivePlaces
  assert.equal(row.reasons.some((x) => x.key === "känslig-plats"), false);
});

test("feed phrases + alert title name the sensitive place (distance scrubbed)", () => {
  const r = report({ tidpunkt: "2026-06-16T03:00:00" });
  const susp = analyzeSuspicion([r], SENS);
  assert.ok(reasonPhrases(susp.elevated[0].reasons).includes("nära Förrådet"));
  const items = computeAlertItems({
    reports: [r], suspicion: susp,
    jobB: buildMarkNominations([r]), actors: buildActorHypotheses([r], { threshold: 1 }), jobA: buildPlateEntities([r]),
  });
  const alert = items.find((a) => a.kind === "förhöjd");
  assert.match(alert!.title, /nära Förrådet/);
  assert.doesNotMatch(alert!.title, /~\d+\s*m/, "no raw distance in the title");
});

// --- clustering: day-0 nodes + vicinity linking ------------------------------

test("a predefined place exists as a cluster (and renders) before any report", () => {
  const [c] = buildLocations([], analyzeSuspicion([], PROT), undefined, {
    Grinden: { lat: 59.01, lon: 17.0, radiusM: 100, sensitive: true },
  });
  assert.equal(c.key, "Grinden");
  assert.equal(c.reports.length, 0);
  assert.deepEqual(c.predefined, { radiusM: 100, sensitive: true });
  const md = renderLocationNote(c).markdown;
  assert.match(md, /fördefinierad: true/);
  assert.match(md, /radie_m: 100/);
  assert.match(md, /känslig: true/);
  // #fördefinierad puts the needle on the map (query + display rule); the
  // sensitive ones additionally carry #skyddsvärd (shield marker).
  assert.match(md, /tags: \[plats, fördefinierad, skyddsvärd\]/);
  assert.match(md, /Inga observationer ännu/);
  assert.match(md, /Fördefinierad plats/);
  // Day-0 graph edge: the place links the AOI node (orphans are hidden in the
  // graph, so a link-less day-0 place would be invisible).
  assert.match(md, /\*\*Operationsområde:\*\* \[\[Objektet\]\]/);
  // Non-sensitive: needle tag but no shield, and location: for the map pin.
  const [plain] = buildLocations([], analyzeSuspicion([], PROT), undefined, PREDEF);
  const md2 = renderLocationNote(plain).markdown;
  assert.match(md2, /tags: \[plats, fördefinierad\]/);
  assert.match(md2, /location: "59.01,17"/);
  assert.match(md2, /\[\[Objektet\]\]/);
});

test("a DERIVED location hub does not link Objektet (no artificial hub edges)", () => {
  const r = report({ tnr: "1", handelse: "Fordon RJK241." });
  const clusters = buildLocations([r], analyzeSuspicion([r], PROT)); // no predefined
  const md = renderLocationNote(clusters.find((c) => c.key === "Vägen")!).markdown;
  assert.equal(md.includes("[[Objektet]]"), false);
});

test("vicinity: a report within the radius links to BOTH its reported place and the predefined one", () => {
  const r = report({ tnr: "1", handelse: "Fordon RJK241." }); // 56 m from Grinden, plats "Vägen"
  const clusters = buildLocations([r], analyzeSuspicion([r], PROT), undefined, PREDEF);
  const own = clusters.find((c) => c.key === "Vägen");
  const pre = clusters.find((c) => c.key === "Grinden");
  assert.equal(own?.reports.length, 1, "the reported place is kept");
  assert.equal(pre?.reports.length, 1, "the predefined place also claims it");
  assert.deepEqual(pre?.plates, ["RJK241"], "the vehicle relates to the predefined place too");
});

test("vicinity: outside the radius → no link; benign reports DO count at a predefined place", () => {
  const outside = report({ tnr: "1", lat: 59.0115, handelse: "Fordon RJK241." }); // 167 m > 100
  const benign = report({ tnr: "2" }); // 56 m, no plate, not elevated (daytime)
  const clusters = buildLocations([outside, benign], analyzeSuspicion([outside, benign], PROT), undefined, PREDEF);
  const pre = clusters.find((c) => c.key === "Grinden");
  assert.equal(pre?.reports.length, 1, "only the within-radius report");
  assert.equal(pre?.reports[0].tnr, "2", "the benign one — operator places record everything");
  assert.equal(clusters.some((c) => c.key === "Vägen" && c.reports.some((o) => o.tnr === "2")), false,
    "a benign report still does not create a derived hub");
});

test("vicinity: the NEAREST covering place wins; an exact-name report attaches once", () => {
  const two: Record<string, PredefinedLocation> = {
    G1: { lat: 59.01, lon: 17.0, radiusM: 100 },
    G2: { lat: 59.0106, lon: 17.0, radiusM: 100 },
  };
  const r = report({ tnr: "1", handelse: "Fordon RJK241." }); // 56 m to G1, 11 m to G2
  const clusters = buildLocations([r], analyzeSuspicion([r], PROT), undefined, two);
  assert.equal(clusters.find((c) => c.key === "G2")?.reports.length, 1);
  assert.equal(clusters.find((c) => c.key === "G1")?.reports.length, 0);

  const exact = report({ tnr: "2", plats: "Grinden", lat: 59.01, handelse: "Fordon ABC123." });
  const c2 = buildLocations([exact], analyzeSuspicion([exact], PROT), undefined, PREDEF);
  assert.equal(c2.find((c) => c.key === "Grinden")?.reports.length, 1, "attached once, not twice");
});

// --- graph wiring: near-linker, actor dual link, recurrence at the place -----

test("predefNearLinker maps an observation file to the predefined place that claimed it", () => {
  const r = report({ tnr: "1", handelse: "Fordon RJK241." });
  const clusters = buildLocations([r], analyzeSuspicion([r], PROT), undefined, PREDEF);
  const nearOf = predefNearLinker(clusters, state());
  assert.deepEqual(nearOf(r.file), { stem: "📍 Grinden", label: "Grinden" });
  assert.equal(nearOf("reports/other.md"), undefined);
});

test("actor note shows the dual place: reported place + (nära <predefined>)", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "fixtures", "reports");
  const reps = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports/${f}`));
  const [h] = buildActorHypotheses(reps, { threshold: 1 }).hypotheses;
  const file = h.chain[0].file;
  const md = renderActorNote(h, undefined, undefined, undefined,
    () => "📍 loc",
    undefined,
    (f) => (f === file ? { stem: "📍 Grinden", label: "Grinden" } : undefined),
  ).markdown;
  assert.ok(md.includes("_(nära [[📍 Grinden|Grinden]])_"), "second place edge rendered");
  // When the reported place IS the predefined one, no duplicate "(nära ...)".
  const md2 = renderActorNote(h, undefined, undefined, undefined,
    () => "📍 Grinden",
    undefined,
    () => ({ stem: "📍 Grinden", label: "Grinden" }),
  ).markdown;
  assert.equal(md2.includes("(nära"), false);
});

test("a plate recurring WITHIN the vicinity (different plats strings) gets a recurrence node at the place", () => {
  const r1 = report({ tnr: "1", plats: "Vägen A", lat: 59.0105, handelse: "Fordon RJK241." });
  const r2 = report({ tnr: "2", plats: "Vägen B", lat: 59.01045, handelse: "Fordon RJK241." });
  const clusters = buildLocations([r1, r2], analyzeSuspicion([r1, r2], PROT), undefined, PREDEF);
  const recs = buildRecurrences(clusters, [], state());
  assert.ok(recs.byVehicle.has("RJK241@@📍 Grinden"), "recurrence keyed on the predefined place");
  assert.equal(recs.pairs.find((p) => p.placeStem === "📍 Grinden")?.count, 2);
});
