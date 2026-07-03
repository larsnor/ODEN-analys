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
import { safeAgentFilename } from "./notenames";
import { Nicknames, placeLabel } from "./places";

export const GENERATOR = "7s-plugin";
export const LOCATION_METOD = "plats";

export interface RenderedNote {
  filename: string;
  markdown: string;
}

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
export function buildLocations(reports: Report[], suspicion: SuspicionAnalysis): LocationCluster[] {
  const elevatedFiles = new Set(suspicion.elevated.map((e) => e.file));
  const map = new Map<string, LocationCluster>();

  for (const r of reports) {
    const key = (r.plats ?? "").trim();
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
  // Display uses the nickname; the file hash stays keyed to the grid identity.
  return safeAgentFilename(`Plats ${placeLabel(c.label, nicks)}`, "plats:" + c.key);
}

export function renderLocationNote(c: LocationCluster, nicks?: Nicknames): RenderedNote {
  const name = placeLabel(c.label, nicks);
  const named = name !== c.key; // a nickname is set → keep the grid visible too
  const fm: string[] = [
    "---",
    "typ: plats",
    `källa: ${GENERATOR}`,
    `generator: ${GENERATOR}`,
    `metod: ${LOCATION_METOD}`,
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
  body.push(`# 📍 Plats: ${name}`);
  if (named) body.push(`_MGRS: ${c.key}_`);
  body.push("");
  body.push(`**Rapporter:** ${c.reports.length}  `);
  body.push(`**Misstänkta observationer:** ${c.elevatedCount}`);
  if (c.plates.length) body.push(`  \n**Fordon här:** ${c.plates.join(", ")}`);
  body.push("");
  body.push("## Observationer");
  for (const o of c.reports) {
    const stem = o.file.replace(/^.*\//, "").replace(/\.md$/, "");
    const mark = o.elevated ? "⚠ " : "";
    const plate = o.plates.length ? ` — ${o.plates.join(", ")}` : "";
    body.push(`- ${mark}[[${stem}|TNR${o.tnr}]] — ${o.tidpunkt}${plate}`);
  }
  body.push("");
  body.push("_Platsnod (härledd av 7s-plugin). Länkar samman observationerna på denna plats._");

  return { filename: locationFilename(c, nicks), markdown: fm.join("\n") + "\n\n" + body.join("\n") + "\n" };
}

export function renderLocationNotes(clusters: LocationCluster[], nicks?: Nicknames): RenderedNote[] {
  return clusters.map((c) => renderLocationNote(c, nicks));
}
