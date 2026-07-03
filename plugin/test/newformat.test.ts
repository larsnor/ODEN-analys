/*
 * New Bin 1 format — parser tests against the two REAL example messages
 * (Händelse-centric, signal_* frontmatter, MGRS grids, mojibake). OUTSIDE Obsidian.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, repairMojibake } from "../src/parse.ts";
import { extractMarks } from "../src/marks.ts";

const here = dirname(fileURLToPath(import.meta.url));
const fix = (name: string) => readFileSync(join(here, "fixtures", name), "utf-8");

test("repairMojibake fixes Swedish UTF-8/Latin-1 garble, leaves clean text alone", () => {
  assert.equal(repairMojibake("HÃ¶glandet"), "Höglandet");
  assert.equal(repairMojibake("SÃ¥g en ribbÃ¥t"), "Såg en ribbåt");
  assert.equal(repairMojibake("RegnbÃ¥gsfÃ¤rgad"), "Regnbågsfärgad");
  assert.equal(repairMojibake("redan ren text"), "redan ren text");
});

test("parses new-format msg1 (boat, frontmatter coords, no Symbol/links)", () => {
  const r = parseReport(fix("TNR260838.md"), "fixtures/TNR260838.md");
  assert.equal(r.typ, "7S-rapport");
  assert.equal(r.tnr, "260838");
  assert.equal(r.signalAvsandareId, "4c6eb23f-be92-460e-82ff-e1af34552193");
  // mojibake repaired in frontmatter + body
  assert.equal(r.plats, "Strandbacken, Höglandet, Stockholm");
  assert.match(r.handelse ?? "", /ribbåt/);
  assert.match(r.handelse ?? "", /mörkt klädda/);
  // Ställe carries the MGRS grid even though frontmatter plats does not
  assert.match(r.stalle ?? "", /33VXF 66651 79308/);
  assert.equal(r.lat, 58.62877);
  assert.equal(r.sedan, "-");
  assert.equal(r.symbol, undefined); // Symbol optional, absent here
  assert.equal(r.links.length, 0); // NO wikilinks in the new format
  // old fields absent, parser tolerant (no throw)
  assert.equal(r.slag, undefined);
});

test("parses new-format msg2 (kayak, MGRS-only plats, Symbol present, no coords)", () => {
  const r = parseReport(fix("TNR260916.md"), "fixtures/TNR260916.md");
  assert.equal(r.tnr, "260916");
  assert.match(r.handelse ?? "", /Kajak paddlade/);
  assert.equal(r.symbol, "Regnbågsfärgad");
  assert.equal(r.plats, "34VDM 37561 82883"); // plats IS the grid here
  assert.equal(r.stalle, "34VDM 37561 82883");
  // no frontmatter lat/lon → derived from the MGRS grid
  assert.equal(r.coordsFromMgrs, true);
  assert.ok(Math.abs((r.lat ?? 0) - 60.27779) < 1e-3, `lat ${r.lat}`);
  assert.ok(Math.abs((r.lon ?? 0) - 19.87106) < 1e-3, `lon ${r.lon}`);
  assert.equal(r.signalAvsandareId, "4c6eb23f-be92-460e-82ff-e1af34552193");
});

test("marks are now read from Händelse (in-vocab road content still works)", () => {
  const text = [
    "---", "id: X", "typ: 7S-rapport", 'tnr: "140000"', 'tidpunkt: "2026-02-14T14:00:00"', "sagesman: AQ", "---",
    "", "**Händelse:** Två män gick mot grindarna, en bar en mörk ryggsäck med märke och en mörk keps med ljust emblem.",
  ].join("\n");
  const marks = extractMarks(parseReport(text, "x")).filter((m) => m.distinctive);
  const cats = marks.map((m) => m.object).sort();
  assert.deepEqual(cats, ["huvudbonad", "ryggsack"], "bag + cap extracted from Händelse prose");
});

test("HONEST CEILING: free-prose / out-of-domain Händelse yields no marks", () => {
  // The maritime examples carry no road-vocabulary marks — deterministic floor
  // correctly finds nothing. This gap is the empirical case for the LLM.
  const m1 = extractMarks(parseReport(fix("TNR260838.md"), "f1")).filter((m) => m.distinctive);
  const m2 = extractMarks(parseReport(fix("TNR260916.md"), "f2")).filter((m) => m.distinctive);
  assert.equal(m1.length, 0);
  assert.equal(m2.length, 0);
});
