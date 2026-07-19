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
import { extractCraft } from "./craft";

export interface Signal {
  key: string;
  label: string; // human-readable reason (shown to the operator)
  weight: number;
}
export interface Scored {
  score: number;
  reasons: Signal[];
}

/** An operator-marked sensitive place (a predefined location with the sensitive
 *  flag): an EXTRA proximity anchor, with bands SCALED by the place's vicinity
 *  radius (<R → 3, <2R → 2, <4R → 1) so a small shed and a large depot both alarm
 *  sensibly, and the radius the operator set is a real dial. */
export interface SensitivePlace {
  name: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export interface SuspicionOpts {
  /** Protected object (objektet) — HvSS Vällinge säteri by default. */
  protectedLat: number;
  protectedLon: number;
  /** Elevated-suspicion threshold for the rollup. */
  threshold?: number;
  /** Operator-marked sensitive places — additional proximity anchors. */
  sensitivePlaces?: SensitivePlace[];
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
// Bounded, precision-gated expansion (validated on a held-out blind corpus — see
// docs/BEHAVIOUR_VALIDATION.md). The original stems were PAST-TENSE-locked to the
// generator's phrasings (recall ~24% on independently-authored prose); the additions
// below are principled TENSE/CONJUGATION coverage (present + supine of the same
// hostile verbs) plus a few unambiguous hostile phrases, each checked to fire on 0
// benign sentences. Ambiguous concepts that cannot be separated from benign life by
// a keyword (filming/photographing, measuring, leaving-a-package vs a delivery) are
// deliberately LEFT to the geo+time weighting and to Phase B — not forced in. FROZEN.
export const THREAT_INDICATORS: Array<{ key: string; label: string; weight?: number; stems: string[] }> = [
  // --- Reconnaissance: surveillance / optics / counter-surveillance ----------
  { key: "observation", label: "övervakning/spaning", stems: [
    "betrakta", "iaktt", "uppsikt mot", "uppsikt över", "höll uppsikt", "höll utkik",
    "höll koll", "håller koll", "hålla koll", "håller utkik", "spana", "rekognos", "rekade",
    "observera", "övervaka", "bevakade", "bevakar", "glor mot", "kollar mot vakt"] },
  { key: "optik", label: "optik/foto", stems: [
    "kikare", "teleobjektiv", "fotografera", "kamera", "filmade", "zoomade", "drönar",
    "nattkikare", "värmekamera", "mörkerkikare", "kikarsikte", "systemkamera"] },
  { key: "registrering", label: "registrering/kartläggning", stems: [
    "antecknade", "antecknar", "block", "stegräknare", "kartlägg", "mätte", "koordinater", "gps",
    "positionerade", "märkte ut", "skiss", "tidtog", "prickade av", "prickar av",
    "räknade fordon", "räknade passager", "räknar fordon", "räknar bilar", "räknar vakter",
    "räknar passager", "noterar tider", "noterar tidpunkter", "stegar upp", "stegar av"] },
  { key: "kontraspaning", label: "kontraspaning", stems: [
    "kontraspaning", "drog sig undan", "undvek ögonkontakt", "tittade bakåt", "tittar bakåt",
    "tittar över axeln", "över axeln", "sänkte blicken", "väjde undan", "gömde sig", "gömmer",
    "maskerade", "vände tvärt", "vänder tvärt", "cirklade", "bytte riktning",
    "försvinner så fort", "bryter av och"] },
  { key: "dröjande", label: "dröjande/upprepning", stems: [
    "stod stilla länge", "andra varvet", "tredje varvet", "långsam passage", "upprepat",
    "dröjde kvar", "för tredje gången", "tredje gången", "kör sakta förbi", "kör långsamt förbi",
    "flera varv", "runt kvarteret", "ett varv till", "upprepade gånger"] },
  { key: "perimeter", label: "närmande/rekognosering av objekt", stems: [
    "kände på staketet", "kände på grinden", "testade grinden", "testade låset",
    "klättrade över", "klättrar över", "kröp", "kryper", "forcerade", "forcerar",
    "trängde in", "tog sig in", "tog sig över", "rycker i handtaget", "rycker i grinden"] },
  { key: "teknik", label: "teknisk inhämtning", stems: [
    "antenn", "sändare", "störsändare", "avlyssning", "signalspaning", "pejlade", "pejl"] },
  // --- Sabotage: breaching + tampering (high confidence → weight 3) -----------
  { key: "sabotage", label: "sabotage/åverkan", weight: 3, stems: [
    "manipulera", "bände upp", "bänder upp", "bröt sig in", "bryter sig in", "bryter loss",
    "bryter upp", "kopplade bort", "kopplar bort", "saboterade", "saboterar", "sabotage",
    "klippte upp", "klippte hål", "klipper upp", "klipper hål", "sågade av", "sågar av",
    "dyrkade", "dyrkar", "bultsax", "avbitartång", "kofot", "bågfil", "sprängmedel",
    "brytverktyg", "brutit sönder"] },
  // --- Terrorism: unattended object + vehicle probing (weight 3) --------------
  { key: "attentat", label: "attentatsindikator", weight: 3, stems: [
    "oidentifierad väska", "kvarlämnad", "herrelöst", "lämnade en väska", "lämnade ett paket",
    "obevakad väska", "övergiven väska", "övergiven ryggsäck", "misstänkt föremål",
    "misstänkt paket", "placerade ett föremål", "placerade ett paket",
    "ställer ifrån sig en väska", "ställer ifrån sig ett paket", "ställer ifrån sig en ryggsäck",
    "grävde ned", "gräver ner", "gräver ned", "fordonsspärr", "körde långsamt förbi",
    "upprepade förbifarter", "rammade"] },
  // --- Infiltration: unauthorised access + pretext + tailing ------------------
  { key: "infiltration", label: "infiltration/tillträde", stems: [
    "obehörig", "utan behörighet", "smet in", "smiter in", "gled in vid", "glider in",
    "utgav sig för", "utger sig för", "utger sig", "påstår sig vara", "säger sig vara",
    "uppger sig", "låtsades vara", "falsk arbetsorder", "saknade arbetsorder",
    "saknar arbetsorder", "fel firmanamn", "kan inte visa legitimation", "förfalskad",
    "skuggade en", "skuggade personal", "skuggar", "följde efter personal", "följer efter",
    "går tätt bakom", "testade en dörr", "testade dörren", "testar dörren", "testar en dörr",
    "testar dörrhandtaget"] },
];

/** The behaviour concepts (key + operator label + weight), for the LLM text
 *  extractor to classify open-vocabulary phrasing into — same concept space as the
 *  deterministic keyword list, so a text-LLM hit and a keyword hit are the same
 *  signal and dedupe cleanly. */
export function threatConcepts(): { key: string; label: string; weight: number }[] {
  return THREAT_INDICATORS.map((i) => ({ key: i.key, label: i.label, weight: i.weight ?? 2 }));
}

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

  // 1. Proximity (graded; needs coords — MGRS-derived ok). Anchors: objektet
  //    (fixed 800/1600/3000 m bands) + operator-marked sensitive places (bands
  //    scaled by each place's vicinity radius). ONE signal only — the strongest,
  //    then nearest — never summed, so proximity alone still cannot cross the
  //    threshold no matter how many anchors overlap.
  if (report.lat !== undefined && report.lon !== undefined) {
    const cand: { d: number; sig: Signal }[] = [];
    const d = haversineM(report.lat, report.lon, opts.protectedLat, opts.protectedLon);
    const m = Math.round(d);
    if (d < 800) cand.push({ d, sig: { key: "proximity", label: `nära objektet (~${m} m)`, weight: 3 } });
    else if (d < 1600) cand.push({ d, sig: { key: "proximity", label: `i närområdet (~${m} m)`, weight: 2 } });
    else if (d < 3000) cand.push({ d, sig: { key: "proximity", label: `i vidare område (~${m} m)`, weight: 1 } });
    for (const p of opts.sensitivePlaces ?? []) {
      const dp = haversineM(report.lat, report.lon, p.lat, p.lon);
      const R = Math.max(1, p.radiusM);
      const mp = Math.round(dp);
      if (dp < R) cand.push({ d: dp, sig: { key: "känslig-plats", label: `nära ${p.name} (~${mp} m)`, weight: 3 } });
      else if (dp < 2 * R) cand.push({ d: dp, sig: { key: "känslig-plats", label: `i närområdet av ${p.name} (~${mp} m)`, weight: 2 } });
      else if (dp < 4 * R) cand.push({ d: dp, sig: { key: "känslig-plats", label: `i vidare område kring ${p.name} (~${mp} m)`, weight: 1 } });
    }
    cand.sort((a, b) => b.sig.weight - a.sig.weight || a.d - b.d);
    if (cand.length > 0) reasons.push(cand[0].sig);
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

  // 3b. Operator-CONFIRMED recon behaviours from an attached photo (§6.7). Already
  //     gated (llm-vision → operatör confirmed) and restricted to the recon subset
  //     at nomination time, so they simply add their weight here — deduped against
  //     a text keyword that already found the same concept.
  for (const b of report.confirmedBehaviours ?? []) {
    if (!reasons.some((r) => r.key === b.key)) reasons.push(b);
  }

  // 4. Craft type (farkost) — a drone/boat/aircraft is inherently relevant near
  //    the objektet. The type's `threat` weight STACKS with proximity + time, so
  //    a drone near the objektet at night reaches Hög, a boat loitering there at
  //    night reaches Förhöjd, and a tractor (threat 0) never flags on type alone.
  //    Craft is always QUERYABLE (query.ts farkost target) even when unelevated.
  //    NB deliberate: a drone ALSO fires beteende:optik (the frozen, validated
  //    "drönar" stem above) — that is two model dimensions, not double-counting:
  //    farkost = what it IS (an aircraft), optik = what it DOES (airborne
  //    sensor). Net effect: any drone mention alone reaches "Att bevaka".
  for (const c of extractCraft(report)) {
    if (c.threat > 0 && !reasons.some((r) => r.key === `farkost:${c.type}`)) {
      reasons.push({ key: `farkost:${c.type}`, label: `farkost: ${c.label}`, weight: c.threat });
    }
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

  return { rows, elevated, threshold, nearObjectElevated };
}
