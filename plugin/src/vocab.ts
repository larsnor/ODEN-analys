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

export type ObjectCategory =
  | "ryggsack"
  | "huvudbonad"
  | "fordon-dekal"
  | "optik"
  | "verktyg"
  | "teknik";

/** Attribute axes a mark can carry. */
export type AttrDim = "farg" | "marking" | "synlighet" | "position" | "text" | "typ" | "item";

/*
 * ── The one distinctiveness principle (frozen boundary) ──────────────────────
 * A descriptor is a usable RE-ID key by BASE RATE + SPECIFICITY, not by "military
 * vs civilian". Two modes, applied consistently:
 *
 *   COMMON carriables (ryggsack, huvudbonad, fordon-dekal, optik) — everyone can
 *   have one, so they are a re-id key ONLY with a distinguishing ATTRIBUTE. A plain
 *   backpack / plain `kikare` is filtered; "dark backpack WITH an emblem" or "camera
 *   WITH teleobjektiv" is the tell. (This is why the original three merged distinct
 *   people in the OOD test — the shared base-rate weakness; the attribute is all
 *   that saves them.)
 *
 *   RARE items (verktyg, teknik) — base rate ≈ 0 in benign traffic, so PRESENCE of
 *   a specific item is a fair key on its own.
 *
 * This seed is FROZEN at these six families by design. Broader coverage is an
 * open-vocabulary (LLM) problem — Phase B — NOT more list: a comprehensive
 * deterministic vocab cannot converge (it spirals and breaks precision either way).
 * Optics also raise the SUSPICION score independently (suspicion.ts
 * THREAT_INDICATORS.optik); this layer only decides whether they LINK sightings.
 */

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
  // Optics (COMMON → the mark opens on any optics word, but stays non-distinctive
  // without a specific sub-type in OPTIC_TYPES — so a birdwatcher's plain `kikare`
  // or a tourist's plain `kamera` is filtered).
  kikare: "optik",
  kamera: "optik",
  optik: "optik",
  "långt objektiv": "optik",
  teleobjektiv: "optik",
  nattkikare: "optik",
  mörkerkikare: "optik",
  värmekamera: "optik",
  drönar: "optik",
};

/** Distinctive optic SUB-TYPE surface form -> canonical `typ` (the identity dim for
 *  `optik`). Only specialised, recon-leaning optics are here; plain binoculars /
 *  cameras deliberately are NOT, so casual civilian optics never become a tell. */
export const OPTIC_TYPES: Record<string, string> = {
  teleobjektiv: "teleobjektiv",
  "långt objektiv": "teleobjektiv",
  nattkikare: "nattkikare",
  mörkerkikare: "nattkikare",
  värmekamera: "värmekamera",
  drönar: "drönare",
};

/** RARE items — presence of the canonical item is itself the signature (no attribute
 *  needed), because base rate ≈ 0 in benign traffic. Surface word -> {category,item}.
 *  Concrete nouns only (no verb-colliding stems like bare "pejl"/"dyrk"). */
export const ITEM_WORDS: Record<string, { category: ObjectCategory; item: string }> = {
  // verktyg — breaching / tampering tools
  bultsax: { category: "verktyg", item: "bultsax" },
  avbitartång: { category: "verktyg", item: "bultsax" },
  kofot: { category: "verktyg", item: "kofot" },
  bräckjärn: { category: "verktyg", item: "kofot" },
  kobräck: { category: "verktyg", item: "kofot" },
  bågfil: { category: "verktyg", item: "bågfil" },
  brytverktyg: { category: "verktyg", item: "brytverktyg" },
  // teknik — signals / technical gear
  antenn: { category: "teknik", item: "antenn" },
  riktantenn: { category: "teknik", item: "antenn" },
  störsändare: { category: "teknik", item: "sändare" },
  sändare: { category: "teknik", item: "sändare" },
  pejlutrustning: { category: "teknik", item: "pejl" },
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
  // COMMON → needs a distinguishing sub-type; plain optics stay non-distinctive.
  optik: ["typ"],
  // RARE → the specific item IS the identity (finer than family → no coarse merge).
  verktyg: ["item"],
  teknik: ["item"],
};

/** GT tell id -> object category (for scoring against ground_truth.json). */
export const TELL_CATEGORY: Record<string, ObjectCategory> = {
  tell_bag: "ryggsack",
  tell_cap: "huvudbonad",
  tell_logo: "fordon-dekal",
};
