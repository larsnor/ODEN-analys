/*
 * "Genomför analys" — the pure report layer (src/report.ts): date ranges,
 * range recomputation, tier-1 note, the complete-roster LLM digest, context
 * sizing, citation guards, and the E19 collation export.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  analyzeRange,
  buildE19Rows,
  buildLlmDigest,
  buildTier1Report,
  computeNumCtx,
  DateRange,
  DEEP_PLACEHOLDER,
  filterReports,
  normalizeRange,
  presetRange,
  renderE19Csv,
  renderReportNote,
  reportFilename,
  ReportNoteInput,
  sanitizeHypotheses,
  buildDeepPrompt,
  looksLikeHypotheses,
  pickDeepModel,
} from "../src/report.ts";
import { parseReport, Report } from "../src/parse.ts";
import { PluginState } from "../src/derive.ts";
import { SuspicionOpts } from "../src/suspicion.ts";

const here = dirname(fileURLToPath(import.meta.url));
const PROT: SuspicionOpts = { protectedLat: 59.0, protectedLon: 17.0, threshold: 5 };

function report(over: Partial<Report>): Report {
  return {
    id: over.tnr ?? "x", typ: "7S-rapport", tnr: over.tnr ?? "000000",
    tidpunkt: "2026-06-16T12:00:00", plats: "Vägen", lat: 59.001, lon: 17.0,
    sagesman: "AQ", links: [], embeds: [], file: `inkorg/TNR${over.tnr ?? "000000"}.md`, ...over,
  } as Report;
}

function state(over: Partial<PluginState> = {}): PluginState {
  return {
    entitiesFolder: "entities",
    locationNicknames: {}, locationMerges: {}, locationNameAsked: {},
    actorNames: {}, actorMerges: {}, actorDecisions: {}, markDecisions: {},
    actorThreshold: 1, ...over,
  };
}

const RANGE: DateRange = normalizeRange("2026-06-16T00:00", "2026-06-16T23:59")!;

// --- ranges -------------------------------------------------------------------

test("normalizeRange: inclusive bounds — a :59-second report is inside", () => {
  const r = normalizeRange("2026-06-16T09:00", "2026-06-16T09:53")!;
  assert.equal(r.from, "2026-06-16T09:00:00");
  assert.equal(r.to, "2026-06-16T09:53:59");
  assert.equal(filterReports([report({ tidpunkt: "2026-06-16T09:53:41" })], r).length, 1);
  assert.equal(filterReports([report({ tidpunkt: "2026-06-16T09:54:00" })], r).length, 0);
});

test("normalizeRange: from after to, or garbage, → null", () => {
  assert.equal(normalizeRange("2026-06-17T00:00", "2026-06-16T00:00"), null);
  assert.equal(normalizeRange("igår", "idag"), null);
});

test("presetRange anchors to the NEWEST report, not the wall clock", () => {
  const reports = [
    report({ tnr: "1", tidpunkt: "2026-06-10T08:00:00" }),
    report({ tnr: "2", tidpunkt: "2026-06-16T20:30:00" }),
  ];
  const dygn = presetRange("dygn", reports)!;
  assert.equal(dygn.to, "2026-06-16T20:30:59");
  assert.equal(dygn.from, "2026-06-15T20:30:00");
  const allt = presetRange("allt", reports)!;
  assert.ok(allt.from <= "2026-06-10T08:00:00" && allt.to >= "2026-06-16T20:30:00");
  assert.equal(presetRange("vecka", []), null);
});

// --- recompute ------------------------------------------------------------------

test("analyzeRange recomputes on the filtered set — out-of-range observations vanish", () => {
  const mk = (tnr: string, tidpunkt: string) =>
    report({ tnr, tidpunkt, handelse: "Bil RJK241 passerade.", file: `inkorg/TNR${tnr}.md` });
  const all = [mk("1", "2026-06-14T10:00:00"), mk("2", "2026-06-15T10:00:00"), mk("3", "2026-06-16T10:00:00")];
  const a = analyzeRange(all, RANGE, PROT, state());
  assert.equal(a.reports.length, 1);
  assert.equal(a.jobA.entities.length, 1);
  assert.equal(a.jobA.entities[0].count, 1, "entity count reflects ONLY in-range observations");
});

// --- tier-1 note ------------------------------------------------------------------

function noteInput(over: Partial<ReportNoteInput> = {}): ReportNoteInput {
  const all = [
    report({ tnr: "160300", tidpunkt: "2026-06-16T03:00:00", handelse: "Person klippte i stängslet.", plats: "Grinden" }),
    report({ tnr: "161200", tidpunkt: "2026-06-16T12:00:00", handelse: "Bil RJK241 parkerade.", plats: "Vägen" }),
  ];
  return {
    analysis: analyzeRange(all, RANGE, PROT, state()),
    state: state(),
    photoRows: [],
    generatedAt: "2026-09-04T12:00:00",
    operationName: "Övning",
    build: "1.3.0",
    ...over,
  };
}

test("tier-1: all sections present, larm cited, empty sections say so honestly", () => {
  const md = buildTier1Report(noteInput());
  for (const h of ["## Larm", "## Tidslinje", "## Återkommande fordon", "## Aktörer", "## Kännetecken", "## Platser", "## Bildfynd"]) {
    assert.ok(md.includes(h), h);
  }
  assert.match(md, /\[\[TNR160300\|TNR160300\]\]/, "night sabotage near objektet is elevated and cited");
  assert.ok(md.includes("_Inga bildfynd i perioden._"));
});

test("tier-1: hostile plats/handelse text is neutralized by mdText", () => {
  const evil = report({
    tnr: "160301", tidpunkt: "2026-06-16T03:10:00",
    handelse: "Klippte upp stängslet [länk](https://evil) [[injicerad]]", plats: "x](https://evil)",
  });
  const i = noteInput({ analysis: analyzeRange([evil], RANGE, PROT, state()) });
  const md = buildTier1Report(i);
  assert.ok(!md.includes("](https://evil)"), "markdown link syntax defused");
});

test("renderReportNote: frontmatter + provenance + deep placeholder/absence", () => {
  const plain = renderReportNote(noteInput());
  assert.match(plain, /typ: analysrapport/);
  assert.match(plain, /period-fran: "2026-06-16T00:00:00"/);
  assert.ok(plain.includes("_Ej begärd._"));
  assert.match(plain, /\*\*Meddelanden:\*\* .*TNR160300/, "provenance lists every message");
  const deep = renderReportNote(noteInput({ deep: { model: "qwen3-vl:4b", promptV: "1", numCtx: 16384, numCtxWhy: "auto" } }));
  assert.ok(deep.includes(DEEP_PLACEHOLDER));
  assert.match(deep, /modell: "qwen3-vl:4b"/);
});

test("reportFilename: date span + collision suffixes, no illegal chars", () => {
  const seen = new Set<string>(["Analys 2026-06-16–2026-06-16.md"]);
  const name = reportFilename(RANGE, (n) => seen.has(n));
  assert.equal(name, "Analys 2026-06-16–2026-06-16 (2).md");
  assert.ok(!/[:*?"<>|\\]/.test(name));
});

// --- digest + context sizing -------------------------------------------------------

test("digest: COMPLETE roster — every filtered report's TNR appears, flagged or not", () => {
  const all = Array.from({ length: 40 }, (_, i) =>
    report({ tnr: `16${String(1000 + i).slice(1)}`, tidpunkt: `2026-06-16T10:${String(i % 60).padStart(2, "0")}:00`, handelse: `Helt vanlig händelse ${i}.` }),
  );
  const a = analyzeRange(all, RANGE, PROT, state());
  const plan = buildLlmDigest(a, state(), 1_000_000);
  assert.equal(plan.chunked, false);
  const text = (plan as { chunked: false; text: string }).text;
  for (const r of all) assert.ok(text.includes(`[[TNR${r.tnr}]]`), r.tnr);
});

test("digest: chunks per day only when over budget; chunks keep every message", () => {
  const all = [
    report({ tnr: "150900", tidpunkt: "2026-06-15T09:00:00", handelse: "A".repeat(400) }),
    report({ tnr: "160900", tidpunkt: "2026-06-16T09:00:00", handelse: "B".repeat(400) }),
  ];
  const wide = normalizeRange("2026-06-15T00:00", "2026-06-16T23:59")!;
  const a = analyzeRange(all, wide, PROT, state());
  const plan = buildLlmDigest(a, state(), 300);
  assert.equal(plan.chunked, true);
  const chunks = (plan as { chunked: true; chunks: { label: string; text: string }[] }).chunks;
  assert.equal(chunks.length, 2);
  assert.ok(chunks[0].text.includes("[[TNR150900]]") && chunks[1].text.includes("[[TNR160900]]"));
});

test("computeNumCtx: floor 8192, RAM tier, model cap, need wins when small", () => {
  const GB = 1024 ** 3;
  assert.equal(computeNumCtx(1000, 262144, 48 * GB), 8192, "floor");
  assert.equal(computeNumCtx(20000, 262144, 48 * GB), 21500, "need + headroom");
  assert.equal(computeNumCtx(60000, 262144, 48 * GB), 32768, "RAM/quality ceiling");
  assert.equal(computeNumCtx(60000, 262144, 16 * GB), 16384, "16 GB tier");
  assert.equal(computeNumCtx(60000, 40960, 128 * GB), 32768, "ceiling below model cap");
  assert.equal(computeNumCtx(60000, 24000, 128 * GB), 24000, "model cap binds");
});

test("sanitizeHypotheses: invented TNR de-linked and flagged; valid kept", () => {
  const allowed = new Set(["160300"]);
  const { text, invented } = sanitizeHypotheses(
    "- **Hypotes (rumsligt):** x. Evidens: [[TNR160300]], [[TNR999999]]",
    allowed,
  );
  assert.ok(text.includes("[[TNR160300]]"));
  assert.ok(!text.includes("[[TNR999999]]"));
  assert.ok(text.includes("TNR999999 (okänd källa — kontrollera)"));
  assert.deepEqual(invented, ["999999"]);
});

test("pickDeepModel prefers the best pulled text model, else the vision model", () => {
  assert.equal(pickDeepModel(["qwen3-vl:4b", "qwen3:8b", "qwen3:32b"], "qwen3-vl:4b"), "qwen3:32b");
  assert.equal(pickDeepModel(["qwen3-vl:4b", "qwen3:8b"], "qwen3-vl:4b"), "qwen3:8b");
  // qwen3:4b TEXT is measured-unusable (CoT leakage) — never picked.
  assert.equal(pickDeepModel(["qwen3-vl:4b", "qwen3:4b"], "qwen3-vl:4b"), "qwen3-vl:4b");
  assert.equal(pickDeepModel(["qwen3-vl:8b"], "qwen3-vl:8b"), "qwen3-vl:8b");
});

test("looksLikeHypotheses: accepts the contract shape, rejects CoT leakage", () => {
  assert.ok(looksLikeHypotheses("- **Hypotes (rumsligt):** x. Evidens: [[TNR160300]]"));
  assert.ok(looksLikeHypotheses("- **Hypotes (avvikelse):** y. Evidens: TNR999999 (okänd källa — kontrollera)"));
  assert.ok(!looksLikeHypotheses("Okay, let's tackle this problem. So, I need to act as..."));
  assert.ok(!looksLikeHypotheses(""));
});

test("buildDeepPrompt puts the TASK at the END (measured long-context requirement)", () => {
  const p = buildDeepPrompt("DATA…", "UPPGIFTEN");
  assert.ok(p.indexOf("DATA…") < p.indexOf("UPPGIFTEN"));
  assert.ok(p.includes("UPPGIFT:"));
});

// --- E19 -----------------------------------------------------------------------------

test("E19: one row per in-range message with Stund/MGRS extracted", () => {
  const all = [
    report({ tnr: "161200", tidpunkt: "2026-06-16T12:00:00", stund: "161158", stalle: "33VXF 55013 72281, Vällingevägen", handelse: "Bil RJK241 parkerade.", sagesman: "GD01" }),
  ];
  const rows = buildE19Rows(analyzeRange(all, RANGE, PROT, state()), all, "Report1");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].lopnummer, "Report1_0001");
  assert.equal(rows[0].stund, "161158");
  assert.equal(rows[0].mgrs, "33VXF 55013 72281");
  assert.equal(rows[0].struktureringsbegrepp, "Händelse");
  assert.equal(rows[0].kalla, "GD01");
  assert.equal(rows[0].tillforlitlighet, "F");
});

test("E19 sakriktighet: different-sagesman prior → 2, same → 3, first → 6, photo → 2; never 1/4/5", () => {
  const mk = (tnr: string, tidpunkt: string, sagesman: string) =>
    report({ tnr, tidpunkt, sagesman, handelse: "Bil RJK241 passerade.", file: `inkorg/TNR${tnr}.md` });
  const all = [mk("140900", "2026-06-14T09:00:00", "BQ"), mk("150900", "2026-06-15T09:00:00", "AQ"), mk("160900", "2026-06-16T09:00:00", "AQ")];
  const a = analyzeRange(all, RANGE, PROT, state());
  // In-range report (AQ) has a prior from BQ (different) AND AQ (same) → 2 wins.
  assert.equal(buildE19Rows(a, all, "Report1")[0].sakriktighet, "2");
  // Only-same-sagesman history → 3.
  const sameOnly = [mk("150900", "2026-06-15T09:00:00", "AQ"), mk("160900", "2026-06-16T09:00:00", "AQ")];
  assert.equal(buildE19Rows(analyzeRange(sameOnly, RANGE, PROT, state()), sameOnly, "R")[0].sakriktighet, "3");
  // First sighting, no plate history → 6.
  const first = [report({ tnr: "161000", tidpunkt: "2026-06-16T10:00:00", handelse: "Person gick förbi." })];
  assert.equal(buildE19Rows(analyzeRange(first, RANGE, PROT, state()), first, "R")[0].sakriktighet, "6");
  // Photo corroboration → 2 regardless.
  assert.equal(buildE19Rows(analyzeRange(first, RANGE, PROT, state()), first, "R", new Set([first[0].file]))[0].sakriktighet, "2");
  for (const rows of [buildE19Rows(a, all, "x")]) for (const r of rows) assert.ok(["2", "3", "6"].includes(r.sakriktighet));
});

test("E19 CSV: BOM + semicolons + quoted fields (semicolon inside Händelse survives)", () => {
  const all = [report({ tnr: "161200", tidpunkt: "2026-06-16T12:00:00", handelse: 'Bil; "grå" skåpbil.' })];
  const csv = renderE19Csv(buildE19Rows(analyzeRange(all, RANGE, PROT, state()), all, "Report1"));
  assert.equal(csv.charCodeAt(0), 0xfeff, "UTF-8 BOM for Swedish Excel");
  assert.ok(csv.includes('"Löpnummer";"TNR";"Stund"'));
  assert.ok(csv.includes('"Bil; ""grå"" skåpbil."'));
  assert.ok(csv.includes("\r\n"));
});

// --- parse: Stund field ----------------------------------------------------------------

test("parse: Stund is extracted from real Bin 1 fixtures", () => {
  const raw = readFileSync(join(here, "fixtures", "bin1_v3", "TNR271415.md"), "utf-8");
  const r = parseReport(raw, "TNR271415.md");
  assert.equal(r.stund, "271415");
});
