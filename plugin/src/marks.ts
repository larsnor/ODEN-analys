/*
 * Job B — mark extraction + normalization (PLUGIN_DESIGN §6.2). Pure TS, ZERO
 * Obsidian imports → testable outside Obsidian.
 *
 * Deterministic floor: segment the Symbol prose into clauses, classify each
 * (negation / coref / exclusion / object), ATTACH trailing detail clauses to the
 * preceding object (a mark commonly spans two comma-clauses — object in clause
 * N, the marking/visibility detail in N+1), then normalize surface tokens to a
 * canonical attribute-set with a stable `signature`.
 *
 * This module NOMINATES nothing and MERGES nothing — it only extracts. Matching
 * lives in jobb.ts; the asymmetry principle (§6.1) is enforced there.
 */
import { Report } from "./parse";
import {
  AttrDim,
  COLOUR_SYNONYMS,
  COREF_CUES,
  EXCLUSIONS,
  ITEM_WORDS,
  MARKING_WORDS,
  NEGATION_CUES,
  ObjectCategory,
  OBJECT_SYNONYMS,
  OPTIC_TYPES,
  POSITION_SYNONYMS,
  SIGNATURE_DIMS,
  VISIBILITY_WORDS,
} from "./vocab";

/** A canonical attribute value on one dimension, e.g. {dim:"farg",value:"mörk"}. */
export interface NormAttr {
  dim: AttrDim;
  value: string;
}

/** A mark detected in one report, after normalization (§6.2 step 1+2). */
export interface NormalizedMark {
  file: string;
  tnr: string;
  tidpunkt: string;
  plats: string;
  sagesman: string;
  object: ObjectCategory;
  /** Canonical attribute-set, deterministically sorted. */
  attrs: NormAttr[];
  /** Stable matching key: "object#dim:value|dim:value" over SIGNATURE dims. */
  signature: string;
  /** True iff all of the category's identity dims are populated (§6.2 floor).
   *  Non-distinctive marks (e.g. a bare noise backpack) are never nominated. */
  distinctive: boolean;
  /** Source clause(s) this mark came from — the audit trace. */
  rawClauses: string[];
  /** "samma man som igår" seen in this report — flagged, never resolved. */
  corefFlagged: boolean;
}

interface Clause {
  text: string;
  lower: string;
}

/** One in-progress object mark while we scan clauses. */
interface OpenMark {
  object: ObjectCategory;
  attrs: Map<AttrDim, Set<string>>;
  rawClauses: string[];
  negated: boolean;
}

/** Strip [[wikilinks]] (plate spans) so a plate alias never leaks into a clause. */
function stripLinks(symbol: string): string {
  return symbol.replace(/!?\[\[[^\]]*\]\]/g, " ");
}

/** Segment on '.', ',', and the conjunctions och/samt; keep '/' intact so
 *  "mössa/keps" and "arbetskläder/varselväst" survive as single tokens. */
function segment(symbol: string): Clause[] {
  return stripLinks(symbol)
    .split(/[.,]|\b(?:och|samt)\b/i)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => ({ text: s, lower: s.toLowerCase() }));
}

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/** Does a clause negate an object ("utan väska", "inga särskilda kännetecken")?
 *  Word-boundary matched — substring matching would falsely fire on e.g.
 *  "bakr[utan]" containing the cue "utan". */
function isNegation(lower: string): boolean {
  return NEGATION_CUES.some((cue) => new RegExp(`\\b${cue.trim()}\\b`).test(lower));
}

function isExclusion(lower: string): boolean {
  return EXCLUSIONS.some((e) => lower.includes(e));
}

/** Find a backpack/headwear object word in a clause. */
function objectWordIn(lower: string): ObjectCategory | null {
  for (const word of Object.keys(OBJECT_SYNONYMS)) {
    if (lower.includes(word)) return OBJECT_SYNONYMS[word];
  }
  return null;
}

function hasMarkingWord(lower: string): boolean {
  return MARKING_WORDS.some((w) => lower.includes(w));
}

function positionIn(lower: string): string | null {
  for (const word of Object.keys(POSITION_SYNONYMS)) {
    if (lower.includes(word)) return POSITION_SYNONYMS[word];
  }
  return null;
}

/** A RARE-item word (verktyg/teknik) in a clause → its {category,item}, else null. */
function itemWordIn(lower: string): { category: ObjectCategory; item: string } | null {
  for (const word of Object.keys(ITEM_WORDS)) {
    if (lower.includes(word)) return ITEM_WORDS[word];
  }
  return null;
}

/** Collect canonical attribute values present in a clause. */
function attrsIn(lower: string): Array<[AttrDim, string]> {
  const out: Array<[AttrDim, string]> = [];
  // colour
  for (const word of Object.keys(COLOUR_SYNONYMS)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) out.push(["farg", COLOUR_SYNONYMS[word]]);
  }
  // marking presence (canonical value "ja")
  if (hasMarkingWord(lower)) out.push(["marking", "ja"]);
  // distinctive optic sub-type (the identity dim for `optik`; plain kikare/kamera
  // has none → non-distinctive)
  for (const word of Object.keys(OPTIC_TYPES)) {
    if (lower.includes(word)) out.push(["typ", OPTIC_TYPES[word]]);
  }
  // visibility (multi-word forms first; any hit -> otydlig)
  if (VISIBILITY_WORDS.some((w) => lower.includes(w))) out.push(["synlighet", "otydlig"]);
  // position (rear window)
  const pos = positionIn(lower);
  if (pos) out.push(["position", pos]);
  // text content (-TAC / DGE) — corroborating only, not part of the signature
  if (/\b-?tac\b/.test(lower)) out.push(["text", "TAC"]);
  if (/\bdge\b/.test(lower)) out.push(["text", "DGE"]);
  return out;
}

/** Is this a "detail" clause that can attach to an open object mark?
 *  (has an attribute, no own object, not an exclusion). */
function isDetailClause(lower: string): boolean {
  if (objectWordIn(lower)) return false;
  if (isExclusion(lower)) return false;
  if (isNegation(lower)) return false;
  return attrsIn(lower).length > 0;
}

function addAttrs(mark: OpenMark, pairs: Array<[AttrDim, string]>): void {
  for (const [dim, value] of pairs) {
    if (!mark.attrs.has(dim)) mark.attrs.set(dim, new Set());
    mark.attrs.get(dim)!.add(value);
  }
}

function finalizeAttrs(mark: OpenMark): NormAttr[] {
  const out: NormAttr[] = [];
  for (const [dim, values] of mark.attrs) {
    for (const value of values) out.push({ dim, value });
  }
  // Deterministic order for idempotency.
  return out.sort((a, b) => a.dim.localeCompare(b.dim) || a.value.localeCompare(b.value));
}

/** Build the matching signature from the category's identity dims only. */
function buildSignature(object: ObjectCategory, attrs: NormAttr[]): { signature: string; distinctive: boolean } {
  const dims = SIGNATURE_DIMS[object];
  const parts: string[] = [];
  let distinctive = true;
  for (const dim of dims) {
    const values = attrs
      .filter((a) => a.dim === dim)
      .map((a) => a.value)
      .sort();
    if (values.length === 0) distinctive = false;
    else parts.push(`${dim}:${values.join(",")}`);
  }
  return { signature: `${object}#${parts.join("|")}`, distinctive };
}

/**
 * Extract normalized marks from one report's Symbol prose.
 * Returns one NormalizedMark per detected object mark (may be several).
 */
export function extractMarks(report: Report): NormalizedMark[] {
  // New format: the descriptive content is the free-prose `Händelse`; the old
  // format put marks in the telegraphic `Symbol`. Read BOTH (joined) so the
  // extractor works on either — old corpus has no Händelse → falls back to
  // Symbol (no regression). NB: free-prose Händelse is harder for the
  // deterministic vocabulary than the old telegraphic Symbol — that recall gap
  // is the honest signal for where the LLM (open-vocab) is needed.
  const source = [report.handelse, report.symbol].filter(Boolean).join(". ");
  const clauses = segment(source);
  const corefFlagged = clauses.some((c) => containsAny(c.lower, COREF_CUES));

  const marks: OpenMark[] = [];
  let open: OpenMark | null = null;

  const closeOpen = () => {
    if (open && !open.negated) marks.push(open);
    open = null;
  };

  for (const clause of clauses) {
    const lower = clause.lower;

    // 1. Rare item (verktyg/teknik) takes precedence — a breaching tool / signals
    //    gear is more salient than an incidental bag ("störsändare i väskan").
    const item = itemWordIn(lower);
    if (item) {
      closeOpen();
      open = { object: item.category, attrs: new Map(), rawClauses: [clause.text], negated: isNegation(lower) };
      addAttrs(open, [["item", item.item]]);
      continue;
    }

    // 2. Object clause (backpack/headwear/optics).
    const obj = objectWordIn(lower);
    if (obj) {
      closeOpen();
      open = { object: obj, attrs: new Map(), rawClauses: [clause.text], negated: isNegation(lower) };
      addAttrs(open, attrsIn(lower));
      continue;
    }

    // 3. Vehicle decal: a marking noun + a rear-window position word.
    if (hasMarkingWord(lower) && positionIn(lower)) {
      closeOpen();
      open = { object: "fordon-dekal", attrs: new Map(), rawClauses: [clause.text], negated: isNegation(lower) };
      addAttrs(open, attrsIn(lower));
      continue;
    }

    // 4. Trailing detail attaches to the open object mark.
    if (open && isDetailClause(lower)) {
      open.rawClauses.push(clause.text);
      addAttrs(open, attrsIn(lower));
      continue;
    }

    // 5. Anything else (exclusion / generic / negation) closes the open mark.
    closeOpen();
  }
  closeOpen();

  return marks.map((m) => {
    const attrs = finalizeAttrs(m);
    const { signature, distinctive } = buildSignature(m.object, attrs);
    return {
      file: report.file,
      tnr: report.tnr,
      tidpunkt: report.tidpunkt,
      plats: report.plats,
      sagesman: report.sagesman,
      object: m.object,
      attrs,
      signature,
      distinctive,
      rawClauses: m.rawClauses,
      corefFlagged,
    };
  });
}

/** Extract normalized marks across many reports (flat, deterministic order). */
export function extractNormalized(reports: Report[]): NormalizedMark[] {
  const all: NormalizedMark[] = [];
  for (const r of reports) all.push(...extractMarks(r));
  return all.sort(
    (a, b) =>
      a.object.localeCompare(b.object) ||
      a.signature.localeCompare(b.signature) ||
      a.tidpunkt.localeCompare(b.tidpunkt) ||
      a.tnr.localeCompare(b.tnr) ||
      a.file.localeCompare(b.file),
  );
}

/** Human-readable label for a normalized mark (deterministic). */
export function markLabel(object: ObjectCategory, attrs: NormAttr[]): string {
  const noun: Record<ObjectCategory, string> = {
    ryggsack: "ryggsäck",
    huvudbonad: "keps/mössa",
    "fordon-dekal": "fordonsdekal",
    optik: "optik",
    verktyg: "verktyg",
    teknik: "teknik",
  };
  const farg = attrs.filter((a) => a.dim === "farg").map((a) => a.value).join("/");
  const extras: string[] = [];
  if (attrs.some((a) => a.dim === "marking")) extras.push("märke");
  if (attrs.some((a) => a.dim === "synlighet")) extras.push("otydligt");
  if (attrs.some((a) => a.dim === "position")) extras.push("bak");
  // The specific sub-type / item IS the identity for optik/verktyg/teknik.
  for (const a of attrs) if (a.dim === "typ" || a.dim === "item") extras.push(a.value);
  const text = attrs.filter((a) => a.dim === "text").map((a) => a.value);
  if (text.length) extras.push(text.join("/"));
  const head = [farg, noun[object]].filter(Boolean).join(" ");
  return extras.length ? `${head} (${extras.join(", ")})` : head;
}
