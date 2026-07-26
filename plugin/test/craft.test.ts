/*
 * Craft (farkost) extraction + scoring — pure, OUTSIDE Obsidian.
 *
 * Covers the domain model's farkost dimension: the type taxonomy, the plated/unplated
 * re-identifiability boundary, the "Se bild." homonym guard, the vision-typ
 * mapping, and the drone > boat > tractor scoring gradation near the objektet.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { parseReport } from "../src/parse.ts";
import { extractCraft, extractAllCraft } from "../src/craft.ts";
import { classifyCraft, craftFromVisionTyp, matchCraftTypes } from "../src/domain.ts";
import { scoreReport, DEFAULT_SUSPICION } from "../src/suspicion.ts";

/** Build a report from body prose (+ optional coords/time). */
function rep(handelse: string, opts: { tnr?: string; lat?: number; lon?: number; t?: string; sagesman?: string } = {}) {
  const fm = [
    "---", "id: X", "typ: 7S-rapport", `tnr: "${opts.tnr ?? "150000"}"`,
    `tidpunkt: "${opts.t ?? "2026-06-15T12:00:00"}"`,
    ...(opts.lat !== undefined ? [`lat: ${opts.lat}`, `lon: ${opts.lon}`] : []),
    `sagesman: ${opts.sagesman ?? "AQ"}`, "---", "", `**Händelse:** ${handelse}`,
  ].join("\n");
  return parseReport(fm, `x/${opts.tnr ?? "150000"}.md`);
}

// --- taxonomy + extraction --------------------------------------------------

test("extractCraft types civil prose the generator already produces", () => {
  assert.equal(extractCraft(rep("Fritidsbåt lade till i gästhamnen."))[0].type, "båt");
  assert.equal(extractCraft(rep("Lastbil hämtade en container vid kajen."))[0].type, "lastbil");
  assert.equal(extractCraft(rep("Traktor plöjde fältet norr om vägen."))[0].type, "traktor");
  assert.equal(extractCraft(rep("En cykel stod lutad mot staketet."))[0].type, "cykel");
  assert.equal(extractCraft(rep("Färjan lade till vid terminalen."))[0].type, "färja");
});

test("medium + plated flags come from the taxonomy", () => {
  const boat = extractCraft(rep("En motorbåt gick förbi."))[0];
  assert.equal(boat.medium, "vatten");
  assert.equal(boat.plated, false);
  const truck = extractCraft(rep("En lastbil körde in."))[0];
  assert.equal(truck.medium, "mark");
  assert.equal(truck.plated, true);
  assert.equal(extractCraft(rep("En drönare i luften."))[0].medium, "luft");
});

test('the "Se bild." photo report is NOT read as a craft (bil ⊄ bild)', () => {
  assert.deepEqual(extractCraft(rep("Se bild.")), []);
  assert.deepEqual(matchCraftTypes("Se bild. Bilden visar en person."), []);
});

test("plated craft links the sole full plate in the same report (re-id bridge)", () => {
  const c = extractCraft(rep("Skåpbil RJK241 parkerade vid ladan."))[0];
  assert.equal(c.type, "lastbil");
  assert.equal(c.plate, "RJK241");
  // Unplated craft never carries a plate, even if the report has one.
  const bike = extractCraft(rep("En cykel och bilen RJK241 syntes.")).find((c) => c.type === "cykel")!;
  assert.equal(bike.plated, false);
  assert.equal(bike.plate, undefined);
});

test("generic craft are OBSERVATIONS, never merged into one entity (re-id boundary)", () => {
  const all = extractAllCraft([
    rep("En drönare sågs över skogen.", { tnr: "1" }),
    rep("En drönare hördes på avstånd.", { tnr: "2" }),
  ]);
  const drones = all.filter((c) => c.type === "drönare");
  assert.equal(drones.length, 2); // two separate sightings, not one node
  assert.ok(drones.every((c) => c.plate === undefined));
});

test("craftFromVisionTyp maps a VLM vehicle typ through the same taxonomy", () => {
  assert.equal(craftFromVisionTyp("lastbil")?.key, "lastbil");
  assert.equal(craftFromVisionTyp("båt")?.key, "båt");
  assert.equal(craftFromVisionTyp("bild"), undefined); // homonym guard holds for vision too
  assert.equal(craftFromVisionTyp(undefined), undefined);
});

test("threat weights: drone alarming, boat notable, tractor benign", () => {
  assert.equal(classifyCraft("drönare")?.threat, 3);
  assert.equal(classifyCraft("båt")?.threat, 1);
  assert.equal(classifyCraft("traktor")?.threat, 0);
  assert.equal(classifyCraft("färja")?.threat, 0);
});

// --- scoring gradation near the objektet ------------------------------------

const near = { lat: DEFAULT_SUSPICION.protectedLat, lon: DEFAULT_SUSPICION.protectedLon };
const night = "2026-06-15T03:00:00";
const noon = "2026-06-15T12:00:00";

test("a drone near the objektet at night reaches Hög via the craft signal", () => {
  const s = scoreReport(rep("En drönare i luften.", { ...near, t: night }));
  assert.ok(s.reasons.some((r) => r.key === "farkost:drönare"));
  assert.ok(s.score >= 8, `drone+prox+natt should be ~8, got ${s.score}`);
});

test("a boat near the objektet at night reaches the elevated threshold", () => {
  const s = scoreReport(rep("En roddbåt låg vid vassen.", { ...near, t: night }));
  assert.ok(s.reasons.some((r) => r.key === "farkost:båt"));
  assert.ok(s.score >= (DEFAULT_SUSPICION.threshold ?? 5), `boat+prox+natt should elevate, got ${s.score}`);
});

test("a tractor near the objektet never flags on type (threat 0)", () => {
  const s = scoreReport(rep("En traktor stod parkerad.", { ...near, t: noon }));
  assert.ok(!s.reasons.some((r) => r.key.startsWith("farkost:")), "tractor must not add a craft signal");
  assert.ok(s.score < (DEFAULT_SUSPICION.threshold ?? 5), `tractor by day should stay low, got ${s.score}`);
});

test("the craft signal is graded drone > boat > tractor at the same place/time", () => {
  const drone = scoreReport(rep("En drönare i luften.", { ...near, t: night })).score;
  const boat = scoreReport(rep("En roddbåt vid vassen.", { ...near, t: night })).score;
  const tractor = scoreReport(rep("En traktor på vägen.", { ...near, t: night })).score;
  assert.ok(drone > boat && boat > tractor, `expected drone(${drone}) > boat(${boat}) > tractor(${tractor})`);
});
