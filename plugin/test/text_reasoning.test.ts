/*
 * Text-reasoning judgement layer (pure) — LLM JSON in, mark/behaviour nominations
 * out, no live Ollama. Canned responses stand in for the model; accuracy is
 * measured separately (a harness pass over the behaviour OOD corpora).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  parseTextExtraction,
  normalizeMarkKey,
  clusterTextMarks,
  TextMarkEntry,
} from "../src/text_reasoning.ts";
import { threatConcepts } from "../src/suspicion.ts";

const CONCEPTS = new Map(threatConcepts().map((c) => [c.key, { label: c.label, weight: c.weight }]));

test("parseTextExtraction: marks + concept-classified behaviours, junk dropped", () => {
  const raw = JSON.stringify({
    kännetecken: ["orange ryggsäck", "", "en man"],
    beteenden: [
      { begrepp: "optik", fras: "tittade genom kikare mot grinden" },
      { begrepp: "INTE-ETT-BEGREPP", fras: "x" },
      { begrepp: "sabotage", fras: "klippte hål i stängslet" },
    ],
  });
  const x = parseTextExtraction(raw, CONCEPTS)!;
  assert.deepEqual(x.marks.map((m) => m.label), ["orange ryggsäck", "en man"], "empty dropped; text kept verbatim");
  const keys = x.behaviours.map((b) => b.key);
  assert.ok(keys.includes("beteende:optik"));
  assert.ok(keys.includes("beteende:sabotage"), "text can carry the severe concepts (unlike photo)");
  assert.ok(!keys.some((k) => k.includes("INTE")), "unknown concept rejected");
  // weights come from the concept table (sabotage = 3).
  assert.equal(x.behaviours.find((b) => b.key === "beteende:sabotage")!.weight, 3);
  assert.equal(x.behaviours.find((b) => b.key === "beteende:optik")!.weight, 2);
});

test("parseTextExtraction: defensive on stray tokens / bad JSON / empty", () => {
  assert.equal(parseTextExtraction("not json", CONCEPTS), null);
  const empty = parseTextExtraction("{}", CONCEPTS)!;
  assert.deepEqual(empty, { marks: [], behaviours: [] });
  const wrapped = parseTextExtraction('ok: {"kännetecken":["röd keps"],"beteenden":[]} .', CONCEPTS)!;
  assert.equal(wrapped.marks[0].label, "röd keps");
});

test("normalizeMarkKey: order-insensitive, article/punctuation-stripped", () => {
  assert.equal(normalizeMarkKey("orange ryggsäck"), normalizeMarkKey("ryggsäck, orange"));
  assert.equal(normalizeMarkKey("en röd keps"), "keps röd");
  assert.notEqual(normalizeMarkKey("röd keps"), normalizeMarkKey("blå keps"));
});

test("parseTextExtraction dedupes marks that normalise to the same key", () => {
  const x = parseTextExtraction(
    JSON.stringify({ kännetecken: ["orange ryggsäck", "ryggsäck orange"], beteenden: [] }),
    CONCEPTS,
  )!;
  assert.equal(x.marks.length, 1, "same key → one mark");
});

test("clusterTextMarks: a distinctive mark in ≥2 reports nominates; once does not", () => {
  const entries: TextMarkEntry[] = [
    { file: "a.md", tnr: "1", tidpunkt: "2026-07-05T02:00", plats: "P", sagesman: "AQ", marks: [{ label: "orange ryggsäck", key: normalizeMarkKey("orange ryggsäck") }] },
    { file: "b.md", tnr: "2", tidpunkt: "2026-07-06T03:00", plats: "P", sagesman: "BQ", marks: [{ label: "ryggsäck orange", key: normalizeMarkKey("ryggsäck orange") }] },
    { file: "c.md", tnr: "3", tidpunkt: "2026-07-06T04:00", plats: "P", sagesman: "CQ", marks: [{ label: "grön jacka", key: normalizeMarkKey("grön jacka") }] },
  ];
  const noms = clusterTextMarks(entries);
  assert.equal(noms.length, 1, "only the twice-seen mark");
  assert.equal(noms[0].count, 2);
  assert.deepEqual(noms[0].files.sort(), ["a.md", "b.md"]);
  assert.equal(noms[0].firstSeen, "2026-07-05T02:00");
});

test("clusterTextMarks: same mark twice in ONE report is not a pattern", () => {
  const entries: TextMarkEntry[] = [
    { file: "a.md", tnr: "1", tidpunkt: "t", plats: "P", sagesman: "AQ", marks: [
      { label: "röd mössa", key: normalizeMarkKey("röd mössa") },
      { label: "mössa röd", key: normalizeMarkKey("mössa röd") },
    ] },
  ];
  assert.equal(clusterTextMarks(entries).length, 0, "one report → no re-id");
});

test("clusterTextMarks: nominations carry per-report evidence (tnr/time/place + that report's phrasing) and the most descriptive label", () => {
  const entry = (file: string, tnr: string, tidpunkt: string, plats: string, label: string) => ({
    file, tnr, tidpunkt, plats, sagesman: "AQ",
    marks: [{ key: "jacka röd", label }],
  });
  const [nom] = clusterTextMarks([
    entry("reports/TNR150900.md", "150900", "2026-06-15T09:00:00", "Norra grinden", "röd"),
    entry("reports/TNR161000.md", "161000", "2026-06-16T10:00:00", "Bryggan", "röd jacka med kapuschong"),
  ]);
  assert.equal(nom.label, "röd jacka med kapuschong", "longest phrasing is the representative label");
  assert.equal(nom.members.length, 2);
  assert.deepEqual(
    nom.members.map((m) => [m.tnr, m.plats, m.label]),
    [["150900", "Norra grinden", "röd"], ["161000", "Bryggan", "röd jacka med kapuschong"]],
    "members keep report identity + per-report phrasing, chronologically",
  );
});
