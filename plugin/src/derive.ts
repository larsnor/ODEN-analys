/*
 * Derivation layer (pure, Obsidian-free) — the "reasoning" that turns reports +
 * suspicion + operator decisions into the set of nodes to materialise and the feed.
 *
 * This used to live as methods on the Obsidian plugin class (main.ts), reading
 * `this.settings` and therefore untested by the node suite. Extracted here as free
 * functions that take a structural `PluginState` (the plugin's settings satisfy it),
 * so the whole derivation is unit-tested outside Obsidian. main.ts is now a thin
 * shell that reads the vault, calls these, and writes the results.
 */
import { Report } from "./parse";
import { SuspicionAnalysis, haversineM } from "./suspicion";
import { ActorHypothesis, ActorResult, buildActorHypotheses, foldActorMerges } from "./actor";
import { buildSuspects, suspectHypotheses, isActorCandidate } from "./suspects";
import { actorFilename, renderActorNote } from "./actor_notes";
import { buildLocations, LocationCluster, locationFilename, resolveLocationKey } from "./location_notes";
import { recurrenceFilename, RecurrencePair } from "./recurrence_notes";
import { safeFilename } from "./entity_notes";
import { markFilename } from "./mark_notes";
import { AnalysisBundle } from "./alerts";
import { FeedItem } from "./feed";
import { isMgrsGrid, placeLabel } from "./places";
import { suspicionLevel, reasonPhrases } from "./present";
import { NearLinker, StemLinker, noteStem } from "./notes_common";

/** The operator-judgement fields the derivation reads — a structural subset of the
 *  plugin's settings, so callers pass `settings` directly. Decision maps are typed
 *  `Record<string,string>` (only `=== "confirmed"` is tested), so the settings'
 *  narrower unions assign fine. */
export interface PluginState {
  entitiesFolder: string;
  locationNicknames: Record<string, string>;
  locationMerges: Record<string, string>;
  locationNameAsked: Record<string, true>;
  actorNames: Record<string, string>;
  actorMerges: Record<string, string>;
  actorDecisions: Record<string, string>;
  markDecisions: Record<string, string>;
  actorThreshold: number;
}

// --- Actors ----------------------------------------------------------------

/** Actors = transitive hypotheses (§6.4) PLUS single-observation suspect agents,
 *  deduped so an agent already inside a transitive actor isn't repeated. */
export function mergedActors(reports: Report[], suspicion: SuspicionAnalysis, threshold: number): ActorResult {
  const base = buildActorHypotheses(reports, { threshold });
  const inActors = new Set<string>();
  for (const h of base.hypotheses) for (const f of h.facets) inActors.add(f.id);
  // Only nominate suspects with a behavioural signal or a repeat sighting —
  // proximity+time-only agents stay as map markers, not actor candidates.
  const candidates = buildSuspects(reports, suspicion).filter(isActorCandidate);
  const extra = suspectHypotheses(candidates).filter((h) => !h.facets.some((f) => inActors.has(f.id)));
  return { ...base, hypotheses: [...base.hypotheses, ...extra] };
}

/** Confirmed actor hypotheses, after folding operator "same actor" merges. */
export function foldedConfirmedActors(reports: Report[], suspicion: SuspicionAnalysis, s: PluginState): ActorHypothesis[] {
  const confirmed = mergedActors(reports, suspicion, s.actorThreshold).hypotheses.filter(
    (h) => s.actorDecisions[h.id] === "confirmed",
  );
  return foldActorMerges(confirmed, s.actorMerges);
}

/** Render the FULL set of currently-confirmed actor notes. Writing the whole set —
 *  rather than one note — keeps the per-job prune correct: confirming/rejecting one
 *  actor never deletes the others. */
export function confirmedActorNotes(
  folded: ActorHypothesis[],
  s: PluginState,
  locStemOf?: StemLinker,
  recs?: { byActor: Map<string, string> },
  nearOf?: NearLinker,
): { name: string; body: string }[] {
  return folded.map((h) => {
    const opName = s.actorNames[h.id];
    // Operator name wins; else a single-observation suspect is titled by its facet
    // label (not the derived "(N fordon…)" default).
    const label = opName ?? (h.id.startsWith("suspect-") ? h.facets[0]?.label : undefined);
    // Route a place this actor recurs at through its recurrence node.
    const entityStem = noteStem(actorFilename(h, opName));
    const recStemOf = recs
      ? (plats: string) => recs.byActor.get(`${entityStem}@@${locStemOf?.(plats) ?? ""}`)
      : undefined;
    const note = renderActorNote(h, label, s.locationNicknames, opName, locStemOf, recStemOf, nearOf);
    return { name: note.filename, body: note.markdown };
  });
}

// --- Location / recurrence linking -----------------------------------------

/** Map each cluster's canonical key → its location-note stem. */
function locationStems(clusters: LocationCluster[], nicks: Record<string, string>): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of clusters) m.set(c.key, noteStem(locationFilename(c, nicks)));
  return m;
}

/** The location-note stem for a canonical place key (or "" if it has no node). */
export function stemForKey(clusters: LocationCluster[], key: string, nicks: Record<string, string>): string {
  const c = clusters.find((x) => x.key === key);
  return c ? noteStem(locationFilename(c, nicks)) : "";
}

/** A resolver from a raw observation `plats` to the stem of its location note
 *  (respecting operator merges), or undefined when that place has no node. */
export function locationLinker(clusters: LocationCluster[], s: PluginState): StemLinker {
  const stemByKey = locationStems(clusters, s.locationNicknames);
  return (plats: string) => stemByKey.get(resolveLocationKey(plats, s.locationMerges));
}

/** The nearest still-unnamed MGRS location cluster within `maxM` of a coordinate —
 *  so a map-click seed can offer "name this existing place" instead of creating a
 *  new one right next to it. Undefined when no such cluster is near. */
export function nearestNamelessGrid(
  clusters: LocationCluster[],
  lat: number,
  lon: number,
  nicks: Record<string, string>,
  maxM = 500,
): { key: string; distanceM: number } | undefined {
  let best: { key: string; distanceM: number } | undefined;
  for (const c of clusters) {
    if (!isMgrsGrid(c.key) || nicks[c.key] || c.lat === undefined || c.lon === undefined) continue;
    const d = haversineM(lat, lon, c.lat, c.lon);
    if (d <= maxM && (!best || d < best.distanceM)) best = { key: c.key, distanceM: Math.round(d) };
  }
  return best;
}

/** Resolves an observation FILE to the predefined place whose vicinity claimed it
 *  (stem + display label), from the attachments already computed in the clusters.
 *  Gives actors their second place edge: reported place + nearest predefined. */
export function predefNearLinker(clusters: LocationCluster[], s: PluginState): NearLinker {
  const byFile = new Map<string, { stem: string; label: string }>();
  for (const c of clusters) {
    if (!c.predefined) continue;
    const stem = noteStem(locationFilename(c, s.locationNicknames));
    const label = placeLabel(c.label, s.locationNicknames);
    for (const o of c.reports) if (!byFile.has(o.file)) byFile.set(o.file, { stem, label });
  }
  return (file) => byFile.get(file);
}

export interface Recurrences {
  pairs: RecurrencePair[];
  byVehicle: Map<string, string>;
  byActor: Map<string, string>;
}

/** Recurrence pairs (entity seen 2+ times at a place), plus lookup maps from an
 *  `entityStem@@placeStem` key to the recurrence-note stem (for routing). */
export function buildRecurrences(clusters: LocationCluster[], actors: ActorHypothesis[], s: PluginState): Recurrences {
  const nicks = s.locationNicknames;
  const pairs: RecurrencePair[] = [];
  const byVehicle = new Map<string, string>();
  const byActor = new Map<string, string>();
  const stemByKey = locationStems(clusters, nicks);

  const add = (p: RecurrencePair, into: Map<string, string>) => {
    pairs.push(p);
    into.set(p.key, noteStem(recurrenceFilename(p)));
  };

  // Vehicles: count how many reports at each cluster carry a given plate.
  for (const c of clusters) {
    const placeStem = stemByKey.get(c.key)!;
    const placeLbl = placeLabel(c.label, nicks);
    const count = new Map<string, number>();
    for (const o of c.reports) for (const p of o.plates) count.set(p, (count.get(p) ?? 0) + 1);
    for (const [plate, n] of count) {
      if (n < 2) continue;
      const entityStem = noteStem(safeFilename(plate));
      add({ key: `${entityStem}@@${placeStem}`, entityKind: "fordon", entityStem, entityLabel: plate, placeStem, placeLabel: placeLbl, count: n }, byVehicle);
    }
  }

  // Actors: count chain steps per place that has a location node.
  for (const h of actors) {
    const opName = s.actorNames[h.id];
    const entityStem = noteStem(actorFilename(h, opName));
    const entityLabel = opName ?? (h.facets.map((f) => f.label).join(" + ") || "aktör");
    const count = new Map<string, number>();
    for (const step of h.chain) {
      const key = resolveLocationKey(step.plats, s.locationMerges);
      if (stemByKey.has(key)) count.set(key, (count.get(key) ?? 0) + 1);
    }
    for (const [placeKey, n] of count) {
      if (n < 2) continue;
      const c = clusters.find((x) => x.key === placeKey);
      add({ key: `${entityStem}@@${stemByKey.get(placeKey)!}`, entityKind: "aktör", entityStem, entityLabel, placeStem: stemByKey.get(placeKey)!, placeLabel: placeLabel(c ? c.label : placeKey, nicks), count: n }, byActor);
    }
  }
  return { pairs, byVehicle, byActor };
}

// --- Feed ------------------------------------------------------------------

/** Build the live event/alarm feed items from the current analysis. DERIVED events
 *  only (identifications + alarms + pending-review nudges), never raw messages.
 *  `corroboration` = canonical plate → observation files whose photo backs it. */
export function buildFeedItems(bundle: AnalysisBundle, s: PluginState, corroboration: Map<string, Set<string>>): FeedItem[] {
  const folder = s.entitiesFolder.replace(/\/+$/, "");
  const inFolder = (name: string) => (folder ? `${folder}/${name}` : name);
  const ms = (t: string) => Date.parse(t) || 0;
  const items: FeedItem[] = [];

  // Identified vehicles (Job A entity notes).
  for (const e of bundle.jobA.entities) {
    items.push({
      path: inFolder(safeFilename(e.canonical)),
      kind: "fordon",
      time: ms(e.lastSeen),
      label: e.canonical,
      count: e.count,
      photo: corroboration.has(e.canonical),
    });
  }
  // Confirmed marks.
  for (const n of bundle.jobB.nominations) {
    if (s.markDecisions[n.signature] === "confirmed") {
      items.push({ path: inFolder(markFilename(n)), kind: "kännetecken", time: ms(n.lastSeen), label: n.label });
    }
  }
  // Confirmed actors (folded).
  const confirmed = foldActorMerges(
    bundle.actors.hypotheses.filter((h) => s.actorDecisions[h.id] === "confirmed"),
    s.actorMerges,
  );
  for (const h of confirmed) {
    const opName = s.actorNames[h.id];
    items.push({
      path: inFolder(actorFilename(h, opName)),
      kind: "aktör",
      time: ms(h.lastSeen),
      label: opName ?? `${h.vehicleCount} fordon + ${h.markCount} kännetecken`,
    });
  }
  // Alarms (link to the observation itself).
  for (const row of bundle.suspicion.elevated) {
    items.push({
      path: row.file,
      kind: "larm",
      time: ms(row.tidpunkt),
      plats: placeLabel(row.plats, s.locationNicknames),
      level: suspicionLevel(row.score),
      reasons: reasonPhrases(row.reasons),
    });
  }

  // Pending suggestions awaiting operator review — pinned to the top so they are
  // visible (click → the confirm/reject review). Human-gated (§6.1).
  const pendingActors = bundle.actors.hypotheses.filter((h) => !s.actorDecisions[h.id]).length;
  const pendingMarks = bundle.jobB.nominations.filter((n) => !s.markDecisions[n.signature]).length;
  if (pendingActors > 0) {
    items.push({ path: "review:actors", kind: "förslag-aktör", time: Number.MAX_SAFE_INTEGER, pending: pendingActors, review: "actors" });
  }
  if (pendingMarks > 0) {
    items.push({ path: "review:marks", kind: "förslag-märke", time: Number.MAX_SAFE_INTEGER - 1, pending: pendingMarks, review: "marks" });
  }

  // Nudge: relevant locations still a bare MGRS grid, not yet named/skipped.
  let t = Number.MAX_SAFE_INTEGER - 2;
  for (const c of buildLocations(bundle.reports, bundle.suspicion)) {
    if (!isMgrsGrid(c.key)) continue;
    if (s.locationNicknames[c.key] || s.locationNameAsked[c.key]) continue;
    items.push({ path: `review:place:${c.key}`, kind: "namnge-plats", time: t--, place: c.key, review: "place" });
  }
  return items;
}
