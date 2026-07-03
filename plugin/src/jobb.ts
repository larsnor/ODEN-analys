/*
 * Job B — mark nomination (PLUGIN_DESIGN §6.1, §6.2). Pure TS, Obsidian-free.
 *
 * Asymmetry principle: Job B NOMINATES candidate mark-matches, it NEVER
 * auto-merges (a false merge = phantom pattern). The output is a set of
 * candidate clusters the operator confirms/rejects elsewhere (main.ts).
 *
 * Clustering is by SIGNATURE EQUALITY over the category's identity dims
 * (vocab.SIGNATURE_DIMS): maximally transparent and reproducible. The
 * normalization layer (marks.ts) is what makes the ~5 varied phrasings of one
 * tell collapse to a single signature. Non-distinctive marks (missing identity
 * dims, e.g. a bare backpack) are never surfaced as a pattern.
 */
import { Report } from "./parse";
import { extractNormalized, markLabel, NormalizedMark, NormAttr } from "./marks";
import { ObjectCategory } from "./vocab";

/** A NOMINATION (never a merge) that 2+ reports share a normalized mark. */
export interface MarkNomination {
  /** Stable id derived from the signature (idempotent across runs). */
  id: string;
  object: ObjectCategory;
  signature: string;
  /** Shared canonical attribute-set the nomination rests on. */
  canonicalAttrs: NormAttr[];
  label: string;
  members: NormalizedMark[];
  count: number;
  firstSeen: string;
  lastSeen: string;
  sagesmän: string[];
  /** Transparent explanation for the §7.2 alert text. */
  explanation: string;
  method: "jobb-b";
  föreslagenAv: "deterministisk";
}

export interface JobBResult {
  /** Distinctive-mark clusters of >=2 reports (the candidate patterns). */
  nominations: MarkNomination[];
  /** Distinctive marks seen once — NOT surfaced as a pattern. */
  singletons: NormalizedMark[];
  /** Non-distinctive marks (missing identity dims) — ignored for nomination. */
  nonDistinctive: NormalizedMark[];
  /** Reports whose Symbol carried a coref cue — surfaced, never resolved. */
  corefFlagged: { file: string; tnr: string }[];
}

function safeId(signature: string): string {
  return "marke-" + signature.replace(/[\\/:*?"<>|.\s#|]/g, "_");
}

const memberSort = (a: NormalizedMark, b: NormalizedMark): number =>
  a.tidpunkt.localeCompare(b.tidpunkt) || a.tnr.localeCompare(b.tnr) || a.file.localeCompare(b.file);

function describeAttrs(attrs: NormAttr[]): string {
  const byDim: Record<string, string> = {
    farg: "färg",
    marking: "märke",
    synlighet: "synlighet",
    position: "position",
    text: "text",
  };
  return attrs
    .map((a) => (a.value === "ja" ? byDim[a.dim] : `${byDim[a.dim]}=${a.value}`))
    .join(", ");
}

/**
 * Build mark nominations from reports. Pure & idempotent: same reports in →
 * byte-identical result out.
 */
export function buildMarkNominations(reports: Report[]): JobBResult {
  const marks = extractNormalized(reports);

  const distinctive = marks.filter((m) => m.distinctive);
  const nonDistinctive = marks.filter((m) => !m.distinctive);

  // Cluster distinctive marks by exact signature (within a category implicitly,
  // since the signature is prefixed by the object).
  const bySig = new Map<string, NormalizedMark[]>();
  for (const m of distinctive) {
    if (!bySig.has(m.signature)) bySig.set(m.signature, []);
    bySig.get(m.signature)!.push(m);
  }

  const nominations: MarkNomination[] = [];
  const singletons: NormalizedMark[] = [];

  for (const [signature, group] of bySig) {
    // A cluster spans distinct reports; same report twice shouldn't inflate it.
    const byFile = new Map<string, NormalizedMark>();
    for (const m of group.sort(memberSort)) if (!byFile.has(m.file)) byFile.set(m.file, m);
    const members = [...byFile.values()].sort(memberSort);

    if (members.length < 2) {
      singletons.push(...members);
      continue;
    }

    const first = members[0];
    const canonicalAttrs = first.attrs;
    const label = markLabel(first.object, canonicalAttrs);
    const sagesmän = [...new Set(members.map((m) => m.sagesman).filter(Boolean))].sort();
    const times = members.map((m) => m.tidpunkt).filter(Boolean);
    const explanation =
      `${members.length} observationer delar normaliserat märke: ${describeAttrs(canonicalAttrs)}. ` +
      `Tidsspann ${times[0]} → ${times[times.length - 1]}. Sägesmän: ${sagesmän.join(", ")}. ` +
      `(föreslagen av deterministisk extraktion — kräver operatörsbekräftelse)`;

    nominations.push({
      id: safeId(signature),
      object: first.object,
      signature,
      canonicalAttrs,
      label,
      members,
      count: members.length,
      firstSeen: times[0] ?? "",
      lastSeen: times[times.length - 1] ?? "",
      sagesmän,
      explanation,
      method: "jobb-b",
      föreslagenAv: "deterministisk",
    });
  }

  // Coref flags (deduped by report).
  const corefMap = new Map<string, { file: string; tnr: string }>();
  for (const m of marks) {
    if (m.corefFlagged && !corefMap.has(m.file)) corefMap.set(m.file, { file: m.file, tnr: m.tnr });
  }

  nominations.sort((a, b) => a.object.localeCompare(b.object) || a.signature.localeCompare(b.signature));
  singletons.sort(memberSort);
  nonDistinctive.sort(memberSort);

  return {
    nominations,
    singletons,
    nonDistinctive,
    corefFlagged: [...corefMap.values()].sort((a, b) => a.file.localeCompare(b.file)),
  };
}
