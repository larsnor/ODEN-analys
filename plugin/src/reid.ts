/*
 * Plate re-identification — deterministic ID re-identification.
 *
 * Pure TS, ZERO Obsidian imports → testable outside Obsidian.
 *
 * Scope: strictly deterministic identifiers (registration plates here;
 * personnummer/phone could slot into the same machinery later). Only this job
 * may **auto-merge**, and ONLY when resolution is certain — a false merge
 * creates a phantom pattern, the dangerous failure mode (asymmetry principle).
 *
 * No canonical plate list is seeded, so a partial can never resolve to a full
 * plate that was never seen. A partial resolves ONLY against full
 * plates actually observed in the corpus:
 *   - exactly one observed full matches  → AUTO-MERGE (certain).
 *   - several observed fulls match        → AMBIGUOUS → candidate, never merged.
 *   - no observed full matches            → stays its own partial entity.
 */
import { Report } from "./parse";
import { plateIdentifiers } from "./ids";

export type PlateSlag = "fordon-reg-full" | "fordon-reg-partiell";

export interface PlateObservation {
  tnr: string;
  tidpunkt: string;
  plats: string;
  file: string;
  /** The plate string exactly as written in the report (full or masked). */
  shown: string;
  kind: "plate-full" | "plate-partial";
  sagesman: string;
}

export interface PlateEntity {
  /** Stable id derived from the canonical plate (idempotent across runs). */
  id: string;
  slag: PlateSlag;
  /** Resolved full plate, or the partial mask if it could not be resolved. */
  canonical: string;
  observations: PlateObservation[];
  /** Distinct partial masks auto-merged into this (full) entity. */
  resolvedPartials: string[];
  /** For an ambiguous partial entity: the fulls it could be (nominated). */
  candidateFulls: string[];
  firstSeen: string;
  lastSeen: string;
  count: number;
  /** Distinct reporting call-signs across the observations. */
  sagesmän: string[];
  method: "jobb-a";
}

export interface JobAResult {
  entities: PlateEntity[];
  /** Ambiguous partials kept as candidates (never auto-merged). */
  ambiguous: { partial: string; candidates: string[] }[];
  /** Partials with no observed full match (their own partial entities). */
  unresolvedPartials: string[];
}

/** A plate link as it appears in one report, with its source report. */
interface PlateMention {
  plate: string;
  kind: "plate-full" | "plate-partial";
  report: Report;
}

/** Observed-full plates matching a partial mask (`.` = wildcard). */
function matchObservedFulls(partial: string, observedFulls: string[]): string[] {
  // partial contains only [A-Z0-9.]; '.' is already a valid regex wildcard.
  const rx = new RegExp("^" + partial + "$");
  return observedFulls.filter((f) => rx.test(f));
}

function safeId(canonical: string): string {
  // Dots and filesystem-hostile chars → underscore; keeps ids/filenames stable.
  return "fordon-" + canonical.replace(/[\\/:*?"<>|.\s]/g, "_");
}

function toObservation(m: PlateMention): PlateObservation {
  const r = m.report;
  return {
    tnr: r.tnr,
    tidpunkt: r.tidpunkt,
    plats: r.plats,
    file: r.file,
    shown: m.plate,
    kind: m.kind,
    sagesman: r.sagesman,
  };
}

function sortObservations(obs: PlateObservation[]): PlateObservation[] {
  // Deterministic order (tidpunkt, then tnr, then file) for idempotent output.
  return [...obs].sort(
    (a, b) =>
      a.tidpunkt.localeCompare(b.tidpunkt) ||
      a.tnr.localeCompare(b.tnr) ||
      a.file.localeCompare(b.file),
  );
}

function finishEntity(
  canonical: string,
  slag: PlateSlag,
  obs: PlateObservation[],
  resolvedPartials: string[],
  candidateFulls: string[],
): PlateEntity {
  const sorted = sortObservations(obs);
  const times = sorted.map((o) => o.tidpunkt).filter(Boolean);
  const sagesmän = [...new Set(sorted.map((o) => o.sagesman).filter(Boolean))].sort();
  return {
    id: safeId(canonical),
    slag,
    canonical,
    observations: sorted,
    resolvedPartials: [...new Set(resolvedPartials)].sort(),
    candidateFulls: [...new Set(candidateFulls)].sort(),
    firstSeen: times.length ? times[0] : "",
    lastSeen: times.length ? times[times.length - 1] : "",
    count: sorted.length,
    sagesmän,
    method: "jobb-a",
  };
}

/**
 * Build vehicle entities from plate identifiers via deterministic plate
 * re-identification. Plate identifiers come from `ids.ts` — extracted from
 * links AND prose — so this works whether or not the intake app (källappen)
 * pre-links.
 * Pure: same reports in → same entities out (idempotent).
 */
export function buildPlateEntities(reports: Report[]): JobAResult {
  // 1. Collect every plate mention (links + prose, deduped in ids.ts).
  const mentions: PlateMention[] = [];
  for (const r of reports) {
    for (const id of plateIdentifiers(r)) {
      mentions.push({ plate: id.value, kind: id.partial ? "plate-partial" : "plate-full", report: r });
    }
  }

  // 2. Observed full plates (the ONLY resolution targets — de-hardcoded).
  const observedFulls = [
    ...new Set(mentions.filter((m) => m.kind === "plate-full").map((m) => m.plate)),
  ].sort();

  // 3. Bucket each mention to a resolution key.
  //    full plate   -> the full plate (auto-merge)
  //    partial w/ 1 -> that full (auto-merge, certain)
  //    partial w/ >1-> the partial string (ambiguous, candidate only)
  //    partial w/ 0 -> the partial string (unresolved)
  const fullBuckets = new Map<string, PlateObservation[]>();
  const fullResolvedPartials = new Map<string, Set<string>>();
  const partialBuckets = new Map<string, PlateObservation[]>();
  const partialCandidates = new Map<string, string[]>();
  const ambiguous: { partial: string; candidates: string[] }[] = [];
  const unresolved = new Set<string>();

  const addFull = (full: string, obs: PlateObservation, fromPartial?: string) => {
    if (!fullBuckets.has(full)) fullBuckets.set(full, []);
    fullBuckets.get(full)!.push(obs);
    if (fromPartial) {
      if (!fullResolvedPartials.has(full)) fullResolvedPartials.set(full, new Set());
      fullResolvedPartials.get(full)!.add(fromPartial);
    }
  };
  const addPartial = (key: string, obs: PlateObservation, candidates: string[]) => {
    if (!partialBuckets.has(key)) partialBuckets.set(key, []);
    partialBuckets.get(key)!.push(obs);
    partialCandidates.set(key, candidates);
  };

  for (const m of mentions) {
    const obs = toObservation(m);
    if (m.kind === "plate-full") {
      addFull(m.plate, obs);
      continue;
    }
    const cands = matchObservedFulls(m.plate, observedFulls);
    if (cands.length === 1) {
      addFull(cands[0], obs, m.plate); // certain → auto-merge
    } else if (cands.length > 1) {
      addPartial(m.plate, obs, cands); // ambiguous → candidate, never merged
      if (!ambiguous.some((a) => a.partial === m.plate)) {
        ambiguous.push({ partial: m.plate, candidates: cands });
      }
    } else {
      addPartial(m.plate, obs, []); // unresolved
      unresolved.add(m.plate);
    }
  }

  // 4. Materialise entities.
  const entities: PlateEntity[] = [];
  for (const [full, obs] of fullBuckets) {
    const resolved = [...(fullResolvedPartials.get(full) ?? new Set<string>())];
    entities.push(finishEntity(full, "fordon-reg-full", obs, resolved, []));
  }
  for (const [partial, obs] of partialBuckets) {
    entities.push(
      finishEntity(partial, "fordon-reg-partiell", obs, [], partialCandidates.get(partial) ?? []),
    );
  }

  // Deterministic entity order: fulls first, then partials, alpha by canonical.
  entities.sort(
    (a, b) =>
      a.slag.localeCompare(b.slag) || a.canonical.localeCompare(b.canonical),
  );

  return {
    entities,
    ambiguous: ambiguous.sort((a, b) => a.partial.localeCompare(b.partial)),
    unresolvedPartials: [...unresolved].sort(),
  };
}
