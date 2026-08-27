/*
 * Bildfynd notes — confirmed photo findings as vault artifacts. Pure, OUTSIDE
 * Obsidian. Regression for the live E2E finding: "blå jeans" (and the eld
 * scene) were operator-CONFIRMED yet unreachable outside the review screen.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Report } from "../src/parse.ts";
import {
  buildPhotoFindings,
  embedTarget,
  renderPhotoFindingNote,
  PhotoFindingState,
} from "../src/photo_notes.ts";

function report(over: Partial<Report>): Report {
  return {
    id: over.tnr ?? "x", typ: "7S-rapport", tnr: over.tnr ?? "271637",
    tidpunkt: "2026-08-27T16:36:00", plats: "Grönsvedja", sagesman: "OKEJ",
    links: [], embeds: over.embeds ?? [], file: `TEST - Oden/TNR${over.tnr ?? "271637"}.md`, ...over,
  } as Report;
}

const IMAGES = (r: Report) => r.embeds.filter((e) => /\.jpg$/i.test(e));

function state(over: Partial<PhotoFindingState> = {}): PhotoFindingState {
  return { photoPlates: {}, photoAnnotations: {}, confirmedBehaviours: {}, ...over };
}

test("only reports with CONFIRMED findings materialise; text-sourced behaviours excluded", () => {
  const r1 = report({ tnr: "1", file: "g/TNR1.md" });
  const r2 = report({ tnr: "2", file: "g/TNR2.md" });
  const r3 = report({ tnr: "3", file: "g/TNR3.md" });
  const s = state({
    photoAnnotations: { "g/TNR1.md": ["man, medelålders, blå jeans"] },
    confirmedBehaviours: {
      "g/TNR2.md": [{ key: "beteende:optik", label: "hotindikator (text): optik", weight: 2 }], // text → not a photo finding
      "g/TNR3.md": [{ key: "beteende:optik", label: "hotindikator (foto): kikare/optik", weight: 2 }],
    },
  });
  const out = buildPhotoFindings([r1, r2, r3], s, IMAGES);
  assert.deepEqual(out.map((f) => f.report.tnr), ["1", "3"], "r2 has only a TEXT signal → no note");
  assert.equal(out[1].behaviours[0].label, "hotindikator (foto): kikare/optik");
});

test("embedTarget: pathed refs join the report's folder; bare names left to Obsidian", () => {
  assert.equal(
    embedTarget("TEST - Oden/TNR271637.md", "20260827_x/1_a.jpg"),
    "TEST - Oden/20260827_x/1_a.jpg",
  );
  assert.equal(embedTarget("TEST - Oden/TNR271637.md", "bild_140755.jpg"), "bild_140755.jpg");
});

test("operator links render as edges; dangling refs as text; a link alone keeps the note", () => {
  const r = report({});
  // No confirmed findings at all — only the operator's asserted link.
  const linksFor = () => [
    { kind: "fordon" as const, label: "RJK241", stem: "RJK241" },
    { kind: "aktör" as const, label: "Ledaren", stem: "🕸️ Ledaren" },
    { kind: "aktör" as const, label: "försvunnen-aktör", stem: undefined },
  ];
  const out = buildPhotoFindings([r], state(), IMAGES, linksFor);
  assert.equal(out.length, 1, "the assertion IS a judgement — note stays alive");
  const md = renderPhotoFindingNote(out[0]).markdown;
  assert.match(md, /## Kopplingar \(operatörens utsaga\)/);
  assert.match(md, /\*\*Fordon:\*\* \[\[RJK241\|RJK241\]\]/, "vehicle edge");
  assert.match(md, /\*\*Aktör:\*\* \[\[🕸️ Ledaren\|Ledaren\]\]/, "actor edge");
  assert.match(md, /försvunnen-aktör _\(saknas i nuvarande material\)_/, "dangling ref = text, no ghost node");
  assert.match(md, /föreslagen-av: operatör/, "the assertion provenance is stated");
  assert.match(md, /rapportfil: "TEST - Oden\/TNR271637.md"/, "identity key for the koppla flows");
});

test("note: provenance, embedded image, report + Objektet edges, vehicle link, idempotent", () => {
  const r = report({ embeds: ["20260827_joel/1_photo.jpg"] });
  const s = state({
    photoPlates: { [r.file]: ["RJK241"] },
    photoAnnotations: { [r.file]: ["svart grill, två behållare på grillen"] },
  });
  const [f] = buildPhotoFindings([r], s, IMAGES);
  const a = renderPhotoFindingNote(f);
  const b = renderPhotoFindingNote(f);
  assert.equal(a.markdown, b.markdown, "byte-identical (idempotent)");
  assert.equal(a.filename, "📷 TNR271637 bildfynd.md");
  assert.match(a.markdown, /föreslagen-av: llm-vision/);
  assert.match(a.markdown, /bekräftad-av: operatör/);
  assert.match(a.markdown, /metod: bildfynd/);
  assert.match(a.markdown, /!\[\[TEST - Oden\/20260827_joel\/1_photo\.jpg\]\]/, "image embedded by full path");
  assert.match(a.markdown, /\[\[TNR271637\|TNR271637\]\]/, "report link kept for traceability");
  assert.match(a.markdown, /\[\[Objektet\]\]/, "non-TNR edge → graph-visible");
  assert.match(a.markdown, /\[\[RJK241\|RJK241\]\]/, "direct bildfynd↔fordon edge");
  assert.match(a.markdown, /svart grill, två behållare/);
  assert.match(a.markdown, /återidentifierar ingen/, "report-local scope stated");
});
