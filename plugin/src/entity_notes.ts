/*
 * Entity-note rendering — Job A output (PLUGIN_DESIGN §5 write contract).
 *
 * Pure TS, Obsidian-free: turns a PlateEntity into (filename, markdown). The
 * Obsidian side (main.ts) does the actual writing and ownership checks.
 *
 * Provenance (§2, §6.4 — two axes, do not conflate):
 *   källa: 7s-plugin       → the plugin WROTE this file.
 *   föreslagen-av: deterministisk → Job A (deterministic) produced the finding.
 * Job A merges are CERTAIN ID matches (§6.1), so they are asserted by the
 * deterministic engine — no operator confirmation needed for the merge itself.
 *
 * Idempotency (§5.4): identical entities → byte-identical files. All ordering is
 * fixed upstream in reid.ts; we only format here.
 */
import { PlateEntity } from "./reid";

/** Marker used to recognise plugin-owned files on disk (§5.2). */
export const GENERATOR = "7s-plugin";

export interface RenderedNote {
  /** Vault-relative filename WITHIN the entities folder (no folder prefix). */
  filename: string;
  markdown: string;
}

/** Filesystem-safe filename from a plate (dots/illegal chars → underscore). */
export function safeFilename(canonical: string): string {
  return canonical.replace(/[\\/:*?"<>|.\s]/g, "_") + ".md";
}

function tnrLink(o: { file: string; tnr: string }): string {
  // Link by file stem (the note title), label with the TNR for readability.
  const stem = o.file.replace(/^.*\//, "").replace(/\.md$/, "");
  return `[[${stem}|TNR${o.tnr}]]`;
}

function frontmatter(e: PlateEntity): string {
  const lines = [
    "---",
    "typ: entitet",
    `slag: ${e.slag}`,
    `namn: "${e.canonical}"`,
    `källa: ${GENERATOR}`,
    `generator: ${GENERATOR}`,
    "föreslagen-av: deterministisk",
    "metod: jobb-a",
    `antal_observationer: ${e.count}`,
  ];
  if (e.firstSeen) lines.push(`forsta_observation: "${e.firstSeen}"`);
  if (e.lastSeen) lines.push(`sista_observation: "${e.lastSeen}"`);
  lines.push("taggar: [fordon]");
  lines.push("---");
  return lines.join("\n");
}

export function renderEntityNote(e: PlateEntity): RenderedNote {
  const body: string[] = [];
  body.push(`# ${e.canonical}`);
  body.push("");
  body.push(`**Slag:** ${e.slag}  `);
  body.push(`**Antal observationer:** ${e.count}  `);
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
    body.push(`- ${tnrLink(o)} — ${o.tidpunkt} — ${o.plats}${shown}`);
  }
  body.push("");
  body.push(
    "_Genererad av ODEN utifrån samma registreringsnummer. Säkra matchningar " +
      "slås ihop automatiskt; tveksamma fall föreslås bara för granskning._",
  );

  return {
    filename: safeFilename(e.canonical),
    markdown: frontmatter(e) + "\n\n" + body.join("\n") + "\n",
  };
}

/** Render all entities → notes (deterministic order from reid.ts preserved). */
export function renderAll(entities: PlateEntity[]): RenderedNote[] {
  return entities.map(renderEntityNote);
}

/** Does an existing file's text mark it as plugin-owned (§5.2)? */
export function isPluginOwned(fileText: string): boolean {
  // Cheap frontmatter check: a `generator: 7s-plugin` line in the YAML head.
  const head = fileText.slice(0, 600);
  return new RegExp(`(^|\\n)generator:\\s*${GENERATOR}\\b`).test(head);
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
