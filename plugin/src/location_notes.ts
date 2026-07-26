/*
 * Location nodes (pure) — one note per RELEVANT location, linking every report
 * observed there. In Obsidian's graph the location becomes a dot connected to its
 * report nodes (and through them to the markers/actors at that spot), so a place
 * with recurring suspicious activity shows up as a spatial hub.
 *
 * We may not edit message files, so the LOCATION note links out to the
 * reports — graph edges are undirected, so the cluster looks the same.
 *
 * "Relevant" = a location that hosts at least one suspicious (elevated) report OR
 * a vehicle plate. Benign-only places are left out to avoid cluttering the graph.
 *
 * Provenance: generator/källa 7s-plugin, metod: plats (own per-job prune), and a
 * `#plats` tag for the graph colour group.
 */
import { Report } from "./parse";
import { SuspicionAnalysis, haversineM } from "./suspicion";
import { plateIdentifiers } from "./ids";
import { safeFilename } from "./entity_notes";
import { mdText } from "./mdsafe";
import { GENERATOR, METOD, OBJEKTET_STEM, RenderedNote, noteStem, resolveMerge } from "./notes_common";
import { safeAgentFilename } from "./notenames";
import { Nicknames, placeLabel } from "./places";

export interface LocationReportRef {
  tnr: string;
  file: string;
  tidpunkt: string;
  elevated: boolean;
  plates: string[];
}

/** An operator-predefined place (created at operation setup, before any reports):
 *  fixed position + vicinity radius. A coord-bearing report within the radius is
 *  linked to the place; a `sensitive` place additionally feeds the suspicion
 *  proximity signal (bands scaled by the radius). Stored in plugin settings,
 *  keyed by the place NAME (which is also the cluster key / note title). */
export interface PredefinedLocation {
  lat: number;
  lon: number;
  /** Vicinity radius (m); default 100 in the creation dialog. */
  radiusM: number;
  /** Sensitive site → proximity alarm signal, beyond mere graph linking. */
  sensitive?: boolean;
}

export interface LocationCluster {
  key: string; // the `plats` string (MGRS grid or place name)
  label: string;
  lat?: number;
  lon?: number;
  reports: LocationReportRef[];
  elevatedCount: number;
  plates: string[];
  /** Set when this cluster is an operator-predefined place (exists from day 0). */
  predefined?: { radiusM: number; sensitive: boolean };
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
  predefined?: Record<string, PredefinedLocation>,
): LocationCluster[] {
  const elevatedFiles = new Set(suspicion.elevated.map((e) => e.file));
  const map = new Map<string, LocationCluster>();

  // Operator-predefined places exist from day 0 — a cluster (and thus a note)
  // even before any report mentions or nears them.
  for (const [name, p] of Object.entries(predefined ?? {})) {
    const key = resolveLocationKey(name, merges);
    if (!key || map.has(key)) continue;
    map.set(key, {
      key, label: key, lat: p.lat, lon: p.lon, reports: [], elevatedCount: 0, plates: [],
      predefined: { radiusM: p.radiusM, sensitive: p.sensitive === true },
    });
  }
  const predefClusters = [...map.values()];

  const attach = (c: LocationCluster, r: Report, elevated: boolean, plates: string[]) => {
    c.reports.push({ tnr: r.tnr, file: r.file, tidpunkt: r.tidpunkt, elevated, plates });
    if (elevated) c.elevatedCount++;
    for (const p of plates) if (!c.plates.includes(p)) c.plates.push(p);
    if (c.lat === undefined && r.lat !== undefined) {
      c.lat = r.lat;
      c.lon = r.lon;
    }
  };

  for (const r of reports) {
    const key = resolveLocationKey((r.plats ?? "").trim(), merges);
    const plates = plateIdentifiers(r)
      .filter((p) => !p.partial)
      .map((p) => p.value);
    const elevated = elevatedFiles.has(r.file);

    // The reported place. An operator-predefined place records EVERY observation
    // there (the operator created it because the spot matters — benign context
    // included); a derived place still needs suspicion or a vehicle to justify a
    // graph hub.
    if (key) {
      const own = map.get(key);
      if (own?.predefined) {
        attach(own, r, elevated, plates);
      } else if (elevated || plates.length > 0) {
        let c = own;
        if (!c) {
          c = { key, label: key, lat: r.lat, lon: r.lon, reports: [], elevatedCount: 0, plates: [] };
          map.set(key, c);
        }
        attach(c, r, elevated, plates);
      }
    }

    // Vicinity: the NEAREST predefined place whose radius covers the report also
    // claims it (dual relation — the reported place above is kept). Skip when the
    // reported place IS that predefined place (already attached).
    if (r.lat !== undefined && r.lon !== undefined) {
      let best: LocationCluster | undefined;
      let bestD = Infinity;
      for (const c of predefClusters) {
        const d = haversineM(r.lat, r.lon, c.lat!, c.lon!);
        if (d <= c.predefined!.radiusM && d < bestD) {
          best = c;
          bestD = d;
        }
      }
      if (best && best.key !== key) attach(best, r, elevated, plates);
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
    // `fördefinierad` puts the place on the map (query + needle rule); derived
    // hubs stay graph-only. `skyddsvärd` additionally marks the sensitive ones.
    c.predefined
      ? c.predefined.sensitive
        ? "tags: [plats, fördefinierad, skyddsvärd]"
        : "tags: [plats, fördefinierad]"
      : "tags: [plats]",
    `namn: "${name.replace(/"/g, "'")}"`,
    `mgrs: "${c.key}"`,
    `antal_rapporter: ${c.reports.length}`,
    `misstankta: ${c.elevatedCount}`,
  ];
  if (c.predefined) {
    fm.push("fördefinierad: true", `radie_m: ${c.predefined.radiusM}`);
    if (c.predefined.sensitive) fm.push("känslig: true");
  }
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
  // Predefined places link the AOI node → a graph edge from day 0, so the place
  // (and Objektet itself) is visible even though the graph hides orphans.
  if (c.predefined) body.push(`  \n**Operationsområde:** [[${OBJEKTET_STEM}]]`);
  body.push("");
  body.push("## Observationer");
  for (const o of c.reports) {
    const stem = noteStem(o.file);
    const mark = o.elevated ? "⚠ " : "";
    // Keep the message link (data/traceability) AND link the vehicle directly.
    const plate = o.plates.length ? ` — ${o.plates.map(plateLink).join(", ")}` : "";
    body.push(`- ${mark}[[${stem}|TNR${mdText(o.tnr)}]] — ${mdText(o.tidpunkt)}${plate}`);
  }
  if (c.reports.length === 0) body.push("_Inga observationer ännu._");
  body.push("");
  if (c.predefined) {
    body.push(
      `_Fördefinierad plats (skapad av operatören${c.predefined.sensitive ? ", skyddsvärd" : ""}). ` +
        `Observationer inom ${c.predefined.radiusM} m kopplas hit${
          c.predefined.sensitive ? "; närhet ger dessutom larmsignal" : ""
        }._`,
    );
  } else {
    body.push("_Platsnod (härledd av 7s-plugin). Länkar samman observationerna på denna plats._");
  }

  return { filename: locationFilename(c, nicks), markdown: fm.join("\n") + "\n\n" + body.join("\n") + "\n" };
}

export function renderLocationNotes(clusters: LocationCluster[], nicks?: Nicknames, recStem?: PlateRecurrenceLinker): RenderedNote[] {
  return clusters.map((c) => renderLocationNote(c, nicks, recStem));
}
