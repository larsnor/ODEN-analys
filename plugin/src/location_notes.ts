/*
 * Location nodes (pure) — one note per RELEVANT location, linking every report
 * observed there. In Obsidian's graph the location becomes a dot connected to its
 * report nodes (and through them to the markers/actors at that spot), so a place
 * with recurring suspicious activity shows up as a spatial hub.
 *
 * We may not edit message files (§5), so the LOCATION note links out to the
 * reports — graph edges are undirected, so the cluster looks the same.
 *
 * "Relevant" = a location that hosts at least one suspicious (elevated) report OR
 * a vehicle plate. Benign-only places are left out to avoid cluttering the graph.
 *
 * Provenance: generator/källa 7s-plugin, metod: plats (own per-job prune), and a
 * `#plats` tag for the graph colour group.
 */
import { Report } from "./parse";
import { SuspicionAnalysis } from "./suspicion";
import { plateIdentifiers } from "./ids";
import { safeFilename } from "./entity_notes";
import { mdText } from "./mdsafe";
import { GENERATOR, METOD, RenderedNote, noteStem, resolveMerge } from "./notes_common";
import { safeAgentFilename } from "./notenames";
import { Nicknames, placeLabel } from "./places";

export interface LocationReportRef {
  tnr: string;
  file: string;
  tidpunkt: string;
  elevated: boolean;
  plates: string[];
}

export interface LocationCluster {
  key: string; // the `plats` string (MGRS grid or place name)
  label: string;
  lat?: number;
  lon?: number;
  reports: LocationReportRef[];
  elevatedCount: number;
  plates: string[];
}

/** Group reports by `plats`; keep locations tied to suspicion or a vehicle, and
 *  link only the RELEVANT observations there (elevated or plate-bearing) so the
 *  graph hub stays focused instead of pulling in every benign report. */
/** Resolve a raw `plats` grid to its canonical survivor through operator merges
 *  (cycle-safe). Exported so callers can link an observation's place to the right
 *  (possibly merged) location note. Trims first (grids carry surrounding spaces). */
export function resolveLocationKey(plats: string, merges?: Record<string, string>): string {
  return resolveMerge((plats ?? "").trim(), merges);
}

export function buildLocations(
  reports: Report[],
  suspicion: SuspicionAnalysis,
  merges?: Record<string, string>,
): LocationCluster[] {
  const elevatedFiles = new Set(suspicion.elevated.map((e) => e.file));
  const map = new Map<string, LocationCluster>();

  for (const r of reports) {
    const key = resolveLocationKey((r.plats ?? "").trim(), merges);
    if (!key) continue;
    const plates = plateIdentifiers(r)
      .filter((p) => !p.partial)
      .map((p) => p.value);
    const elevated = elevatedFiles.has(r.file);
    // Only suspicious or vehicle observations tie a report to a location hub.
    if (!elevated && plates.length === 0) continue;

    let c = map.get(key);
    if (!c) {
      c = { key, label: key, lat: r.lat, lon: r.lon, reports: [], elevatedCount: 0, plates: [] };
      map.set(key, c);
    }
    c.reports.push({ tnr: r.tnr, file: r.file, tidpunkt: r.tidpunkt, elevated, plates });
    if (elevated) c.elevatedCount++;
    for (const p of plates) if (!c.plates.includes(p)) c.plates.push(p);
    if (c.lat === undefined && r.lat !== undefined) {
      c.lat = r.lat;
      c.lon = r.lon;
    }
  }

  const relevant = [...map.values()];
  for (const c of relevant) {
    c.reports.sort((a, b) => a.tidpunkt.localeCompare(b.tidpunkt) || a.tnr.localeCompare(b.tnr));
  }
  return relevant.sort(
    (a, b) => b.elevatedCount - a.elevatedCount || b.reports.length - a.reports.length || a.key.localeCompare(b.key),
  );
}

export function locationFilename(c: LocationCluster, nicks?: Nicknames): string {
  // Display uses the nickname; the file hash stays keyed to the grid identity. The
  // 📍 emoji marks the type (the word "Plats" stays in metadata only).
  return safeAgentFilename(`📍 ${placeLabel(c.label, nicks)}`, "plats:" + c.key);
}

/** For a (place, plate) pair seen 2+ times, the stem of the recurrence node to link
 *  INSTEAD of the vehicle, or undefined. Two args (unlike the actor/suspect
 *  `StemLinker`), so it has its own name to avoid confusion. Routing the pair through
 *  the recurrence node avoids a redundant direct edge. */
export type PlateRecurrenceLinker = (placeKey: string, plate: string) => string | undefined;

export function renderLocationNote(c: LocationCluster, nicks?: Nicknames, recStem?: PlateRecurrenceLinker): RenderedNote {
  const name = placeLabel(c.label, nicks);
  const named = name !== c.key; // a nickname is set → keep the grid visible too
  const fm: string[] = [
    "---",
    "typ: plats",
    `källa: ${GENERATOR}`,
    `generator: ${GENERATOR}`,
    `metod: ${METOD.plats}`,
    "tags: [plats]",
    `namn: "${name.replace(/"/g, "'")}"`,
    `mgrs: "${c.key}"`,
    `antal_rapporter: ${c.reports.length}`,
    `misstankta: ${c.elevatedCount}`,
  ];
  if (c.plates.length) fm.push(`fordon: [${c.plates.join(", ")}]`);
  if (c.lat !== undefined && c.lon !== undefined) {
    fm.push(`lat: ${c.lat}`, `lon: ${c.lon}`, `location: "${c.lat},${c.lon}"`);
  }
  fm.push("---");

  const body: string[] = [];
  body.push(`# 📍 ${mdText(name)}`);
  if (named) body.push(`_MGRS: ${mdText(c.key)}_`);
  body.push("");
  // Link the plate to its vehicle entity note → a DIRECT place↔fordon graph edge
  // (so the link survives even when message nodes are filtered out of the graph).
  // If the plate recurs here (2+ visits), link the recurrence node instead, so the
  // pair is one labelled hop rather than a plain edge.
  const plateLink = (p: string) => {
    const rec = recStem?.(c.key, p);
    const stem = rec ?? safeFilename(p).replace(/\.md$/, "");
    return `[[${stem}|${p}]]`;
  };
  body.push(`**Rapporter:** ${c.reports.length}  `);
  body.push(`**Misstänkta observationer:** ${c.elevatedCount}`);
  if (c.plates.length) body.push(`  \n**Fordon här:** ${c.plates.map(plateLink).join(", ")}`);
  body.push("");
  body.push("## Observationer");
  for (const o of c.reports) {
    const stem = noteStem(o.file);
    const mark = o.elevated ? "⚠ " : "";
    // Keep the message link (data/traceability) AND link the vehicle directly.
    const plate = o.plates.length ? ` — ${o.plates.map(plateLink).join(", ")}` : "";
    body.push(`- ${mark}[[${stem}|TNR${mdText(o.tnr)}]] — ${mdText(o.tidpunkt)}${plate}`);
  }
  body.push("");
  body.push("_Platsnod (härledd av 7s-plugin). Länkar samman observationerna på denna plats._");

  return { filename: locationFilename(c, nicks), markdown: fm.join("\n") + "\n\n" + body.join("\n") + "\n" };
}

export function renderLocationNotes(clusters: LocationCluster[], nicks?: Nicknames, recStem?: PlateRecurrenceLinker): RenderedNote[] {
  return clusters.map((c) => renderLocationNote(c, nicks, recStem));
}
