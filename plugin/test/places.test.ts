/* Place display — MGRS detection + operator nickname resolution (display-only). */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isMgrsGrid, placeLabel } from "../src/places.ts";

test("isMgrsGrid recognises bare grids, not named places", () => {
  assert.equal(isMgrsGrid("33VXF5490371882"), true);
  assert.equal(isMgrsGrid("33VXF 54903 71882"), true, "spaces tolerated");
  assert.equal(isMgrsGrid("Infart Vällinge säteri"), false);
  assert.equal(isMgrsGrid("Vällingevägen vid grindarna"), false);
  assert.equal(isMgrsGrid(""), false);
});

test("placeLabel returns the nickname if set, else the raw plats", () => {
  const nicks = { "33VXF5490371882": "Norra grinden" };
  assert.equal(placeLabel("33VXF5490371882", nicks), "Norra grinden");
  assert.equal(placeLabel("33VXF5453072480", nicks), "33VXF5453072480", "no nickname → raw grid");
  assert.equal(placeLabel("33VXF5490371882"), "33VXF5490371882", "no map → raw grid");
  assert.equal(placeLabel("33VXF5490371882", { "33VXF5490371882": "   " }), "33VXF5490371882", "blank nickname ignored");
});
