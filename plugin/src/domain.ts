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

import { tokenizeSv, withinOneEdit } from "./sv_match";
import { Declension, inflectNoun } from "./sv_morph";

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
  /** Declared nouns whose four inflected forms (sv_morph.ts) become EXACT
   *  whole-token forms. Exact beats head-suffix across the whole taxonomy, so a
   *  base here also serves as an override ("personbil" stays `bil` although the
   *  `bil` head would type it lastbil; "motorcyklist" preempts the cyklist head).
   *  The expansion is FROZEN via the committed snapshot
   *  test/fixtures/craft_vocabulary.ts — same audit discipline as a hand list. */
  bases?: { base: string; decl: Declension }[];
  /** Declared head nouns whose inflected forms match as PROPER token SUFFIXES —
   *  "…bil(en/ar/arna)" types any unforeseen compound (servicebil, leveransbil)
   *  without enumeration. Token-end anchoring dodges cykelvägen/busshållplatsen
   *  by construction; the longest matching form across the taxonomy wins
   *  (elsparkcyklisten → sparkcykel, not cykel); CRAFT_HEAD_BLOCK kills the
   *  known homonyms (mobilen, stabil). */
  heads?: { base: string; decl: Declension }[];
  /** Literal irregular surface forms (lowercased), matched as EXACT tokens —
   *  loanwords and verb forms the inflector cannot produce (pickup, mc, cyklade). */
  keywords: string[];
  /** Opt-OUT of the edit-distance-1 typo layer. Set false where the hazard
   *  audit (test/run_typo_hazards.ts) shows a dense real-word neighbourhood:
   *  buskarna~bussarna, kollar~jollar, snabbt~snabbåt, kärnan~kärran,
   *  grönare~drönare — a typo'd match there is likelier a plain Swedish word,
   *  and for drönare (threat 3) a false alert is unacceptable. */
  typoTolerant?: false;
  /** Compound-safe SUBSTRING stems (optional) — matched anywhere, so an operator's
   *  compound ("drönarobservationer", "båttrafik") resolves. ONLY for stems that
   *  never appear inside a benign or a DIFFERENT-type word: "drönar", "båt",
   *  "traktor" are safe; "bil"/"cykel" are NOT (bil⊂bild; cykel⊂motorcykel), so
   *  those types rely on exact forms + head-suffix matching instead. */
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
  // plate dossier can read "bil RJK241". `personbil` is a base (exact) so the
  // lastbil `bil` head can never claim it.
  { key: "bil", label: "bil", medium: "mark", plated: true, threat: 0, queryCue: false,
    bases: [{ base: "bil", decl: "en-ar" }, { base: "personbil", decl: "en-ar" },
      { base: "bilist", decl: "en-er" }],
    keywords: [] },
  // Trucks/vans: the `bil` HEAD types every "…bil" compound (servicebil,
  // leveransbil, valfri hantverkarbil) without enumeration — measured issue-#2
  // gap. Compounds that are NOT trucks are overridden by exact bases elsewhere
  // (personbil → bil) or blocklisted (mobilen, stabil — CRAFT_HEAD_BLOCK).
  { key: "lastbil", label: "lastbil", medium: "mark", plated: true, threat: 0, queryCue: true,
    bases: [{ base: "lastbil", decl: "en-ar" }, { base: "skåpbil", decl: "en-ar" }],
    heads: [{ base: "bil", decl: "en-ar" }],
    keywords: ["pickup"],
    stems: ["lastbil", "skåpbil"] },
  { key: "traktor", label: "traktor", medium: "mark", plated: true, threat: 0, queryCue: true,
    bases: [{ base: "traktor", decl: "en-er" }], keywords: [], stems: ["traktor"] },
  // `motorcyklist` is a base so the cykel `cyklist` head can never claim it
  // (the motorcyk stem already covers it as substring; the base keeps the
  // per-token exact layer consistent).
  { key: "motorcykel", label: "motorcykel", medium: "mark", plated: true, threat: 0, queryCue: true,
    bases: [{ base: "motorcykel", decl: "en-ar-syncope" }, { base: "motorcyklist", decl: "en-er" },
      { base: "moped", decl: "en-er" }, { base: "skoter", decl: "en-rar-syncope" },
      { base: "fyrhjuling", decl: "en-ar" }],
    heads: [{ base: "motorcykel", decl: "en-ar-syncope" }],
    keywords: ["mc"], stems: ["motorcyk"] },
  { key: "buss", label: "buss", typoTolerant: false, medium: "mark", plated: true, threat: 0, queryCue: true,
    bases: [{ base: "buss", decl: "en-ar" }, { base: "minibuss", decl: "en-ar" }],
    heads: [{ base: "buss", decl: "en-ar" }],
    keywords: [] },

  // ── unplated ground (re-id via distinctive MARK only) — threat 0 ──────────
  // The agent noun (cyklist) is a base AND a head: "cyklist" itself is exact,
  // and any "…cyklist" compound resolves — with sparkcyklist declared under
  // sparkcykel, longest-head-wins sends elsparkcyklisten there, not here.
  // Verb keywords (cykla/cyklade/cyklat): the generator facit stamps "cyklade"
  // (corpusgen/content.py) — a report that someone cycled past IS a bicycle
  // observation.
  { key: "cykel", label: "cykel", medium: "mark", plated: false, threat: 0, queryCue: true,
    bases: [{ base: "cykel", decl: "en-ar-syncope" }, { base: "cyklist", decl: "en-er" }],
    heads: [{ base: "cykel", decl: "en-ar-syncope" }, { base: "cyklist", decl: "en-er" }],
    keywords: ["cykla", "cyklade", "cyklat"] },
  { key: "sparkcykel", label: "sparkcykel", medium: "mark", plated: false, threat: 0, queryCue: true,
    bases: [{ base: "sparkcykel", decl: "en-ar-syncope" }, { base: "elsparkcykel", decl: "en-ar-syncope" },
      { base: "elcykel", decl: "en-ar-syncope" }, { base: "sparkcyklist", decl: "en-er" },
      { base: "elsparkcyklist", decl: "en-er" }],
    heads: [{ base: "sparkcykel", decl: "en-ar-syncope" }, { base: "sparkcyklist", decl: "en-er" }],
    keywords: ["scooter"] },
  { key: "kärra", label: "kärra", typoTolerant: false, medium: "mark", plated: false, threat: 0, queryCue: true,
    bases: [{ base: "kärra", decl: "a-or" }],
    heads: [{ base: "kärra", decl: "a-or" }],
    keywords: [] },

  // ── watercraft (re-id via NAME/reg or MARK) — a boat near a coastal objektet
  //    is notable; a scheduled ferry is not ─────────────────────────────────
  // "kajak" is stem-safe (no Swedish word contains it that is not about kayaks),
  // so compounds and agent nouns resolve: kajakpaddlare, kajaker, kajakist.
  // The båt stem covers every "…båt"/"båt…" compound, so no head is needed.
  { key: "båt", label: "båt", typoTolerant: false, medium: "vatten", plated: false, threat: 1, queryCue: true,
    bases: [{ base: "båt", decl: "en-ar" }, { base: "motorbåt", decl: "en-ar" },
      { base: "segelbåt", decl: "en-ar" }, { base: "fritidsbåt", decl: "en-ar" },
      { base: "roddbåt", decl: "en-ar" }, { base: "gummibåt", decl: "en-ar" },
      { base: "jolle", decl: "en-ar" }, { base: "kajak", decl: "en-er" },
      { base: "vattenskoter", decl: "en-rar-syncope" }],
    keywords: ["ribbåt", "snabbåt"],
    stems: ["båt", "kajak"] },
  { key: "fartyg", label: "fartyg", medium: "vatten", plated: false, threat: 1, queryCue: true,
    bases: [{ base: "fartyg", decl: "et-0" }, { base: "skepp", decl: "et-0" },
      { base: "tankfartyg", decl: "et-0" }, { base: "lastfartyg", decl: "et-0" },
      { base: "örlogsfartyg", decl: "et-0" }],
    keywords: [], stems: ["fartyg"] },
  { key: "färja", label: "färja", medium: "vatten", plated: false, threat: 0, queryCue: true,
    bases: [{ base: "färja", decl: "a-or" }, { base: "bilfärja", decl: "a-or" },
      { base: "passagerarfärja", decl: "a-or" }, { base: "vägfärja", decl: "a-or" }],
    keywords: [], stems: ["färja"] },

  // ── aircraft (re-id via distinctive MARK only) — a drone over the objektet is
  //    a top recon signal. NO "plan" head — `planen` is a homonym (plans/lawn). ──
  { key: "drönare", label: "drönare", typoTolerant: false, medium: "luft", plated: false, threat: 3, queryCue: true,
    bases: [{ base: "drönare", decl: "are" }],
    keywords: ["quadcopter", "kvadkopter", "multirotor"],
    stems: ["drönar"] },
  { key: "helikopter", label: "helikopter", medium: "luft", plated: false, threat: 2, queryCue: true,
    bases: [{ base: "helikopter", decl: "en-rar-syncope" }],
    keywords: ["chopper"], stems: ["helikopt"] },
  { key: "flygplan", label: "flygplan", medium: "luft", plated: false, threat: 1, queryCue: true,
    bases: [{ base: "flygplan", decl: "et-0" }, { base: "sjöflygplan", decl: "et-0" },
      { base: "propellerplan", decl: "et-0" }, { base: "segelflygplan", decl: "et-0" }],
    keywords: ["ultralätt"], stems: ["flygplan"] },
];

/** Exact tokens that END in a head form but are NOT that craft — the known
 *  Swedish homonyms/loanwords for the `bil` head. Extended only from the
 *  measured hazard audit (docs/CRAFT_VALIDATION.md), never speculatively. */
const CRAFT_HEAD_BLOCK = new Set([
  "mobil", "mobilen", "stabil", "instabil", "labil", "habil", "debil",
  "automobil", "automobilen",
]);

const BY_KEY = new Map(CRAFT_TAXONOMY.map((t) => [t.key, t]));


/*
 * Precompiled matching structures — built once from the taxonomy at module load.
 * Per-token precedence: blocklist → exact form → head-suffix (longest form wins
 * across the whole taxonomy); substring stems then run over the whole text as
 * before. Build-time invariant: no exact or head form may map to two types —
 * violating edits fail every test immediately.
 */
const EXACT_FORM = new Map<string, string>(); // surface form → type key
const HEAD_FORMS: { form: string; key: string }[] = []; // sorted longest-first
const STEM_FORMS: { stem: string; key: string }[] = [];
for (const t of CRAFT_TAXONOMY) {
  const exacts = [
    ...(t.bases ?? []).flatMap((b) => inflectNoun(b.base, b.decl)),
    ...t.keywords,
  ];
  for (const f of exacts) {
    const prev = EXACT_FORM.get(f);
    if (prev !== undefined && prev !== t.key)
      throw new Error(`craft form "${f}" maps to both ${prev} and ${t.key}`);
    EXACT_FORM.set(f, t.key);
  }
  const headSeen = new Set<string>();
  for (const h of t.heads ?? [])
    for (const f of inflectNoun(h.base, h.decl))
      if (!headSeen.has(f)) { headSeen.add(f); HEAD_FORMS.push({ form: f, key: t.key }); }
  for (const st of t.stems ?? []) STEM_FORMS.push({ stem: st, key: t.key });
}
{
  const byForm = new Map<string, string>();
  for (const h of HEAD_FORMS) {
    const prev = byForm.get(h.form);
    if (prev !== undefined && prev !== h.key)
      throw new Error(`craft head form "${h.form}" maps to both ${prev} and ${h.key}`);
    byForm.set(h.form, h.key);
  }
}
HEAD_FORMS.sort((a, b) => b.form.length - a.form.length || a.form.localeCompare(b.form));

// Edit-distance-1 candidates: exact forms ≥6 chars of typo-tolerant types,
// bucketed by length (a 1-edit neighbour differs by at most 1 in length).
const TYPO_MIN = 6;
const TYPO_FORMS = new Map<number, { form: string; key: string }[]>();
for (const t of CRAFT_TAXONOMY) {
  if (t.typoTolerant === false) continue;
  const forms = new Set([
    ...(t.bases ?? []).flatMap((b) => inflectNoun(b.base, b.decl)),
    ...t.keywords,
  ]);
  for (const f of forms) {
    if (f.length < TYPO_MIN) continue;
    for (const len of [f.length - 1, f.length, f.length + 1]) {
      if (!TYPO_FORMS.has(len)) TYPO_FORMS.set(len, []);
      TYPO_FORMS.get(len)!.push({ form: f, key: t.key });
    }
  }
}

/** The craft types whose exact forms (whole token), head-suffix forms (token
 *  ends in an inflected head noun: servicebilen → lastbil) or compound stems
 *  (substring) appear in `text`, in taxonomy order, each at most once. The one
 *  matcher used by prose extraction (craft.ts), vision-typ mapping AND query
 *  target-steering (query.ts) — so "drönarobservationer" resolves the same
 *  everywhere and the layers never diverge. */
export function matchCraftTypes(text: string, opts?: { typo?: boolean }): CraftType[] {
  const typo = opts?.typo !== false;
  const lower = (text ?? "").toLowerCase();
  const hit = new Set<string>();
  for (const token of tokenizeSv(lower)) {
    if (CRAFT_HEAD_BLOCK.has(token)) continue;
    const exact = EXACT_FORM.get(token);
    if (exact !== undefined) { hit.add(exact); continue; }
    let headed = false;
    for (const h of HEAD_FORMS) {
      if (token.length > h.form.length && token.endsWith(h.form)) { hit.add(h.key); headed = true; break; }
    }
    if (headed || !typo || token.length < TYPO_MIN) continue;
    // Typo layer: one edit (sub/ins/del) from the forms of exactly ONE
    // typo-tolerant type — two candidate types is ambiguity, not evidence.
    const keys = new Set<string>();
    for (const c of TYPO_FORMS.get(token.length) ?? [])
      if (withinOneEdit(token, c.form)) keys.add(c.key);
    if (keys.size === 1) hit.add([...keys][0]);
  }
  for (const s of STEM_FORMS) if (lower.includes(s.stem)) hit.add(s.key);
  return CRAFT_TAXONOMY.filter((t) => hit.has(t.key));
}

/** The effective (expanded) vocabulary per type — what the matcher actually
 *  recognises. Frozen by deep-equality against the committed snapshot in
 *  test/fixtures/craft_vocabulary.ts: any change to a base, declension class,
 *  keyword, stem or blocklist entry produces a reviewable fixture diff. */
export function expandedCraftVocabulary(): {
  types: { key: string; exactForms: string[]; headForms: string[]; stems: string[]; typoForms: string[] }[];
  headBlock: string[];
} {
  const types = CRAFT_TAXONOMY.map((t) => {
    const exactForms = [...new Set([
      ...(t.bases ?? []).flatMap((b) => inflectNoun(b.base, b.decl)),
      ...t.keywords,
    ])].sort();
    return {
      key: t.key,
      exactForms,
      headForms: [...new Set((t.heads ?? []).flatMap((h) => inflectNoun(h.base, h.decl)))].sort(),
      stems: [...(t.stems ?? [])],
      typoForms: t.typoTolerant === false ? [] : exactForms.filter((f) => f.length >= TYPO_MIN),
    };
  });
  return { types, headBlock: [...CRAFT_HEAD_BLOCK].sort() };
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
