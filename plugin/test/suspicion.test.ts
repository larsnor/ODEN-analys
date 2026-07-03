/*
 * Step 6 suspicion scoring — vs the NEW-format corpus + ground_truth_new.json.
 * Goal: does the transparent score separate the pure-pattern recon team (which
 * the re-id layers miss entirely) from the high-volume civilian background?
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, Report } from "../src/parse.ts";
import { analyzeSuspicion, scoreReport, DEFAULT_SUSPICION } from "../src/suspicion.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures");
const dir = join(root, "reports_new");
const gtPath = join(root, "ground_truth_new.json");
const haveCorpus = existsSync(dir) && existsSync(gtPath);

function load(): { reports: Report[]; truth: Map<string, string> } {
  const reports = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports_new/${f}`));
  const gt = JSON.parse(readFileSync(gtPath, "utf-8")) as { file: string; truth: string }[];
  return { reports, truth: new Map(gt.map((g) => [g.file, g.truth])) };
}
const base = (f: string) => f.replace(/^.*\//, "");

test("scoreReport: recon report scores high, benign civilian low", () => {
  const recon = parseReport(
    ['---', 'id: X', 'typ: 7S-rapport', 'tnr: "150046"', 'tidpunkt: "2026-06-15T03:00:00"', "lat: 59.2615", "lon: 17.7135", "sagesman: AQ", "---",
     "", "**Händelse:** Stod stilla länge och betraktade grindarna, fotograferade mot säteriet.", "", "**Symbol:** mörk hoodie, kamera med teleobjektiv"].join("\n"),
    "x",
  );
  const civ = parseReport(
    ['---', 'id: Y', 'typ: 7S-rapport', 'tnr: "151200"', 'tidpunkt: "2026-06-15T12:00:00"', "lat: 59.242", "lon: 17.756", "sagesman: BQ", "---",
     "", "**Händelse:** Postutdelare på cykel passerade."].join("\n"),
    "y",
  );
  const sr = scoreReport(recon).score;
  const sc = scoreReport(civ).score;
  assert.ok(sr >= 5, `recon score ${sr}`);
  assert.ok(sc < 5, `civilian score ${sc}`);
  assert.ok(sr - sc >= 4, `separation ${sr - sc}`);
});

test("real corpus: suspicion separates the recon team from civilians", { skip: !haveCorpus }, () => {
  const { reports, truth } = load();
  const a = analyzeSuspicion(reports, DEFAULT_SUSPICION);
  const isRecon = (f: string) => truth.get(base(f)) === "recon";

  const reconScores = a.rows.filter((r) => isRecon(r.file)).map((r) => r.score);
  const civScores = a.rows.filter((r) => !isRecon(r.file)).map((r) => r.score);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  assert.ok(mean(reconScores) - mean(civScores) >= 3, `recon ${mean(reconScores).toFixed(1)} vs civ ${mean(civScores).toFixed(1)}`);

  // Recall + precision of the elevated set against the recon team.
  const reconTotal = reconScores.length;
  const elevatedRecon = a.elevated.filter((r) => isRecon(r.file)).length;
  const recall = elevatedRecon / reconTotal;
  const precision = elevatedRecon / a.elevated.length;
  assert.ok(recall >= 0.8, `recon recall ${recall.toFixed(2)} (${elevatedRecon}/${reconTotal})`);
  assert.ok(precision >= 0.8, `precision ${precision.toFixed(2)} (${elevatedRecon}/${a.elevated.length})`);

  // The pattern should concentrate near the protected object.
  assert.ok(a.nearObjectElevated > 0);
});

test("analysis is deterministic", { skip: !haveCorpus }, () => {
  const { reports } = load();
  assert.deepEqual(analyzeSuspicion(reports), analyzeSuspicion(reports));
});
