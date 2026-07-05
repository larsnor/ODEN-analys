/*
 * Out-of-distribution re-identification measurement.
 *
 * Runs the mark layer over an INDEPENDENT corpus (a second generator config, with
 * --varied-marks: each member's tell is PARAPHRASED across sightings and the truth
 * is the objective `member` label, not a hand annotation). Prints re-id
 * precision/recall + the category ceiling for us to judge. Asserts ONLY the
 * corpus-independent safety property: no distinctive mark is fabricated on a
 * civilian. Behaviour of the detector is unchanged — this only measures it.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, Report } from "../src/parse.ts";
import { scoreReid, formatReidReport, ReidGT } from "./scoring_reid.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures", "ood");

function loadReports(): Report[] {
  const dir = join(root, "reports");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `ood/reports/${f}`));
}
function loadGT(): ReidGT[] {
  return JSON.parse(readFileSync(join(root, "ground_truth.json"), "utf-8"));
}

test("OOD re-id: measure precision/recall + category ceiling (printed), assert only safety", () => {
  const s = scoreReid(loadReports(), loadGT());
  console.log("\n" + formatReidReport(s) + "\n");

  // The one corpus-independent guarantee: the detector must not manufacture a
  // distinctive mark on a civilian (precision fails safe on noise).
  assert.equal(
    s.falseMarksOnCivil.length,
    0,
    `distinctive marks fabricated on civilians: ${s.falseMarksOnCivil.join(" ; ")}`,
  );
});
