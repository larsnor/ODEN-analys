/*
 * Suspect agents (pure) — a suspicious observation identifies an AGENT (a
 * vehicle or a person) that the operator may verify as an actor, EVEN from a
 * single observation. This complements the transitive actor derivation:
 * that needs a multi-facet component; a lone suspect never surfaces there.
 *
 * The agent of a report:
 *   - a VEHICLE if the report carries a plate (ids.plateIdentifiers), else
 *   - a PERSON, identified by their distinguishing description (Symbol prose);
 *     recurring sightings of the same description group into one suspect.
 *
 * Suspects are converted to single-facet ActorHypotheses so the EXISTING actor
 * review + confirm→write flow handles them unchanged (human-gated).
 */
import { Report } from "./parse";
import { SuspicionAnalysis, Signal } from "./suspicion";
import { plateIdentifiers } from "./ids";
import { ActorHypothesis, ChainStep, Facet } from "./actor";
import { noteStem } from "./notes_common";
import { suspicionLevel } from "./present";

export interface SuspectObs {
  tnr: string;
  file: string;
  plats: string;
  tidpunkt: string;
  lat?: number;
  lon?: number;
  score: number;
  reasons: Signal[];
}

export interface Suspect {
  key: string; // stable agent key ("fordon:RJK241" | "person:<desc>")
  kind: "fordon" | "person";
  label: string; // agent display (plate, or the person's description)
  obs: SuspectObs[]; // suspicious observations of this agent
  firstSeen: string;
  lastSeen: string;
  /** Highest suspicion level word across observations (for the note). */
  level: string;
}

function agentOf(r: Report): { key: string; kind: "fordon" | "person"; label: string } {
  const plate = plateIdentifiers(r).find((p) => !p.partial) ?? plateIdentifiers(r)[0];
  if (plate) return { key: `fordon:${plate.value}`, kind: "fordon", label: plate.value };
  const desc = (r.symbol ?? "").trim();
  if (desc) return { key: `person:${desc.toLowerCase()}`, kind: "person", label: desc };
  // No plate, no description → identify by the report so two unknowns stay distinct.
  return { key: `person:${r.tnr}`, kind: "person", label: `okänd (TNR${r.tnr})` };
}

/** Group elevated observations by their agent into suspect candidates. */
export function buildSuspects(reports: Report[], suspicion: SuspicionAnalysis): Suspect[] {
  const byFile = new Map<string, Report>();
  for (const r of reports) byFile.set(r.file, r);

  const map = new Map<string, Suspect>();
  for (const row of suspicion.elevated) {
    const r = byFile.get(row.file);
    if (!r) continue;
    const a = agentOf(r);
    const obs: SuspectObs = {
      tnr: row.tnr,
      file: row.file,
      plats: row.plats,
      tidpunkt: row.tidpunkt,
      lat: r.lat,
      lon: r.lon,
      score: row.score,
      reasons: row.reasons,
    };
    let s = map.get(a.key);
    if (!s) {
      s = { key: a.key, kind: a.kind, label: a.label, obs: [], firstSeen: "", lastSeen: "", level: "" };
      map.set(a.key, s);
    }
    s.obs.push(obs);
  }

  const suspects = [...map.values()];
  for (const s of suspects) {
    s.obs.sort((x, y) => x.tidpunkt.localeCompare(y.tidpunkt) || x.tnr.localeCompare(y.tnr));
    s.firstSeen = s.obs[0]?.tidpunkt ?? "";
    s.lastSeen = s.obs[s.obs.length - 1]?.tidpunkt ?? "";
    s.level = suspicionLevel(Math.max(...s.obs.map((o) => o.score))) || "Att bevaka";
  }
  return suspects.sort((a, b) => b.obs.length - a.obs.length || a.key.localeCompare(b.key));
}

/** Stable ActorHypothesis id for a suspect agent key (also the review-decision key). */
export function suspectHypId(key: string): string {
  return "suspect-" + key.replace(/[\\/:*?"<>|.\s#]/g, "_");
}

/**
 * Should this suspect be NOMINATED as an actor candidate (vs. only marked on the
 * map)? Yes when there's an actual behavioural signal (a recon indicator) OR the
 * same agent is seen more than once. A lone report that only scores from
 * proximity+time — e.g. a farm vehicle working late near the object — still gets
 * a red marker, but doesn't clutter the actor-review list with ambient activity.
 */
export function isActorCandidate(s: Suspect): boolean {
  if (s.obs.length > 1) return true; // repeat sighting of the same agent
  return s.obs.some((o) => o.reasons.some((r) => r.key.startsWith("beteende:")));
}

/** Convert suspects to single-facet ActorHypotheses for the actor review. */
export function suspectHypotheses(suspects: Suspect[]): ActorHypothesis[] {
  return suspects.map((s): ActorHypothesis => {
    const stem = s.obs[0] ? noteStem(s.obs[0].file) : "";
    const latest = s.obs[s.obs.length - 1]; // most recent observation → map position
    const facet: Facet = {
      id: s.key,
      kind: s.kind === "fordon" ? "fordon" : "kannetecken",
      type: s.kind === "fordon" ? "fordon" : "person",
      label: s.label,
      noteStem: stem, // link the observation (no separate facet note for a lone person)
      files: s.obs.map((o) => o.file),
    };
    const chain: ChainStep[] = s.obs.map((o) => ({
      tnr: o.tnr,
      tidpunkt: o.tidpunkt,
      plats: o.plats,
      file: o.file,
      facets: [s.label],
    }));
    return {
      id: suspectHypId(s.key),
      facets: [facet],
      types: [facet.type],
      vehicleCount: s.kind === "fordon" ? 1 : 0,
      markCount: s.kind === "person" ? 1 : 0,
      edges: [],
      chain,
      reportFiles: s.obs.map((o) => o.file),
      firstSeen: s.firstSeen,
      lastSeen: s.lastSeen,
      explanation: `Misstänkt ${s.kind === "fordon" ? "fordon" : "person"}: ${s.label}`,
      method: "aktor",
      föreslagenAv: "deterministisk",
      lat: latest?.lat,
      lon: latest?.lon,
    };
  });
}
