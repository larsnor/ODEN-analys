/*
 * Transitive cross-type actor derivation. Pure TS, Obsidian-free.
 *
 * The core value: an ACTOR can appear as several entity-facets of different
 * types (vehicle, backpack, cap, logo) that NEVER all co-occur in one message.
 * The graph in the vault/Obsidian configuration only shows co-occurrence via
 * shared links; it cannot ASSERT
 * that three separate nodes are one actor. This module derives that:
 *
 *   M1: vehicle V  co-occurs with backpack B
 *   M5: backpack B co-occurs with cap C
 *   M9: vehicle V  co-occurs with cap C
 *   → V, B, C are facets of one actor (no single message has all three).
 *
 * Mechanics: build an association graph (edge = co-occurrence in a
 * message, weighted by #supporting messages), take connected components over
 * edges past an evidence threshold; a component spanning ≥2 entity TYPES is an
 * actor hypothesis. NOMINATE, never auto-merge — present the evidence
 * chain so the operator sees *why*, then confirm.
 *
 * The threshold is a parameter so the operator can explore what-if questions
 * ("at the current threshold V–B and B–C don't connect; lower it to T and the
 * component joins") — a legitimate parameter request, not LLM fishing.
 *
 * Low over-fit: this is generic union-find over a typed co-occurrence graph; it
 * consumes whatever facets plate re-identification and mark nomination produce
 * and knows nothing of the vocabulary.
 */
import { Report } from "./parse";
import { buildPlateEntities } from "./reid";
import { buildMarkNominations } from "./jobb";
import { markLabel } from "./marks";
import { resolveMerge } from "./notes_common";

export type FacetKind = "fordon" | "kannetecken";

export interface Facet {
  id: string; // "fordon:RJK241" | "marke:<signature>"
  kind: FacetKind;
  /** Distinct type for the multi-type spanning test:
   *  "fordon" | "marke:ryggsack" | "marke:huvudbonad" | "marke:fordon-dekal". */
  type: string;
  label: string;
  /** Note stem the facet's entity note lives under (for actor-note links). */
  noteStem: string;
  files: string[]; // report files where this facet is observed
}

export interface SupportRef {
  file: string;
  tnr: string;
  tidpunkt: string;
  plats: string;
}

export interface EvidenceEdge {
  a: string; // facet id (a < b)
  b: string;
  weight: number; // # messages supporting the co-occurrence
  supporting: SupportRef[];
}

/** One report in the evidence chain, with the facets it ties together. */
export interface ChainStep {
  tnr: string;
  tidpunkt: string;
  plats: string;
  file: string;
  facets: string[]; // labels of component facets present in this message
}

export interface ActorHypothesis {
  id: string;
  facets: Facet[];
  types: string[];
  vehicleCount: number;
  markCount: number;
  edges: EvidenceEdge[];
  /** The M1→M5→M9 narrative: messages in time order with the facets they link. */
  chain: ChainStep[];
  reportFiles: string[];
  firstSeen: string;
  lastSeen: string;
  explanation: string;
  method: "aktor";
  föreslagenAv: "deterministisk";
  /** Map position for single-agent (suspect-derived) actors — the latest
   *  observation's coordinates. Absent for transitive actors that span many
   *  places (graph only, no single point). */
  lat?: number;
  lon?: number;
}

export interface ActorResult {
  hypotheses: ActorHypothesis[];
  threshold: number;
  facetCount: number;
}

export interface ActorOpts {
  /** Minimum #supporting messages for a co-occurrence edge to count. */
  threshold?: number;
}

function safeStem(s: string): string {
  return s.replace(/[\\/:*?"<>|.\s#]/g, "_");
}

/** Tiny deterministic hash for stable actor ids/filenames. */
function shortHash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    if (!this.parent.has(x)) this.parent.set(x, x);
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (this.parent.get(cur) !== root) {
      const next = this.parent.get(cur)!;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }
  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

/** Build actor hypotheses from the current reports (pure, idempotent). */
export function buildActorHypotheses(reports: Report[], opts: ActorOpts = {}): ActorResult {
  const threshold = Math.max(1, opts.threshold ?? 1);

  // 1. Facets: vehicles (plate re-id) + distinctive mark clusters (mark nominations).
  const facets = new Map<string, Facet>();
  for (const v of buildPlateEntities(reports).entities) {
    const id = `fordon:${v.canonical}`;
    facets.set(id, {
      id,
      kind: "fordon",
      type: "fordon",
      label: v.canonical,
      noteStem: safeStem(v.canonical),
      files: v.observations.map((o) => o.file),
    });
  }
  for (const m of buildMarkNominations(reports).nominations) {
    const id = `marke:${m.signature}`;
    facets.set(id, {
      id,
      kind: "kannetecken",
      type: `marke:${m.object}`,
      label: markLabel(m.object, m.canonicalAttrs),
      noteStem: safeStem(m.id),
      files: m.members.map((x) => x.file),
    });
  }

  // 2. Report metadata + facets-present-per-file.
  const reportMeta = new Map<string, SupportRef>();
  for (const r of reports) reportMeta.set(r.file, { file: r.file, tnr: r.tnr, tidpunkt: r.tidpunkt, plats: r.plats });
  const facetsByFile = new Map<string, string[]>();
  for (const f of facets.values()) {
    for (const file of f.files) {
      if (!facetsByFile.has(file)) facetsByFile.set(file, []);
      facetsByFile.get(file)!.push(f.id);
    }
  }

  // 3. Co-occurrence edges (edge = two facets in the same message).
  const edges = new Map<string, EvidenceEdge>();
  for (const [file, ids] of facetsByFile) {
    const uniq = [...new Set(ids)].sort();
    const ref = reportMeta.get(file);
    for (let i = 0; i < uniq.length; i++) {
      for (let j = i + 1; j < uniq.length; j++) {
        const key = `${uniq[i]}\u0000${uniq[j]}`;
        if (!edges.has(key)) edges.set(key, { a: uniq[i], b: uniq[j], weight: 0, supporting: [] });
        const e = edges.get(key)!;
        if (ref) e.supporting.push(ref);
        e.weight = e.supporting.length;
      }
    }
  }

  // 4. Union facets over edges that meet the evidence threshold.
  const uf = new UnionFind();
  for (const f of facets.keys()) uf.find(f);
  const qualifying: EvidenceEdge[] = [];
  for (const e of edges.values()) {
    if (e.weight >= threshold) {
      uf.union(e.a, e.b);
      qualifying.push(e);
    }
  }

  // 5. Group facets into components.
  const components = new Map<string, string[]>();
  for (const id of facets.keys()) {
    const root = uf.find(id);
    if (!components.has(root)) components.set(root, []);
    components.get(root)!.push(id);
  }

  // 6. A component spanning ≥2 distinct types is an actor hypothesis.
  const hypotheses: ActorHypothesis[] = [];
  for (const ids of components.values()) {
    const compFacets = ids.map((id) => facets.get(id)!).sort((a, b) => a.id.localeCompare(b.id));
    const types = [...new Set(compFacets.map((f) => f.type))].sort();
    if (types.length < 2) continue;

    const idSet = new Set(ids);
    const compEdges = qualifying
      .filter((e) => idSet.has(e.a) && idSet.has(e.b))
      .map((e) => ({
        ...e,
        supporting: [...e.supporting].sort((x, y) => x.tidpunkt.localeCompare(y.tidpunkt) || x.tnr.localeCompare(y.tnr)),
      }))
      .sort((x, y) => y.weight - x.weight || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));

    // Evidence chain: every supporting message in time order, with the facets
    // it ties together (the M1→M5→M9 narrative).
    const chainFiles = new Set<string>();
    for (const e of compEdges) for (const s of e.supporting) chainFiles.add(s.file);
    const labelOf = new Map(compFacets.map((f) => [f.id, f.label]));
    const chain: ChainStep[] = [...chainFiles]
      .map((file) => {
        const ref = reportMeta.get(file)!;
        const present = (facetsByFile.get(file) ?? [])
          .filter((id) => idSet.has(id))
          .map((id) => labelOf.get(id)!)
          .sort();
        return { tnr: ref.tnr, tidpunkt: ref.tidpunkt, plats: ref.plats, file, facets: [...new Set(present)] };
      })
      .sort((a, b) => a.tidpunkt.localeCompare(b.tidpunkt) || a.tnr.localeCompare(b.tnr));

    const times = chain.map((c) => c.tidpunkt).filter(Boolean);
    const vehicleCount = compFacets.filter((f) => f.kind === "fordon").length;
    const markCount = compFacets.filter((f) => f.kind === "kannetecken").length;
    const reportFiles = [...chainFiles].sort();
    const id = `aktor-${safeStem(compFacets[0].label)}-${compFacets.length}f-${shortHash(ids.slice().sort().join("|"))}`;

    const explanation =
      `Aktör-hypotes: ${vehicleCount} fordon + ${markCount} kännetecken länkade via ` +
      `${chain.length} delade observationer (${times[0] ?? "?"} → ${times[times.length - 1] ?? "?"}). ` +
      `Spänner typer: ${types.join(", ")}. Inget enskilt meddelande binder alla facetter — ` +
      `kopplingen är transitiv. Nominerad (deterministisk), tröskel ${threshold} — kräver operatörsbekräftelse.`;

    hypotheses.push({
      id,
      facets: compFacets,
      types,
      vehicleCount,
      markCount,
      edges: compEdges,
      chain,
      reportFiles,
      firstSeen: times[0] ?? "",
      lastSeen: times[times.length - 1] ?? "",
      explanation,
      method: "aktor",
      föreslagenAv: "deterministisk",
    });
  }

  hypotheses.sort((a, b) => b.facets.length - a.facets.length || a.id.localeCompare(b.id));
  return { hypotheses, threshold, facetCount: facets.size };
}

// --- Operator merges --------------------------------------------------------
// Two confirmed actor hypotheses can turn out to be the SAME person. The operator
// asserts that; we persist it as a merge map (absorbed id → survivor id) and fold
// the hypotheses into ONE combined node at render time. Pure + idempotent so the
// owned-note rewrite keeps the merge; a plain [[link]] would be pruned away.

/** Combine several hypotheses (that the operator merged) into one: union facets,
 *  merge the evidence chain per file, widen the time span, recount fordon/kännetecken. */
function combineHypotheses(id: string, base: ActorHypothesis, group: ActorHypothesis[]): ActorHypothesis {
  const facets: Facet[] = [];
  const seenF = new Set<string>();
  for (const h of group) for (const f of h.facets) if (!seenF.has(f.id)) { seenF.add(f.id); facets.push(f); }
  facets.sort((a, b) => a.id.localeCompare(b.id));

  const chainByFile = new Map<string, ChainStep>();
  for (const h of group) for (const c of h.chain) {
    const ex = chainByFile.get(c.file);
    if (!ex) chainByFile.set(c.file, { ...c, facets: [...c.facets] });
    else ex.facets = [...new Set([...ex.facets, ...c.facets])].sort();
  }
  const chain = [...chainByFile.values()].sort(
    (a, b) => a.tidpunkt.localeCompare(b.tidpunkt) || a.tnr.localeCompare(b.tnr),
  );

  const types = [...new Set(facets.map((f) => f.type))].sort();
  const vehicleCount = facets.filter((f) => f.kind === "fordon").length;
  const markCount = facets.filter((f) => f.kind === "kannetecken").length;
  const times = chain.map((c) => c.tidpunkt).filter(Boolean);
  const reportFiles = [...new Set(group.flatMap((h) => h.reportFiles))].sort();
  const explanation =
    `Sammanslagen aktör (${group.length} hypoteser sammanförda av operatören): ` +
    `${vehicleCount} fordon + ${markCount} kännetecken över ${chain.length} observationer` +
    `${times.length ? ` (${times[0]} → ${times[times.length - 1]})` : ""}.`;

  return {
    ...base,
    id,
    facets,
    types,
    vehicleCount,
    markCount,
    edges: group.flatMap((h) => h.edges),
    chain,
    reportFiles,
    firstSeen: times[0] ?? base.firstSeen,
    lastSeen: times[times.length - 1] ?? base.lastSeen,
    explanation,
  };
}

/** Fold merged hypotheses into one combined node per canonical survivor. Only
 *  groups with ≥2 members present are combined; a lone hypothesis (its survivor
 *  not in the set) passes through unchanged. Pure. */
export function foldActorMerges(hyps: ActorHypothesis[], merges: Record<string, string>): ActorHypothesis[] {
  if (!merges || Object.keys(merges).length === 0) return hyps;
  const byId = new Map(hyps.map((h) => [h.id, h]));
  const groups = new Map<string, ActorHypothesis[]>();
  const order: string[] = [];
  for (const h of hyps) {
    const canon = resolveMerge(h.id, merges);
    if (!groups.has(canon)) { groups.set(canon, []); order.push(canon); }
    groups.get(canon)!.push(h);
  }
  const out: ActorHypothesis[] = [];
  for (const canon of order) {
    const group = groups.get(canon)!;
    if (group.length === 1) { out.push(group[0]); continue; }
    const base = byId.get(canon) ?? group[0];
    out.push(combineHypotheses(canon, base, group));
  }
  return out;
}
