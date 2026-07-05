/*
 * Recurrence nodes — a vehicle/actor seen 2+ times at the same place gets a
 * labelled node ON that pair (edge-weight is impossible in Obsidian's core graph).
 * The location/actor notes ROUTE the pair through it (no redundant direct edge).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { renderRecurrenceNote, recurrenceFilename, RecurrencePair } from "../src/recurrence_notes.ts";
import { buildLocations, renderLocationNote } from "../src/location_notes.ts";
import { renderActorNote } from "../src/actor_notes.ts";
import { buildActorHypotheses } from "../src/actor.ts";
import { analyzeSuspicion } from "../src/suspicion.ts";
import { parseReport, Report } from "../src/parse.ts";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const PROT = { protectedLat: 59.0, protectedLon: 17.0, threshold: 5 };
function report(over: Partial<Report>): Report {
  return {
    id: over.tnr ?? "x", typ: "7S-rapport", tnr: over.tnr ?? "000000",
    tidpunkt: "2026-06-16T03:00:00", plats: "Norra grinden", lat: 59.001, lon: 17.0,
    sagesman: "AQ", links: [], embeds: [], file: `reports/TNR${over.tnr ?? "000000"}.md`, ...over,
  } as Report;
}

const PAIR: RecurrencePair = {
  key: "RJK241@@📍 Norra grinden", entityKind: "fordon",
  entityStem: "RJK241", entityLabel: "RJK241",
  placeStem: "📍 Norra grinden", placeLabel: "Norra grinden", count: 3,
};

test("recurrence node names both endpoints + the count, and links them", () => {
  assert.equal(recurrenceFilename(PAIR), "🔁 RJK241 ×3 · Norra grinden.md");
  const md = renderRecurrenceNote(PAIR).markdown;
  assert.match(md, /metod: aterkomst/);
  assert.match(md, /tags: \[återkomst\]/);
  assert.match(md, /\[\[RJK241\|RJK241\]\]/, "links the vehicle node");
  assert.match(md, /\[\[📍 Norra grinden\|Norra grinden\]\]/, "links the place node");
  assert.match(md, /antal: 3/);
});

test("filename identity is stable as the count grows (count only in label)", () => {
  const p2 = { ...PAIR, count: 2 };
  const p9 = { ...PAIR, count: 9 };
  // Same key → same safe-name base; only the visible ×N differs. The prune keys on
  // metod, so the old count file is replaced, not duplicated.
  assert.notEqual(recurrenceFilename(p2), recurrenceFilename(p9));
  assert.equal(p2.key, p9.key, "stable identity independent of the count");
});

test("location note ROUTES a recurrent plate through the recurrence node (no direct edge)", () => {
  const reports = [
    report({ tnr: "1", handelse: "Fordon RJK241." }),
    report({ tnr: "2", handelse: "Fordon RJK241." }),
  ];
  const [c] = buildLocations(reports, analyzeSuspicion(reports, PROT));
  const routed = renderLocationNote(c, undefined, (pk, plate) =>
    pk === c.key && plate === "RJK241" ? "🔁 RJK241 ×2 · Norra grinden" : undefined,
  );
  assert.match(routed.markdown, /\[\[🔁 RJK241 ×2 · Norra grinden\|RJK241\]\]/, "links the recurrence node");
  assert.doesNotMatch(routed.markdown, /\[\[RJK241\|RJK241\]\]/, "NOT a direct vehicle edge");
  // Without a resolver, it falls back to the plain direct vehicle edge.
  const plain = renderLocationNote(c);
  assert.match(plain.markdown, /\[\[RJK241\|RJK241\]\]/);
});

test("actor note routes a recurrent chain-place through the recurrence node", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const dir = join(here, "fixtures", "reports");
  const reps = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports/${f}`));
  const [h] = buildActorHypotheses(reps, { threshold: 1 }).hypotheses;
  const place = h.chain[0].plats;
  const md = renderActorNote(h, undefined, undefined, undefined,
    () => "📍 loc",                                  // locStemOf (fallback)
    (p) => (p === place ? "🔁 REC" : undefined),     // recStemOf (wins)
  ).markdown;
  assert.ok(md.includes("[[🔁 REC|"), "recurrent place links the recurrence node");
});
