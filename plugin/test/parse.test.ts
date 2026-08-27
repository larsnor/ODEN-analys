/*
 * Parser tests — run OUTSIDE Obsidian.
 * Uses Node's built-in test runner; no test framework dependency.
 *
 *   npm test        (node --test --import tsx test/*.test.ts)
 *
 * Fixtures are the real generated corpus in ../../reports.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { classifyLink, parseMapSeed, parseReport } from "../src/parse.ts";

const here = dirname(fileURLToPath(import.meta.url));
const reportsDir = join(here, "fixtures", "reports");

function loadCorpus() {
  const files = readdirSync(reportsDir).filter((f) => f.endsWith(".md"));
  const issues: import("../src/parse.ts").ParseIssue[] = [];
  const reports = files.map((f) =>
    parseReport(readFileSync(join(reportsDir, f), "utf-8"), `reports/${f}`, issues),
  );
  return { reports, issues, files };
}

test("classifyLink distinguishes full / partial plates / marks", () => {
  assert.equal(classifyLink("RJK241"), "plate-full");
  assert.equal(classifyLink("WBN84X"), "plate-full");
  assert.equal(classifyLink("...24."), "plate-partial");
  assert.equal(classifyLink("..G41."), "plate-partial");
  assert.equal(classifyLink("logotyp-fragment DGE"), "mark");
  assert.equal(classifyLink("keps mörk med ljust emblem"), "mark");
  // alias form "[[target|alias]]" classifies on the target.
  assert.equal(classifyLink("RJK241|RJK 241"), "plate-full");
});

test("parses the documented minimal example", () => {
  const text = [
    "---",
    "id: 7S-004",
    "typ: 7S-rapport",
    "källa: bin1-intag",
    'tnr: "140755"',
    'tidpunkt: "2026-02-14T07:55:00"',
    'plats: "Vägren E4 avfart söderut"',
    "lat: 59.25401",
    "lon: 17.69812",
    "sagesman: CQ",
    'location: "59.25401,17.69812"',
    'bilagor: ["bild_140755.jpg"]',
    "---",
    "",
    "**TNR:** 140755",
    "",
    "**Slag:** Fordon + person",
    "",
    "**Symbol:** mörkröd Toyota Avensis, reg [[..G41.]]. [[logotyp-fragment DGE]].",
    "",
    "**Sagesman:** CQ",
    "",
    "![[bild_140755.jpg]]",
  ].join("\n");

  const r = parseReport(text, "reports/TNR140755.md");
  assert.equal(r.id, "7S-004");
  assert.equal(r.tnr, "140755");
  assert.equal(r.källa, "bin1-intag");
  assert.equal(r.tidpunkt, "2026-02-14T07:55:00");
  assert.equal(r.lat, 59.25401);
  assert.equal(r.lon, 17.69812);
  assert.equal(r.slag, "Fordon + person");
  assert.deepEqual(r.bilagor, ["bild_140755.jpg"]);
  assert.deepEqual(r.embeds, ["bild_140755.jpg"]);
  // two links in Symbol; embed is NOT counted as a link.
  assert.equal(r.links.length, 2);
  assert.equal(r.links[0].raw, "..G41.");
  assert.equal(r.links[0].kind, "plate-partial");
  assert.equal(r.links[1].kind, "mark");
});

test("real corpus parses without fatal gaps", () => {
  const { reports, issues, files } = loadCorpus();
  assert.ok(files.length >= 100, `expected a sizeable corpus, got ${files.length}`);
  // Every report must have an id and tnr (FORMAT_SPEC hard requirements).
  assert.deepEqual(issues, [], `unexpected parse issues: ${JSON.stringify(issues.slice(0, 5))}`);
  for (const r of reports) {
    assert.notEqual(r.id, "", `${r.file} missing id`);
    assert.notEqual(r.tnr, "", `${r.file} missing tnr`);
    assert.notEqual(r.tidpunkt, "", `${r.file} missing tidpunkt`);
  }
});

test("real corpus carries bin1-intag provenance and plate links", () => {
  const { reports } = loadCorpus();
  const bin1 = reports.filter((r) => r.källa === "bin1-intag");
  assert.ok(bin1.length > 0, "expected bin1-intag provenance on the corpus");

  // The scenario seeds plates; we should see at least some full or partial links.
  const plateLinks = reports.reduce(
    (n, r) => n + r.links.filter((l) => l.kind === "plate-full" || l.kind === "plate-partial").length,
    0,
  );
  assert.ok(plateLinks > 0, "expected some plate links in the corpus");
});

test("coordinate-less report omits lat/lon/location cleanly", () => {
  const text = [
    "---",
    "id: 7S-099",
    "typ: 7S-rapport",
    'tnr: "150000"',
    'tidpunkt: "2026-02-15T00:00:00"',
    'plats: "Okänd plats"',
    "sagesman: AQ",
    "---",
    "",
    "**Symbol:** inga särskilda kännetecken.",
  ].join("\n");
  const r = parseReport(text, "x.md");
  assert.equal(r.lat, undefined);
  assert.equal(r.lon, undefined);
  assert.equal(r.symbol, "inga särskilda kännetecken.");
  assert.equal(r.links.length, 0);
});

// --- coordinate cross-check (Bin 1 ≤3.1.2 emits wrong frontmatter coords for
// --- spaced MGRS grids while the grid in Ställe is correct) ------------------

/** Report text with frontmatter coords + an MGRS grid in Ställe. */
function coordReport(lat: number, lon: number, stalle: string): string {
  return [
    "---", "id: C1", "typ: 7S-rapport", 'tnr: "271039"', 'tidpunkt: "2026-08-27T10:38:00"',
    'plats: "Vällingevägen"', `lat: ${lat}`, `lon: ${lon}`, "sagesman: AQ", "---",
    "", "**TNR:** 271039", "", `**Ställe:** ${stalle}`, "",
    "**Händelse:** En man observerade grinden.", "",
  ].join("\n");
}

test("coordinate cross-check: gross frontmatter/grid mismatch → grid wins + issue", () => {
  // The REAL TNR271039 shape: grid 33VXF 54366 72296 (≈59.261,17.708 — Vällinge)
  // but frontmatter says 58.62877,16.72219 (~75 km off, the intake-app bug).
  const issues: import("../src/parse.ts").ParseIssue[] = [];
  const r = parseReport(coordReport(58.62877, 16.72219, "33VXF 54366 72296, Vällingevägen"), "c1.md", issues);
  assert.equal(r.coordsFromMgrs, true, "grid-derived coords take over");
  assert.ok(Math.abs((r.lat ?? 0) - 59.2614) < 1e-3, `lat ${r.lat}`);
  assert.ok(Math.abs((r.lon ?? 0) - 17.70788) < 1e-3, `lon ${r.lon}`);
  assert.equal(issues.length, 1, "the disagreement is surfaced");
  assert.match(issues[0].message, /coordinate mismatch/);
  assert.match(issues[0].message, /km/);
});

test("coordinate cross-check: agreeing coords are kept verbatim, no issue", () => {
  // Frontmatter ~200 m from the grid centre (legitimate precision difference).
  const issues: import("../src/parse.ts").ParseIssue[] = [];
  const r = parseReport(coordReport(59.263, 17.709, "33VXF 54366 72296, Vällingevägen"), "c2.md", issues);
  assert.equal(r.coordsFromMgrs, false);
  assert.equal(r.lat, 59.263, "frontmatter kept exactly");
  assert.equal(r.lon, 17.709);
  assert.deepEqual(issues, []);
});

test("coordinate cross-check: no grid in Ställe → frontmatter kept, unchanged behaviour", () => {
  const issues: import("../src/parse.ts").ParseIssue[] = [];
  const r = parseReport(coordReport(58.62877, 16.72219, "Vägren vid grinden"), "c3.md", issues);
  assert.equal(r.coordsFromMgrs, false);
  assert.equal(r.lat, 58.62877);
  assert.deepEqual(issues, []);
});

test("parseMapSeed: a Map View 'New note here' note is a seed; reports/owned notes are not", () => {
  // Exactly what Map View "New note here (front matter)" writes.
  const seed = parseMapSeed('---\nlocation: "59.2622,17.712"\n---\n\n');
  assert.deepEqual(seed, { lat: 59.2622, lon: 17.712 });
  // Array form Map View also reads.
  assert.deepEqual(parseMapSeed("---\nlocation: [59.2622, 17.712]\n---\n"), { lat: 59.2622, lon: 17.712 });
  // Obsidian property-editor style: single-element array holding the pair.
  assert.deepEqual(parseMapSeed('---\nlocation: ["59.2622,17.712"]\n---\n'), { lat: 59.2622, lon: 17.712 });

  // A 7S report is NOT a seed (typ present).
  assert.equal(parseMapSeed('---\ntyp: 7S-rapport\nlocation: "59.2,17.7"\n---\n'), null);
  // A plugin-owned note is NOT a seed (generator present).
  assert.equal(parseMapSeed('---\ngenerator: 7s-plugin\nlocation: "59.2,17.7"\n---\n'), null);
  // No location / no frontmatter / junk location → null.
  assert.equal(parseMapSeed("---\nnamn: test\n---\n"), null);
  assert.equal(parseMapSeed("Bara brödtext."), null);
  assert.equal(parseMapSeed('---\nlocation: "här"\n---\n'), null);
  assert.equal(parseMapSeed('---\nlocation: "959.0,17.0"\n---\n'), null, "out-of-range lat rejected");
});
