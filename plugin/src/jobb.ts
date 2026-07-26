/*
 * Mark nomination. Pure TS, Obsidian-free.
 *
 * Asymmetry principle: this job NOMINATES candidate mark-matches, it NEVER
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
  method: "jobb-b";
  föreslagenAv: "deterministisk";
}

export interface JobBResult {
  /** Distinctive-mark clusters of >=2 reports (the candidate patterns). */
  nominations: MarkNomination[];
}

function safeId(signature: string): string {
  return "marke-" + signature.replace(/[\\/:*?"<>|.\s#|]/g, "_");
}

const memberSort = (a: NormalizedMark, b: NormalizedMark): number =>
  a.tidpunkt.localeCompare(b.tidpunkt) || a.tnr.localeCompare(b.tnr) || a.file.localeCompare(b.file);

/**
 * Build mark nominations from reports. Pure & idempotent: same reports in →
 * byte-identical result out.
 */
export function buildMarkNominations(reports: Report[]): JobBResult {
  const marks = extractNormalized(reports);

  const distinctive = marks.filter((m) => m.distinctive);

  // Cluster distinctive marks by exact signature (within a category implicitly,
  // since the signature is prefixed by the object).
  const bySig = new Map<string, NormalizedMark[]>();
  for (const m of distinctive) {
    if (!bySig.has(m.signature)) bySig.set(m.signature, []);
    bySig.get(m.signature)!.push(m);
  }

  const nominations: MarkNomination[] = [];

  for (const [signature, group] of bySig) {
    // A cluster spans distinct reports; same report twice shouldn't inflate it.
    const byFile = new Map<string, NormalizedMark>();
    for (const m of group.sort(memberSort)) if (!byFile.has(m.file)) byFile.set(m.file, m);
    const members = [...byFile.values()].sort(memberSort);

    if (members.length < 2) continue; // a distinctive mark seen once is not a pattern

    const first = members[0];
    const canonicalAttrs = first.attrs;
    const label = markLabel(first.object, canonicalAttrs);
    const sagesmän = [...new Set(members.map((m) => m.sagesman).filter(Boolean))].sort();
    const times = members.map((m) => m.tidpunkt).filter(Boolean);

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
      method: "jobb-b",
      föreslagenAv: "deterministisk",
    });
  }

  nominations.sort((a, b) => a.object.localeCompare(b.object) || a.signature.localeCompare(b.signature));

  return { nominations };
}
