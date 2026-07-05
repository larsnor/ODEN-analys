/* Suspect agents — a suspicious observation yields a verifiable actor candidate
 * (vehicle or person) even from a SINGLE observation (#1). */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Report } from "../src/parse.ts";
import { analyzeSuspicion } from "../src/suspicion.ts";
import { buildSuspects, suspectHypotheses, suspectHypId, isActorCandidate } from "../src/suspects.ts";
import { suspectFilename, renderSuspectNote } from "../src/suspect_notes.ts";

const PROT = { protectedLat: 59.0, protectedLon: 17.0, threshold: 5 };

function report(over: Partial<Report>): Report {
  return {
    id: over.tnr ?? "x",
    typ: "7S-rapport",
    tnr: over.tnr ?? "000000",
    tidpunkt: "2026-06-16T03:00:00", // night → weight 2
    plats: "Grindarna",
    lat: 59.001, // ~111 m from the protected object → proximity weight 3
    lon: 17.0,
    sagesman: "AQ",
    links: [],
    embeds: [],
    file: `reports/TNR${over.tnr ?? "000000"}.md`,
    ...over,
  };
}

test("groups elevated observations by agent: vehicle (plate) vs person (symbol)", () => {
  const reports = [
    report({ tnr: "100000", handelse: "Fordon RJK241 passerar långsamt." }),
    report({ tnr: "100100", handelse: "Samma fordon RJK241 återkommer.", file: "reports/TNR100100.md" }),
    report({ tnr: "100200", symbol: "mörk hoodie, bär kamera" }),
  ];
  const susp = analyzeSuspicion(reports, PROT);
  assert.ok(susp.elevated.length === 3, "all three are elevated (proximity+natt)");

  const suspects = buildSuspects(reports, susp);
  assert.equal(suspects.length, 2, "two distinct agents");

  const vehicle = suspects.find((s) => s.kind === "fordon");
  assert.ok(vehicle, "a vehicle suspect");
  assert.equal(vehicle!.label, "RJK241");
  assert.equal(vehicle!.obs.length, 2, "both plate sightings group into one agent");

  const person = suspects.find((s) => s.kind === "person");
  assert.ok(person, "a person suspect");
  assert.match(person!.label, /hoodie/);
  assert.equal(person!.obs.length, 1, "a single observation is enough");
});

test("suspectHypotheses are single-facet actor candidates the review flow can confirm", () => {
  const reports = [report({ tnr: "200000", symbol: "reflexväst, cyklar sakta" })];
  const susp = analyzeSuspicion(reports, PROT);
  const [h] = suspectHypotheses(buildSuspects(reports, susp));

  assert.ok(h, "one hypothesis");
  assert.ok(h.id.startsWith("suspect-"), "id marks it a suspect");
  assert.equal(h.facets.length, 1, "single facet = the agent");
  assert.equal(h.markCount, 1);
  assert.equal(h.vehicleCount, 0);
  assert.equal(h.chain.length, 1, "the observation is the evidence");
  assert.match(h.explanation, /Misstänkt person/);
});

test("a vehicle suspect carries fordon facet + vehicleCount", () => {
  const reports = [report({ tnr: "300000", handelse: "Skåpbil ABC12X står parkerad, förare fotograferar." })];
  const susp = analyzeSuspicion(reports, PROT);
  const [h] = suspectHypotheses(buildSuspects(reports, susp));
  assert.equal(h.facets[0].kind, "fordon");
  assert.equal(h.vehicleCount, 1);
  assert.equal(h.markCount, 0);
});

test("isActorCandidate: proximity+time only is NOT nominated; behaviour or repeat is", () => {
  // Benign: near the object at night, no behaviour (like TNR192339's farm vehicle).
  // Still an elevated suspect (→ red marker) but NOT an actor candidate.
  const benign = [report({ tnr: "600000", handelse: "Lantbruksfordon på åkern, sedvanligt arbete." })];
  const bs = buildSuspects(benign, analyzeSuspicion(benign, PROT));
  assert.equal(bs.length, 1, "still an elevated suspect → red marker stays");
  assert.equal(isActorCandidate(bs[0]), false, "proximity+night only → no actor nomination");

  // Behavioural (recon) signal present → candidate even from ONE observation.
  const recon = [report({ tnr: "600100", handelse: "Person fotograferar objektet med kamera och teleobjektiv." })];
  const rs = buildSuspects(recon, analyzeSuspicion(recon, PROT));
  assert.equal(isActorCandidate(rs[0]), true, "recon behaviour → candidate");

  // Repeat sighting of the same agent → candidate even without a behaviour cue.
  const repeat = [
    report({ tnr: "600200", handelse: "Fordon RJK900 passerar." }),
    report({ tnr: "600300", handelse: "Fordon RJK900 igen.", file: "reports/TNR600300.md" }),
  ];
  const rp = buildSuspects(repeat, analyzeSuspicion(repeat, PROT));
  assert.equal(rp[0].obs.length, 2, "same agent grouped");
  assert.equal(isActorCandidate(rp[0]), true, "repeat sighting → candidate");
});

test("hypothesis carries the latest observation's coords (→ map position on confirm)", () => {
  const reports = [
    report({ tnr: "400000", handelse: "Fordon RJK241 passerar.", lat: 59.001, lon: 17.0 }),
    report({ tnr: "400100", handelse: "Fordon RJK241 igen.", lat: 59.002, lon: 17.001, file: "reports/TNR400100.md" }),
  ];
  const susp = analyzeSuspicion(reports, PROT);
  const [h] = suspectHypotheses(buildSuspects(reports, susp));
  assert.equal(h.lat, 59.002, "latest obs latitude");
  assert.equal(h.lon, 17.001, "latest obs longitude");
});

test("suspectFilename is a readable, colon-free graph label; id matches decision key", () => {
  const reports = [report({ tnr: "500000", handelse: "Fordon RJK241 passerar." })];
  const [s] = buildSuspects(reports, analyzeSuspicion(reports, PROT));
  const name = suspectFilename(s);
  assert.match(name, /^⚠️ RJK241/);
  assert.doesNotMatch(name, /[:\\/]/, "no filesystem-illegal chars");
  assert.ok(name.endsWith(".md"));
  // The marker's agent key maps to the same id used as the review-decision key.
  assert.equal(suspectHypId(s.key), suspectHypotheses([s])[0].id);
});

test("larm note links place + vehicle DIRECTLY so it survives message-node filtering", () => {
  const reports = [report({ tnr: "500000", plats: "Grindarna", handelse: "Fordon RJK241 passerar." })];
  const [s] = buildSuspects(reports, analyzeSuspicion(reports, PROT));
  const note = renderSuspectNote(s, undefined, (p) => (p === "Grindarna" ? "📍 Grindarna" : undefined));
  assert.match(note.markdown, /\[\[📍 Grindarna\|Grindarna\]\]/, "direct larm↔plats edge");
  assert.match(note.markdown, /\*\*Fordon:\*\* \[\[RJK241\|RJK241\]\]/, "direct larm↔fordon edge");
  assert.match(note.markdown, /\[\[TNR500000\|TNR500000\]\]/, "message link kept for traceability");
});
