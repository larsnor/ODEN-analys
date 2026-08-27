/*
 * Bin 1 (oden) v3-output contract — REAL emitted files, not mimicry.
 *
 * fixtures/bin1_v3/ holds reports actually produced by the real intake app
 * (NicklasAndersson/oden v3.1.2, received over Signal 2026-08-26/27; the one
 * phone number is scrubbed, UUIDs kept). They upgrade the Bin 1 contract from
 * the two hand-shared 2026-06 example messages to current, live output — and
 * they carry the app's real defect: v≤3.1.2 mis-converts spaced MGRS grids and
 * writes a stale frontmatter coordinate while the grid in Ställe is correct
 * (fixed upstream in oden PR #257, unreleased at capture time). That makes them
 * the regression anchor for the parser's coordinate cross-check.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ParseIssue, parseReport, Report } from "../src/parse.ts";
import { extractIdentifiers } from "../src/ids.ts";
import { analyzeSuspicion, DEFAULT_SUSPICION } from "../src/suspicion.ts";
import { extractMarks } from "../src/marks.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, "fixtures", "bin1_v3");

function load(): { reports: Report[]; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const reports = readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `bin1_v3/${f}`, issues));
  return { reports, issues };
}

test("real Bin 1 v3 output parses with every contract field populated", () => {
  const { reports } = load();
  assert.ok(reports.length >= 2, "the captured corpus is present");
  for (const r of reports) {
    assert.equal(r.typ, "7S-rapport", r.file);
    assert.match(r.tnr, /^\d{6}$/, `${r.file}: tnr`);
    assert.match(r.tidpunkt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, `${r.file}: tidpunkt`);
    assert.ok(r.id.startsWith("7S-"), `${r.file}: uuid id`);
    assert.ok(r.signalAvsandareId, `${r.file}: signal sender id`);
    assert.ok(r.sagesman, `${r.file}: sagesman`);
    assert.ok(r.handelse, `${r.file}: Händelse prose`);
    assert.match(r.stalle ?? "", /\d{1,2}[C-X][A-Z]{2} \d+ \d+/, `${r.file}: MGRS in Ställe`);
    assert.equal(r.sedan, "-", `${r.file}: Sedan placeholder`);
  }
});

test("v3.1.2 coordinate bug is corrected by the cross-check (grid wins, issue raised)", () => {
  const { reports, issues } = load();
  // Both captured files carry the SAME stale frontmatter coordinate
  // (58.62877,16.72219) regardless of their actual — differing — grids.
  for (const r of reports) {
    assert.equal(r.coordsFromMgrs, true, `${r.file}: grid-derived coords take over`);
  }
  const t27 = reports.find((r) => r.tnr === "271039")!;
  assert.ok(Math.abs((t27.lat ?? 0) - 59.2614) < 1e-3, `Vällingevägen lat ${t27.lat}`);
  const t26 = reports.find((r) => r.tnr === "261132")!;
  assert.ok(Math.abs((t26.lat ?? 0) - 59.3496) < 1e-3, `Teknikringen lat ${t26.lat}`);
  assert.equal(
    issues.filter((i) => /coordinate mismatch/.test(i.message)).length,
    reports.length,
    "one surfaced mismatch per affected file",
  );
});

test("identifiers and marks extract from real prose (sender ids, backpack tell)", () => {
  const { reports } = load();
  const t27 = reports.find((r) => r.tnr === "271039")!;
  const ids = extractIdentifiers(t27);
  assert.ok(ids.some((i) => i.type === "sender"), "signal sender identifier");
  assert.ok(ids.some((i) => i.type === "mgrs" && i.role === "location"), "grid as location id");
  // "grön ryggsäck … Fjällräven logga" — a backpack with colour is detected; the
  // deterministic colour vocabulary (mörk/ljus families only) does not canonise
  // "grön", so it stays non-distinctive — the honest 📝-layer boundary.
  const marks = extractMarks(t27);
  assert.ok(marks.some((m) => m.object === "ryggsack"), "backpack mark detected");
});

test("the recon-phrased report elevates once its position is corrected", () => {
  // TNR271039: "observerade HvSS med kikare" ~250 m from the default AOI at
  // 10:38 — behaviour (observation + optik) + proximity must elevate it. With
  // the UNCORRECTED coordinate (75 km away) proximity would be 0 and the whole
  // point of the cross-check is that this alarm is not lost.
  const { reports } = load();
  const a = analyzeSuspicion(reports, DEFAULT_SUSPICION);
  const row = a.rows.find((r) => r.tnr === "271039")!;
  assert.ok(row.reasons.some((x) => x.key === "proximity" && x.weight === 3), "nära objektet");
  assert.ok(row.reasons.some((x) => x.key === "beteende:optik"), "kikare");
  assert.ok(row.score >= a.threshold, `elevates (score ${row.score})`);
});
