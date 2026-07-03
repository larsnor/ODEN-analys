/*
 * §6.4 transitive actor derivation — vs the real corpus + ground_truth.json.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, Report } from "../src/parse.ts";
import { buildActorHypotheses } from "../src/actor.ts";
import { renderActorNote } from "../src/actor_notes.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures");
function loadReports(): Report[] {
  const dir = join(root, "reports");
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports/${f}`));
}
function truthByFile(): Map<string, string> {
  const gt = JSON.parse(readFileSync(join(root, "ground_truth.json"), "utf-8")) as { file: string; truth: string }[];
  return new Map(gt.map((g) => [g.file, g.truth]));
}
function base(file: string): string {
  return file.replace(/^.*\//, "");
}

test("derives a transitive actor spanning vehicle + all three mark types", () => {
  const r = buildActorHypotheses(loadReports(), { threshold: 1 });
  assert.ok(r.hypotheses.length >= 1, "expected at least one actor hypothesis");
  const big = r.hypotheses[0]; // sorted largest-first
  // The recon cell: the vehicles that share a cap/logo mark + bag + cap + logo,
  // all transitively linked. NB: a POI vehicle with NO shared mark (SDG417) is
  // correctly NOT pulled in — the actor is bound to evidence, not POI status.
  assert.ok(big.vehicleCount >= 4, `expected the mark-linked POI vehicles, got ${big.vehicleCount}`);
  assert.ok(big.markCount >= 3, `expected bag+cap+logo, got ${big.markCount}`);
  assert.ok(!big.facets.some((f) => f.label === "SDG417"), "SDG417 has no shared mark — must NOT be merged in");
  assert.ok(
    big.types.includes("fordon") &&
      big.types.includes("marke:ryggsack") &&
      big.types.includes("marke:huvudbonad") &&
      big.types.includes("marke:fordon-dekal"),
    `types: ${big.types.join(", ")}`,
  );
});

test("the actor hypothesis contains NO noise reports (§6.1 phantom guard)", () => {
  const r = buildActorHypotheses(loadReports(), { threshold: 1 });
  const truth = truthByFile();
  for (const h of r.hypotheses) {
    const noise = h.reportFiles.filter((f) => truth.get(base(f)) === "noise");
    assert.deepEqual(noise.map(base), [], `actor includes noise reports: ${noise.map(base).join(", ")}`);
  }
});

test("evidence chain is transitive — no single message holds all facets", () => {
  const r = buildActorHypotheses(loadReports(), { threshold: 1 });
  const big = r.hypotheses[0];
  const totalFacets = big.facets.length;
  const maxInOneMessage = Math.max(...big.chain.map((c) => c.facets.length));
  assert.ok(maxInOneMessage < totalFacets, "some message would hold every facet — not a transitive derivation");
  assert.ok(big.chain.length >= 3, "expect a multi-message evidence chain");
  // chain is time-ordered
  for (let i = 1; i < big.chain.length; i++) {
    assert.ok(big.chain[i - 1].tidpunkt <= big.chain[i].tidpunkt, "chain not time-ordered");
  }
});

test("raising the evidence threshold splits/shrinks the component (§9.3-A)", () => {
  const reports = loadReports();
  const lo = buildActorHypotheses(reports, { threshold: 1 });
  const hi = buildActorHypotheses(reports, { threshold: 3 });
  const loMax = Math.max(...lo.hypotheses.map((h) => h.facets.length), 0);
  const hiMax = Math.max(...hi.hypotheses.map((h) => h.facets.length), 0);
  assert.ok(hiMax <= loMax, "higher threshold should not grow the largest component");
});

test("actor derivation is deterministic/idempotent", () => {
  const reports = loadReports();
  assert.deepEqual(buildActorHypotheses(reports, { threshold: 2 }), buildActorHypotheses(reports, { threshold: 2 }));
});

test("confirmed actor note is idempotent and provenance-marked", () => {
  const big = buildActorHypotheses(loadReports(), { threshold: 1 }).hypotheses[0];
  const a = renderActorNote(big);
  const b = renderActorNote(big);
  assert.equal(a.markdown, b.markdown, "same hypothesis → byte-identical note");
  assert.match(a.markdown, /slag: aktör/);
  assert.match(a.markdown, /källa: 7s-plugin/);
  assert.match(a.markdown, /föreslagen-av: deterministisk/);
  assert.match(a.markdown, /bekräftad-av: operatör/);
  assert.match(a.markdown, /metod: aktor/); // per-job pruning tag
  assert.match(a.markdown, /## Evidenskedja/);
  assert.match(a.markdown, /tags: \[aktör\]/); // real Obsidian tag (not `taggar:`)
  assert.doesNotMatch(a.markdown, /taggar:/);
  // Readable graph label + colon-free filename.
  assert.ok(a.filename.startsWith("Aktör ") && a.filename.endsWith(".md"));
  assert.doesNotMatch(a.filename, /[:\\/]/);
});

test("suspect-derived actor carries map coords and a real #aktör tag", () => {
  const big = buildActorHypotheses(loadReports(), { threshold: 1 }).hypotheses[0];
  const withCoords = { ...big, lat: 59.263, lon: 17.711 };
  const md = renderActorNote(withCoords).markdown;
  assert.match(md, /lat: 59.263/);
  assert.match(md, /lon: 17.711/);
  assert.match(md, /location: "59.263,17.711"/);
  assert.match(md, /tags: \[aktör\]/);
});
