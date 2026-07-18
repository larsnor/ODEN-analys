/*
 * Photo analysis (pure, Obsidian-free) — the "reasoning" half of the vision phase.
 *
 * A VLM (Ollama, src/llm.ts) turns an attached photo into a PhotoSighting; this
 * module owns the PROMPT, the response VALIDATION, the recon-behaviour mapping,
 * and the sighting → operator-nomination derivation. No network, no Obsidian —
 * so the whole judgement layer is unit-tested with canned JSON (FakeVision).
 *
 * Iron rule (§6.7): images NOMINATE, never assert. Every finding here is a
 * suggestion the operator confirms per-item. Provenance on anything materialised
 * from a photo: `föreslagen-av: llm-vision`.
 *
 * Data-model (locked 2026-07-14): a photo PLATE is a re-identification key (→ Job
 * A after confirm); a photo-described VEHICLE/PERSON is a report-local ANNOTATION
 * (never auto-merged across reports — generic descriptions can't be re-identified).
 * Behaviour from a still is the RECON subset only (optik/observation/registrering)
 * — the severe behaviours are act-not-photograph moments.
 */
import { Signal } from "./suspicion";
import { normalizePlate } from "./vision";

/** Bump when the prompt/schema changes — part of the cache key, so old cached
 *  sightings are re-analysed rather than silently reused (§9.2). */
export const PROMPT_VERSION = "1";

/** The sighting prompt (Swedish). Rules proven in the bake-off: every attribute
 *  optional with an explicit "okänd" escape (forced guessing is where the model
 *  hallucinates); DESCRIPTIVE attributes only, never identity (also dodges VLM
 *  safety-refusals); age as coarse bands. Sent with Ollama `format: json` +
 *  `num_ctx >= 8192` (the 4096 default truncates the JSON mid-object). */
export const SIGHTING_PROMPT =
  "Du analyserar ett foto från en säkerhetsobservation. Svara ENDAST med JSON. " +
  "Beskriv bara det som TYDLIGT syns; använd \"okänd\" hellre än att gissa. " +
  "Identifiera ALDRIG vem en person är — beskriv endast synliga attribut. " +
  "Ålder endast som ung/medelålders/äldre/okänd.\n" +
  "Schema: {\"fordon\":[{\"typ\":\"\",\"marke\":\"\",\"farg\":\"\",\"skylt\":\"\"}]," +
  "\"personer\":[{\"kon\":\"man|kvinna|okänd\",\"alder\":\"\",\"klader\":[\"\"],\"utrustning\":[\"\"]}]," +
  "\"ovrigt\":[\"\"]}";

export interface PhotoVehicle {
  typ?: string;
  marke?: string;
  farg?: string;
  skylt?: string; // raw plate as read; normalised later
}
export interface PhotoPerson {
  kon?: string;
  alder?: string;
  klader: string[];
  utrustning: string[];
}
export interface PhotoSighting {
  vehicles: PhotoVehicle[];
  persons: PhotoPerson[];
  ovrigt: string[];
}

/** A source of sightings from an image. Swap the impl (Ollama / Fake), not the
 *  wiring — mirrors the PlateVision seam. */
export interface PhotoVision {
  analyzePhoto(image: Uint8Array): Promise<PhotoSighting | null>;
}

// --- response validation ----------------------------------------------------

const isStr = (v: unknown): v is string => typeof v === "string";
/** "okänd" / "" / "-" → undefined; else the trimmed string. */
function clean(v: unknown): string | undefined {
  if (!isStr(v)) return undefined;
  const s = v.trim();
  return s === "" || s === "-" || /^okänd$/i.test(s) ? undefined : s;
}
function strList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(clean).filter((s): s is string => s !== undefined);
}

/** Parse a VLM response into a validated PhotoSighting, or null. Defensive: the
 *  model MAY wrap the JSON in stray tokens even with format:json, so we fall back
 *  to the first balanced `{…}` block. Unknown keys are dropped; every field is
 *  coerced to the expected shape. */
export function parseSighting(raw: string): PhotoSighting | null {
  const obj = tryJson(raw);
  if (!obj || typeof obj !== "object") return null;
  const o = obj as Record<string, unknown>;
  const vehicles: PhotoVehicle[] = Array.isArray(o.fordon)
    ? o.fordon.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").map((v) => ({
        typ: clean(v.typ),
        marke: clean(v.marke),
        farg: clean(v.farg),
        skylt: clean(v.skylt),
      }))
    : [];
  const persons: PhotoPerson[] = Array.isArray(o.personer)
    ? o.personer.filter((x): x is Record<string, unknown> => !!x && typeof x === "object").map((p) => ({
        kon: clean(p.kon),
        alder: clean(p.alder),
        klader: strList(p.klader),
        utrustning: strList(p.utrustning),
      }))
    : [];
  return { vehicles, persons, ovrigt: strList(o.ovrigt) };
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

// --- plate normalisation ----------------------------------------------------

/** Swedish plate body: ABC123 (old) or ABC12D (new). */
const PLATE_RE = /^[A-ZÅÄÖ]{3}[0-9]{2}[0-9A-ZÅÄÖ]$/;

/** Normalise a plate the VLM read: upper/strip spaces, then drop a leading nation
 *  "S" the model lifts off the blue EU strip (bake-off: every near-miss was this),
 *  but ONLY when doing so turns an over-length string into a valid plate — so a
 *  genuine S-plate ("SIS515") is untouched. Returns "" for a non-plate. */
export function normalizePlateRead(raw: string): string {
  const n = normalizePlate(raw);
  if (n.length === 7 && n[0] === "S" && PLATE_RE.test(n.slice(1))) return n.slice(1);
  return n;
}

/** Fold diacritics for plate COMPARISON only (vanity plate RAMSJÖ ~ RAMSJO). */
const fold = (p: string): string => p.replace(/Å|Ä/g, "A").replace(/Ö/g, "O");
export function samePlate(a: string, b: string): boolean {
  return fold(normalizePlateRead(a)) === fold(normalizePlateRead(b));
}

// --- recon-behaviour mapping (RECON subset of THREAT_INDICATORS only) --------

/** Equipment/activity substring → recon behaviour concept + weight. Deliberately
 *  narrow: only what a photo realistically captures (a soldier who SEES sabotage
 *  intervenes, doesn't photograph it). optik=2, registrering=2, observation=1
 *  mirror the text-keyword weights in suspicion.ts. */
const RECON_MAP: { stems: string[]; key: string; label: string; weight: number }[] = [
  { stems: ["kikare", "binokl", "binocular", "tub", "sikte"], key: "optik", label: "kikare/optik", weight: 2 },
  { stems: ["kamera", "camera", "teleobjektiv", "objektiv", "telephoto", "telelins"], key: "optik", label: "kamera/teleobjektiv", weight: 2 },
  { stems: ["mät", "measur", "tumstock", "avstånds", "gps-", "kartl"], key: "registrering", label: "mätande/registrering", weight: 2 },
  { stems: ["antecknar", "anteckn", "noter", "skiss", "ritblock"], key: "registrering", label: "antecknande", weight: 2 },
  { stems: ["observ", "spanar", "betraktar", "övervakar", "watching"], key: "observation", label: "observerande", weight: 1 },
];

/** Recon behaviour signals a sighting supports — from person equipment AND the
 *  free `ovrigt` text. Deduped by concept key (strongest weight wins). These feed
 *  the suspicion score ONLY through a confirmed sighting (nomination gate). */
export function reconBehaviours(s: PhotoSighting): Signal[] {
  const hay = [
    ...s.persons.flatMap((p) => [...p.utrustning, ...p.klader]),
    ...s.ovrigt,
  ]
    .join(" ")
    .toLowerCase();
  const byKey = new Map<string, Signal>();
  for (const m of RECON_MAP) {
    if (!m.stems.some((st) => hay.includes(st))) continue;
    const prev = byKey.get(m.key);
    if (!prev || m.weight > prev.weight) {
      byKey.set(m.key, { key: `beteende:${m.key}`, label: `hotindikator (foto): ${m.label}`, weight: m.weight });
    }
  }
  return [...byKey.values()];
}

// --- sighting → per-item operator nominations -------------------------------

export type PhotoNomination =
  | { kind: "plate"; value: string; conflict: boolean }
  | { kind: "vehicle"; label: string }
  | { kind: "person"; label: string; recon: Signal[] };

/** Turn a sighting into the per-item review list (locked decision: each plate/
 *  vehicle/person is accepted or rejected on its own). `textPlates` = plates the
 *  human already typed in that report — a photo plate that differs is flagged
 *  `conflict` (§6.7: never silently overrides a typed plate). */
export function sightingToNominations(s: PhotoSighting, textPlates: string[]): PhotoNomination[] {
  const typed = textPlates.map(normalizePlateRead).filter(Boolean);
  const out: PhotoNomination[] = [];
  const seenPlate = new Set<string>();

  for (const v of s.vehicles) {
    const plate = v.skylt ? normalizePlateRead(v.skylt) : "";
    if (plate && PLATE_RE.test(plate) && !seenPlate.has(plate)) {
      seenPlate.add(plate);
      const conflict = typed.length > 0 && !typed.some((t) => samePlate(t, plate));
      out.push({ kind: "plate", value: plate, conflict });
    }
    const desc = [v.farg, v.marke, v.typ].filter(Boolean).join(" ");
    if (desc) out.push({ kind: "vehicle", label: desc });
  }

  for (const p of s.persons) {
    const bits = [
      p.kon && p.kon !== "okänd" ? p.kon : undefined,
      p.alder && p.alder !== "okänd" ? p.alder : undefined,
      ...p.klader,
      ...p.utrustning,
    ].filter(Boolean);
    // A person with no legible attribute at all isn't worth a review row.
    if (bits.length === 0) continue;
    out.push({ kind: "person", label: bits.join(", "), recon: reconBehaviours({ vehicles: [], persons: [p], ovrigt: [] }) });
  }
  return out;
}

/** Does a sighting carry anything the operator would review? (skip empty `{}`.) */
export function sightingHasFindings(s: PhotoSighting): boolean {
  return s.vehicles.length > 0 || s.persons.length > 0;
}
