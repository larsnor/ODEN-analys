/*
 * Photo-analysis judgement layer (pure) — the VLM's JSON in, operator nominations
 * out, with NO live Ollama. Canned responses stand in for the model (the model's
 * real accuracy is measured separately in the manual vision_harness.ts).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  parseSighting,
  normalizePlateRead,
  samePlate,
  reconBehaviours,
  sightingToNominations,
  sightingHasFindings,
  PhotoSighting,
} from "../src/photo_analysis.ts";

// --- response validation ----------------------------------------------------

test("parseSighting coerces the schema and drops junk / 'okänd'", () => {
  const raw = JSON.stringify({
    fordon: [{ typ: "bil", marke: "Volvo", farg: "röd", skylt: "RTZ 355" }, "junk", null],
    personer: [{ kon: "man", alder: "okänd", klader: ["blå jacka", "", "-"], utrustning: ["kikare"] }],
    ovrigt: ["garage", "okänd"],
  });
  const s = parseSighting(raw)!;
  assert.equal(s.vehicles.length, 1);
  assert.deepEqual(s.vehicles[0], { typ: "bil", marke: "Volvo", farg: "röd", skylt: "RTZ 355" });
  assert.equal(s.persons[0].alder, undefined, "'okänd' → undefined");
  assert.deepEqual(s.persons[0].klader, ["blå jacka"], "empty/'-' dropped");
  assert.deepEqual(s.ovrigt, ["garage"]);
});

test("parseSighting survives stray tokens around the JSON, and rejects non-JSON", () => {
  const s = parseSighting('here is the result: {"fordon":[],"personer":[],"ovrigt":[]} done')!;
  assert.deepEqual(s, { vehicles: [], persons: [], ovrigt: [] });
  assert.equal(parseSighting("not json at all"), null);
  assert.equal(parseSighting("{ broken"), null);
});

test("parseSighting tolerates missing arrays (empty {})", () => {
  const s = parseSighting("{}")!;
  assert.deepEqual(s, { vehicles: [], persons: [], ovrigt: [] });
  assert.equal(sightingHasFindings(s), false, "empty sighting has nothing to review");
});

// --- plate normalisation (the measured VLM quirks) --------------------------

test("normalizePlateRead strips the EU-strip nation S, but never a real S-plate", () => {
  assert.equal(normalizePlateRead("SABC123"), "ABC123", "7-char S+plate → strip");
  assert.equal(normalizePlateRead("S RTZ 355"), "RTZ355", "spaces + nation S");
  assert.equal(normalizePlateRead("SIS515"), "SIS515", "genuine 6-char S-plate untouched");
  assert.equal(normalizePlateRead("ABC12D"), "ABC12D", "new-format plate");
});

test("samePlate folds vanity-plate diacritics for comparison", () => {
  assert.ok(samePlate("RAMSJÖ", "RAMSJO"), "Ö≈O on compare");
  assert.ok(samePlate("rtz355", "RTZ 355"));
  assert.ok(!samePlate("ABC123", "ABD123"));
});

// --- recon-behaviour mapping (RECON subset only) ----------------------------

test("reconBehaviours maps optics/measuring to the recon concepts, ignores the rest", () => {
  const withOptics: PhotoSighting = { vehicles: [], persons: [{ klader: [], utrustning: ["kikare", "ryggsäck"] }], ovrigt: [] };
  const sig = reconBehaviours(withOptics);
  assert.equal(sig.length, 1);
  assert.equal(sig[0].key, "beteende:optik");
  assert.equal(sig[0].weight, 2);
  // A camera with a telephoto also reads as optik.
  assert.equal(reconBehaviours({ vehicles: [], persons: [], ovrigt: ["man med teleobjektiv"] })[0].key, "beteende:optik");
  // Nothing recon-relevant → no signal (a person just standing raises nothing).
  assert.deepEqual(reconBehaviours({ vehicles: [], persons: [{ klader: ["röd jacka"], utrustning: [] }], ovrigt: [] }), []);
});

test("reconBehaviours NEVER infers the severe (act-not-photograph) behaviours", () => {
  // Even if the model volunteers sabotage-ish prose, we map ONLY the recon subset.
  const s: PhotoSighting = { vehicles: [], persons: [{ klader: [], utrustning: ["avbitartång", "bultsax"] }], ovrigt: ["klipper stängsel"] };
  const keys = reconBehaviours(s).map((x) => x.key);
  assert.ok(!keys.includes("beteende:sabotage"));
  assert.ok(!keys.includes("beteende:verktyg"));
});

// --- sighting → per-item nominations ----------------------------------------

test("sightingToNominations: plate + vehicle + person become separate review items", () => {
  const s: PhotoSighting = {
    vehicles: [{ typ: "bil", marke: "Volvo", farg: "röd", skylt: "SRTZ355" }],
    persons: [{ kon: "man", alder: "medelålders", klader: ["blå jacka"], utrustning: ["kikare"] }],
    ovrigt: [],
  };
  const noms = sightingToNominations(s, []);
  const plate = noms.find((n) => n.kind === "plate");
  const vehicle = noms.find((n) => n.kind === "vehicle");
  const person = noms.find((n) => n.kind === "person");
  assert.equal(plate?.kind === "plate" && plate.value, "RTZ355", "nation-S stripped");
  assert.equal(plate?.kind === "plate" && plate.conflict, false, "no typed plate → not a conflict");
  assert.equal(vehicle?.kind === "vehicle" && vehicle.label, "röd Volvo bil");
  assert.match(person?.kind === "person" ? person.label : "", /man, medelålders, blå jacka, kikare/);
  assert.equal(person?.kind === "person" && person.recon[0].key, "beteende:optik", "person carries recon signal");
});

test("sightingToNominations flags a photo plate that CONFLICTS with a typed one", () => {
  const s: PhotoSighting = { vehicles: [{ skylt: "XYZ789" }], persons: [], ovrigt: [] };
  const [nom] = sightingToNominations(s, ["RTZ355"]);
  assert.equal(nom.kind === "plate" && nom.conflict, true, "differs from the typed plate → conflict");
  // Same plate as typed → corroboration, not conflict.
  const [ok] = sightingToNominations({ vehicles: [{ skylt: "S RTZ 355" }], persons: [], ovrigt: [] }, ["RTZ355"]);
  assert.equal(ok.kind === "plate" && ok.conflict, false);
});

test("sightingToNominations: an attribute-less person yields no row; a non-plate skylt is dropped", () => {
  const s: PhotoSighting = {
    vehicles: [{ farg: "svart", skylt: "okänd" }],
    persons: [{ klader: [], utrustning: [] }],
    ovrigt: [],
  };
  const noms = sightingToNominations(s, []);
  assert.equal(noms.filter((n) => n.kind === "plate").length, 0, "'okänd' skylt → no plate item");
  assert.equal(noms.filter((n) => n.kind === "person").length, 0, "no legible attribute → no person item");
  assert.equal(noms.filter((n) => n.kind === "vehicle").length, 1, "colour alone still annotates the vehicle");
});
