/*
 * Bildfynd notes (pure, Obsidian-free) — operator-CONFIRMED photo findings
 * materialised as vault artifacts.
 *
 * Until now a confirmed vehicle/person/scene annotation lived only in
 * settings.photoAnnotations — write-only memory (operator finding, live E2E:
 * "blå jeans" and the eld-scene were unreachable outside the review screen).
 * Confirmed judgements become NOTES in ODEN, like marks and actors — so the
 * finding is readable in Obsidian next to the embedded photo, plugin or no
 * plugin.
 *
 * One note per report that HAS confirmed photo findings, in the entities folder
 * (the owned-note machinery — idempotent rewrite, per-metod prune, judgement
 * wipes — manages only that folder; this was an explicit placement decision).
 * Provenance: föreslagen-av: llm-vision + bekräftad-av: operatör; the raw
 * sighting cache is NOT a judgement and never materialises.
 */
import { Report } from "./parse";
import { Signal } from "./suspicion";
import { safeFilename } from "./entity_notes";
import { mdText } from "./mdsafe";
import { GENERATOR, METOD, OBJEKTET_STEM, RenderedNote, noteStem } from "./notes_common";
import { safeAgentFilename } from "./notenames";
import { Nicknames, placeLabel } from "./places";

/** The confirmed-photo-finding stores, structurally = the plugin settings. */
export interface PhotoFindingState {
  photoPlates: Record<string, string[]>;
  photoAnnotations: Record<string, string[]>;
  confirmedBehaviours: Record<string, { key: string; label: string; weight: number }[]>;
}

export interface PhotoFinding {
  report: Report;
  /** Image embed targets, resolved for a note that lives in entities/ (full
   *  vault path when the attachment sits in the report's folder). */
  images: string[];
  plates: string[];
  annotations: string[];
  /** Photo-sourced behaviour signals only (labels carry "(foto)"). */
  behaviours: Signal[];
}

/** Resolve a report-relative attachment ref to something embeddable from
 *  entities/: refs with a path join the report's folder; bare names are left
 *  for Obsidian's own resolution. */
export function embedTarget(reportFile: string, att: string): string {
  if (!att.includes("/")) return att;
  const dir = reportFile.replace(/\/[^/]*$/, "");
  return dir === reportFile ? att : `${dir}/${att}`;
}

/** The reports that have ANY confirmed photo finding (pure; imageRefs supplies
 *  each report's attachment refs — the shell's imageAttachments). */
export function buildPhotoFindings(
  reports: Report[],
  s: PhotoFindingState,
  imageRefs: (r: Report) => string[],
): PhotoFinding[] {
  const out: PhotoFinding[] = [];
  for (const r of reports) {
    const plates = s.photoPlates[r.file] ?? [];
    const annotations = s.photoAnnotations[r.file] ?? [];
    const behaviours = (s.confirmedBehaviours[r.file] ?? []).filter((b) => b.label.includes("(foto)"));
    if (plates.length === 0 && annotations.length === 0 && behaviours.length === 0) continue;
    out.push({
      report: r,
      images: imageRefs(r).map((a) => embedTarget(r.file, a)),
      plates,
      annotations,
      behaviours,
    });
  }
  return out.sort((a, b) => a.report.file.localeCompare(b.report.file));
}

export function photoFindingFilename(f: PhotoFinding): string {
  return safeAgentFilename(`📷 TNR${f.report.tnr} bildfynd`, "bildfynd:" + f.report.file);
}

export function renderPhotoFindingNote(f: PhotoFinding, nicks?: Nicknames): RenderedNote {
  const r = f.report;
  const fm: string[] = [
    "---",
    "typ: bildfynd",
    `tnr: "${r.tnr}"`,
    `källa: ${GENERATOR}`,
    `generator: ${GENERATOR}`,
    "föreslagen-av: llm-vision",
    "bekräftad-av: operatör",
    `metod: ${METOD.bildfynd}`,
    "tags: [bildfynd]",
    "---",
  ];

  const body: string[] = [];
  body.push(`# 📷 Bildfynd — TNR${mdText(r.tnr)}`);
  body.push("");
  body.push(`**Rapport:** [[${noteStem(r.file)}|TNR${mdText(r.tnr)}]] — ${mdText(r.tidpunkt)} — ${mdText(placeLabel(r.plats, nicks))}  `);
  // Non-TNR edge: message nodes are hidden in the graph (-file:TNR +
  // showOrphans:false), so without this the note would be invisible there.
  body.push(`**Operationsområde:** [[${OBJEKTET_STEM}]]`);
  body.push("");
  for (const img of f.images) body.push(`![[${img}]]`);
  if (f.images.length) body.push("");
  if (f.plates.length) {
    body.push("## Regplåtar (ur foto, bekräftade)");
    // Link the vehicle entity → a direct bildfynd↔fordon graph edge.
    for (const p of f.plates) body.push(`- [[${safeFilename(p).replace(/\.md$/, "")}|${mdText(p)}]]`);
    body.push("");
  }
  if (f.annotations.length) {
    body.push("## Iakttagelser (bekräftade)");
    for (const a of f.annotations) body.push(`- ${mdText(a)}`);
    body.push("");
  }
  if (f.behaviours.length) {
    body.push("## Beteendesignaler (ur foto, bekräftade — ingår i misstankepoängen)");
    for (const b of f.behaviours) body.push(`- ${mdText(b.label)}`);
    body.push("");
  }
  body.push(
    "_Föreslaget av bildmodellen (llm-vision), bekräftat av operatören. " +
      "Iakttagelserna gäller ENDAST denna rapport — de återidentifierar ingen._",
  );

  return { filename: photoFindingFilename(f), markdown: fm.join("\n") + "\n\n" + body.join("\n") + "\n" };
}

export function renderPhotoFindingNotes(findings: PhotoFinding[], nicks?: Nicknames): RenderedNote[] {
  return findings.map((f) => renderPhotoFindingNote(f, nicks));
}
