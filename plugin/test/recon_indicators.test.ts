/*
 * Behaviour-indicator coverage (§6.5) — HELD-OUT sentences the generator does NOT
 * produce, so this is not circular. Recon phrasings must raise a `beteende:*`
 * signal; benign prose (incl. tricky near-misses) must NOT. Isolates behaviour by
 * scoring far from the object in daytime, so ONLY a behaviour hit yields points.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { scoreReport } from "../src/suspicion.ts";
import { Report } from "../src/parse.ts";

function behaviourHit(handelse: string): boolean {
  const r = {
    typ: "7S-rapport", tnr: "x", tidpunkt: "2026-06-16T13:00:00", plats: "p",
    lat: 58.0, lon: 16.0, sagesman: "AQ", handelse, links: [], embeds: [], file: "f.md",
  } as unknown as Report;
  // far from the default protected object + daytime → proximity/night contribute 0
  return scoreReport(r).reasons.some((x) => x.key.startsWith("beteende:"));
}

// Novel recon phrasings (NOT in the generator's templates).
const RECON = [
  "Höll utkik mot hangaren från en parkerad bil.",
  "Filmade start och landning, zoomade in på vakten.",
  "Noterade koordinater och märkte ut kameraplaceringar på en skiss.",
  "Vände tvärt och gömde sig bakom en container när patrullen kom.",
  "Kände på grinden och testade låset, tog sig sedan över staketet.",
  "Riktade en antenn mot området och sysslade med signalspaning.",
  "Dröjde kvar länge, tredje varvet på en timme.",
  "Höll koll på infarten och bevakade vaktbytet.",
  "Rekade in skogsbrynet med en mörkerkikare.",
  "Klättrade över stängslet och kröp längs diket.",
];

// Benign prose, including deliberate near-misses.
const BENIGN = [
  "Familj tittade på flygplan från parkeringen.",
  "Pensionärspar promenerade längs staketet.",            // NOT "längs staketet" as an indicator
  "Barn lekte vid stranden under uppsikt av vuxen.",       // "uppsikt av", not "uppsikt mot"
  "Bonde kontrollerade stängsel vid åkerkanten.",
  "Motionär joggade längs vägen mot Söderfors.",
  "Fiskare vid bryggan, metspö och hink.",
  "Paketbil levererade till klubbstugan.",
  "Cyklist i blå jacka passerade grinden.",
  "Hundrastare med en labrador på grusvägen.",
  "Traktor plöjde åkern intill banan.",
];

test("novel recon phrasings raise a behaviour signal (recall of the expanded vocab)", () => {
  const missed = RECON.filter((s) => !behaviourHit(s));
  assert.deepEqual(missed, [], `these recon phrasings were missed: ${missed.join(" | ")}`);
});

test("benign prose (incl. near-misses) raises NO behaviour signal (precision guard)", () => {
  const falsePos = BENIGN.filter((s) => behaviourHit(s));
  assert.deepEqual(falsePos, [], `these benign phrasings falsely fired: ${falsePos.join(" | ")}`);
});
