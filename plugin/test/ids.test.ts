/*
 * Deterministic identifier extraction (ids.ts) + the prose→re-identification decoupling.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, Report } from "../src/parse.ts";
import { extractIdentifiers, plateIdentifiers } from "../src/ids.ts";
import { buildPlateEntities } from "../src/reid.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures");
const fix = (n: string) => readFileSync(join(here, "fixtures", n), "utf-8");

function mkNew(handelse: string, stalle = "Grindarna", tnr = "140000", symbol?: string): Report {
  const text = [
    "---",
    "id: X",
    "typ: 7S-rapport",
    `tnr: "${tnr}"`,
    `tidpunkt: "2026-02-14T14:00:00"`,
    "signal_avsandare_id: sender-AAA",
    "sagesman: AQ",
    "---",
    "",
    `**Ställe:** ${stalle}`,
    "",
    `**Händelse:** ${handelse}`,
    symbol ? `\n**Symbol:** ${symbol}` : "",
  ].join("\n");
  return parseReport(text, `reports/TNR${tnr}.md`);
}

test("extracts typed identifiers from the real new-format examples", () => {
  const m1 = extractIdentifiers(parseReport(fix("TNR260838.md"), "f1"));
  // MGRS grid (location) + signal sender (source); no plates (a boat).
  assert.ok(m1.some((i) => i.type === "mgrs" && i.value === "33VXF6665179308" && i.role === "location"));
  assert.ok(m1.some((i) => i.type === "sender" && i.role === "source"));
  assert.ok(!m1.some((i) => i.type === "plate"));

  const m2 = extractIdentifiers(parseReport(fix("TNR260916.md"), "f2"));
  assert.ok(m2.some((i) => i.type === "mgrs" && i.value === "34VDM3756182883"));
});

test("plates and personnummer are extracted from PLAIN PROSE (no links)", () => {
  const r = mkNew("Mörk Volvo reg ABC123 körde förbi, förare med personnummer 850101-1234.");
  const ids = extractIdentifiers(r);
  const plate = ids.find((i) => i.type === "plate");
  assert.ok(plate, "plate found in prose");
  assert.equal(plate!.value, "ABC123");
  assert.equal(plate!.source, "prose-handelse");
  assert.equal(plate!.role, "actor");
  const pnr = ids.find((i) => i.type === "personnummer");
  assert.ok(pnr, "personnummer found in prose");
  assert.equal(pnr!.value, "850101-1234");
  assert.equal(pnr!.role, "actor");
});

test("plate re-identification works on prose-only plates (no intake links)", () => {
  const reports = [
    mkNew("Volvo reg ABC123 vid grindarna", "Grindarna", "140000"),
    mkNew("Samma bil ABC123 passerade igen", "Grindarna", "150000"),
    mkNew("Skåpbil reg DEF456 lastade", "Bornsjön", "160000"),
  ];
  const r = buildPlateEntities(reports);
  const abc = r.entities.find((e) => e.canonical === "ABC123");
  assert.ok(abc, "ABC123 entity built from prose");
  assert.equal(abc!.count, 2, "two prose sightings merged");
  assert.equal(r.entities.filter((e) => e.canonical === "DEF456")[0].count, 1);
});

test("decoupling preserves old-corpus plate extraction (regression)", () => {
  const dir = join(root, "reports");
  const reports = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports/${f}`));
  const r = buildPlateEntities(reports);
  const canon = new Set(r.entities.map((e) => e.canonical));
  // The tracked POI + commuter plates resolve via ids.ts.
  for (const p of ["PMR556", "RJK241", "SDG417", "TLP893", "WBN84X", "ABC123", "MRT902"]) {
    assert.ok(canon.has(p), `${p} still recovered after decoupling`);
  }
});

// --- partial plate masks in PROSE (the real Bin 1 fails to [[link]] dot-edged
// --- masks — its \b regex has no boundary between a dot and a space) ---------

test("prose partials: dot-edged masks are extracted (trailing, leading, spec examples)", () => {
  const cases: Array<[string, string]> = [
    ["Samma skåpbil, reg RJK2..", "RJK2.."], // the live E2E M3 case
    ["Delvis avläst ..G41. på plåten", "..G41."], // FORMAT_SPEC §6.4 example
    ["reg .JK..1 skymtad", ".JK..1"],
    ["reg RJK24.. i mörkret", "RJK24."], // mask is exactly 6; 7th dot = sentence stop
  ];
  for (const [text, expected] of cases) {
    const p = plateIdentifiers(mkNew(text)).find((i) => i.partial);
    assert.equal(p?.value, expected, text);
    assert.equal(p?.source, "prose-handelse", text);
  }
});

test("prose partials: precision guards — punctuation, initials and fulls never spawn masks", () => {
  for (const text of [
    "Såg RJK241. Sedan körde den vidare.", // full + sentence stop → full only
    "Rapportör N.N... inget mer känt", // initials + ellipsis: <3 read positions
    "Vänta... nu kommer den",
    "Mötet kl 14.30.. oklart",
  ]) {
    const ids = plateIdentifiers(mkNew(text));
    assert.equal(ids.filter((i) => i.partial).length, 0, `bogus partial in: ${text}`);
  }
  // The full in the first case is still read.
  assert.equal(plateIdentifiers(mkNew("Såg RJK241. Sedan körde den vidare."))[0]?.value, "RJK241");
});

test("prose partial resolves through plate re-id like a linked one (the M2+M3 chain)", () => {
  const reports = [
    mkNew("Skåpbil reg RJK241 vid grinden", "Grindarna", "140000"),
    mkNew("Samma skåpbil passerar igen, reg RJK2..", "Grindarna", "150000"),
  ];
  const r = buildPlateEntities(reports);
  const rjk = r.entities.find((e) => e.canonical === "RJK241");
  assert.equal(rjk?.count, 2, "masked sighting merged (unique full observed)");
  assert.deepEqual(rjk?.resolvedPartials, ["RJK2.."]);
});

test("a linked plate is not double-counted with its prose occurrence", () => {
  // Old-style report: plate inside [[ ]] within Symbol prose.
  const text = [
    "---", "id: X", "typ: 7S-rapport", 'tnr: "140000"', 'tidpunkt: "2026-02-14T14:00:00"', "sagesman: AQ", "---",
    "", "**Symbol:** mörkröd Toyota, reg [[RJK241]].",
  ].join("\n");
  const r = parseReport(text, "reports/x.md");
  const plates = plateIdentifiers(r);
  assert.equal(plates.length, 1, "link + prose occurrence dedupe to one");
  assert.equal(plates[0].value, "RJK241");
  assert.equal(plates[0].source, "link", "link provenance preferred");
});

test("operator-confirmed photo plate is injected into plate re-id as if typed", () => {
  // A "Se bild"-style report: no plate in the text at all.
  const text = [
    "---", "id: P", "typ: 7S-rapport", 'tnr: "080910"', 'tidpunkt: "2026-07-05T02:00:00"', "sagesman: BQ", "---",
    "", "**Händelse:** Se bild.",
  ].join("\n");
  const r = parseReport(text, "reports/p.md");
  assert.equal(plateIdentifiers(r).length, 0, "no plate in the text");

  // Operator confirmed a photo plate → injected post-parse.
  r.photoPlates = ["RTZ355"];
  const plates = plateIdentifiers(r);
  assert.equal(plates.length, 1);
  assert.equal(plates[0].value, "RTZ355");
  assert.equal(plates[0].source, "photo", "provenance = photo (llm-vision)");
  assert.equal(plates[0].partial, false);
  // And plate re-identification recovers the vehicle.
  const canon = new Set(buildPlateEntities([r]).entities.map((e) => e.canonical));
  assert.ok(canon.has("RTZ355"), "photo plate reaches plate re-id");
});
