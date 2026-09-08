/*
 * Demo cartridges (src/cartridge.ts): manifest parsing, discovery incl. the
 * legacy flat layout, command naming, and the AOI-switch rule.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  cartridgeCommandId, cartridgeCommandName, cartridgeNeedsAoiSwitch,
  discoverCartridges, parseCartridgeManifest,
} from "../src/cartridge.ts";
import { haversineM } from "../src/mgrs.ts";

const TIERP = JSON.stringify({ id: "tierp", label: "Tierps flygfält", aoi: { lat: 60.3444, lon: 17.4222 }, area: "airport", days: 10, beskrivning: "Hög hotnivå." });

test("manifest: valid → cartridge with root; malformed → null", () => {
  const c = parseCartridgeManifest(TIERP, "demo/tierp")!;
  assert.equal(c.id, "tierp");
  assert.equal(c.root, "demo/tierp");
  assert.deepEqual(c.aoi, { lat: 60.3444, lon: 17.4222 });
  assert.equal(parseCartridgeManifest("{not json", "demo/x"), null);
  assert.equal(parseCartridgeManifest(JSON.stringify({ id: "Bad Id!", label: "x" }), "demo/x"), null);
  assert.equal(parseCartridgeManifest(JSON.stringify({ id: "ok", label: "" }), "demo/ok"), null);
  assert.equal(parseCartridgeManifest(JSON.stringify({ id: "ok", label: "Ok", aoi: { lat: "59", lon: 17 } }), "demo/ok")!.aoi, undefined);
});

test("discovery: sorted by label, legacy flat layout first as the unnamed cartridge", () => {
  const found = discoverCartridges(
    [
      { root: "demo/norrtalje", json: JSON.stringify({ id: "norrtalje", label: "Norrtälje hamn" }) },
      { root: "demo/tierp", json: TIERP },
      { root: "demo/broken", json: "nope" },
    ],
    true,
  );
  assert.deepEqual(found.map((c) => c.id), ["", "norrtalje", "tierp"]);
  assert.equal(found[0].root, "demo");
  assert.equal(found[0].label, "Demodata");
});

test("command id/name: stable ids, Swedish palette names, legacy unchanged", () => {
  const c = parseCartridgeManifest(TIERP, "demo/tierp")!;
  assert.equal(cartridgeCommandId(c), "feed-demo-tierp");
  assert.equal(cartridgeCommandName(c), "Mata demodata — Tierps flygfält");
  const legacy = discoverCartridges([], true)[0];
  assert.equal(cartridgeCommandId(legacy), "feed-demo");
  assert.equal(cartridgeCommandName(legacy), "Mata demodata");
});

test("AOI switch only when the cartridge's AOI is materially elsewhere", () => {
  const c = parseCartridgeManifest(TIERP, "demo/tierp")!;
  assert.equal(cartridgeNeedsAoiSwitch(c, { lat: 59.2622, lon: 17.712 }, haversineM), true, "Vällinge → Tierp");
  assert.equal(cartridgeNeedsAoiSwitch(c, { lat: 60.3445, lon: 17.4224 }, haversineM), false, "already there");
  assert.equal(cartridgeNeedsAoiSwitch({ id: "", label: "Demodata", root: "demo" }, { lat: 0, lon: 0 }, haversineM), false, "no AOI in manifest");
});
