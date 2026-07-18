/*
 * Shared primitives for the plugin-owned note layer (pure, Obsidian-free).
 *
 * These used to be re-declared in every *_notes.ts module (6× GENERATOR, 6×
 * RenderedNote, 12× stem-strip, two copies of the merge resolver) and the `metod`
 * tags were hard-coded as bare string literals in both the renderers and main.ts —
 * so a reviewer could not tell the constants from the contract. This module is the
 * single source of truth for all of them.
 */

/** Marker written into every plugin-owned note's frontmatter, so the write-contract
 *  (§5.2) can recognise files it owns and may overwrite/prune. */
export const GENERATOR = "7s-plugin";

/** `metod` tags — the per-job pruning key of the write-contract (§5). A run for one
 *  metod never deletes notes of another. The SINGLE source of truth: both the note
 *  renderers and main.ts's write/prune use these, never bare literals. */
export const METOD = {
  jobbA: "jobb-a", // Job A vehicle entities
  jobbB: "jobb-b", // Job B confirmed marks
  aktor: "aktor", // confirmed actor nodes
  larm: "larm", // suspect/alarm markers
  plats: "plats", // location hubs
  objektet: "objektet", // the AOI marker
  aterkomst: "aterkomst", // recurrence nodes
  textmarke: "text-marke", // LLM open-vocab kännetecken (confirmed, föreslagen-av: llm)
} as const;

/** The AOI marker note's stem ("Objektet.md", written at operation setup). A fixed
 *  contract like the emoji prefixes: predefined places link it so they (and it)
 *  have a graph edge from day 0 — the graph hides orphans (`showOrphans: false`). */
export const OBJEKTET_STEM = "Objektet";

/** A rendered note: vault-relative filename (no folder prefix) + Markdown body. */
export interface RenderedNote {
  filename: string;
  markdown: string;
}

/** The note title (basename, no folder, no `.md`) for a vault file path — the stem a
 *  `[[wikilink]]` resolves against. */
export function noteStem(file: string): string {
  return file.replace(/^.*\//, "").replace(/\.md$/, "");
}

/** Resolve an id to its canonical survivor through an operator merge map (cycle-safe).
 *  Shared by actor merges and location merges. */
export function resolveMerge(id: string, merges?: Record<string, string>): string {
  if (!merges) return id;
  const seen = new Set<string>();
  let cur = id;
  while (merges[cur] && !seen.has(cur)) {
    seen.add(cur);
    cur = merges[cur];
  }
  return cur;
}

/** Given an observation's raw `plats`, the stem of the note (location or recurrence)
 *  to link to — or undefined when none — so a note keeps a direct graph edge even
 *  when message (TNR) nodes are filtered out. */
export type StemLinker = (plats: string) => string | undefined;

/** Given an observation FILE, the predefined place whose vicinity claimed it
 *  (note stem + display label) — or undefined. The second half of the dual place
 *  relation: the reported `plats` is linked via StemLinker, the nearest predefined
 *  place via this. */
export type NearLinker = (file: string) => { stem: string; label: string } | undefined;
