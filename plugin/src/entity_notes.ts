/*
 * Entity-note rendering — plate re-identification output.
 *
 * Pure TS, Obsidian-free: turns a PlateEntity into (filename, markdown). The
 * Obsidian side (main.ts) does the actual writing and ownership checks.
 *
 * Provenance (two axes, do not conflate):
 *   källa: 7s-plugin       → the plugin WROTE this file.
 *   föreslagen-av: deterministisk → the deterministic plate re-id produced the
 *   finding.
 * Plate re-id merges are CERTAIN ID matches, so they are asserted by the
 * deterministic engine — no operator confirmation needed for the merge itself.
 *
 * Idempotency: identical entities → byte-identical files. All ordering is
 * fixed upstream in reid.ts; we only format here.
 */
import { PlateEntity } from "./reid";
import { mdText } from "./mdsafe";
import { GENERATOR, METOD, RenderedNote, noteStem } from "./notes_common";

/** Filesystem-safe filename from a plate (dots/illegal chars → underscore). */
export function safeFilename(canonical: string): string {
  return canonical.replace(/[\\/:*?"<>|.\s]/g, "_") + ".md";
}

function tnrLink(o: { file: string; tnr: string }): string {
  // Link by file stem (the note title), label with the TNR for readability.
  return `[[${noteStem(o.file)}|TNR${mdText(o.tnr)}]]`;
}

function frontmatter(e: PlateEntity, corroborated: number): string {
  const lines = [
    "---",
    "typ: entitet",
    `slag: ${e.slag}`,
    `namn: "${e.canonical}"`,
    `källa: ${GENERATOR}`,
    `generator: ${GENERATOR}`,
    "föreslagen-av: deterministisk",
    `metod: ${METOD.jobbA}`,
    `antal_observationer: ${e.count}`,
  ];
  if (corroborated > 0) lines.push(`bild_styrkt: ${corroborated}`);
  if (e.firstSeen) lines.push(`forsta_observation: "${e.firstSeen}"`);
  if (e.lastSeen) lines.push(`sista_observation: "${e.lastSeen}"`);
  lines.push("taggar: [fordon]");
  lines.push("---");
  return lines.join("\n");
}

/**
 * @param confirmed  observation files whose attached photo's plate matches this
 *   entity's plate (image-corroboration). Absent → no image handling, so
 *   the note is byte-identical to the pre-vision output (fixtures stay stable).
 */
export function renderEntityNote(e: PlateEntity, confirmed?: Set<string>): RenderedNote {
  const corroborated = confirmed ? e.observations.filter((o) => confirmed.has(o.file)).length : 0;
  const body: string[] = [];
  body.push(`# ${e.canonical}`);
  body.push("");
  body.push(`**Slag:** ${e.slag}  `);
  body.push(`**Antal observationer:** ${e.count}  `);
  if (corroborated > 0) {
    body.push(`**📷 Bildstyrkt:** ${corroborated} observation(er) med foto som bekräftar plåten  `);
  }
  if (e.firstSeen && e.lastSeen) {
    body.push(`**Tidsspann:** ${e.firstSeen} → ${e.lastSeen}  `);
  }
  if (e.sagesmän.length) body.push(`**Sagesmän:** ${e.sagesmän.join(", ")}`);
  body.push("");

  if (e.slag === "fordon-reg-full" && e.resolvedPartials.length) {
    body.push(
      "**Partiella observationer som säkert avser denna plåt** " +
        "(auto-sammanslagna, deterministisk): " +
        e.resolvedPartials.map((p) => `\`${p}\``).join(", "),
    );
    body.push("");
  }
  if (e.slag === "fordon-reg-partiell" && e.candidateFulls.length) {
    body.push(
      "_Tvetydig partiell plåt — möjliga fullständiga plåtar (kandidater, " +
        "EJ auto-sammanslagna): " +
        e.candidateFulls.map((c) => `\`${c}\``).join(", ") +
        ". Kräver operatörsbekräftelse._",
    );
    body.push("");
  }
  if (e.slag === "fordon-reg-partiell" && !e.candidateFulls.length) {
    body.push("_Ingen matchande fullständig plåt observerad i materialet ännu._");
    body.push("");
  }

  body.push("## Observationer");
  for (const o of e.observations) {
    const shown = o.shown !== e.canonical ? `  — sedd som \`${o.shown}\`` : "";
    const cam = confirmed?.has(o.file) ? " 📷" : "";
    body.push(`- ${tnrLink(o)} — ${mdText(o.tidpunkt)} — ${mdText(o.plats)}${shown}${cam}`);
  }
  body.push("");
  body.push(
    "_Genererad av ODEN utifrån samma registreringsnummer. Säkra matchningar " +
      "slås ihop automatiskt; tveksamma fall föreslås bara för granskning._",
  );

  return {
    filename: safeFilename(e.canonical),
    markdown: frontmatter(e, corroborated) + "\n\n" + body.join("\n") + "\n",
  };
}

/**
 * Render all entities → notes (deterministic order from reid.ts preserved).
 * @param confirmedByPlate  canonical plate → observation files photo-corroborated.
 */
export function renderAll(entities: PlateEntity[], confirmedByPlate?: Map<string, Set<string>>): RenderedNote[] {
  return entities.map((e) => renderEntityNote(e, confirmedByPlate?.get(e.canonical)));
}

/** Does an existing file's text mark it as plugin-owned? */
export function isPluginOwned(fileText: string): boolean {
  // Cheap frontmatter check: a `generator: 7s-plugin` line in the YAML head.
  const head = fileText.slice(0, 600);
  return new RegExp(`(^|\\n)generator:\\s*${GENERATOR}\\b`).test(head);
}

/** Read the `metod:` tag from a plugin-owned note's frontmatter (drives the per-job
 *  write-contract prune). Returns "" if absent. */
export function ownedMetod(fileText: string): string {
  const m = fileText.slice(0, 600).match(/(^|\n)metod:\s*([^\n]+)/);
  return m ? m[2].trim() : "";
}

/**
 * May writeOwnedNotes safely (over)write an existing file at a target path?
 * True when the file is plugin-owned OR empty/whitespace-only. The empty case
 * matters: a stray 0-byte file returns isPluginOwned=false, and treating it as
 * someone else's note would block us from ever writing the real content there
 * (the bug where a confirmed actor note stayed empty → orphan → hidden in graph).
 * Genuine non-empty, non-owned user notes are still protected (returns false).
 */
export function isOverwritable(fileText: string): boolean {
  return fileText.trim() === "" || isPluginOwned(fileText);
}
