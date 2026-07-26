/*
 * Derivation layer (pure, Obsidian-free) — the "reasoning" that turns reports +
 * suspicion + operator decisions into the set of nodes to materialise and the feed.
 *
 * Pure free functions taking an explicit structural `PluginState` (the plugin's
 * settings satisfy it), so the whole derivation is unit-tested outside Obsidian.
 * main.ts is a thin shell that reads the vault, calls these, and writes the
 * results.
 */
import { Report } from "./parse";
import { SuspicionAnalysis, haversineM } from "./suspicion";
import { ActorHypothesis, ActorResult, buildActorHypotheses, foldActorMerges } from "./actor";
import { buildSuspects, suspectHypotheses, isActorCandidate, Suspect } from "./suspects";
import { actorFilename, renderActorNote } from "./actor_notes";
import { suspectFilename } from "./suspect_notes";
import { safeAgentFilename } from "./notenames";
import { TextMarkNomination } from "./text_reasoning";
import { buildLocations, LocationCluster, locationFilename, resolveLocationKey } from "./location_notes";
import { recurrenceFilename, RecurrencePair } from "./recurrence_notes";
import { safeFilename } from "./entity_notes";
import { markFilename } from "./mark_notes";
import { AnalysisBundle } from "./alerts";
import { FeedItem } from "./feed";
import { isMgrsGrid, placeLabel } from "./places";
import { suspicionLevel, reasonPhrases } from "./present";
import { NearLinker, StemLinker, noteStem, resolveMerge } from "./notes_common";

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
  watchlist?: Record<string, WatchEntry>;
}

// --- Bevakningslista (watchlist, 🔭) ----------------------------------------

/** One operator "keep an eye on this" nomination. Stored in settings (wiped with
 *  the operation area like every judgement). VISIBILITY ONLY — the watchlist
 *  never feeds the suspicion score (no-fishing: operator interest must not
 *  inflate machine evidence; "Flagga som larm" is the tool for suspicion). */
export interface WatchEntry {
  kind: "fordon" | "aktör" | "person" | "märke" | "textmärke" | "händelse";
  label: string;
  /** Stable analysis key: plate canonical / actor hypothesis id / suspect agent
   *  key / mark-nomination signature / text-mark key / report file path. */
  ref: string;
  addedAt: string;
  /** Observation count when watched (or last marked seen); fresh = count −
   *  baseline. -1 = not yet initialised — the shell repairs it on first status. */
  baseline: number;
}

/** Current status of one watched entity — panel section + "🔭 Bevakad" feed rows. */
export interface WatchRow {
  key: string;
  kind: WatchEntry["kind"];
  label: string;
  count: number;
  lastSeen: string;
  /** New observations since the watch was added / last marked seen. */
  fresh: number;
  /** Note stem to open on click (undefined until the entity's note exists). */
  stem?: string;
}

/** Resolve every watchlist entry against the current analysis. `textMarks` and
 *  `suspects` are passed in (not in the bundle) — only needed when entries of
 *  those kinds exist. A watched actor id survives merges via resolveMerge. */
export function buildWatchStatus(
  bundle: AnalysisBundle,
  s: PluginState,
  textMarks: TextMarkNomination[] = [],
  suspects: Suspect[] = [],
): WatchRow[] {
  const folder = s.entitiesFolder.replace(/\/+$/, "");
  const inFolder = (name: string) => (folder ? `${folder}/${name}` : name);
  const entries = Object.entries(s.watchlist ?? {});
  if (entries.length === 0) return [];
  const confirmedActors = foldActorMerges(
    bundle.actors.hypotheses.filter((h) => s.actorDecisions[h.id] === "confirmed"),
    s.actorMerges,
  );
  const rows: WatchRow[] = [];
  for (const [key, w] of entries) {
    let count = 0;
    let lastSeen = "";
    let stem: string | undefined;
    let label = w.label;
    switch (w.kind) {
      case "fordon": {
        const e = bundle.jobA.entities.find((x) => x.canonical === w.ref);
        if (e) { count = e.count; lastSeen = e.lastSeen; stem = noteStem(inFolder(safeFilename(e.canonical))); label = e.canonical; }
        break;
      }
      case "aktör": {
        const canon = resolveMerge(w.ref, s.actorMerges);
        const h = confirmedActors.find((x) => x.id === canon);
        if (h) { count = h.chain.length; lastSeen = h.lastSeen; stem = noteStem(inFolder(actorFilename(h, s.actorNames[h.id]))); }
        break;
      }
      case "person": {
        const su = suspects.find((x) => x.key === w.ref);
        if (su) { count = su.obs.length; lastSeen = su.lastSeen; stem = noteStem(inFolder(suspectFilename(su))); }
        break;
      }
      case "märke": {
        const n = bundle.jobB.nominations.find((x) => x.signature === w.ref);
        if (n) { count = n.count; lastSeen = n.lastSeen; stem = noteStem(inFolder(markFilename(n))); }
        break;
      }
      case "textmärke": {
        const n = textMarks.find((x) => x.key === w.ref);
        if (n) { count = n.count; lastSeen = n.lastSeen; label = n.label; stem = noteStem(inFolder(safeAgentFilename(`🎒 ${n.label}`, "textmark:" + n.key))); }
        break;
      }
      case "händelse": {
        const r = bundle.reports.find((x) => x.file === w.ref);
        count = 1; // a single report never gains activity — the watch is a bookmark
        lastSeen = r?.tidpunkt ?? "";
        stem = noteStem(w.ref);
        break;
      }
    }
    const baseline = w.baseline < 0 ? count : w.baseline;
    // A watched single report is a bookmark — it can never gain activity.
    const fresh = w.kind === "händelse" ? 0 : Math.max(0, count - baseline);
    rows.push({ key, kind: w.kind, label, count, lastSeen, fresh, stem });
  }
  return rows.sort((a, b) => b.fresh - a.fresh || a.label.localeCompare(b.label, "sv"));
}

// --- Actors ----------------------------------------------------------------

/** Actors = transitive cross-type hypotheses PLUS single-observation suspect agents,
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
 *  `corroboration` = canonical plate → observation files whose photo backs it.
 *  `analyzingPhotos`/`analyzingTexts` = report files the VLM/LLM is analysing
 *  RIGHT NOW (transient, in-memory) → a pinned "…analys" row each.
 *  `photoPending`/`textPending` = un-actioned findings counts → one pinned
 *  review row per capability. */
export function buildFeedItems(
  bundle: AnalysisBundle,
  s: PluginState,
  corroboration: Map<string, Set<string>>,
  analyzingPhotos: ReadonlySet<string> = new Set(),
  photoPending = 0,
  analyzingTexts: ReadonlySet<string> = new Set(),
  textPending = 0,
  watch: WatchRow[] = [],
): FeedItem[] {
  const folder = s.entitiesFolder.replace(/\/+$/, "");
  const inFolder = (name: string) => (folder ? `${folder}/${name}` : name);
  const ms = (t: string) => Date.parse(t) || 0;
  const items: FeedItem[] = [];

  // Identified vehicles (plate re-identification entity notes).
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

  // Watched entities with NEW activity — amber 🔭 rows at the observation's own
  // time (visibility only; the watchlist never feeds the score). Synthetic path
  // so the entity's own row survives; clicking marks the activity seen.
  for (const wr of watch) {
    if (wr.fresh <= 0) continue;
    items.push({ path: `bevakad:${wr.key}`, kind: "bevakad", time: ms(wr.lastSeen), label: wr.label, count: wr.fresh, file: wr.stem, watchKey: wr.key });
  }

  // Pending suggestions awaiting operator review — pinned to the top so they are
  // visible (click → the confirm/reject review). Human-gated.
  const pendingActors = bundle.actors.hypotheses.filter((h) => !s.actorDecisions[h.id]).length;
  const pendingMarks = bundle.jobB.nominations.filter((n) => !s.markDecisions[n.signature]).length;
  if (pendingActors > 0) {
    items.push({ path: "review:actors", kind: "förslag-aktör", time: Number.MAX_SAFE_INTEGER, pending: pendingActors, review: "actors" });
  }
  if (pendingMarks > 0) {
    items.push({ path: "review:marks", kind: "förslag-märke", time: Number.MAX_SAFE_INTEGER - 1, pending: pendingMarks, review: "marks" });
  }
  if (photoPending > 0) {
    items.push({ path: "review:photos", kind: "förslag-bild", time: Number.MAX_SAFE_INTEGER - 2, pending: photoPending, review: "photos" });
  }
  if (textPending > 0) {
    items.push({ path: "review:texts", kind: "förslag-text", time: Number.MAX_SAFE_INTEGER - 3, pending: textPending, review: "texts" });
  }

  // Transient: reports being analysed right now (photo VLM / text LLM) — one
  // pinned row per report. The synthetic path keeps the row from dedup-replacing
  // the report's own larm row; `file` is the real click target.
  let t = Number.MAX_SAFE_INTEGER - 4;
  for (const f of [...analyzingPhotos].sort()) {
    const r = bundle.reports.find((x) => x.file === f);
    items.push({ path: `bildanalys:${f}`, kind: "bildanalys", time: t--, tnr: r?.tnr ?? "?", plats: r ? placeLabel(r.plats, s.locationNicknames) : undefined, file: f });
  }
  for (const f of [...analyzingTexts].sort()) {
    if (analyzingPhotos.has(f)) continue; // one in-progress row per report is enough
    const r = bundle.reports.find((x) => x.file === f);
    items.push({ path: `textanalys:${f}`, kind: "textanalys", time: t--, tnr: r?.tnr ?? "?", plats: r ? placeLabel(r.plats, s.locationNicknames) : undefined, file: f });
  }

  // Nudge: relevant locations still a bare MGRS grid, not yet named/skipped.
  for (const c of buildLocations(bundle.reports, bundle.suspicion)) {
    if (!isMgrsGrid(c.key)) continue;
    if (s.locationNicknames[c.key] || s.locationNameAsked[c.key]) continue;
    items.push({ path: `review:place:${c.key}`, kind: "namnge-plats", time: t--, place: c.key, review: "place" });
  }
  return items;
}
