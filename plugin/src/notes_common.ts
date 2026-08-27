/*
 * Shared primitives for the plugin-owned note layer (pure, Obsidian-free).
 *
 * Shared constants/helpers for the *_notes renderers (GENERATOR, RenderedNote,
 * stem-stripping, the merge resolver, the `metod` tags). This module is the
 * single source of truth for all of them — the renderers and main.ts use these,
 * never bare literals, so a reviewer can tell the constants from the contract.
 */

/** Marker written into every plugin-owned note's frontmatter, so the write-contract
 *  can recognise files it owns and may overwrite/prune. */
export const GENERATOR = "7s-plugin";

/** `metod` tags — the per-job pruning key of the write-contract. A run for one
 *  metod never deletes notes of another. The SINGLE source of truth: both the note
 *  renderers and main.ts's write/prune use these, never bare literals. */
export const METOD = {
  jobbA: "jobb-a", // plate re-identification vehicle entities
  jobbB: "jobb-b", // confirmed marks (mark nomination)
  aktor: "aktor", // confirmed actor nodes
  larm: "larm", // suspect/alarm markers
  plats: "plats", // location hubs
  objektet: "objektet", // the AOI marker
  aterkomst: "aterkomst", // recurrence nodes
  bildfynd: "bildfynd", // confirmed photo findings (per report, llm-vision + operatör)
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
