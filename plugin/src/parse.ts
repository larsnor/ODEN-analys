/*
 * Pure 7S report parser — Bin 3, Step 1 (skeleton).
 *
 * DELIBERATELY has ZERO Obsidian imports so the analysis core stays testable
 * outside Obsidian (PLUGIN_DESIGN §10, §11). This module only *reads/parses*;
 * it derives no knowledge, merges nothing, nominates nothing. Re-identification
 * (Job A/B/C) belongs to later steps.
 *
 * Format contract: FORMAT_SPEC.md (§4 frontmatter, §5 body, §6 links).
 * Note: real `bin1-intag` reports also carry `källa` and `bilagor` — agreed but
 * not yet written into FORMAT_SPEC v1.0 — so we read them DEFENSIVELY (optional).
 */
import { findMgrsLatLon } from "./mgrs";

/** Link reference as it literally appears in a message — a raw ref, NOT an
 *  Entity. Bin 1 emits refs; deriving Entities is the plugin's job (§4). */
export type LinkKind = "plate-full" | "plate-partial" | "mark";

export interface LinkRef {
  raw: string; // exact [[target]] text, e.g. "RJK241", "...24.", "logotyp-fragment DGE"
  kind: LinkKind;
}

/** In-memory model of one 7S message (PLUGIN_DESIGN §4). */
export interface Report {
  // --- frontmatter (§4) ---
  id: string;
  typ: string;
  tnr: string;
  tidpunkt: string; // ISO 8601 local, authoritative timestamp
  plats: string;
  lat?: number;
  lon?: number;
  location?: string;
  sagesman: string;
  /** Provenance (§2). Optional: present on bin1-intag data, not yet in spec. */
  källa?: string;
  /** Image attachments (§6.7). Optional: present on data, not yet in spec. */
  bilagor?: string[];
  /** Signal transport metadata (NEW format). `signalAvsandareId` is a stable
   *  per-sender identity — usable as a source/"same observer" key. */
  signalAvsandareId?: string;
  signalTidpunkt?: string;

  // --- body 7S (§5) ---
  // OLD format fields — parsed but unused; tolerated for backward compatibility.
  styrka?: string;
  slag?: string;
  sysselsattning?: string;
  /** NEW format: free-prose event narrative — replaces Slag/Styrka/Sysselsättning. */
  handelse?: string;
  /** NEW format: follow-up / "since" field (often "-"). */
  sedan?: string;
  /** Body "Ställe" — place name and/or MGRS grid. Carries the grid in the new
   *  format even when frontmatter `plats`/`lat`/`lon` are absent. */
  stalle?: string;
  /** True when lat/lon were derived from an MGRS grid (no frontmatter coords). */
  coordsFromMgrs?: boolean;
  /** Symbol field prose — distinguishing marks. Optional in the new format. */
  symbol?: string;

  // --- derived-at-parse (no analysis, just extraction) ---
  links: LinkRef[]; // [[...]] targets found in body
  embeds: string[]; // ![[...]] image embeds found in body

  // --- bookkeeping ---
  file: string; // path or stem the report was read from
}

export interface ParseIssue {
  file: string;
  message: string;
}

// Swedish plate shape, from FORMAT_SPEC §6.3/§6.4 and bin3_prototype/entity_lib.py.
// Allowed letters exclude I O Q V. We accept the wildcard '.' for partials.
const PLATE_RE = /^[ABCDEFGHJKLMNPRSTUWXYZ.]{3}[0-9.]{2}[0-9ABCDEFGHJKLMNPRSTUWXYZ.]$/;
const LINK_RE = /(!)?\[\[([^\]]+?)\]\]/g;

/** Classify a link target. No resolution/merging — that is analysis (later). */
export function classifyLink(raw: string): LinkKind {
  // Strip an Obsidian alias ("[[target|alias]]") before shape-testing.
  const target = raw.split("|")[0].trim();
  if (PLATE_RE.test(target)) {
    return target.includes(".") ? "plate-partial" : "plate-full";
  }
  return "mark";
}

// UTF-8 bytes mis-decoded as Latin-1/CP1252 ("mojibake", e.g. "HÃ¶glandet").
// These digraphs never occur in correct Swedish text, so targeted replacement is
// safe and deterministic — no risk of corrupting already-correct content.
const MOJIBAKE: Array<[RegExp, string]> = [
  [/Ã¥/g, "å"], [/Ã¤/g, "ä"], [/Ã¶/g, "ö"],
  [/Ã…/g, "Å"], [/Ã„/g, "Ä"], [/Ã–/g, "Ö"],
  [/Ã©/g, "é"], [/Ã¼/g, "ü"], [/Ã¸/g, "ø"], [/Ã¦/g, "æ"], [/ÃŸ/g, "ß"],
  [/Â /g, " "], [/Â/g, ""],
];

/** Repair common Swedish mojibake. No-op when the text is already clean. */
export function repairMojibake(text: string): string {
  if (!text.includes("Ã") && !text.includes("Â")) return text;
  let out = text;
  for (const [re, ch] of MOJIBAKE) out = out.replace(re, ch);
  return out;
}

/** Split a file's raw text into [frontmatterText, body]. */
function splitFrontmatter(text: string): { fm: string; body: string } {
  // Normalise CRLF just in case; spec mandates LF but be tolerant on read.
  const t = text.replace(/\r\n/g, "\n");
  if (!t.startsWith("---\n")) return { fm: "", body: t };
  const end = t.indexOf("\n---", 4);
  if (end === -1) return { fm: "", body: t };
  const fm = t.slice(4, end);
  // Body starts after the closing '---' line.
  const afterClose = t.indexOf("\n", end + 1);
  const body = afterClose === -1 ? "" : t.slice(afterClose + 1);
  return { fm, body };
}

/** Strip matching surrounding single/double quotes from a scalar value. */
function unquote(v: string): string {
  const s = v.trim();
  if (s.length >= 2 && ((s[0] === '"' && s.endsWith('"')) || (s[0] === "'" && s.endsWith("'")))) {
    return s.slice(1, -1);
  }
  return s;
}

/** Parse a flat-key YAML frontmatter line value. Handles scalars, inline
 *  arrays (`["a", "b"]`). Intentionally minimal — the 7S frontmatter is flat
 *  (§4), so we avoid a full YAML dependency to keep the surface reviewable. */
function parseScalarOrArray(v: string): string | string[] {
  const s = v.trim();
  if (s.startsWith("[") && s.endsWith("]")) {
    const inner = s.slice(1, -1).trim();
    if (inner === "") return [];
    return inner.split(",").map((item) => unquote(item));
  }
  return unquote(s);
}

function frontmatterToMap(fm: string): Map<string, string | string[]> {
  const map = new Map<string, string | string[]>();
  for (const line of fm.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1);
    map.set(key, parseScalarOrArray(value));
  }
  return map;
}

function asString(v: string | string[] | undefined): string | undefined {
  if (v === undefined) return undefined;
  return Array.isArray(v) ? v.join(", ") : v;
}

function asNumber(v: string | string[] | undefined): number | undefined {
  const s = asString(v);
  if (s === undefined || s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

// Body field labels (§5). Map Swedish label -> Report key. Covers BOTH the old
// format (Styrka/Slag/Sysselsättning) and the new one (Händelse/Sedan).
const BODY_LABELS: Record<string, keyof Report> = {
  Styrka: "styrka",
  Slag: "slag",
  Sysselsättning: "sysselsattning",
  Händelse: "handelse",
  Sedan: "sedan",
  Ställe: "stalle",
  Symbol: "symbol",
};

/** Extract `**Label:** value` body fields. Values may span to the next blank
 *  line; we capture the single logical line after the label (7S fields are one
 *  line/sentence per §5). */
function parseBodyFields(body: string): Partial<Record<keyof Report, string>> {
  const out: Partial<Record<keyof Report, string>> = {};
  // Match **Label:** then everything up to end-of-line.
  const re = /\*\*([^:*]+):\*\*[ \t]*(.*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const label = m[1].trim();
    const key = BODY_LABELS[label];
    if (key) out[key] = m[2].trim();
  }
  return out;
}

function extractLinksAndEmbeds(body: string): { links: LinkRef[]; embeds: string[] } {
  const links: LinkRef[] = [];
  const embeds: string[] = [];
  let m: RegExpExecArray | null;
  LINK_RE.lastIndex = 0;
  while ((m = LINK_RE.exec(body)) !== null) {
    const isEmbed = m[1] === "!";
    const raw = m[2].trim();
    if (isEmbed) {
      embeds.push(raw);
    } else {
      links.push({ raw, kind: classifyLink(raw) });
    }
  }
  return { links, embeds };
}

/**
 * Parse one report file's raw text into a Report.
 * @param text  raw UTF-8 file contents
 * @param file  path or stem (for bookkeeping/citation)
 * @param issues optional sink for non-fatal problems
 */
export function parseReport(text: string, file: string, issues?: ParseIssue[]): Report {
  const { fm, body } = splitFrontmatter(repairMojibake(text));
  const f = frontmatterToMap(fm);
  const note = (message: string) => issues?.push({ file, message });

  const id = asString(f.get("id")) ?? "";
  const tnr = asString(f.get("tnr")) ?? "";
  if (id === "") note("missing frontmatter: id");
  if (tnr === "") note("missing frontmatter: tnr");

  const bilagorRaw = f.get("bilagor");
  const bilagor = bilagorRaw === undefined
    ? undefined
    : Array.isArray(bilagorRaw)
    ? bilagorRaw
    : [bilagorRaw];

  const fields = parseBodyFields(body);
  const { links, embeds } = extractLinksAndEmbeds(body);

  // Coordinates: prefer frontmatter; if absent, derive from an MGRS grid in
  // Ställe/plats (new format ships grids without lat/lon, §6.6 needs coords).
  const plats = asString(f.get("plats")) ?? "";
  let lat = asNumber(f.get("lat"));
  let lon = asNumber(f.get("lon"));
  let location = asString(f.get("location"));
  let coordsFromMgrs = false;
  if (lat === undefined || lon === undefined) {
    const ll = findMgrsLatLon(fields.stalle ?? "") ?? findMgrsLatLon(plats);
    if (ll) {
      lat = Math.round(ll.lat * 1e5) / 1e5;
      lon = Math.round(ll.lon * 1e5) / 1e5;
      location = `${lat},${lon}`;
      coordsFromMgrs = true;
    }
  }

  return {
    id,
    typ: asString(f.get("typ")) ?? "",
    tnr,
    tidpunkt: asString(f.get("tidpunkt")) ?? "",
    plats,
    lat,
    lon,
    location,
    coordsFromMgrs,
    sagesman: asString(f.get("sagesman")) ?? "",
    källa: asString(f.get("källa")),
    bilagor,
    signalAvsandareId: asString(f.get("signal_avsandare_id")),
    signalTidpunkt: asString(f.get("signal_tidpunkt")),
    styrka: fields.styrka,
    slag: fields.slag,
    sysselsattning: fields.sysselsattning,
    handelse: fields.handelse,
    sedan: fields.sedan,
    stalle: fields.stalle,
    symbol: fields.symbol,
    links,
    embeds,
    file,
  };
}
