/*
 * Query-engine tests — OUTSIDE Obsidian (§10). Pure parse + execute over the real
 * corpus. The engine is a projection of the domain model: TARGET (reports/fordon/
 * kännetecken/aktör/plats/larm/farkost) × SHAPE (detail/list/timeline/summary),
 * with FILTERS and the identity GUARD. The KB uses Job A vehicles + ALL Job B
 * nominations, all actors (threshold 1), places, elevated larm, and craft — the
 * engine only cares about the set it is handed.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, Report } from "../src/parse.ts";
import { buildPlateEntities } from "../src/reid.ts";
import { buildMarkNominations } from "../src/jobb.ts";
import { analyzeSuspicion } from "../src/suspicion.ts";
import { mergedActors } from "../src/derive.ts";
import { buildLocations } from "../src/location_notes.ts";
import { extractAllCraft } from "../src/craft.ts";
import { KB, parseQuery, runQuery } from "../src/query.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures");
function loadReports(): Report[] {
  const dir = join(root, "reports");
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports/${f}`));
}
function kb(): KB {
  const reports = loadReports();
  const suspicion = analyzeSuspicion(reports);
  return {
    reports,
    vehicles: buildPlateEntities(reports).entities,
    marks: buildMarkNominations(reports).nominations,
    actors: mergedActors(reports, suspicion, 1).hypotheses,
    places: buildLocations(reports, suspicion),
    larm: suspicion.elevated,
    craft: extractAllCraft(reports),
  };
}

test("parser echoes the structured interpretation (target × shape)", () => {
  assert.match(parseQuery("RJK241").echo, /mål=fordon/);
  assert.match(parseQuery("RJK241").echo, /form=detail/);
  assert.match(parseQuery("RJK241").echo, /term="RJK241"/);
  const night = parseQuery("fordon vid grindarna i natt");
  assert.equal(night.target, "fordon");
  assert.equal(night.time?.label, "natt (22:00–05:00)");
  assert.equal(night.place, "grindarna");
});

test("entity lookup returns the vehicle with cited observations", () => {
  const a = runQuery("RJK241", kb());
  assert.equal(a.query.target, "fordon");
  assert.equal(a.query.shape, "detail");
  assert.ok(a.rowCount >= 5, `RJK241 should have its sightings, got ${a.rowCount}`);
  assert.match(a.markdown, /# Fordon RJK241/);
  assert.match(a.markdown, /\[\[TNR/); // citations present
  assert.match(a.markdown, /Tolkad fråga/); // query-echo present
});

test("recurring lists multi-sighting entities only", () => {
  const a = runQuery("återkommande fordon", kb());
  assert.equal(a.query.shape, "list");
  assert.ok(a.query.minCount && a.query.minCount >= 2);
  assert.match(a.markdown, /RJK241/);
  assert.match(a.markdown, /Återkommande fordon/);
  const a2 = runQuery("återkommande fordon minst 8", kb());
  assert.ok(a2.rowCount < a.rowCount);
});

test("time + place filter narrows observations and cites", () => {
  const night = runQuery("fordon i natt", kb());
  assert.equal(night.query.target, "fordon");
  assert.ok(night.rowCount > 0, "expected some night vehicle observations");
  assert.match(night.markdown, /\[\[TNR\d+\|TNR\d+\]\]/);
});

test("identity question hits the write-wall, asserts nothing", () => {
  const a = runQuery("är RJK241 och TLP893 samma aktör?", kb());
  assert.equal(a.query.guard, true);
  assert.match(a.markdown, /påstår inte/);
  assert.match(a.markdown, /operatörens bekräftelse/i);
  assert.equal(a.rowCount, 0);
});

test("free-text search finds reports by prose", () => {
  const a = runQuery("Skoda", kb());
  assert.match(a.markdown, /# Sökning/);
  assert.ok(a.rowCount > 0);
  assert.match(a.markdown, /\[\[TNR/);
});

// --- widened targets -------------------------------------------------------

test("farkost target lists craft observations by type", () => {
  const q = parseQuery("visa traktorer");
  assert.equal(q.target, "farkost");
  assert.equal(q.term, "traktor");
  const a = runQuery("visa traktorer", kb());
  assert.match(a.markdown, /# Farkostobservationer: traktor/);
  assert.ok(a.rowCount > 0, `corpus has tractors, got ${a.rowCount}`);
  assert.match(a.markdown, /\[\[TNR/);
});

test("a craft type absent from the corpus parses but returns an honest miss", () => {
  const a = runQuery("visa drönarobservationer", kb());
  assert.equal(a.query.target, "farkost");
  assert.equal(a.query.term, "drönare");
  assert.equal(a.rowCount, 0);
  assert.match(a.markdown, /Inga farkostobservationer/);
});

test("larm target ranks elevated reports with operator phrases", () => {
  const k = kb();
  const a = runQuery("vilka larm har vi?", k);
  assert.equal(a.query.target, "larm");
  assert.equal(a.query.shape, "list");
  assert.equal(a.rowCount, k.larm.length);
  assert.match(a.markdown, /# Larm/);
});

test("aktör target lists confirmed actors", () => {
  const k = kb();
  const a = runQuery("visa aktörer", k);
  assert.equal(a.query.target, "aktor");
  assert.equal(a.rowCount, k.actors.length);
  assert.match(a.markdown, /# Aktörer/);
});

test("plats target lists relevant locations", () => {
  const k = kb();
  const a = runQuery("vilka platser är hetast?", k);
  assert.equal(a.query.target, "plats");
  assert.equal(a.rowCount, k.places.length);
  assert.match(a.markdown, /# Platser/);
});

test("summary shape returns a situation overview", () => {
  const a = runQuery("sammanfatta läget", kb());
  assert.equal(a.query.shape, "summary");
  assert.match(a.markdown, /# Lägesbild/);
  assert.match(a.markdown, /Rapporter: \d+/);
});

test("observer filter narrows to a call-sign's reports", () => {
  const k = kb();
  const callsign = k.reports.map((r) => r.sagesman).find((s) => /^[A-ZÅÄÖ]{2}$/.test(s ?? ""));
  if (!callsign) return; // corpus without 2-letter call-signs: nothing to assert
  const a = runQuery(`vad har ${callsign} rapporterat?`, k);
  assert.equal(a.query.observer, callsign);
  assert.ok(a.rowCount > 0 && a.rowCount < k.reports.length, "observer filter should narrow, not empty/all");
});

test("query execution is deterministic", () => {
  const k = kb();
  assert.equal(runQuery("återkommande", k).markdown, runQuery("återkommande", k).markdown);
  assert.equal(runQuery("sammanfatta läget", k).markdown, runQuery("sammanfatta läget", k).markdown);
});
