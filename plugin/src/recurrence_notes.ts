/*
 * Recurrence nodes (pure) — one node per (entity, place) pair the SAME vehicle or
 * actor was observed at 2+ times. Obsidian's core graph can't weight or label an
 * edge, so "seen here 3×" — which is edge-level information — is materialised as a
 * small node that sits ON that pair, carrying the count and naming both endpoints.
 *
 * Single visits stay as plain direct edges; only recurrence gets a node, so the
 * graph stays sparse. The plugin ROUTES the pair through this node (the location /
 * actor note links here instead of straight across), so a repeat is one labelled
 * hop rather than a plain edge plus a triangle.
 *
 * Provenance: källa/generator 7s-plugin, metod: aterkomst (own per-job prune), and
 * a `#återkomst` tag for the graph colour group.
 */
import { mdText } from "./mdsafe";
import { safeAgentFilename } from "./notenames";

export const GENERATOR = "7s-plugin";
export const RECURRENCE_METOD = "aterkomst";

export interface RenderedNote {
  filename: string;
  markdown: string;
}

export interface RecurrencePair {
  /** Stable identity: `${entityStem}@@${placeStem}` (count-independent). */
  key: string;
  entityKind: "fordon" | "aktör";
  entityStem: string; // note stem to link the entity node
  entityLabel: string;
  placeStem: string; // location note stem
  placeLabel: string;
  count: number;
}

export function recurrenceFilename(p: RecurrencePair): string {
  // The count is in the label (so the graph node shows it) but NOT in the key,
  // so the file identity is stable as the count grows (idempotent prune rewrites).
  return safeAgentFilename(`🔁 ${p.entityLabel} ×${p.count} · ${p.placeLabel}`, p.key);
}

export function renderRecurrenceNote(p: RecurrencePair): RenderedNote {
  const kindWord = p.entityKind === "fordon" ? "Fordon" : "Aktör";
  const fm = [
    "---",
    "typ: återkomst",
    `källa: ${GENERATOR}`,
    `generator: ${GENERATOR}`,
    `metod: ${RECURRENCE_METOD}`,
    "tags: [återkomst]",
    `slag: ${p.entityKind}`,
    `entitet: "${p.entityLabel.replace(/"/g, "'")}"`,
    `plats: "${p.placeLabel.replace(/"/g, "'")}"`,
    `antal: ${p.count}`,
    "---",
    "",
  ];
  const body = [
    `# 🔁 ${mdText(p.entityLabel)} ×${p.count} · ${mdText(p.placeLabel)}`,
    "",
    `**${kindWord}:** [[${p.entityStem}|${mdText(p.entityLabel)}]]  `,
    `**Plats:** [[${p.placeStem}|${mdText(p.placeLabel)}]]  `,
    `**Antal observationer här:** ${p.count}`,
    "",
    "_Återkommande närvaro — samma entitet observerad på denna plats flera gånger._",
    "",
  ];
  return { filename: recurrenceFilename(p), markdown: fm.join("\n") + body.join("\n") };
}
