/*
 * Text reasoning (pure, Obsidian-free) — the open-vocabulary LLM extractor that
 * lifts the recall ceiling of the two FROZEN keyword lists (vocab.ts marks,
 * suspicion.ts THREAT_INDICATORS behaviours), which we measured at ~6–9 % and
 * ~24–62 % OOD recall. It reads a report's Händelse⊕Symbol prose and NOMINATES:
 *
 *   - distinctive marks (kännetecken) the mark vocabulary missed, re-identified
 *     across reports by a normalised key (fuzzy/embedding similarity is a later
 *     phase — this is exact-key clustering, a deliberate crude floor);
 *   - recon/threat behaviours the keyword list missed, classified into the SAME
 *     concept space (suspicion.threatConcepts) so a text hit and a keyword hit are
 *     one signal.
 *
 * Iron rule as everywhere: the LLM NOMINATES, the operator confirms. Nothing here
 * reaches the graph or the score without a human accept (§6.3, föreslagen-av: llm).
 * Accuracy is UNMEASURED — safe because gated; a harness pass (reusing the
 * behaviour OOD corpora) quantifies the lift before operational trust.
 */
import { Signal } from "./suspicion";

export const TEXT_PROMPT_VERSION = "1";

/** Concept keys the behaviour classifier may use (mirrors threatConcepts()). */
const CONCEPTS = new Set([
  "observation", "optik", "registrering", "kontraspaning", "dröjande",
  "perimeter", "teknik", "sabotage", "attentat", "infiltration",
]);

export const TEXT_PROMPT =
  "Du analyserar TEXTEN i en fältobservation (svenska). Svara ENDAST med JSON.\n" +
  "1) kännetecken: distinkta, IGENKÄNNBARA fysiska särdrag hos personer eller fordon " +
  "(färg+plagg, väska, utrustning, logotyp, fordonsdetalj). Endast särskiljande — " +
  "hoppa över generiskt ('en man', 'en bil').\n" +
  "2) beteenden: observerade beteenden som matchar något av begreppen [observation, " +
  "optik, registrering, kontraspaning, dröjande, perimeter, teknik, sabotage, " +
  "attentat, infiltration]. Ange begrepp + den korta fras i texten som stödjer det. " +
  "Hitta ALDRIG på — bara det som tydligt står i texten.\n" +
  "Schema: {\"kännetecken\":[\"\"],\"beteenden\":[{\"begrepp\":\"\",\"fras\":\"\"}]}";

export interface TextMark {
  label: string; // as written, operator-facing
  key: string; // normalised match key (exact-key re-id)
}
export interface TextExtraction {
  marks: TextMark[];
  behaviours: Signal[];
}

const isStr = (v: unknown): v is string => typeof v === "string";
function clean(v: unknown): string | undefined {
  if (!isStr(v)) return undefined;
  const s = v.trim();
  return s === "" || s === "-" ? undefined : s;
}

/** Normalise a mark phrase to a re-id key: lowercase, strip diacritics-safe
 *  articles/punctuation, sort tokens (so "orange ryggsäck" ≡ "ryggsäck orange"). */
export function normalizeMarkKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[.,;:!?()"']/g, " ")
    .split(/\s+/)
    .filter((w) => w && !["en", "ett", "den", "det", "med", "och", "i", "på", "av"].includes(w))
    .sort()
    .join(" ")
    .trim();
}

/** Parse a text-LLM response into a validated extraction, or null. `concepts` maps
 *  concept key → {label, weight} (from suspicion.threatConcepts()). */
export function parseTextExtraction(
  raw: string,
  concepts: Map<string, { label: string; weight: number }>,
): TextExtraction | null {
  const obj = tryJson(raw);
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;

  const marks: TextMark[] = [];
  const seenKey = new Set<string>();
  if (Array.isArray(o["kännetecken"])) {
    for (const item of o["kännetecken"]) {
      const label = clean(item);
      if (!label) continue;
      const key = normalizeMarkKey(label);
      if (!key || seenKey.has(key)) continue;
      seenKey.add(key);
      marks.push({ label, key });
    }
  }

  const behaviours: Signal[] = [];
  const seenB = new Set<string>();
  if (Array.isArray(o["beteenden"])) {
    for (const b of o["beteenden"]) {
      if (!b || typeof b !== "object") continue;
      const bb = b as Record<string, unknown>;
      const begrepp = clean(bb.begrepp)?.toLowerCase();
      if (!begrepp || !CONCEPTS.has(begrepp) || seenB.has(begrepp)) continue;
      const c = concepts.get(begrepp);
      if (!c) continue;
      seenB.add(begrepp);
      const fras = clean(bb.fras);
      behaviours.push({
        key: `beteende:${begrepp}`,
        label: `hotindikator (text): ${c.label}${fras ? ` ("${fras}")` : ""}`,
        weight: c.weight,
      });
    }
  }
  return { marks, behaviours };
}

function tryJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const a = raw.indexOf("{");
    const b = raw.lastIndexOf("}");
    if (a >= 0 && b > a) {
      try {
        return JSON.parse(raw.slice(a, b + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

// --- cross-report clustering of text marks (exact-key floor) -----------------

export interface TextMarkEntry {
  file: string;
  tnr: string;
  tidpunkt: string;
  plats: string;
  sagesman: string;
  marks: TextMark[];
}

/** One observation of a clustered text-mark — the operator-actionable context
 *  (WHICH report, when, where, and how THAT report phrased it). */
export interface TextMarkMember {
  file: string;
  tnr: string;
  tidpunkt: string;
  plats: string;
  /** The mark label as extracted from THIS report (phrasing may vary per report). */
  label: string;
}

export interface TextMarkNomination {
  key: string;
  /** Representative label: the LONGEST member phrasing (most descriptive variant). */
  label: string;
  files: string[];
  /** Per-report evidence — the review renders these as clickable TNR references. */
  members: TextMarkMember[];
  count: number; // distinct reports
  firstSeen: string;
  lastSeen: string;
}

/** A distinctive text-mark seen in ≥2 distinct reports is a re-id nomination —
 *  mirrors Job B's "seen once is not a pattern" rule. */
export function clusterTextMarks(entries: TextMarkEntry[]): TextMarkNomination[] {
  const byKey = new Map<string, Map<string, TextMarkMember>>(); // key → file → member
  for (const e of entries) {
    for (const m of e.marks) {
      if (!byKey.has(m.key)) byKey.set(m.key, new Map());
      const byFile = byKey.get(m.key)!;
      if (!byFile.has(e.file)) {
        byFile.set(e.file, { file: e.file, tnr: e.tnr, tidpunkt: e.tidpunkt, plats: e.plats, label: m.label });
      }
    }
  }
  const out: TextMarkNomination[] = [];
  for (const [key, byFile] of byKey) {
    if (byFile.size < 2) continue;
    const members = [...byFile.values()].sort(
      (a, b) => a.tidpunkt.localeCompare(b.tidpunkt) || a.tnr.localeCompare(b.tnr),
    );
    const times = members.map((m) => m.tidpunkt).filter(Boolean);
    // The longest phrasing is the most descriptive representative ("röd jacka
    // med kapuschong" beats a bare "röd" from another report).
    const label = members.reduce((best, m) => (m.label.length > best.length ? m.label : best), members[0].label);
    out.push({
      key,
      label,
      files: members.map((m) => m.file),
      members,
      count: byFile.size,
      firstSeen: times[0] ?? "",
      lastSeen: times[times.length - 1] ?? "",
    });
  }
  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
