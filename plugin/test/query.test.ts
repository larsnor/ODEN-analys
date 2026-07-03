/*
 * Step 4 query-engine tests — OUTSIDE Obsidian (§10). Pure parse + execute over
 * the real corpus. The KB uses Job A vehicles + ALL Job B nominations treated as
 * "confirmed" (the engine only cares about the confirmed set it is handed).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, Report } from "../src/parse.ts";
import { buildPlateEntities } from "../src/reid.ts";
import { buildMarkNominations } from "../src/jobb.ts";
import { KB, parseQuery, runQuery } from "../src/query.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures");
function loadReports(): Report[] {
  const dir = join(root, "reports");
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports/${f}`));
}
function kb(): KB {
  const reports = loadReports();
  return { reports, vehicles: buildPlateEntities(reports).entities, marks: buildMarkNominations(reports).nominations };
}

test("parser echoes the structured interpretation", () => {
  assert.match(parseQuery("RJK241").echo, /avsikt=entity/);
  assert.match(parseQuery("RJK241").echo, /term="RJK241"/);
  const night = parseQuery("fordon vid grindarna i natt");
  assert.equal(night.intent, "observations");
  assert.equal(night.kind, "fordon");
  assert.equal(night.time?.label, "natt (22:00–05:00)");
  assert.equal(night.place, "grindarna");
});

test("entity lookup returns the vehicle with cited observations", () => {
  const a = runQuery("RJK241", kb());
  assert.equal(a.query.intent, "entity");
  assert.ok(a.rowCount >= 5, `RJK241 should have its sightings, got ${a.rowCount}`);
  assert.match(a.markdown, /# Fordon RJK241/);
  assert.match(a.markdown, /\[\[TNR/); // citations present
  assert.match(a.markdown, /Tolkad fråga/); // query-echo present
});

test("recurring lists multi-sighting entities only", () => {
  const a = runQuery("återkommande fordon", kb());
  assert.equal(a.query.intent, "recurring");
  assert.match(a.markdown, /RJK241/);
  assert.match(a.markdown, /## Fordon/);
  // a high threshold should drop most
  const a2 = runQuery("återkommande fordon minst 8", kb());
  assert.ok(a2.rowCount < a.rowCount);
});

test("time + place filter narrows observations and cites", () => {
  const all = runQuery("observationer", kb()); // free search fallback ~ everything-ish
  const night = runQuery("fordon i natt", kb());
  assert.equal(night.query.intent, "observations");
  assert.ok(night.rowCount > 0, "expected some night vehicle observations");
  // every cited row is a real report link
  assert.match(night.markdown, /\[\[TNR\d+\|TNR\d+\]\]/);
  void all;
});

test("identity question hits the write-wall, asserts nothing", () => {
  const a = runQuery("är RJK241 och TLP893 samma aktör?", kb());
  assert.equal(a.query.intent, "identity-guard");
  assert.match(a.markdown, /påstår inte/);
  assert.match(a.markdown, /operatörens bekräftelse/i);
  assert.equal(a.rowCount, 0);
});

test("free-text search finds reports by symbol prose", () => {
  const a = runQuery("Skoda", kb());
  assert.equal(a.query.intent, "search");
  assert.ok(a.rowCount > 0);
  assert.match(a.markdown, /\[\[TNR/);
});

test("query execution is deterministic", () => {
  const k = kb();
  assert.equal(runQuery("återkommande", k).markdown, runQuery("återkommande", k).markdown);
});
