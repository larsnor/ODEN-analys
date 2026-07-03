/*
 * Job B nomination + scoring vs the real corpus + ground_truth.json (§10).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, Report } from "../src/parse.ts";
import { extractNormalized } from "../src/marks.ts";
import { buildMarkNominations } from "../src/jobb.ts";
import { renderMarkNote } from "../src/mark_notes.ts";
import { GroundTruthRow, scoreJobB } from "./scoring.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures");

function loadReports(): Report[] {
  const dir = join(root, "reports");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports/${f}`));
}
function loadGroundTruth(): GroundTruthRow[] {
  return JSON.parse(readFileSync(join(root, "ground_truth.json"), "utf-8"));
}

test("Job B: full extraction recall over GT tell instances", () => {
  const reports = loadReports();
  const gt = loadGroundTruth();
  const marks = extractNormalized(reports);
  const result = buildMarkNominations(reports);
  const s = scoreJobB(result, marks, gt);

  assert.ok(s.tellInstances >= 30, `expected the tell instances, got ${s.tellInstances}`);
  assert.equal(s.tellInstancesFound, s.tellInstances, `missed tells; recallByCat=${JSON.stringify(s.recallByCategory)}`);
  assert.equal(s.extractionRecall, 1);
});

test("Job B: no distinctive false marks on noise/commuter (precision)", () => {
  const reports = loadReports();
  const gt = loadGroundTruth();
  const marks = extractNormalized(reports);
  const result = buildMarkNominations(reports);
  const s = scoreJobB(result, marks, gt);
  assert.equal(s.falseMarks, 0, `false marks: ${s.falseMarkDetails.slice(0, 8).join(" | ")}`);
  assert.equal(s.extractionPrecision, 1);
});

test("Job B: each tell category collapses to exactly one signature", () => {
  const reports = loadReports();
  const gt = loadGroundTruth();
  const marks = extractNormalized(reports);
  const result = buildMarkNominations(reports);
  const s = scoreJobB(result, marks, gt);
  for (const [cat, n] of Object.entries(s.signaturesPerCategory)) {
    assert.equal(n, 1, `category ${cat} produced ${n} signatures (expected 1)`);
  }
});

test("Job B: nominations clean — zero noise, full pair precision/recall", () => {
  const reports = loadReports();
  const gt = loadGroundTruth();
  const marks = extractNormalized(reports);
  const result = buildMarkNominations(reports);
  const s = scoreJobB(result, marks, gt);

  // The §6.1 hard assertion (analogue of Job A's zero false merges).
  assert.equal(s.noiseInNominations, 0, s.noiseNominationDetails.join(" | "));
  assert.equal(s.nominationPairPrecision, 1, "a nominated pair did not share the GT tell");
  assert.equal(s.nominationPairRecall, 1, "some same-tell report pair was not nominated together");

  // Exactly the three recon-cell marks should be nominated (one per category).
  const cats = result.nominations.map((n) => n.object).sort();
  assert.deepEqual(cats, ["fordon-dekal", "huvudbonad", "ryggsack"]);
});

test("Job B: nomination is deterministic/idempotent", () => {
  const reports = loadReports();
  assert.deepEqual(buildMarkNominations(reports), buildMarkNominations(reports));
});

test("Job B: confirmed mark note is idempotent and provenance-marked", () => {
  const reports = loadReports();
  const result = buildMarkNominations(reports);
  const cap = result.nominations.find((n) => n.object === "huvudbonad")!;
  const a = renderMarkNote(cap);
  const b = renderMarkNote(cap);
  assert.equal(a.markdown, b.markdown, "same nomination → byte-identical note");
  // Two provenance axes, both present (§6.4).
  assert.match(a.markdown, /källa: 7s-plugin/);
  assert.match(a.markdown, /föreslagen-av: deterministisk/);
  assert.match(a.markdown, /bekräftad-av: operatör/);
  assert.match(a.markdown, /metod: jobb-b/); // per-job pruning tag
  assert.match(a.markdown, /slag: kannetecken/);
  assert.ok(a.filename.startsWith("marke-") && a.filename.endsWith(".md"));
});
