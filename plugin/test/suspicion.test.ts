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
import { analyzeSuspicion, scoreReport, DEFAULT_SUSPICION, OPERATOR_FLAG_SIGNAL } from "../src/suspicion.ts";

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

test("confirmedBehaviours (photo/text LLM, operator-confirmed) feed the score, deduped", () => {
  const base = parseReport(
    ['---', 'id: Z', 'typ: 7S-rapport', 'tnr: "020200"', 'tidpunkt: "2026-06-15T02:00:00"', "lat: 59.2615", "lon: 17.7135", "sagesman: AQ", "---",
     "", "**Händelse:** Se bild."].join("\n"),
    "z",
  );
  // Se bild + night(2) + proximity(3) but no text behaviour → elevated only from geo+time.
  const before = scoreReport(base).score;
  // Operator confirms a recon behaviour from the photo/text LLM (+2).
  const withBeh = { ...base, confirmedBehaviours: [{ key: "beteende:optik", label: "hotindikator (foto): kikare", weight: 2 }] };
  assert.equal(scoreReport(withBeh).score, before + 2, "confirmed behaviour adds its weight");
  assert.ok(scoreReport(withBeh).reasons.some((r) => r.key === "beteende:optik"));
  // Deduped against a text keyword that already found the same concept (no double count).
  const dupText = parseReport(
    ['---', 'id: Z2', 'typ: 7S-rapport', 'tnr: "020201"', 'tidpunkt: "2026-06-15T02:00:00"', "lat: 59.2615", "lon: 17.7135", "sagesman: AQ", "---",
     "", "**Händelse:** Betraktade grinden genom kikare."].join("\n"),
    "z2",
  );
  const withDup = { ...dupText, confirmedBehaviours: [{ key: "beteende:optik", label: "x", weight: 2 }] };
  const optikCount = scoreReport(withDup).reasons.filter((r) => r.key === "beteende:optik").length;
  assert.equal(optikCount, 1, "keyword + confirmed same concept → counted once");
});

test("OPERATOR_FLAG_SIGNAL elevates a benign report with the operator-provenance reason", () => {
  const benign = parseReport(
    ['---', 'id: F', 'typ: 7S-rapport', 'tnr: "121200"', 'tidpunkt: "2026-06-15T12:00:00"', "lat: 59.40", "lon: 17.90", "sagesman: AQ", "---",
     "", "**Händelse:** Personbil passerade söderut."].join("\n"),
    "f",
  );
  // Midday, far from the objektet, no behaviour → well below the threshold.
  const before = scoreReport(benign);
  assert.ok(before.score < (DEFAULT_SUSPICION.threshold ?? 5), "fixture must start un-elevated");
  // The operator flags the report (file-menu) → the signal rides confirmedBehaviours.
  const flagged = { ...benign, confirmedBehaviours: [OPERATOR_FLAG_SIGNAL] };
  const after = scoreReport(flagged);
  assert.ok(after.score >= 9, "flag alone reaches the Hög band");
  assert.ok(after.reasons.some((r) => r.key === "operatörsflagga" && r.label === "flaggad av operatör"));
  // Idempotent: injecting twice cannot double-count (dedup by key).
  const twice = { ...benign, confirmedBehaviours: [OPERATOR_FLAG_SIGNAL, OPERATOR_FLAG_SIGNAL] };
  assert.equal(scoreReport(twice).score, after.score);
});
