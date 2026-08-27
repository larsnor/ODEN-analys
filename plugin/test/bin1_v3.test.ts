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
import { extractIdentifiers, plateIdentifiers } from "../src/ids.ts";
import { buildPlateEntities } from "../src/reid.ts";
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
    // Collision suffix rides in the frontmatter tnr per spec ("271425_3") —
    // verified live: two resends on the same TNR → _2/_3 files.
    assert.match(r.tnr, /^\d{6}(_\d+)?$/, `${r.file}: tnr`);
    assert.match(r.tidpunkt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/, `${r.file}: tidpunkt`);
    assert.ok(r.id.startsWith("7S-"), `${r.file}: uuid id`);
    assert.ok(r.signalAvsandareId, `${r.file}: signal sender id`);
    assert.ok(r.sagesman, `${r.file}: sagesman`);
    // Either format: free-prose Händelse, or the legacy telegraphic trio
    // (the live E2E deliberately exercised both — M2/TNR271415 is legacy).
    assert.ok(
      r.handelse || (r.styrka && r.slag && r.sysselsattning),
      `${r.file}: Händelse or Styrka/Slag/Sysselsättning`,
    );
    assert.match(r.stalle ?? "", /\d{1,2}[C-X][A-Z]{2} \d+ \d+/, `${r.file}: MGRS in Ställe`);
    // Sedan is "-" when sent, absent when the sender omitted the line.
    assert.ok(r.sedan === "-" || r.sedan === undefined, `${r.file}: Sedan`);
  }
});

test("v3.1.2 coordinate bug is corrected by the cross-check (grid wins, issue raised)", () => {
  const { reports, issues } = load();
  // The ≤3.1.2 captures all carry the SAME stale coordinate (58.62877,16.72219)
  // regardless of their — differing — grids; the bare-grid file (TNR271420, no
  // comma in Ställe → oden writes no coords) is plain grid-derived instead.
  // TNR271425_3 was captured AFTER the snapshot upgrade (#257) and is asserted
  // separately below. Either way every position ends up correct.
  const MISMATCH_RESCUED = ["271039", "261132", "271436", "271415"];
  for (const tnr of [...MISMATCH_RESCUED, "271420"]) {
    const r = reports.find((x) => x.tnr === tnr)!;
    assert.equal(r.coordsFromMgrs, true, `${r.file}: grid-derived coords take over`);
  }
  for (const [tnr, lat] of [
    ["271039", 59.2614], // Vällingevägen (2026-08-26 capture)
    ["261132", 59.3496], // Teknikringen
    ["271436", 59.2614], // E2E M1 — live re-confirmation of the same stale coord
    ["271420", 59.2614], // E2E M3 — bare grid, no frontmatter coords at all
  ] as const) {
    const r = reports.find((x) => x.tnr === tnr)!;
    assert.ok(Math.abs((r.lat ?? 0) - lat) < 1e-3, `${tnr}: lat ${r.lat}`);
  }
  assert.equal(
    issues.filter((i) => /coordinate mismatch/.test(i.message)).length,
    MISMATCH_RESCUED.length,
    "one surfaced mismatch per file that HAD (wrong) frontmatter coords",
  );
});

test("post-upgrade capture (snapshot ≥ #245+#257): image embed present, coords correct at source, cross-check silent", () => {
  const { reports } = load();
  // E2E M4, captured AFTER the oden snapshot upgrade: the same message that
  // v3.1.2 wrote WITHOUT its photo and with the stale coordinate.
  const r = reports.find((x) => x.tnr === "271425_3")!;
  // #245: the attachment rides as a ## Bilagor embed (the jpg itself is NOT
  // committed — real photo; the repo takes numbers, never images).
  assert.equal(r.embeds.length, 1, "one image embed");
  assert.match(r.embeds[0], /\.jpg$/i);
  // #257: frontmatter coords now agree with the Ställe grid → the cross-check
  // keeps them verbatim and stays silent.
  assert.equal(r.coordsFromMgrs, false, "frontmatter kept — no rescue needed");
  assert.ok(Math.abs((r.lat ?? 0) - 59.2614) < 1e-3, `lat ${r.lat}`);
});

test("E2E M2+M3: Bin 1 links the full plate but NOT the dot-edged partial — prose rescue re-identifies it", () => {
  const { reports } = load();
  // M2 (TNR271415): oden wrapped the full plate → a [[RJK241]] link.
  const m2 = reports.find((r) => r.tnr === "271415")!;
  assert.ok(m2.links.some((l) => l.raw === "RJK241" && l.kind === "plate-full"), "full plate linked by Bin 1");
  // M3 (TNR271420): "reg RJK2.." stayed plain prose (their \b regex cannot match
  // a dot-edged mask) — the prose scanner must pick it up as a partial.
  const m3 = reports.find((r) => r.tnr === "271420")!;
  assert.equal(m3.links.length, 0, "Bin 1 did not link the partial");
  const partial = plateIdentifiers(m3).find((p) => p.partial);
  assert.equal(partial?.value, "RJK2..", "prose partial extracted");
  // End to end: the partial resolves uniquely against the observed full → the
  // sighting merges into RJK241 (this is the live E2E case that failed).
  const jobA = buildPlateEntities(reports);
  const rjk = jobA.entities.find((e) => e.canonical === "RJK241")!;
  assert.equal(rjk.count, 2, "M3's masked sighting merged into RJK241");
  assert.deepEqual(rjk.resolvedPartials, ["RJK2.."]);
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
