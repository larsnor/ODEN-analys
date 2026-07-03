/* Presentation layer — bands + reason phrasing, no architecture meta leaks. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { suspicionLevel, reasonPhrase, reasonPhrases } from "../src/present.ts";
import { Signal } from "../src/suspicion.ts";

test("suspicionLevel bands", () => {
  assert.equal(suspicionLevel(10), "Hög");
  assert.equal(suspicionLevel(7), "Förhöjd");
  assert.equal(suspicionLevel(5), "Att bevaka");
  assert.equal(suspicionLevel(3), "");
});

test("reasonPhrase maps keys and scrubs weights/distance", () => {
  assert.equal(reasonPhrase({ key: "proximity", label: "nära objektet (~108 m)", weight: 3 }), "nära objektet");
  assert.equal(reasonPhrase({ key: "natt", label: "nattaktivitet (kl 23)", weight: 2 }), "nattetid");
  assert.equal(reasonPhrase({ key: "beteende:optik", label: 'spaningsindikator: optik/foto ("kikare")', weight: 2 }), "kamera/kikare");
  // fallback scrubs a raw weight
  assert.equal(reasonPhrase({ key: "unknown", label: "något (+2)", weight: 2 }), "något");
});

test("no architecture meta leaks into operator phrases", () => {
  const reasons: Signal[] = [
    { key: "proximity", label: "nära objektet (~108 m)", weight: 3 },
    { key: "natt", label: "nattaktivitet (kl 23)", weight: 2 },
    { key: "beteende:registrering", label: "x", weight: 2 },
  ];
  const text = reasonPhrases(reasons).join(" | ");
  for (const bad of ["+", "§", "Job", "Bin", "deterministisk", "(~"]) {
    assert.ok(!text.includes(bad), `leak "${bad}" in: ${text}`);
  }
  assert.deepEqual(reasonPhrases(reasons), ["nära objektet", "nattetid", "antecknande/mätande"]);
});
