/*
 * Operator merges (§6.4-follow-up): two confirmed actor hypotheses the operator
 * asserts are the SAME person fold into ONE combined node; the emoji filename can
 * be driven by the operator's free-text name. Pure, so testable without Obsidian.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildActorHypotheses, foldActorMerges, ActorHypothesis } from "../src/actor.ts";
import { actorFilename, renderActorNote } from "../src/actor_notes.ts";
import { parseReport, Report } from "../src/parse.ts";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
function loadReports(): Report[] {
  const dir = join(here, "fixtures", "reports");
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports/${f}`));
}

test("filename uses the 🕸️ emoji cue and no 'Aktör' word", () => {
  const [h] = buildActorHypotheses(loadReports(), { threshold: 1 }).hypotheses;
  const f = actorFilename(h);
  assert.ok(f.startsWith("🕸️ "), `expected emoji prefix, got ${f}`);
  assert.doesNotMatch(f, /Aktör/, "the type word must stay out of the name");
});

test("an operator name overrides the actor filename + note title", () => {
  const [h] = buildActorHypotheses(loadReports(), { threshold: 1 }).hypotheses;
  assert.equal(actorFilename(h, "Ledaren"), "🕸️ Ledaren.md");
  const note = renderActorNote(h, "Ledaren", undefined, "Ledaren");
  assert.equal(note.filename, "🕸️ Ledaren.md");
  assert.match(note.markdown, /# 🕸️ Ledaren/);
  assert.match(note.markdown, /namn: "Ledaren"/);
});

test("actor note links its chain places DIRECTLY to location notes when a linker is given", () => {
  const [h] = buildActorHypotheses(loadReports(), { threshold: 1 }).hypotheses;
  const place = h.chain[0].plats;
  const stem = "📍 Testplats";
  const linked = renderActorNote(h, undefined, undefined, undefined, (p) => (p === place ? stem : undefined));
  assert.ok(linked.markdown.includes(`[[${stem}|`), "chain place is a wikilink to the location node");
  // Without a linker, the same place renders as plain text (no location note exists).
  const plain = renderActorNote(h);
  assert.ok(!plain.markdown.includes(`[[${stem}`), "no ghost link when the place has no node");
});

test("no merges → hypotheses pass through unchanged", () => {
  const hyps = buildActorHypotheses(loadReports(), { threshold: 1 }).hypotheses;
  assert.deepEqual(foldActorMerges(hyps, {}), hyps);
});

test("merging two hypotheses yields one combined node with the union of facets", () => {
  // Two synthetic single-facet hypotheses → merge A into B.
  const mk = (id: string, label: string, kind: "fordon" | "kannetecken"): ActorHypothesis => ({
    id,
    facets: [{ id: `${kind}:${label}`, kind, type: kind === "fordon" ? "fordon" : "person", label, noteStem: label, files: [`${label}.md`] }],
    types: [kind === "fordon" ? "fordon" : "person"],
    vehicleCount: kind === "fordon" ? 1 : 0,
    markCount: kind === "kannetecken" ? 1 : 0,
    edges: [],
    chain: [{ tnr: label, tidpunkt: "2026-06-16T10:00:00", plats: "P", file: `${label}.md`, facets: [label] }],
    reportFiles: [`${label}.md`],
    firstSeen: "2026-06-16T10:00:00",
    lastSeen: "2026-06-16T10:00:00",
    explanation: "x",
    method: "aktor",
    föreslagenAv: "deterministisk",
  });
  const a = mk("suspect-a", "RJK241", "fordon");
  const b = mk("suspect-b", "mörk hoodie", "kannetecken");

  const folded = foldActorMerges([a, b], { "suspect-a": "suspect-b" });
  assert.equal(folded.length, 1, "two hypotheses collapse into one node");
  const [combined] = folded;
  assert.equal(combined.id, "suspect-b", "survivor id is canonical");
  assert.equal(combined.facets.length, 2, "union of both facets");
  assert.equal(combined.vehicleCount, 1);
  assert.equal(combined.markCount, 1);
  assert.match(combined.explanation, /Sammanslagen aktör/);
});

test("merge chain a→b→c collapses all three onto the final survivor", () => {
  const mk = (id: string): ActorHypothesis => ({
    id, facets: [], types: [], vehicleCount: 0, markCount: 0, edges: [], chain: [],
    reportFiles: [], firstSeen: "", lastSeen: "", explanation: "x", method: "aktor", föreslagenAv: "deterministisk",
  });
  const a = mk("a"), b = mk("b"), c = mk("c");
  const folded = foldActorMerges([a, b, c], { a: "b", b: "c" });
  assert.equal(folded.length, 1, "chain-following collapses a→b→c into one node");
  assert.equal(folded[0].id, "c", "survivor is the end of the chain");
});

test("a merge cycle terminates safely (no infinite loop)", () => {
  const mk = (id: string): ActorHypothesis => ({
    id, facets: [], types: [], vehicleCount: 0, markCount: 0, edges: [], chain: [],
    reportFiles: [], firstSeen: "", lastSeen: "", explanation: "x", method: "aktor", föreslagenAv: "deterministisk",
  });
  const [a, b, c] = ["a", "b", "c"].map(mk);
  // A pathological cycle a→b→c→a must not hang; the guard breaks it.
  const folded = foldActorMerges([a, b, c], { a: "b", b: "c", c: "a" });
  assert.ok(folded.length >= 1, "returns without hanging");
});
