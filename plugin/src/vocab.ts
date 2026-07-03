/*
 * Controlled vocabulary for Job B mark extraction (PLUGIN_DESIGN §6.2).
 *
 * DECLARATIVE DATA ONLY — no logic. This is the single audit surface for "what
 * counts as a distinctive mark" and how surface words fold to canonical values
 * (§11 reviewability; §9.1 trigger-3 "utökad vokabulär" = a one-file change).
 *
 * Derived from the real corpus + generate_reports.py. The three recon-cell
 * tells map to three object categories:
 *   tell_bag  -> ryggsack      (backpack/bag, dark, with a partial marking)
 *   tell_cap  -> huvudbonad    (cap/hat, dark with a light emblem)
 *   tell_logo -> fordon-dekal  (vehicle rear-window decal/logo)
 */

export type ObjectCategory = "ryggsack" | "huvudbonad" | "fordon-dekal";

/** Attribute axes a mark can carry. */
export type AttrDim = "farg" | "marking" | "synlighet" | "position" | "text";

/** Surface object word (lowercase) -> canonical category.
 *  NB: fordon-dekal is NOT keyed here; it is detected structurally in marks.ts
 *  (a marking-noun co-occurring with a rear-window position word), so a
 *  backpack's "märke" is never mistaken for a vehicle decal. */
export const OBJECT_SYNONYMS: Record<string, ObjectCategory> = {
  ryggsäck: "ryggsack",
  väska: "ryggsack",
  keps: "huvudbonad",
  mössa: "huvudbonad",
  huvudbonad: "huvudbonad",
};

/** Marking nouns — any present sets the `marking` dimension. Also the trigger
 *  (with a position word) for fordon-dekal detection. "text" covers
 *  "delvis läsbar text -TAC". */
export const MARKING_WORDS: string[] = [
  "märke",
  "emblem",
  "tryck",
  "symbol",
  "logga",
  "logotyp",
  "dekalrest",
  "dekal",
  "klistermärke",
  "text",
];

/** Colour surface word -> canonical colour. svart & the mörk* family collapse
 *  to `mörk`; the ljus* family to `ljus`. */
export const COLOUR_SYNONYMS: Record<string, string> = {
  svart: "mörk",
  mörk: "mörk",
  mörkt: "mörk",
  mörka: "mörk",
  mörkgrå: "mörk",
  mörkblå: "mörk",
  mörkröd: "mörk",
  mörkgrön: "mörk",
  ljus: "ljus",
  ljust: "ljus",
  ljusa: "ljus",
};

/** Visibility/legibility surface forms -> canonical `otydlig`. Multi-word forms
 *  must be matched before single words (handled in marks.ts). */
export const VISIBILITY_WORDS: string[] = [
  "delvis synlig",
  "delvis synligt",
  "delvis läsbar",
  "svårt att läsa",
  "svårläst",
  "otydlig",
  "otydligt",
  "delvis",
];

/** Rear-window position surface forms -> canonical `bak` (vehicle decal locus).
 *  Deliberately excludes "på ryggen"/"på baksidan" so a backpack's marking is
 *  not read as a vehicle position. */
export const POSITION_SYNONYMS: Record<string, string> = {
  bakrutan: "bak",
  bakglaset: "bak",
  baktill: "bak",
};

/**
 * Generic / non-distinctive clause markers (lowercased substrings). A clause
 * matching any of these is NOT a distinctive mark and is dropped (§6.2). Covers
 * generic clothing, commuter decoys (kostym/kavaj/solglasögon), person
 * descriptors, behaviour, and low-value activity nouns.
 */
export const EXCLUSIONS: string[] = [
  "inga särskilda kännetecken",
  "vardaglig klädsel",
  "neutral klädsel",
  "diskret klädd",
  "arbetskläder",
  "varselväst",
  "joggingkläder",
  "träningskläder",
  "motionskläder",
  "jacka",
  "kostym",
  "kavaj",
  "solglasögon",
  "medelålders",
  "vältränad",
  "atletisk",
  "kraftig",
  "fåordig",
  "samordnade rörelser",
  "ungdom",
  "cyklist",
  "motionär",
  "joggare",
  "hundrastare",
  "hund",
  "koppel",
  "barnvagn",
  "rullator",
  "rollator",
  "käpp",
  "ensam",
  "picknick",
  "fika",
];

/** Negation cues — a clause containing one (over an object) emits no mark. */
export const NEGATION_CUES: string[] = ["inga", "ingen", "inget", "utan", "saknar", "avsaknad", " ej "];

/** Coreference cues — flagged (surfaced) but NOT resolved (§6.2). */
export const COREF_CUES: string[] = ["samma", "som igår", "tidigare sedd", "som ovan", "igen", "återigen", "känns igen"];

/**
 * Identity-bearing dimensions per category — these form the matching
 * `signature`. Other detected attributes (e.g. text:TAC/DGE) are corroborating:
 * shown in the explanation but kept out of the signature so OCR-style surface
 * variance does not fragment clusters. A mark is "distinctive" only when ALL its
 * category's signature dims are populated — this is what separates the tell
 * (dark backpack WITH a marking) from a bare noise backpack.
 */
export const SIGNATURE_DIMS: Record<ObjectCategory, AttrDim[]> = {
  ryggsack: ["farg", "marking"],
  huvudbonad: ["farg", "marking"],
  "fordon-dekal": ["position", "marking"],
};

/** GT tell id -> object category (for scoring against ground_truth.json). */
export const TELL_CATEGORY: Record<string, ObjectCategory> = {
  tell_bag: "ryggsack",
  tell_cap: "huvudbonad",
  tell_logo: "fordon-dekal",
};
