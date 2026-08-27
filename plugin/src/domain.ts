/*
 * The explicit observed-thing domain model (pure TS, Obsidian-free) — the SINGLE
 * SOURCE OF TRUTH the rest of the plugin projects from: identifier types
 * (ids.ts), facet kinds (actor.ts), mark categories (vocab.ts), behaviour
 * categories (suspicion.ts), and node classes (notes_common.ts) are all
 * projections of it. This file NAMES the whole model in one place and OWNS the
 * craft/farkost dimension.
 *
 * The observed-thing taxonomy — what a 7S report can be ABOUT:
 *   person  → an actor, re-identified transitively via facets (actor.ts / derive.ts)
 *   craft   → a vehicle / vessel / aircraft (THIS module)
 *   mark    → a distinctive kännetecken (vocab.ts + marks.ts)
 *   place   → a location (location_notes.ts)
 *   larm    → an elevated report (suspicion.ts)
 * These are the query engine's TARGETS (query.ts) and the graph's node classes —
 * one model, projected, not re-invented per layer.
 *
 * ── The craft re-identifiability boundary (frozen) ───────────────────────────
 * Craft TYPE is ALWAYS a scored, queryable OBSERVATION. RE-IDENTIFICATION — the
 * claim that two sightings are the SAME craft — needs a stable identifier or a
 * distinctive mark, NEVER the bare type:
 *   plated ground craft → re-id by its PLATE (plate re-identification, reid.ts)
 *   watercraft          → re-id by a boat NAME/reg (future) or a distinctive mark
 *   drone / aircraft    → re-id by a distinctive mark only (rare)
 *   unplated ground     → re-id by a distinctive mark only
 * A generic "en drönare" / "en båt" is an annotation on its report; the machine
 * NEVER merges two generic craft into one entity — mirrors the vision
 * person-attribute rule (photo_analysis.ts data-model note) and the mark
 * base-rate rule (vocab.ts). This is the boundary the operator set.
 */

/** ground · water · air. NB: "mark" here is Swedish for GROUND (the medium), not
 *  the English "mark"/kännetecken elsewhere in the codebase. */
export type CraftMedium = "mark" | "vatten" | "luft";

export interface CraftType {
  /** Canonical key — also the query term and the suspicion signal suffix. */
  key: string;
  /** Operator-facing noun. */
  label: string;
  medium: CraftMedium;
  /** Carries a registration plate → re-identifiable via plate re-id (reid.ts). */
  plated: boolean;
  /** Inherent relevance near the objektet: the suspicion weight the TYPE
   *  contributes, which STACKS with proximity/time. 0 = benign type (surfaces
   *  only via proximity/behaviour, never on type alone); 3 = alarming on its own
   *  (a drone). Tuned so a drone near the objektet at night reaches Hög, a boat
   *  loitering there at night reaches Förhöjd, and a tractor never flags on type. */
  threat: number;
  /** Should a mention of this type STEER a chat query to the farkost target?
   *  false only for the bare car — "bil"/"fordon" stays the plate-entity target
   *  (query.ts), while a car's TYPE is still recorded for the vehicle-dossier
   *  join. Every distinctive type (lastbil, drönare, båt, …) is true. */
  queryCue: boolean;
  /** Surface forms (lowercased), matched WHOLE-WORD (Swedish-aware) — so "bil"
   *  never fires inside "bild"/"mobil". FROZEN + precision-gated like vocab.ts:
   *  each inflection listed explicitly rather than substring-stemmed. */
  keywords: string[];
  /** Compound-safe SUBSTRING stems (optional) — matched anywhere, so an operator's
   *  compound ("drönarobservationer", "båttrafik") resolves. ONLY for stems that
   *  never appear inside a benign or a DIFFERENT-type word: "drönar", "båt",
   *  "traktor" are safe; "bil"/"cykel" are NOT (bil⊂bild; cykel⊂motorcykel), so
   *  those types stay whole-word only. */
  stems?: string[];
}

/*
 * The taxonomy. `threat` is the only new scoring input; everything else is for
 * extraction (keywords), re-id routing (plated), and query steering (queryCue).
 */
export const CRAFT_TAXONOMY: CraftType[] = [
  // ── plated ground (re-id via PLATE, reid.ts) — threat 0 ───────────────────
  // The bare car: the DEFAULT plated vehicle. queryCue=false so "bil"/"fordon"
  // resolves to the fordon (plate-entity) target; the type is still tagged so a
  // plate dossier can read "bil RJK241".
  { key: "bil", label: "bil", medium: "mark", plated: true, threat: 0, queryCue: false,
    keywords: ["bil", "bilen", "bilar", "bilarna", "personbil", "personbilen", "personbilar"] },
  { key: "lastbil", label: "lastbil", medium: "mark", plated: true, threat: 0, queryCue: true,
    keywords: ["lastbil", "lastbilen", "lastbilar", "skåpbil", "skåpbilen", "husbil", "husbilen",
      "postbil", "postbilen", "budbil", "budbilen", "paketbil", "paketbilen",
      "transportbil", "flakbil", "tankbil", "pickup"],
    stems: ["lastbil", "skåpbil"] },
  { key: "traktor", label: "traktor", medium: "mark", plated: true, threat: 0, queryCue: true,
    keywords: ["traktor", "traktorn", "traktorer", "traktorerna"], stems: ["traktor"] },
  { key: "motorcykel", label: "motorcykel", medium: "mark", plated: true, threat: 0, queryCue: true,
    keywords: ["motorcykel", "motorcykeln", "motorcyklar", "mc", "moped", "mopeden", "mopeder",
      "skoter", "skotern", "fyrhjuling", "fyrhjulingen"], stems: ["motorcyk"] },
  { key: "buss", label: "buss", medium: "mark", plated: true, threat: 0, queryCue: true,
    keywords: ["buss", "bussen", "bussar", "bussarna", "minibuss", "minibussen"] },

  // ── unplated ground (re-id via distinctive MARK only) — threat 0 ──────────
  // NB the AGENT NOUN (cyklist) is listed explicitly: whole-word matching means
  // "cyklist" shares no matchable form with "cykel", and the stem "cykl" is unsafe
  // (it is inside "motorcyklist"). Same reason "cykel" stays keyword-only.
  { key: "cykel", label: "cykel", medium: "mark", plated: false, threat: 0, queryCue: true,
    keywords: ["cykel", "cykeln", "cyklar", "cyklarna",
      "cyklist", "cyklisten", "cyklister", "cyklisterna"] },
  { key: "sparkcykel", label: "sparkcykel", medium: "mark", plated: false, threat: 0, queryCue: true,
    keywords: ["sparkcykel", "sparkcykeln", "elsparkcykel", "elsparkcykeln", "elcykel", "elcykeln", "scooter"] },
  { key: "kärra", label: "kärra", medium: "mark", plated: false, threat: 0, queryCue: true,
    keywords: ["kärra", "kärran", "kärror", "dragkärra", "skottkärra", "släpkärra"] },

  // ── watercraft (re-id via NAME/reg or MARK) — a boat near a coastal objektet
  //    is notable; a scheduled ferry is not ─────────────────────────────────
  { key: "båt", label: "båt", medium: "vatten", plated: false, threat: 1, queryCue: true,
    keywords: ["båt", "båten", "båtar", "båtarna", "motorbåt", "motorbåten", "segelbåt", "segelbåten",
      "fritidsbåt", "fritidsbåten", "roddbåt", "gummibåt", "jolle", "jollen", "kajak", "kajaken",
      "ribbåt", "snabbåt", "vattenskoter"],
    // "kajak" is stem-safe (no Swedish word contains it that is not about kayaks),
    // so compounds and agent nouns resolve: kajakpaddlare, kajaker, kajakist.
    stems: ["båt", "kajak"] },
  { key: "fartyg", label: "fartyg", medium: "vatten", plated: false, threat: 1, queryCue: true,
    keywords: ["fartyg", "fartyget", "skepp", "skeppet", "tankfartyg", "lastfartyg", "örlogsfartyg"],
    stems: ["fartyg"] },
  { key: "färja", label: "färja", medium: "vatten", plated: false, threat: 0, queryCue: true,
    keywords: ["färja", "färjan", "färjor", "bilfärja", "passagerarfärja", "vägfärja"], stems: ["färja"] },

  // ── aircraft (re-id via distinctive MARK only) — a drone over the objektet is
  //    a top recon signal ─────────────────────────────────────────────────────
  { key: "drönare", label: "drönare", medium: "luft", plated: false, threat: 3, queryCue: true,
    keywords: ["drönare", "drönaren", "drönarna", "quadcopter", "kvadkopter", "multirotor"],
    stems: ["drönar"] },
  { key: "helikopter", label: "helikopter", medium: "luft", plated: false, threat: 2, queryCue: true,
    keywords: ["helikopter", "helikoptern", "helikoptrar", "chopper"], stems: ["helikopt"] },
  { key: "flygplan", label: "flygplan", medium: "luft", plated: false, threat: 1, queryCue: true,
    keywords: ["flygplan", "flygplanet", "sjöflygplan", "propellerplan", "segelflygplan", "ultralätt"],
    stems: ["flygplan"] },
];

const BY_KEY = new Map(CRAFT_TAXONOMY.map((t) => [t.key, t]));

/** Whole-word (Swedish-aware) match — JS `\b` treats å/ä/ö as boundaries, so we
 *  build an explicit non-letter/digit lookaround like query.ts does. */
function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?<![a-zåäö0-9])${word}(?![a-zåäö0-9])`, "i").test(text);
}

/** The craft types whose keywords (whole-word) or compound stems (substring)
 *  appear in `text` (lowercased internally), in taxonomy order, each at most
 *  once. The one matcher used by prose extraction (craft.ts), vision-typ mapping
 *  AND query target-steering (query.ts) — so "drönarobservationer" resolves the
 *  same everywhere and the layers never diverge. */
export function matchCraftTypes(text: string): CraftType[] {
  const lower = (text ?? "").toLowerCase();
  return CRAFT_TAXONOMY.filter(
    (t) => t.keywords.some((k) => hasWord(lower, k)) || (t.stems ?? []).some((s) => lower.includes(s)),
  );
}

/** Look up a craft type by its canonical key. */
export function classifyCraft(key: string): CraftType | undefined {
  return BY_KEY.get(key);
}

/** Map a VLM's vehicle `typ` string (photo_analysis.ts PhotoVehicle.typ) into the
 *  taxonomy — the same keyword tables, so a photographed "lastbil" and a
 *  prose "lastbil" become the SAME craft type. Undefined when the typ is unknown
 *  to the taxonomy (the vision layer then keeps it as a plain annotation). */
export function craftFromVisionTyp(typ: string | undefined): CraftType | undefined {
  if (!typ) return undefined;
  return matchCraftTypes(typ)[0];
}
