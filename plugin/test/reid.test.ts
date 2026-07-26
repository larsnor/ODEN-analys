/*
 * Plate re-identification tests — run OUTSIDE Obsidian.
 * Measures the deterministic core against the real corpus + ground_truth.json.
 *
 *   npm test
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, Report } from "../src/parse.ts";
import { buildPlateEntities } from "../src/reid.ts";
import { renderEntityNote } from "../src/entity_notes.ts";
import { GroundTruthRow, scoreJobA } from "./scoring.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures");
const reportsDir = join(root, "reports");

function loadReports(): Report[] {
  return readdirSync(reportsDir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseReport(readFileSync(join(reportsDir, f), "utf-8"), `reports/${f}`));
}

function loadGroundTruth(): GroundTruthRow[] {
  return JSON.parse(readFileSync(join(root, "ground_truth.json"), "utf-8"));
}

test("de-hardcoded resolution: partials resolve only to OBSERVED fulls", () => {
  const reports = [
    mkReport("A", "140000", "[[RJK241]]"), // full observed
    mkReport("B", "140100", "[[.JK..1]]"), // partial → RJK241
    mkReport("C", "140200", "[[ZZZ99Z]]"), // unrelated full
    mkReport("D", "140300", "[[XXX00X]]"), // partial-shaped? no, it's a full-shaped
  ];
  const r = buildPlateEntities(reports);
  const rjk = r.entities.find((e) => e.canonical === "RJK241");
  assert.ok(rjk, "RJK241 entity should exist");
  assert.equal(rjk!.count, 2, "full + resolved partial merged");
  assert.deepEqual(rjk!.resolvedPartials, [".JK..1"]);
});

test("partial with no observed full stays its own partial entity", () => {
  const reports = [mkReport("A", "140000", "[[QWX..1]]")]; // only a partial, no full
  // NB: Q is excluded from plate letters, so QWX is not a valid plate → mark.
  // Use a valid-letter partial instead:
  const reports2 = [mkReport("A", "140000", "[[RJK..1]]")];
  const r = buildPlateEntities(reports2);
  assert.equal(r.entities.length, 1);
  assert.equal(r.entities[0].slag, "fordon-reg-partiell");
  assert.equal(r.unresolvedPartials.length, 1);
  assert.equal(reports.length, 1); // silence unused
});

test("ambiguous partial is nominated, never auto-merged", () => {
  const reports = [
    mkReport("A", "140000", "[[RJK241]]"),
    mkReport("B", "140100", "[[RJK247]]"),
    mkReport("C", "140200", "[[RJK24.]]"), // matches BOTH fulls → ambiguous
  ];
  const r = buildPlateEntities(reports);
  // Two full entities, each with just their own sighting (no merge of C).
  const rjk241 = r.entities.find((e) => e.canonical === "RJK241");
  const rjk247 = r.entities.find((e) => e.canonical === "RJK247");
  assert.equal(rjk241!.count, 1, "ambiguous partial must NOT merge into RJK241");
  assert.equal(rjk247!.count, 1, "ambiguous partial must NOT merge into RJK247");
  assert.equal(r.ambiguous.length, 1);
  assert.deepEqual(r.ambiguous[0].candidates, ["RJK241", "RJK247"]);
  const partialEnt = r.entities.find((e) => e.canonical === "RJK24.");
  assert.ok(partialEnt && partialEnt.candidateFulls.length === 2);
});

test("real corpus: all 5 tracked plates recovered, 0 false merges", () => {
  const reports = loadReports();
  const gt = loadGroundTruth();
  const result = buildPlateEntities(reports);
  const score = scoreJobA(result, gt);

  // The dangerous failure mode: zero phantom merges.
  assert.equal(score.falseMerges, 0, `false merges: ${score.falseMergeDetails.join("; ")}`);
  assert.equal(score.precision, 1);

  // All 5 tracked plates fully recovered, every GT sighting clustered.
  assert.equal(score.truePlates, 5);
  assert.equal(score.truePlatesRecovered, 5, "all 5 tracked plates should be recovered");
  assert.equal(score.correctlyClustered, score.plateReports, "every GT plate report clustered");
  assert.equal(score.clusterRecall, 1);

  // Every masked partial sighting resolved to the correct full.
  assert.equal(score.partialsResolvedCorrectly, score.partialReports);
  assert.equal(score.partialRecall, 1);
  assert.ok(score.partialReports >= 8, `expected the masked partials, got ${score.partialReports}`);
});

test("real corpus: recurring vehicles clustered, most noise stays singleton", () => {
  const reports = loadReports();
  const result = buildPlateEntities(reports);
  const multi = result.entities.filter((e) => e.count > 1);
  const singles = result.entities.filter((e) => e.count === 1);
  const canon = new Set(multi.map((e) => e.canonical));

  // The 5 POI plates and the 4 recurring commuter plates must all cluster.
  for (const p of ["PMR556", "RJK241", "SDG417", "TLP893", "WBN84X"]) {
    assert.ok(canon.has(p), `POI plate ${p} should be a recurring entity`);
  }
  for (const p of ["ABC123", "DEF456", "GHK78L", "MRT902"]) {
    // Commuters recur as the same full-plate vehicle — plate re-identification
    // clusters them; down-ranking them as benign is a later (suspicion) concern.
    assert.ok(canon.has(p), `commuter plate ${p} should be a recurring entity`);
  }
  // The vast majority of noise plates are unique singletons (75 in this corpus).
  assert.ok(singles.length > 50, `expected many noise singletons, got ${singles.length}`);
});

test("entity-note rendering is idempotent and provenance-marked", () => {
  const reports = loadReports();
  const result = buildPlateEntities(reports);
  const rjk = result.entities.find((e) => e.canonical === "RJK241")!;
  const a = renderEntityNote(rjk);
  const b = renderEntityNote(rjk);
  assert.equal(a.markdown, b.markdown, "same entity → byte-identical note");
  assert.match(a.markdown, /generator: 7s-plugin/);
  assert.match(a.markdown, /källa: 7s-plugin/);
  assert.match(a.markdown, /föreslagen-av: deterministisk/);
  assert.match(a.markdown, /## Observationer/);
  assert.equal(a.filename, "RJK241.md");
  // a partial entity's filename has dots replaced
  const partial = { ...rjk, canonical: "R.K24.", slag: "fordon-reg-partiell" as const };
  assert.equal(renderEntityNote(partial).filename, "R_K24_.md");
});

// --- helpers ---
function mkReport(id: string, tnr: string, symbol: string): Report {
  const text = [
    "---",
    `id: ${id}`,
    "typ: 7S-rapport",
    "källa: bin1-intag",
    `tnr: "${tnr}"`,
    `tidpunkt: "2026-02-14T${tnr.slice(2, 4)}:${tnr.slice(4, 6)}:00"`,
    'plats: "Testplats"',
    "sagesman: AQ",
    "---",
    "",
    `**Symbol:** fordon, reg ${symbol}.`,
  ].join("\n");
  return parseReport(text, `reports/TNR${tnr}.md`);
}
