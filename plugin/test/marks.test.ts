/*
 * Job B extraction/normalization unit tests — OUTSIDE Obsidian (§10).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseReport, Report } from "../src/parse.ts";
import { extractMarks } from "../src/marks.ts";

function mkReport(symbol: string, tnr = "140000"): Report {
  const text = [
    "---",
    "id: X",
    "typ: 7S-rapport",
    "källa: bin1-intag",
    `tnr: "${tnr}"`,
    `tidpunkt: "2026-02-14T14:00:00"`,
    'plats: "Testplats"',
    "sagesman: AQ",
    "---",
    "",
    `**Symbol:** ${symbol}`,
  ].join("\n");
  return parseReport(text, `reports/TNR${tnr}.md`);
}

const TELL_BAG = [
  "bar en mörk ryggsäck med ett delvis synligt märke",
  "svart ryggsäck, något tryck på baksidan",
  "mörk väska på ryggen, otydlig logga",
  "ryggsäck i mörkt tyg, märke svårt att läsa",
  "bar en svart ryggsäck, delvis läsbar text -TAC",
];
const TELL_CAP = [
  "mörk keps med ett ljust emblem",
  "bar en svart keps, ljus symbol fram",
  "mörk mössa/keps med ljust märke",
  "keps i mörk färg, ljust tryck",
  "huvudbonad mörk med ljust emblem",
];
const TELL_LOGO = [
  "Fordonet hade delvis synlig logotyp på bakrutan, liknar bokstäverna DGE",
  "Fordonet hade dekalrest på bakrutan, otydlig",
  "Fordonet hade klistermärke baktill, delvis DGE",
  "Fordonet hade logga på bakglaset, svårläst",
  "Fordonet hade märke på bakrutan, möjligen DGE",
];

test("each tell phrasing extracts the right object category", () => {
  for (const p of TELL_BAG) {
    const m = extractMarks(mkReport(p));
    assert.equal(m.length, 1, `bag phrasing: ${p}`);
    assert.equal(m[0].object, "ryggsack", p);
  }
  for (const p of TELL_CAP) {
    const m = extractMarks(mkReport(p));
    assert.equal(m.length, 1, `cap phrasing: ${p}`);
    assert.equal(m[0].object, "huvudbonad", p);
  }
  for (const p of TELL_LOGO) {
    const m = extractMarks(mkReport(p));
    assert.equal(m.length, 1, `logo phrasing: ${p}`);
    assert.equal(m[0].object, "fordon-dekal", p);
  }
});

test("all phrasings of a tell collapse to ONE signature per category", () => {
  const bagSigs = new Set(TELL_BAG.map((p) => extractMarks(mkReport(p))[0].signature));
  const capSigs = new Set(TELL_CAP.map((p) => extractMarks(mkReport(p))[0].signature));
  const logoSigs = new Set(TELL_LOGO.map((p) => extractMarks(mkReport(p))[0].signature));
  assert.equal(bagSigs.size, 1, `bag signatures: ${[...bagSigs].join(" | ")}`);
  assert.equal(capSigs.size, 1, `cap signatures: ${[...capSigs].join(" | ")}`);
  assert.equal(logoSigs.size, 1, `logo signatures: ${[...logoSigs].join(" | ")}`);
});

test("distinctive marks require identity dims; bare backpack is not distinctive", () => {
  const tell = extractMarks(mkReport("bar en mörk ryggsäck med ett delvis synligt märke"))[0];
  assert.equal(tell.distinctive, true);
  // noise: light jacket (excluded) + bare backpack (no colour, no marking)
  const noise = extractMarks(mkReport("Cyklist i ljus jacka, ryggsäck"));
  assert.equal(noise.length, 1, "bare backpack still detected");
  assert.equal(noise[0].object, "ryggsack");
  assert.equal(noise[0].distinctive, false, "bare backpack must NOT be distinctive");
});

test("negation and exclusion produce no distinctive marks", () => {
  assert.equal(extractMarks(mkReport("inga särskilda kännetecken")).length, 0);
  assert.equal(extractMarks(mkReport("utan väska, vardaglig klädsel")).filter((m) => m.distinctive).length, 0);
  assert.equal(extractMarks(mkReport("Man i 40-årsåldern, atletisk, diskret klädd")).length, 0);
  assert.equal(extractMarks(mkReport("Förare ensam, kostym")).length, 0);
  assert.equal(extractMarks(mkReport("Kvinna ensam, solglasögon")).length, 0);
  assert.equal(extractMarks(mkReport("Ungdom på elsparkcykel, ljus jacka")).length, 0);
});

test("trailing detail clause attaches to the preceding object (split-clause bug)", () => {
  // object in clause N, marking detail in clause N+1
  const m = extractMarks(mkReport("bar en svart ryggsäck, delvis läsbar text -TAC"))[0];
  assert.equal(m.object, "ryggsack");
  assert.ok(m.attrs.some((a) => a.dim === "farg" && a.value === "mörk"));
  assert.ok(m.attrs.some((a) => a.dim === "marking"), "marking attached from detail clause");
  assert.equal(m.distinctive, true);
});

test("a vehicle report with both logo and driver cap extracts two marks", () => {
  const m = extractMarks(
    mkReport(
      "Fordonet hade klistermärke baktill, delvis DGE. Föraren bar en svart keps, ljus symbol fram",
    ),
  );
  const cats = m.map((x) => x.object).sort();
  assert.deepEqual(cats, ["fordon-dekal", "huvudbonad"]);
});

test("coref cue is flagged but not resolved", () => {
  const m = extractMarks(mkReport("samma man som igår, mörk keps med ljust emblem"));
  assert.ok(m.length >= 1);
  assert.equal(m[0].corefFlagged, true);
});

test("extraction is idempotent", () => {
  const r = mkReport("bar en mörk ryggsäck med ett delvis synligt märke");
  assert.deepEqual(extractMarks(r), extractMarks(r));
});
