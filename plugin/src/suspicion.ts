/*
 * §6.5/§6.6 — transparent suspicion score (pure TS, Obsidian-free). NO LLM.
 *
 * A weighted, EXPLAINABLE sum — never just a number. Every contribution is a
 * named reason with its weight, so a reviewer sees exactly why something scored.
 *
 * Crucially this scores PER REPORT (and aggregates), not only per entity: a
 * reconnaissance team of distinct individuals produces NO entities (no shared
 * ID, no marking-bearing tell), so the re-id layers miss it entirely — but each
 * sighting is individually scorable by:
 *   - proximity to the protected object (robust; haversine, works off MGRS-derived coords)
 *   - time of day (robust; night activity)
 *   - recon-behaviour indicators in Händelse (the TUNABLE surface — the LLM lifts this later)
 * The team then surfaces as a spatio-temporal CONCENTRATION of elevated reports.
 *
 * Per-entity suspicion (§6.5) is also provided for entities that DO exist
 * (recurring vehicles): recurrence + aggregated proximity/night.
 */
import { Report } from "./parse";

export interface Signal {
  key: string;
  label: string; // human-readable reason (shown to the operator)
  weight: number;
}
export interface Scored {
  score: number;
  reasons: Signal[];
}

export interface SuspicionOpts {
  /** Protected object (objektet) — HvSS Vällinge säteri by default. */
  protectedLat: number;
  protectedLon: number;
  /** Elevated-suspicion threshold for the rollup. */
  threshold?: number;
}

export const DEFAULT_SUSPICION: SuspicionOpts = {
  protectedLat: 59.2622,
  protectedLon: 17.712,
  threshold: 5,
};

/**
 * Threat-behaviour indicators (the TUNABLE / domain-specific surface, isolated
 * like vocab.ts). Covers the four hostility modes — reconnaissance, sabotage,
 * infiltration and terrorism — each a category of behavioural signals. The LLM
 * (later) lifts the open-vocabulary ceiling this fixed list cannot reach.
 *
 * `weight` defaults to 2; HIGH-CONFIDENCE signals (breaching tools, tampering,
 * an unattended package) are weight 3, so a single such signal at night reaches
 * the threshold even without proximity.
 *
 * Matching is SUBSTRING (a poor-man's stemmer: "iaktt" catches iakttog/iakttar).
 * So every stem must be safe INSIDE benign words too — prefer verb roots and
 * multi-word phrases, and never a stem a benign template contains (e.g. "under
 * uppsikt av" is benign → require "uppsikt mot/över"; "klippte gräs" is benign →
 * a saboteur "klippte upp" the fence, never bare "klippte").
 */
export const THREAT_INDICATORS: Array<{ key: string; label: string; weight?: number; stems: string[] }> = [
  // --- Reconnaissance: surveillance / optics / counter-surveillance ----------
  { key: "observation", label: "övervakning/spaning", stems: [
    "betrakta", "iaktt", "uppsikt mot", "uppsikt över", "höll uppsikt", "höll utkik",
    "höll koll", "spana", "rekognos", "rekade", "observera", "övervaka", "bevakade"] },
  { key: "optik", label: "optik/foto", stems: [
    "kikare", "teleobjektiv", "fotografera", "kamera", "filmade", "zoomade", "drönar",
    "nattkikare", "värmekamera", "mörkerkikare"] },
  { key: "registrering", label: "registrering/kartläggning", stems: [
    "antecknade", "block", "stegräknare", "kartlägg", "mätte", "koordinater", "gps",
    "positionerade", "märkte ut", "skiss", "tidtog", "prickade av", "räknade fordon",
    "räknade passager"] },
  { key: "kontraspaning", label: "kontraspaning", stems: [
    "kontraspaning", "drog sig undan", "undvek ögonkontakt", "tittade bakåt", "sänkte blicken",
    "väjde undan", "gömde sig", "maskerade", "vände tvärt", "cirklade", "bytte riktning"] },
  { key: "dröjande", label: "dröjande/upprepning", stems: [
    "stod stilla länge", "andra varvet", "tredje varvet", "långsam passage", "upprepat",
    "dröjde kvar"] },
  { key: "perimeter", label: "närmande/rekognosering av objekt", stems: [
    "kände på staketet", "kände på grinden", "testade grinden", "testade låset",
    "klättrade över", "kröp", "forcerade", "trängde in", "tog sig in", "tog sig över"] },
  { key: "teknik", label: "teknisk inhämtning", stems: [
    "antenn", "sändare", "störsändare", "avlyssning", "signalspaning", "pejlade", "pejl"] },
  // --- Sabotage: breaching + tampering (high confidence → weight 3) -----------
  { key: "sabotage", label: "sabotage/åverkan", weight: 3, stems: [
    "manipulera", "bände upp", "bröt sig in", "kopplade bort", "saboterade", "sabotage",
    "klippte upp", "klippte hål", "sågade av", "dyrkade", "bultsax", "kofot", "bågfil",
    "sprängmedel", "brytverktyg"] },
  // --- Terrorism: unattended object + vehicle probing (weight 3) --------------
  { key: "attentat", label: "attentatsindikator", weight: 3, stems: [
    "oidentifierad väska", "kvarlämnad", "herrelöst", "lämnade en väska", "lämnade ett paket",
    "obevakad väska", "misstänkt föremål", "misstänkt paket", "placerade ett föremål",
    "placerade ett paket", "grävde ned", "fordonsspärr", "körde långsamt förbi",
    "upprepade förbifarter", "rammade"] },
  // --- Infiltration: unauthorised access + pretext + tailing ------------------
  { key: "infiltration", label: "infiltration/tillträde", stems: [
    "obehörig", "smet in", "gled in vid", "utgav sig för", "låtsades vara", "falsk arbetsorder",
    "saknade arbetsorder", "förfalskad", "skuggade en", "skuggade personal",
    "följde efter personal", "testade en dörr", "testade dörren"] },
];

const R = 6371000; // earth radius (m)
export function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function hourOf(tidpunkt: string): number | null {
  const m = tidpunkt.match(/T(\d{2}):/);
  return m ? parseInt(m[1], 10) : null;
}

/** Score one report. Pure, deterministic, fully explainable. */
export function scoreReport(report: Report, opts: SuspicionOpts = DEFAULT_SUSPICION): Scored {
  const reasons: Signal[] = [];

  // 1. Proximity to the protected object (graded; needs coords — MGRS-derived ok).
  if (report.lat !== undefined && report.lon !== undefined) {
    const d = haversineM(report.lat, report.lon, opts.protectedLat, opts.protectedLon);
    const m = Math.round(d);
    if (d < 800) reasons.push({ key: "proximity", label: `nära objektet (~${m} m)`, weight: 3 });
    else if (d < 1600) reasons.push({ key: "proximity", label: `i närområdet (~${m} m)`, weight: 2 });
    else if (d < 3000) reasons.push({ key: "proximity", label: `i vidare område (~${m} m)`, weight: 1 });
  }

  // 2. Time of day.
  const h = hourOf(report.tidpunkt);
  if (h !== null) {
    if (h >= 22 || h < 5) reasons.push({ key: "natt", label: `nattaktivitet (kl ${String(h).padStart(2, "0")})`, weight: 2 });
    else if (h < 7 || h >= 21) reasons.push({ key: "skymning", label: `gryning/skymning (kl ${String(h).padStart(2, "0")})`, weight: 1 });
  }

  // 3. Recon-behaviour indicators in Händelse ⊕ Symbol (tunable surface).
  const text = `${report.handelse ?? ""} ${report.symbol ?? ""}`.toLowerCase();
  for (const ind of THREAT_INDICATORS) {
    const hit = ind.stems.find((s) => text.includes(s));
    if (hit) reasons.push({ key: `beteende:${ind.key}`, label: `hotindikator: ${ind.label} ("${hit}")`, weight: ind.weight ?? 2 });
  }

  const score = reasons.reduce((s, r) => s + r.weight, 0);
  return { score, reasons };
}


export interface SuspicionRow {
  file: string;
  tnr: string;
  tidpunkt: string;
  plats: string;
  sagesman: string;
  lat?: number;
  lon?: number;
  score: number;
  reasons: Signal[];
}
export interface SuspicionAnalysis {
  rows: SuspicionRow[]; // all, sorted desc by score
  elevated: SuspicionRow[]; // score >= threshold
  threshold: number;
  nearObjectElevated: number;
  nightElevated: number;
  byLocation: Array<{ plats: string; count: number }>;
  byDay: Array<{ day: string; count: number }>;
}


/** Score every report and roll up the elevated ones spatially/temporally. */
export function analyzeSuspicion(reports: Report[], opts: SuspicionOpts = DEFAULT_SUSPICION): SuspicionAnalysis {
  const threshold = opts.threshold ?? 5;
  const rows: SuspicionRow[] = reports.map((r) => {
    const s = scoreReport(r, opts);
    return {
      file: r.file,
      tnr: r.tnr,
      tidpunkt: r.tidpunkt,
      plats: r.plats,
      sagesman: r.sagesman,
      lat: r.lat,
      lon: r.lon,
      score: s.score,
      reasons: s.reasons,
    };
  });
  rows.sort((a, b) => b.score - a.score || a.tidpunkt.localeCompare(b.tidpunkt) || a.tnr.localeCompare(b.tnr));
  const elevated = rows.filter((r) => r.score >= threshold);

  const nearObjectElevated = elevated.filter((r) => r.reasons.some((x) => x.key === "proximity" && x.weight === 3)).length;
  const nightElevated = elevated.filter((r) => r.reasons.some((x) => x.key === "natt")).length;

  const locCount = new Map<string, number>();
  const dayCount = new Map<string, number>();
  for (const r of elevated) {
    locCount.set(r.plats, (locCount.get(r.plats) ?? 0) + 1);
    const day = r.tidpunkt.slice(0, 10);
    dayCount.set(day, (dayCount.get(day) ?? 0) + 1);
  }
  const byLocation = [...locCount.entries()].map(([plats, count]) => ({ plats, count })).sort((a, b) => b.count - a.count);
  const byDay = [...dayCount.entries()].map(([day, count]) => ({ day, count })).sort((a, b) => a.day.localeCompare(b.day));

  return { rows, elevated, threshold, nearObjectElevated, nightElevated, byLocation, byDay };
}
