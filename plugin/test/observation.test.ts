/* Operator observation template — a hand-authored note carries every field, and
 * round-trips through the parser as a normal 7S report. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { renderObservation, tnrFromTidpunkt } from "../src/observation.ts";
import { parseReport } from "../src/parse.ts";

test("TNR is DDHHMM from the observation time", () => {
  assert.equal(tnrFromTidpunkt("2026-06-16T09:53:00"), "160953");
});

test("renders a complete 7S note that the parser accepts", () => {
  const { filename, markdown } = renderObservation({
    id: "7S-test",
    tidpunkt: "2026-06-16T09:53:00",
    plats: "33VXF5453072480",
    sagesman: "OP",
    handelse: "Person fotograferade mot grinden.",
    symbol: "mörk hoodie, kamera",
  });
  assert.equal(filename, "TNR160953.md");

  const r = parseReport(markdown, filename);
  assert.equal(r.typ, "7S-rapport");
  assert.equal(r.tnr, "160953");
  assert.equal(r.källa, "operatör");
  assert.equal(r.sagesman, "OP");
  assert.match(r.handelse ?? "", /fotograferade/);
  assert.equal(r.symbol, "mörk hoodie, kamera");
  // MGRS in the plats → coordinates derived, near the grid.
  assert.ok(r.lat !== undefined && Math.abs(r.lat - 59.263) < 0.01, "coords from MGRS");
});

test("omits coords cleanly when the plats has no grid; omits Symbol when empty", () => {
  const { markdown } = renderObservation({
    id: "7S-x", tidpunkt: "2026-06-16T14:00:00", plats: "Vid grindarna",
    sagesman: "AQ", handelse: "Lugnt.",
  });
  assert.doesNotMatch(markdown, /^lat:/m);
  assert.doesNotMatch(markdown, /\*\*Symbol:\*\*/);
  const r = parseReport(markdown, "TNR160000.md");
  assert.equal(r.lat, undefined);
});
