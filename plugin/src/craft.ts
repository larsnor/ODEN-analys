/*
 * Craft (farkost) extraction — pure TS, Obsidian-free → testable outside Obsidian.
 *
 * The deterministic floor for the observed-thing "craft" dimension (domain.ts):
 * scan a report's free prose (Händelse ⊕ Symbol, the same source marks.ts reads)
 * for craft-type keywords and emit one OBSERVATION per distinct type mentioned.
 *
 * An observation is NOT an entity. Per the re-identifiability boundary (domain.ts),
 * a generic craft never clusters into a tracked node: it is a scored, queryable
 * sighting. The ONE re-id bridge here is the plate — a plated craft in a report
 * that also carries exactly one full plate is linked to it, so a plate entity
 * (reid.ts) can be shown WITH its type ("lastbil RJK241") and craft-type queries
 * ("återkommande traktorer") resolve through Job A. A named-boat identifier →
 * re-identifiable watercraft entity is a future extension (domain.ts).
 */
import { Report } from "./parse";
import { plateIdentifiers } from "./ids";
import { CraftMedium, matchCraftTypes } from "./domain";

export interface CraftObservation {
  /** Craft type key (domain.ts CraftType.key). */
  type: string;
  label: string;
  medium: CraftMedium;
  plated: boolean;
  /** Inherent threat weight of the type (copied from the taxonomy). */
  threat: number;
  /** The full plate in the SAME report, when there is exactly one (unambiguous)
   *  and the craft is plated — the re-id bridge to a Job A vehicle entity. */
  plate?: string;
  file: string;
  tnr: string;
  tidpunkt: string;
  plats: string;
  sagesman: string;
}

/** Extract craft observations from one report (one per distinct type, dedup by
 *  type, deterministic order). */
export function extractCraft(report: Report): CraftObservation[] {
  const source = [report.handelse, report.symbol].filter(Boolean).join(". ");
  const types = matchCraftTypes(source);
  if (types.length === 0) return [];

  // A single unambiguous full plate in the report is the plated-craft re-id bridge.
  const fulls = [...new Set(plateIdentifiers(report).filter((p) => !p.partial).map((p) => p.value))];
  const solePlate = fulls.length === 1 ? fulls[0] : undefined;

  return types
    .map((t) => ({
      type: t.key,
      label: t.label,
      medium: t.medium,
      plated: t.plated,
      threat: t.threat,
      plate: t.plated ? solePlate : undefined,
      file: report.file,
      tnr: report.tnr,
      tidpunkt: report.tidpunkt,
      plats: report.plats,
      sagesman: report.sagesman,
    }))
    .sort((a, b) => a.type.localeCompare(b.type));
}

/** Extract craft observations across many reports (flat, deterministic order). */
export function extractAllCraft(reports: Report[]): CraftObservation[] {
  const all: CraftObservation[] = [];
  for (const r of reports) all.push(...extractCraft(r));
  return all.sort(
    (a, b) =>
      a.type.localeCompare(b.type) ||
      a.tidpunkt.localeCompare(b.tidpunkt) ||
      a.tnr.localeCompare(b.tnr) ||
      a.file.localeCompare(b.file),
  );
}
