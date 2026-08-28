/*
 * Behaviour-indicator coverage — HELD-OUT sentences the generator does NOT
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

// --- sabotage / infiltration / terrorism (the extended threat vocabulary) -----
const THREATS = [
  // sabotage
  "Klippte upp stängslet med en bultsax och tog sig in.",
  "Manipulerade ett kabelskåp och kopplade bort strömmen.",
  "Bände upp en lucka med kofot vid stationen.",
  // infiltration
  "Utgav sig för att vara hantverkare men saknade arbetsorder.",
  "Smet in genom en dörr vid vaktbyte.",
  "Skuggade en anställd och testade en dörr som skulle vara låst.",
  // elicitation + false authority (GitHub #3 — the generator's repertoire phrases)
  "Ställde ingående frågor om rutiner och passertider.",
  "Bar synbart passerkort men kändes inte igen av vakten.",
  "Man i väst frågar vakten om rutinerna för in- och utpassering.",
  "Försökte prata sig förbi grindvakten utan ärende.",
  // terrorism
  "Lämnade en oidentifierad väska vid entrén och avlägsnade sig.",
  "Körde långsamt förbi upprepade gånger.",
  "En kvarlämnad väska stod obevakad vid perrongen.",
];

// Benign prose that specifically probes the NEW threat stems for false positives.
const THREAT_BENIGN = [
  "Trädgårdsmästaren klippte gräs längs staketet.",   // NOT "klippte upp"
  "Elektriker bytte en säkring i elskåpet.",           // infra noun alone is inert
  "Hantverkare bar sin verktygsväska till bygget.",    // toolbag ≠ breaching tool
  "Personal visade passerkort vid grinden.",           // passcard alone is inert
  "Bil körde förbi i normal hastighet.",               // NOT "körde långsamt förbi"
  "Familj lämnade stranden på kvällen.",               // NOT "lämnade en väska"
  "Bonde kontrollerade stängslet vid åkerkanten.",
  "Lastbil hämtade en container vid terminalen.",
];

test("sabotage/infiltration/terrorism phrasings raise a threat signal", () => {
  const missed = THREATS.filter((s) => !behaviourHit(s));
  assert.deepEqual(missed, [], `these threat phrasings were missed: ${missed.join(" | ")}`);
});

test("the photo-only activity stems are NOT in the text vocabulary (idiom guard)", () => {
  // "hoppar över" is the Swedish idiom for SKIPPING something — it lives only in
  // the photo path's activity mapping, where the visual context disambiguates.
  // Adding it to THREAT_INDICATORS would fire on everyday prose like these:
  for (const s of ["Vakten hoppar över lunchen idag.", "Vi hoppade över mötet."]) {
    assert.equal(behaviourHit(s), false, `text idiom must stay silent: ${s}`);
  }
});

test("benign prose does not fire the new threat stems (precision guard)", () => {
  const fp = THREAT_BENIGN.filter((s) => behaviourHit(s));
  assert.deepEqual(fp, [], `these benign phrasings falsely fired: ${fp.join(" | ")}`);
});

test("a high-confidence threat signal (weight 3) elevates on its own at night", () => {
  // far from the object, but night + a weight-3 sabotage signal = 2 + 3 = 5 ≥ threshold.
  const r = {
    typ: "7S-rapport", tnr: "x", tidpunkt: "2026-06-16T02:00:00", plats: "p",
    lat: 58.0, lon: 16.0, sagesman: "AQ", handelse: "Bände upp en lucka med kofot.",
    links: [], embeds: [], file: "f.md",
  } as unknown as Report;
  assert.ok(scoreReport(r).score >= 5, "weight-3 sabotage + night should reach the threshold");
});
