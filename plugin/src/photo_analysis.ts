/*
 * Photo analysis (pure, Obsidian-free) — the "reasoning" half of the vision phase.
 *
 * A VLM (Ollama, src/llm.ts) turns an attached photo into a PhotoSighting; this
 * module owns the PROMPT, the response VALIDATION, the recon-behaviour mapping,
 * and the sighting → operator-nomination derivation. No network, no Obsidian —
 * so the whole judgement layer is unit-tested with canned JSON (FakeVision).
 *
 * Iron rule: images NOMINATE, never assert. Every finding here is a
 * suggestion the operator confirms per-item. Provenance on anything materialised
 * from a photo: `föreslagen-av: llm-vision`.
 *
 * Data-model (locked 2026-07-14): a photo PLATE is a re-identification key (→
 * plate re-identification after confirm); a photo-described VEHICLE/PERSON is a
 * report-local ANNOTATION
 * (never auto-merged across reports — generic descriptions can't be re-identified).
 *
 * REVISED 2026-08-27 (live E2E): behaviour from a still was originally the RECON
 * subset only, on the "act-not-photograph" theory (a soldier who SEES sabotage
 * intervenes). Real use disproved it — observers DO photograph fence-climbing —
 * so photo behaviours now classify into the FULL threat-concept space, exactly
 * like the 📝 text path, still per-item operator-gated (safe because gated).
 */
import { Signal, THREAT_INDICATORS } from "./suspicion";
import { normalizePlate } from "./vision";

/** Bump when the prompt/schema changes — part of the cache key, so stale cached
 *  sightings are re-analysed rather than silently reused.
 *  v2 (2026-08-27): explicit all-values-in-Swedish instruction — live E2E showed
 *  qwen3-vl drifting to English on attribute values ("Medelåldersman, blue
 *  jeans"), which reads badly for the operator AND misses the Swedish keyword
 *  tables downstream (craft typ mapping, mark vocabulary).
 *  v3 (2026-08-27): per-person `aktivitet` — the schema had NO field for what a
 *  person is doing, so a photographed fence-climb yielded attributes only.
 *  Wording measured on the real image against 4b AND 8b (VISION_VALIDATION). */
export const PROMPT_VERSION = "3";

/** The sighting prompt (Swedish). Rules proven in the bake-off: every attribute
 *  optional with an explicit "okänd" escape (forced guessing is where the model
 *  hallucinates); DESCRIPTIVE attributes only, never identity (also dodges VLM
 *  safety-refusals); age as coarse bands. Sent with Ollama `format: json` +
 *  `num_ctx >= 8192` (the 4096 default truncates the JSON mid-object). */
export const SIGHTING_PROMPT =
  "Du analyserar ett foto från en säkerhetsobservation. Svara ENDAST med JSON. " +
  "ALLA textvärden ska vara på SVENSKA (t.ex. \"blå jeans\", inte \"blue jeans\"). " +
  "Beskriv bara det som TYDLIGT syns; använd \"okänd\" hellre än att gissa. " +
  "Identifiera ALDRIG vem en person är — beskriv endast synliga attribut. " +
  "Ålder endast som ung/medelålders/äldre/okänd. " +
  // v3, MEASURED wording (docs/VISION_VALIDATION.md): the simple variant made 8b
  // answer with literal pose; the long interaction clause made 4b return {} —
  // this middle length lands the activity on BOTH sizes.
  "Beskriv för varje person VAD den GÖR (aktivitet) — kort fras, bara det som " +
  "syns, särskilt fysisk interaktion med stängsel, grind eller dörr.\n" +
  "Schema: {\"fordon\":[{\"typ\":\"\",\"marke\":\"\",\"farg\":\"\",\"skylt\":\"\"}]," +
  "\"personer\":[{\"kon\":\"man|kvinna|okänd\",\"alder\":\"\",\"klader\":[\"\"],\"utrustning\":[\"\"],\"aktivitet\":\"\"}]," +
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
  /** What the person is DOING ("hoppar över stängsel") — the field whose absence
   *  made a photographed perimeter intrusion invisible (live E2E finding). */
  aktivitet?: string;
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
        aktivitet: clean(p.aktivitet),
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

// --- photo behaviour mapping (full threat-concept space, operator-gated) -----

/** English/short surface forms the VLM may still use despite the Swedish
 *  instruction — extra coverage on top of the Swedish THREAT_INDICATORS stems. */
const SURFACE_MAP: { stems: string[]; key: string; label: string; weight: number }[] = [
  { stems: ["kikare", "binokl", "binocular", "tub", "sikte"], key: "optik", label: "kikare/optik", weight: 2 },
  { stems: ["kamera", "camera", "teleobjektiv", "objektiv", "telephoto", "telelins"], key: "optik", label: "kamera/teleobjektiv", weight: 2 },
  { stems: ["mät", "measur", "tumstock", "avstånds", "gps-", "kartl"], key: "registrering", label: "mätande/registrering", weight: 2 },
  { stems: ["antecknar", "anteckn", "noter", "skiss", "ritblock"], key: "registrering", label: "antecknande", weight: 2 },
  { stems: ["observ", "spanar", "betraktar", "övervakar", "watching"], key: "observation", label: "observerande", weight: 1 },
];

/** Photo-ONLY activity stems. Deliberately NOT added to the frozen, OOD-validated
 *  THREAT_INDICATORS: "hoppar över" is a Swedish idiom for skipping something
 *  ("hoppar över lunchen") and would wreck text precision — but in a photo's
 *  aktivitet field the visual context disambiguates (measured phrasings from
 *  the live fence-climb image: 4b "hoppar över stängsel", 8b "hoppa över
 *  stängsel"). */
const PHOTO_ACTIVITY_STEMS: { stems: string[]; key: string; label: string; weight: number }[] = [
  // NB "tar sig över" (present) is also here: the frozen text list carries only
  // the past tense "tog sig över" (measured 8b phrasing was present tense).
  { stems: ["hoppar över", "hoppa över", "klättrar på", "tar sig över"], key: "perimeter", label: "närmande/rekognosering av objekt", weight: 2 },
];

/** Behaviour signals a sighting supports — from person equipment, clothing,
 *  ACTIVITY and the free `ovrigt` text. Matched against the full
 *  THREAT_INDICATORS concept space (same weights as the text path — a photo
 *  hit and a text hit are the same signal, deduped by key downstream) plus the
 *  photo-only supplements above. Deduped by concept key, strongest weight wins.
 *  These feed the suspicion score ONLY through a confirmed nomination. */
export function photoBehaviours(s: PhotoSighting): Signal[] {
  const hay = [
    ...s.persons.flatMap((p) => [...p.utrustning, ...p.klader, ...(p.aktivitet ? [p.aktivitet] : [])]),
    ...s.ovrigt,
  ]
    .join(" ")
    .toLowerCase();
  const byKey = new Map<string, Signal>();
  const add = (key: string, label: string, weight: number) => {
    const prev = byKey.get(key);
    if (!prev || weight > prev.weight) {
      byKey.set(key, { key: `beteende:${key}`, label: `hotindikator (foto): ${label}`, weight });
    }
  };
  for (const ind of THREAT_INDICATORS) {
    const hit = ind.stems.find((st) => hay.includes(st));
    if (hit) add(ind.key, `${ind.label} ("${hit}")`, ind.weight ?? 2);
  }
  for (const m of [...SURFACE_MAP, ...PHOTO_ACTIVITY_STEMS]) {
    if (m.stems.some((st) => hay.includes(st))) add(m.key, m.label, m.weight);
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

// --- sighting → per-item operator nominations -------------------------------

export type PhotoNomination =
  | { kind: "plate"; value: string; conflict: boolean }
  | { kind: "vehicle"; label: string }
  | { kind: "person"; label: string; recon: Signal[] }
  /** Scene-level content (`ovrigt`) with no vehicle/person — a fire, smoke, a
   *  breached fence, a left object. Found in live E2E: an "eld" photo came back
   *  as pure ovrigt ("svart grill, två behållare …") and was silently dropped,
   *  because "findings" only meant plates/vehicles/persons. The model DID see
   *  something; the operator decides its relevance — nominate, never discard. */
  | { kind: "scene"; label: string; recon: Signal[] };

/** Turn a sighting into the per-item review list (locked decision: each plate/
 *  vehicle/person is accepted or rejected on its own). `textPlates` = plates the
 *  human already typed in that report — a photo plate that differs is flagged
 *  `conflict` (a photo never silently overrides a typed plate). */
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
    // A person with no legible attribute AND no activity isn't worth a row.
    if (bits.length === 0 && !p.aktivitet) continue;
    const attrs = bits.join(", ");
    const label = p.aktivitet ? (attrs ? `${attrs} — ${p.aktivitet}` : p.aktivitet) : attrs;
    out.push({ kind: "person", label, recon: photoBehaviours({ vehicles: [], persons: [p], ovrigt: [] }) });
  }

  // Scene content stands on its own ONLY when no vehicle/person carried the
  // photo's meaning — otherwise ovrigt is context the other rows already imply.
  if (out.length === 0 && s.ovrigt.length > 0) {
    out.push({
      kind: "scene",
      label: s.ovrigt.join(", "),
      recon: photoBehaviours({ vehicles: [], persons: [], ovrigt: s.ovrigt }),
    });
  }
  return out;
}

/** Does a sighting carry anything the operator would review? (skip empty `{}`.) */
export function sightingHasFindings(s: PhotoSighting): boolean {
  return s.vehicles.length > 0 || s.persons.length > 0 || s.ovrigt.length > 0;
}
