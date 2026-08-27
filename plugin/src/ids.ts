/*
 * Deterministic identifier extraction (pure TS, Obsidian-free).
 *
 * Decouples analysis from the assumption that the intake app (källappen)
 * pre-links identifiers as `[[wikilinks]]`. The Händelse format ships plain
 * prose (Händelse / Ställe / Symbol) and may emit NO links at all — so the
 * plugin extracts verified identifiers ITSELF, from links AND prose, and types
 * them:
 *
 *   actor-identity : plate, personnummer   → plate re-id auto-merge candidates
 *   location       : MGRS grid             → spatial clustering, NOT actor id
 *   source         : signal sender id      → provenance / "same observer"
 *
 * This is the deterministic floor for "verified clear inputs" the operator asked
 * to generalize (plates today; personnummer/grids now; logos/marks stay soft in
 * mark nomination). It runs the same regardless of whether the intake app links
 * anything.
 */
import { Report } from "./parse";

export type IdentifierType = "plate" | "personnummer" | "mgrs" | "sender";
export type IdentifierRole = "actor" | "location" | "source";
export type IdentifierSource =
  | "link"
  | "prose-handelse"
  | "prose-stalle"
  | "prose-symbol"
  | "frontmatter"
  | "photo"; // operator-confirmed from an attached photo (llm-vision)

export interface Identifier {
  type: IdentifierType;
  role: IdentifierRole;
  value: string; // normalized (uppercase, spaces removed)
  raw: string; // as seen
  partial?: boolean; // plates only: contains wildcard '.'
  source: IdentifierSource;
}

// Swedish plate in prose: 3 letters (excl I O Q V) + optional space + 2 digits +
// 1 digit/letter. Matches "RJK241" and "RJK 241".
const PLATE_PROSE = /\b([ABCDEFGHJKLMNPRSTUWXYZ]{3})\s?([0-9]{2}[0-9ABCDEFGHJKLMNPRSTUWXYZ])\b/g;
// PARTIAL plate mask in prose ("reg RJK2..", "..G41."). The real Bin 1 fails to
// wrap dot-edged masks in [[links]] (its regex uses \b, and there is no word
// boundary between a dot and a space) — so the mask reaches us as plain prose
// and must be read here. NB deliberately NOT \b-delimited for the same reason:
// explicit lookarounds instead. A mask is EXACTLY 6 chars (FORMAT_SPEC §6.4);
// a 7th "." after the match is sentence punctuation, not part of the mask.
const PARTIAL_PROSE = /(?<![A-ZÅÄÖ0-9.])([A-Z.]{3}[0-9.]{2}[0-9A-Z.])(?![A-Z0-9])/g;
/** A prose token is accepted as a partial mask only when ≥1 position is masked
 *  AND ≥3 positions were actually read — "N.N..." (initials + ellipsis) or a
 *  bare "..." must never become re-id evidence. Explicit [[links]] are trusted
 *  at the spec minimum (1 read position) as before. */
function isProsePartial(token: string): boolean {
  const dots = (token.match(/\./g) ?? []).length;
  return dots >= 1 && token.length - dots >= 3;
}
// Personnummer: require a separator to avoid matching arbitrary digit runs.
const PERSONNUMMER = /\b(\d{6}|\d{8})[-+](\d{4})\b/g;
// MGRS: zone(1-2) + band letter(C-X) + 2 square letters + easting + northing.
const MGRS = /\b(\d{1,2}[C-X][A-Z]{2})\s?(\d{2,5})\s?(\d{2,5})\b/g;

function normPlate(s: string): string {
  return s.replace(/\s+/g, "").toUpperCase();
}

/** Scan one prose blob for plates / personnummer / MGRS. */
function scanProse(text: string, source: IdentifierSource): Identifier[] {
  if (!text) return [];
  const out: Identifier[] = [];
  let m: RegExpExecArray | null;

  PLATE_PROSE.lastIndex = 0;
  const fullSpans: Array<[number, number]> = [];
  while ((m = PLATE_PROSE.exec(text)) !== null) {
    const value = normPlate(m[1] + m[2]);
    out.push({ type: "plate", role: "actor", value, raw: m[0], partial: false, source });
    fullSpans.push([m.index, m.index + m[0].length]);
  }
  PARTIAL_PROSE.lastIndex = 0;
  while ((m = PARTIAL_PROSE.exec(text)) !== null) {
    const token = m[1];
    if (!isProsePartial(token)) continue;
    // Never carve a partial out of a span already read as a full plate
    // ("RJK241." must not additionally spawn a bogus mask).
    const s = m.index;
    if (fullSpans.some(([a, b]) => s < b && s + token.length > a)) continue;
    out.push({ type: "plate", role: "actor", value: token.toUpperCase(), raw: token, partial: true, source });
  }
  PERSONNUMMER.lastIndex = 0;
  while ((m = PERSONNUMMER.exec(text)) !== null) {
    out.push({ type: "personnummer", role: "actor", value: `${m[1]}-${m[2]}`, raw: m[0], source });
  }
  MGRS.lastIndex = 0;
  while ((m = MGRS.exec(text)) !== null) {
    out.push({ type: "mgrs", role: "location", value: (m[1] + m[2] + m[3]).toUpperCase(), raw: m[0], source });
  }
  return out;
}

/**
 * Extract every identifier from a report, from links + prose + frontmatter.
 * Deduped by (type, value, partial). Link-sourced plates win over prose for the
 * same value (a linked plate is the higher-confidence provenance).
 */
export function extractIdentifiers(report: Report): Identifier[] {
  const found: Identifier[] = [];

  // 1. Pre-linked identifiers (if the intake app emits them).
  for (const l of report.links) {
    if (l.kind === "plate-full" || l.kind === "plate-partial") {
      const target = l.raw.split("|")[0].trim();
      found.push({
        type: "plate",
        role: "actor",
        value: normPlate(target),
        raw: target,
        partial: l.kind === "plate-partial",
        source: "link",
      });
    }
  }

  // 2. Prose (the Händelse format's real content lives here).
  found.push(...scanProse(report.handelse ?? "", "prose-handelse"));
  found.push(...scanProse(report.stalle ?? "", "prose-stalle"));
  found.push(...scanProse(report.symbol ?? "", "prose-symbol"));

  // 2b. Operator-CONFIRMED photo plates — injected as if typed, so plate re-id
  //     re-identifies a vehicle whose plate only ever appeared in an image. Only
  //     confirmed plates reach here (main.ts attaches them post-parse).
  for (const p of report.photoPlates ?? []) {
    const v = normPlate(p);
    if (v) found.push({ type: "plate", role: "actor", value: v, raw: p, partial: false, source: "photo" });
  }

  // 3. Frontmatter sender identity.
  if (report.signalAvsandareId) {
    found.push({
      type: "sender",
      role: "source",
      value: report.signalAvsandareId,
      raw: report.signalAvsandareId,
      source: "frontmatter",
    });
  }

  // Dedupe by (type|value|partial); prefer link source for plates.
  const byKey = new Map<string, Identifier>();
  for (const id of found) {
    const key = `${id.type}|${id.value}|${id.partial ? "p" : "f"}`;
    const existing = byKey.get(key);
    if (!existing || (id.source === "link" && existing.source !== "link")) byKey.set(key, id);
  }
  return [...byKey.values()].sort(
    (a, b) => a.type.localeCompare(b.type) || a.value.localeCompare(b.value),
  );
}

/** Plate identifiers only (the key used by plate re-identification / suspects). */
export function plateIdentifiers(report: Report): Identifier[] {
  return extractIdentifiers(report).filter((i) => i.type === "plate");
}
