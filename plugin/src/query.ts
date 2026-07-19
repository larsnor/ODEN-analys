/*
 * Deterministic text query interface (PLUGIN_DESIGN §7.1). Pure TS, Obsidian-free
 * → testable outside Obsidian.
 *
 * This is the DEGRADED/no-LLM mode that is also the foundation: the operator's
 * input is parsed by a DETERMINISTIC keyword parser into a StructuredQuery, the
 * interpretation is ECHOED back (so a misread is visible and corrected at the
 * query, §7.1 guardrail 1), and the answer is computed deterministically from the
 * knowledge base with a citation per row (guardrails 2–4). A chat LLM (§7.1) only
 * needs to produce the same StructuredQuery and NARRATE the result — findings
 * never originate in a model.
 *
 * ── The two axes (a projection of the domain model, domain.ts) ───────────────
 * A query is a TARGET (which domain type: report · fordon · kännetecken · aktör ·
 * plats · larm · farkost) crossed with a SHAPE (how to render it: detail · list ·
 * timeline · summary), narrowed by FILTERS (time / place / observer / minCount),
 * with a GUARD axis for the identity-assertion write-wall (§7.1 guardrail 6): an
 * identity question ("är dessa samma?") is REFUSED, routed to the evidence flow,
 * never answered yes/no.
 */
import { Report } from "./parse";
import { PlateEntity } from "./reid";
import { MarkNomination } from "./jobb";
import { mdText } from "./mdsafe";
import { noteStem } from "./notes_common";
import { matchCraftTypes } from "./domain";
import { reasonPhrases, suspicionLevel } from "./present";
import type { ActorHypothesis } from "./actor";
import type { LocationCluster } from "./location_notes";
import type { SuspicionRow } from "./suspicion";
import type { CraftObservation } from "./craft";

/** Snapshot of current knowledge (reflects gradual vault buildup) — one field per
 *  domain TARGET, so the engine is a faithful projection of the model. */
export interface KB {
  reports: Report[];
  vehicles: PlateEntity[];
  /** CONFIRMED mark entities only (operator-approved Job B nominations). */
  marks: MarkNomination[];
  /** CONFIRMED actor hypotheses (operator-approved), folded for merges. */
  actors: ActorHypothesis[];
  /** Relevant location clusters (suspicion- or vehicle-bearing + predefined). */
  places: LocationCluster[];
  /** Elevated (suspicious) reports. */
  larm: SuspicionRow[];
  /** Craft observations across all reports (scored + queryable; not entities). */
  craft: CraftObservation[];
}

export type Shape = "detail" | "list" | "timeline" | "summary";
export type Target =
  | "reports"
  | "fordon"
  | "kannetecken"
  | "aktor"
  | "plats"
  | "larm"
  | "farkost"
  | "alla";

export interface TimeWindow {
  startMin: number; // minutes from midnight, inclusive
  endMin: number; // inclusive; wraps past midnight when startMin > endMin
  label: string;
}

export interface StructuredQuery {
  shape: Shape;
  target: Target;
  /** Identity-assertion write-wall: refuse, route to the evidence flow. */
  guard?: boolean;
  term?: string; // entity id / craft type / free-text search
  minCount?: number; // recurring threshold
  time?: TimeWindow;
  place?: string; // plats substring (lowercased)
  observer?: string; // sägesman / call-sign filter (uppercased)
  /** Human-readable rendering of the parsed query (the echo). */
  echo: string;
  raw: string;
}

export interface QueryAnswer {
  query: StructuredQuery;
  markdown: string;
  rowCount: number;
}

// --- parsing ---------------------------------------------------------------

const PLATE_RE = /\b([ABCDEFGHJKLMNPRSTUWXYZ]{3}[0-9]{2}[0-9ABCDEFGHJKLMNPRSTUWXYZ])\b/;

/** Word match that respects Swedish letters — JS `\b` treats å/ä/ö as
 *  boundaries, so `\bkväll\b` / `\båterkommande\b` would wrongly fail. */
function hasWord(text: string, word: string): boolean {
  return new RegExp(`(?<![a-zåäö0-9])${word}(?![a-zåäö0-9])`, "i").test(text);
}
function hasAnyWord(text: string, words: string[]): boolean {
  return words.some((w) => hasWord(text, w));
}

const TIME_PRESETS: Record<string, TimeWindow> = {
  natt: { startMin: 22 * 60, endMin: 5 * 60, label: "natt (22:00–05:00)" },
  nattetid: { startMin: 22 * 60, endMin: 5 * 60, label: "natt (22:00–05:00)" },
  inatt: { startMin: 22 * 60, endMin: 5 * 60, label: "natt (22:00–05:00)" },
  morgon: { startMin: 5 * 60, endMin: 9 * 60, label: "morgon (05:00–09:00)" },
  dag: { startMin: 6 * 60, endMin: 18 * 60, label: "dag (06:00–18:00)" },
  dagtid: { startMin: 6 * 60, endMin: 18 * 60, label: "dag (06:00–18:00)" },
  kväll: { startMin: 18 * 60, endMin: 22 * 60, label: "kväll (18:00–22:00)" },
};

function hhmmToMin(h: string, m: string): number {
  return (parseInt(h, 10) % 24) * 60 + parseInt(m, 10) % 60;
}

function parseTime(lower: string): TimeWindow | undefined {
  // explicit "mellan HH(:MM) och HH(:MM)" / "kl HH-HH"
  const between = lower.match(/(?:mellan|kl\.?|klockan)\s*(\d{1,2})(?::(\d{2}))?\s*(?:och|-|–|till)\s*(\d{1,2})(?::(\d{2}))?/);
  if (between) {
    const start = hhmmToMin(between[1], between[2] ?? "00");
    const end = hhmmToMin(between[3], between[4] ?? "00");
    const fmt = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;
    return { startMin: start, endMin: end, label: `${fmt(start)}–${fmt(end)}` };
  }
  for (const key of Object.keys(TIME_PRESETS)) {
    if (hasWord(lower, key)) return TIME_PRESETS[key];
  }
  return undefined;
}

const PLACE_CUES = ["vid", "nära", "plats", "sektor", "kring", "runt"];
const STOP_AFTER_PLACE = new Set([
  ...Object.keys(TIME_PRESETS),
  "mellan", "kl", "klockan", "återkommande", "fordon", "farkost", "märke", "märken",
  "aktör", "aktörer", "larm", "sammanfatta", "natt", "natten", "i", "på", "och", "från", "av",
]);

/** Extract a place substring following a place cue, up to a stop word. */
function parsePlace(tokens: string[]): string | undefined {
  for (let i = 0; i < tokens.length; i++) {
    if (PLACE_CUES.includes(tokens[i])) {
      const rest: string[] = [];
      for (let j = i + 1; j < tokens.length; j++) {
        if (STOP_AFTER_PLACE.has(tokens[j])) break;
        rest.push(tokens[j]);
      }
      const place = rest.join(" ").replace(/[?.!,]+$/, "").trim();
      if (place.length >= 2) return place;
    }
  }
  return undefined;
}

const OBSV_STOP = new Set(["en", "ett", "den", "det", "de", "dem", "alla", "några", "någon", "min", "vår", "en"]);

/** A reporting call-sign filter ("från AQ", "rapporterat av BQ", "vad har CQ
 *  sett"). Deterministic floor: uppercase-cued or the local …Q call-sign
 *  convention; the chat LLM can refine lowercase forms. */
function parseObserver(raw: string): string | undefined {
  const after = raw.match(/(?:från|av|sägesman|sagesman)\s+([\wÅÄÖåäö]{1,4})\b/i);
  if (after && !OBSV_STOP.has(after[1].toLowerCase())) return after[1].toUpperCase();
  if (/\b(rapport|observ|sett|sagt|säger|inrapport|meddelat)/i.test(raw)) {
    const cs = raw.match(/\b([A-Za-zÅÄÖåäö]{1,2}[Qq])\b/);
    if (cs) return cs[1].toUpperCase();
  }
  return undefined;
}

const TARGET_CUES: { target: Target; words: string[] }[] = [
  { target: "larm", words: ["larm", "larmen", "hot", "hotbild", "misstänkta", "misstanke", "varning", "varningar", "misstänkt"] },
  { target: "aktor", words: ["aktör", "aktörer", "aktören", "misstänkt person", "agent", "gärningsman"] },
  { target: "plats", words: ["plats", "platser", "platsen", "hotspot", "hotspots", "område", "områden"] },
  { target: "kannetecken", words: ["kännetecken", "märke", "märken", "ryggsäck", "keps", "mössa", "dekal", "optik", "kikare"] },
  { target: "fordon", words: ["fordon", "bil", "bilar", "plåt", "plåtar", "reg", "registreringsskylt", "registreringsnummer", "nummerplåt"] },
];

/** Which domain type is the operator asking about? A named craft TYPE (lastbil,
 *  drönare, …) steers to `farkost`; the bare car / "fordon" stays the plate-entity
 *  target (domain.ts queryCue). */
function parseTarget(lower: string): { target: Target; craftType?: string } {
  const craft = matchCraftTypes(lower).filter((t) => t.queryCue);
  if (craft.length) return { target: "farkost", craftType: craft[0].key };
  for (const { target, words } of TARGET_CUES) if (hasAnyWord(lower, words)) return { target };
  return { target: "alla" };
}

const SUMMARY_WORDS = ["sammanfatta", "sammanfattning", "läget", "lägesbild", "översikt", "överblick", "summering", "summera"];
const TIMELINE_WORDS = ["tidslinje", "tidslinjen", "kronologi", "kronologisk", "tidsordning", "förlopp"];
const LIST_WORDS = ["vilka", "lista", "alla", "heta", "hetast", "hetaste", "antal", "flest"];
const DETAIL_WORDS = ["visa", "detalj", "detaljer", "beskriv", "berätta"];

function parseShape(lower: string, hasTerm: boolean): Shape {
  if (hasAnyWord(lower, SUMMARY_WORDS)) return "summary";
  if (hasAnyWord(lower, TIMELINE_WORDS)) return "timeline";
  if (hasAnyWord(lower, LIST_WORDS)) return "list";
  if (hasAnyWord(lower, DETAIL_WORDS)) return "detail";
  return hasTerm ? "detail" : "list";
}

function describe(q: Omit<StructuredQuery, "echo" | "raw">): string {
  const parts: string[] = [];
  if (q.guard) parts.push("identitetsspärr");
  parts.push(`mål=${q.target}`, `form=${q.shape}`);
  if (q.term) parts.push(`term="${q.term}"`);
  if (q.minCount) parts.push(`minst=${q.minCount}`);
  if (q.time) parts.push(`tid=${q.time.label}`);
  if (q.place) parts.push(`plats~"${q.place}"`);
  if (q.observer) parts.push(`observatör=${q.observer}`);
  return parts.join(", ");
}

export function parseQuery(raw: string): StructuredQuery {
  const lower = raw.toLowerCase().trim();
  const tokens = lower.split(/\s+/).filter(Boolean);
  const { target, craftType } = parseTarget(lower);
  const time = parseTime(lower);
  const place = parsePlace(tokens);
  const observer = parseObserver(raw);
  const finish = (q: Omit<StructuredQuery, "echo" | "raw">): StructuredQuery => ({ ...q, echo: describe(q), raw });

  // Identity assertion → write-wall (route to §9.3, never assert).
  if (hasWord(lower, "samma") && (lower.includes("?") || hasAnyWord(lower, ["är", "aktör", "person", "fordon"]))) {
    return finish({ shape: "detail", target, guard: true, time, place, observer });
  }

  // Entity lookup: an explicit "entitet X" or a plate-shaped token → the vehicle
  // dossier (detail of one fordon).
  const plate = raw.match(PLATE_RE);
  const entityKw = lower.match(/\bentitet\s+([^\s,?.!]+)/);
  if (entityKw || plate) {
    const term = (entityKw?.[1] ?? plate?.[1] ?? "").toUpperCase();
    return finish({ shape: "detail", target: "fordon", term, time, place, observer });
  }

  // Recurring entities (a list filtered by sighting count).
  if (hasAnyWord(lower, ["återkommande", "upprepad", "upprepade", "återkommer"]) || /flera gånger|mer än en gång/.test(lower)) {
    const minM = lower.match(/\b(?:minst|mer än)\s*(\d+)/);
    const minCount = minM ? Math.max(2, parseInt(minM[1], 10)) : 2;
    return finish({ shape: "list", target, minCount, time, place, observer });
  }

  const shape = parseShape(lower, false);
  // A named craft type becomes the term (so "visa drönarobservationer" filters).
  // The whole-question free-text term is a last resort ONLY when there is nothing
  // else to go on — an observer/time/place filter must not be shadowed by a dumb
  // full-string search.
  const term = craftType ?? (target === "alla" && !time && !place && !observer ? lower.replace(/[?.!]+$/, "").trim() : undefined);
  return finish({ shape, target, term, time, place, observer });
}

// --- execution -------------------------------------------------------------

function minuteOf(tidpunkt: string): number | null {
  const m = tidpunkt.match(/T(\d{2}):(\d{2})/);
  return m ? hhmmToMin(m[1], m[2]) : null;
}

function inWindow(min: number, w: TimeWindow): boolean {
  return w.startMin <= w.endMin
    ? min >= w.startMin && min <= w.endMin
    : min >= w.startMin || min <= w.endMin;
}

function matchesTime(tidpunkt: string, w: TimeWindow): boolean {
  const min = minuteOf(tidpunkt);
  return min !== null && inWindow(min, w);
}
function matchesObserver(sagesman: string, obs: string): boolean {
  return (sagesman ?? "").toUpperCase().includes(obs);
}

/** Time / place / observer filters against a record with tidpunkt/plats/sagesman. */
function passesFilters(rec: { tidpunkt: string; plats: string; sagesman?: string }, q: StructuredQuery): boolean {
  if (q.time && !matchesTime(rec.tidpunkt, q.time)) return false;
  if (q.place && !(rec.plats ?? "").toLowerCase().includes(q.place)) return false;
  if (q.observer && !matchesObserver(rec.sagesman ?? "", q.observer)) return false;
  return true;
}

function cite(r: { file: string; tnr: string }): string {
  // tnr is attacker-controlled report content inside a wikilink alias — escape it.
  return `[[${noteStem(r.file)}|TNR${mdText(r.tnr)}]]`;
}

function echoBlock(q: StructuredQuery): string {
  return ["> **Tolkad fråga:** `" + q.echo + "`", "> _(rätta genom att omformulera frågan; fynden nedan är deterministiska)_", ""].join("\n");
}

const answer = (q: StructuredQuery, lines: string[], rowCount: number): QueryAnswer => ({ query: q, markdown: lines.join("\n"), rowCount });

// --- guard -----------------------------------------------------------------

function answerIdentityGuard(q: StructuredQuery): QueryAnswer {
  return answer(q, [
    echoBlock(q),
    "# Identitetsfråga",
    "",
    "ODEN **påstår inte** att två noder är samma aktör på egen hand.",
    "Det avgörs med evidens och operatörens bekräftelse:",
    "",
    "- **Evidens:** ställ *återkommande*- eller observationsfrågor och jämför",
    "  kedjan (vilka meddelanden, vilka delade kännetecken/registreringsnummer).",
    "- **Operatörens bedömning:** granska aktörsförslagen i ODEN-panelen och",
    "  bekräfta själv.",
    "",
    "_Inget skrivs som fakta utan tydlig evidens eller operatörens bekräftelse._",
  ], 0);
}

// --- detail ----------------------------------------------------------------

function vehicleDetail(q: StructuredQuery, kb: KB): QueryAnswer {
  const term = (q.term ?? "").toUpperCase();
  const lines: string[] = [echoBlock(q)];
  const v = kb.vehicles.find((e) => e.canonical.toUpperCase() === term);
  if (v) {
    // Join the craft type (if the same plate was seen as a typed craft).
    const typed = [...new Set(kb.craft.filter((c) => c.plate === v.canonical).map((c) => c.label))];
    const typeStr = typed.length ? `${typed.join("/")} · ` : "";
    lines.push(`# Fordon ${v.canonical}`);
    lines.push(`${typeStr}${v.count} observationer · ${mdText(v.firstSeen)} → ${mdText(v.lastSeen)}`);
    if (v.resolvedPartials.length) lines.push(`Auto-sammanslagna partialer: ${v.resolvedPartials.map((p) => "`" + p + "`").join(", ")}`);
    lines.push("", "## Observationer");
    for (const o of v.observations) lines.push(`- ${cite(o)} — ${mdText(o.tidpunkt)} — ${mdText(o.plats)}`);
    return answer(q, lines, v.observations.length);
  }
  // Fall back to a mark of the same term (old entity behaviour).
  const t2 = (q.term ?? "").toLowerCase();
  const mk = kb.marks.find((m) => m.signature.toLowerCase().includes(t2) || m.label.toLowerCase().includes(t2));
  if (mk) return markDossier(q, mk);
  lines.push(`Ingen entitet matchar \`${q.term}\` i nuvarande material.`);
  return answer(q, lines, 0);
}

function markDossier(q: StructuredQuery, mk: MarkNomination): QueryAnswer {
  const lines = [echoBlock(q), `# Kännetecken ${mk.label}`, `${mk.count} observationer · ${mdText(mk.firstSeen)} → ${mdText(mk.lastSeen)}`, "", "## Observationer"];
  for (const o of mk.members) lines.push(`- ${cite(o)} — ${mdText(o.tidpunkt)} — ${mdText(o.plats)}`);
  return answer(q, lines, mk.members.length);
}

function markDetail(q: StructuredQuery, kb: KB): QueryAnswer {
  const t = (q.term ?? "").toLowerCase();
  const mk = t ? kb.marks.find((m) => m.signature.toLowerCase().includes(t) || m.label.toLowerCase().includes(t)) : undefined;
  if (mk) return markDossier(q, mk);
  return marksList(q, kb, 1);
}

/** Find a confirmed actor by term (facet label / id / a plate in its chain). */
function findActor(kb: KB, term: string): ActorHypothesis | undefined {
  const t = term.toLowerCase();
  return kb.actors.find(
    (h) => h.id.toLowerCase().includes(t) || h.facets.some((f) => f.label.toLowerCase().includes(t)),
  );
}

function actorDetail(q: StructuredQuery, kb: KB): QueryAnswer {
  const h = q.term ? findActor(kb, q.term) : undefined;
  if (!h) return actorsList(q, kb);
  const facetStr = h.facets.map((f) => f.label).join(" + ");
  const lines = [
    echoBlock(q),
    `# Aktör: ${mdText(facetStr)}`,
    `${h.vehicleCount} fordon + ${h.markCount} kännetecken · ${mdText(h.firstSeen)} → ${mdText(h.lastSeen)}`,
    "",
    "## Facetter",
  ];
  for (const f of h.facets) lines.push(`- ${mdText(f.label)} _(${mdText(f.type)})_`);
  lines.push("", "## Rörelsekedja");
  for (const step of h.chain) {
    lines.push(`- ${cite(step)} — ${mdText(step.tidpunkt)} — ${mdText(step.plats)}${step.facets.length ? " — " + mdText(step.facets.join(", ")) : ""}`);
  }
  return answer(q, lines, h.chain.length);
}

/** Does an observation's `plats` belong to a cluster? */
function atPlace(plats: string, c: LocationCluster): boolean {
  const p = (plats ?? "").trim();
  return p === c.key || (c.label !== c.key && p.toLowerCase().includes(c.label.toLowerCase()));
}

function findPlace(kb: KB, term: string): LocationCluster | undefined {
  const t = term.toLowerCase();
  return kb.places.find((c) => c.key.toLowerCase().includes(t) || c.label.toLowerCase().includes(t));
}

function placeDetail(q: StructuredQuery, kb: KB): QueryAnswer {
  const key = q.place ?? q.term;
  const c = key ? findPlace(kb, key) : undefined;
  if (!c) return placesList(q, kb);
  const lines = [
    echoBlock(q),
    `# 📍 ${mdText(c.label)}`,
    `${c.reports.length} rapporter · ${c.elevatedCount} misstänkta${c.plates.length ? ` · fordon: ${c.plates.map((p) => "`" + p + "`").join(", ")}` : ""}`,
    "",
    "## Observationer",
  ];
  for (const o of c.reports) {
    const mark = o.elevated ? "⚠ " : "";
    const plate = o.plates.length ? ` — ${o.plates.map((p) => "`" + p + "`").join(", ")}` : "";
    lines.push(`- ${mark}${cite(o)} — ${mdText(o.tidpunkt)}${plate}`);
  }
  if (c.reports.length === 0) lines.push("_Inga observationer ännu._");
  return answer(q, lines, c.reports.length);
}

function answerDetail(q: StructuredQuery, kb: KB): QueryAnswer {
  switch (q.target) {
    case "fordon": return vehicleDetail(q, kb);
    case "kannetecken": return markDetail(q, kb);
    case "aktor": return actorDetail(q, kb);
    case "plats": return placeDetail(q, kb);
    case "farkost": return craftList(q, kb);
    default: return q.term ? searchReports(q, kb) : observationList(q, kb);
  }
}

// --- list ------------------------------------------------------------------

function vehiclesList(q: StructuredQuery, kb: KB, minCount: number): QueryAnswer {
  const recurring = minCount > 1;
  const vs = kb.vehicles.filter((e) => e.count >= minCount).sort((a, b) => b.count - a.count || a.canonical.localeCompare(b.canonical));
  const lines = [echoBlock(q), recurring ? `# Återkommande fordon (minst ${minCount} observationer)` : "# Fordon"];
  for (const v of vs) {
    const typed = [...new Set(kb.craft.filter((c) => c.plate === v.canonical).map((c) => c.label))];
    const typeStr = typed.length ? `${typed.join("/")} ` : "";
    lines.push(`- **${typeStr}${v.canonical}** — ${v.count} obs (${mdText(v.firstSeen)} → ${mdText(v.lastSeen)}) — ${v.observations.map(cite).slice(0, 12).join(", ")}`);
  }
  if (vs.length === 0) lines.push("", "_Inga fordon över tröskeln._");
  return answer(q, lines, vs.length);
}

function marksList(q: StructuredQuery, kb: KB, minCount: number): QueryAnswer {
  const recurring = minCount > 1;
  const ms = kb.marks.filter((m) => m.count >= minCount).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const lines = [echoBlock(q), recurring ? `# Återkommande kännetecken (minst ${minCount})` : "# Kännetecken (bekräftade)"];
  for (const m of ms) lines.push(`- **${mdText(m.label)}** — ${m.count} obs (${mdText(m.firstSeen)} → ${mdText(m.lastSeen)})`);
  if (ms.length === 0) lines.push("", "_Inga bekräftade kännetecken över tröskeln._");
  return answer(q, lines, ms.length);
}

function recurringBoth(q: StructuredQuery, kb: KB): QueryAnswer {
  const minCount = q.minCount ?? 2;
  const vs = kb.vehicles.filter((e) => e.count >= minCount).sort((a, b) => b.count - a.count);
  const ms = kb.marks.filter((m) => m.count >= minCount).sort((a, b) => b.count - a.count);
  const lines = [echoBlock(q), `# Återkommande (minst ${minCount} observationer)`];
  let rows = 0;
  if (vs.length) {
    lines.push("", "## Fordon");
    for (const v of vs) { rows++; lines.push(`- **${v.canonical}** — ${v.count} obs (${mdText(v.firstSeen)} → ${mdText(v.lastSeen)}) — ${v.observations.map(cite).slice(0, 12).join(", ")}`); }
  }
  if (ms.length) {
    lines.push("", "## Kännetecken (bekräftade)");
    for (const m of ms) { rows++; lines.push(`- **${mdText(m.label)}** — ${m.count} obs (${mdText(m.firstSeen)} → ${mdText(m.lastSeen)})`); }
  }
  if (rows === 0) lines.push("", "_Inga återkommande entiteter över tröskeln._");
  return answer(q, lines, rows);
}

function actorsList(q: StructuredQuery, kb: KB): QueryAnswer {
  const lines = [echoBlock(q), "# Aktörer (bekräftade)"];
  for (const h of kb.actors) {
    const label = h.facets.map((f) => f.label).join(" + ");
    const first = h.reportFiles[0];
    const cited = first ? ` — ${cite({ file: first, tnr: h.chain[0]?.tnr ?? "" })}` : "";
    lines.push(`- **${mdText(label)}** — ${h.vehicleCount} fordon + ${h.markCount} kännetecken (${mdText(h.firstSeen)} → ${mdText(h.lastSeen)})${cited}`);
  }
  if (kb.actors.length === 0) lines.push("", "_Inga bekräftade aktörer ännu._");
  return answer(q, lines, kb.actors.length);
}

function placesList(q: StructuredQuery, kb: KB): QueryAnswer {
  const cs = [...kb.places].sort((a, b) => b.elevatedCount - a.elevatedCount || b.reports.length - a.reports.length || a.label.localeCompare(b.label));
  const lines = [echoBlock(q), "# Platser"];
  for (const c of cs) {
    const cites = c.reports.slice(0, 3).map(cite).join(", ");
    lines.push(`- **${mdText(c.label)}** — ${c.reports.length} rapporter, ${c.elevatedCount} misstänkta${c.predefined ? " · fördefinierad" : ""}${cites ? ` — ${cites}` : ""}`);
  }
  if (cs.length === 0) lines.push("", "_Inga relevanta platser ännu._");
  return answer(q, lines, cs.length);
}

function larmList(q: StructuredQuery, kb: KB): QueryAnswer {
  const rows = kb.larm.filter((r) => passesFilters(r, q)).sort((a, b) => b.score - a.score || a.tidpunkt.localeCompare(b.tidpunkt));
  const lines = [echoBlock(q), "# Larm (förhöjd misstanke)"];
  for (const r of rows) {
    const level = suspicionLevel(r.score);
    const reasons = reasonPhrases(r.reasons).join(", ");
    lines.push(`- ${level ? `**${level}** · ` : ""}${cite(r)} — ${mdText(r.tidpunkt)} — ${mdText(r.plats)}${reasons ? ` — ${mdText(reasons)}` : ""}`);
  }
  if (rows.length === 0) lines.push("", "_Inga larm matchar filtren._");
  return answer(q, lines, rows.length);
}

function craftList(q: StructuredQuery, kb: KB): QueryAnswer {
  const type = q.term ? matchCraftTypes(q.term)[0]?.key ?? q.term.toLowerCase() : undefined;
  const elevated = new Set(kb.larm.map((r) => r.file));
  let rows = kb.craft.filter((c) => passesFilters(c, q));
  if (type) rows = rows.filter((c) => c.type === type);
  rows = rows.sort((a, b) => a.tidpunkt.localeCompare(b.tidpunkt) || a.tnr.localeCompare(b.tnr));
  const title = type ? `# Farkostobservationer: ${mdText(type)}` : "# Farkostobservationer";
  const lines = [echoBlock(q), title];
  for (const c of rows) {
    const mark = elevated.has(c.file) ? "⚠ " : "";
    const plate = c.plate ? ` — \`${c.plate}\`` : "";
    lines.push(`- ${mark}${cite(c)} — ${mdText(c.tidpunkt)} — ${mdText(c.plats)} — ${mdText(c.label)}${plate}`);
  }
  if (rows.length === 0) lines.push("", "_Inga farkostobservationer matchar._");
  return answer(q, lines, rows.length);
}

function observationList(q: StructuredQuery, kb: KB): QueryAnswer {
  let matches = kb.reports.filter((r) => passesFilters(r, q));
  if (q.target === "fordon") matches = matches.filter(hasPlate);
  if (q.target === "kannetecken") {
    const markFiles = new Set(kb.marks.flatMap((m) => m.members.map((x) => x.file)));
    matches = matches.filter((r) => markFiles.has(r.file));
  }
  matches = matches.sort((a, b) => a.tidpunkt.localeCompare(b.tidpunkt));
  const lines = [echoBlock(q), "# Observationer"];
  for (const r of matches) lines.push(`- ${cite(r)} — ${mdText(r.tidpunkt)} — ${mdText(r.plats)}${r.symbol ? " — " + mdText(r.symbol) : ""}`);
  if (matches.length === 0) lines.push("", "_Inga observationer matchar filtren._");
  return answer(q, lines, matches.length);
}

function hasPlate(r: Report): boolean {
  return r.links.some((l) => l.kind === "plate-full" || l.kind === "plate-partial");
}

function searchReports(q: StructuredQuery, kb: KB): QueryAnswer {
  const term = (q.term ?? "").toLowerCase();
  const lines = [echoBlock(q), `# Sökning: "${mdText(q.term ?? "")}"`];
  if (term.length < 2) {
    lines.push("", "_Ange minst två tecken._");
    return answer(q, lines, 0);
  }
  const hits = kb.reports
    .filter((r) =>
      (r.handelse ?? "").toLowerCase().includes(term) ||
      (r.symbol ?? "").toLowerCase().includes(term) ||
      (r.plats ?? "").toLowerCase().includes(term) ||
      r.links.some((l) => l.raw.toLowerCase().includes(term)),
    )
    .filter((r) => passesFilters(r, q))
    .sort((a, b) => a.tidpunkt.localeCompare(b.tidpunkt));
  for (const r of hits) lines.push(`- ${cite(r)} — ${mdText(r.tidpunkt)} — ${mdText(r.plats)} — ${mdText(r.symbol ?? r.handelse ?? "")}`);
  if (hits.length === 0) lines.push("", "_Inga träffar._");
  return answer(q, lines, hits.length);
}

function answerList(q: StructuredQuery, kb: KB): QueryAnswer {
  const rec = q.minCount != null;
  const filtered = q.time || q.place || q.observer;
  switch (q.target) {
    case "fordon":
      if (!rec && filtered) return observationList(q, kb);
      return vehiclesList(q, kb, rec ? q.minCount! : 1);
    case "kannetecken":
      if (!rec && filtered) return observationList(q, kb);
      return marksList(q, kb, rec ? q.minCount! : 1);
    case "aktor": return actorsList(q, kb);
    case "plats": return placesList(q, kb);
    case "larm": return larmList(q, kb);
    case "farkost": return craftList(q, kb);
    case "reports":
    case "alla":
    default:
      if (rec) return recurringBoth(q, kb);
      if (q.term) return searchReports(q, kb);
      return observationList(q, kb);
  }
}

// --- summary ---------------------------------------------------------------

function placeSummary(q: StructuredQuery, kb: KB, c: LocationCluster): QueryAnswer {
  const labelLower = c.label.toLowerCase();
  const vehicles = kb.vehicles.filter((v) => c.plates.includes(v.canonical));
  const actors = kb.actors.filter((h) => h.chain.some((s) => atPlace(s.plats, c)));
  const craft = kb.craft.filter((x) => atPlace(x.plats, c));
  const larm = kb.larm.filter((r) => c.reports.some((o) => o.file === r.file) || atPlace(r.plats, c)).sort((a, b) => b.score - a.score);
  const lines = [
    echoBlock(q),
    `# Lägesbild: 📍 ${mdText(c.label)}`,
    `${c.reports.length} rapporter · ${c.elevatedCount} misstänkta${c.predefined ? (c.predefined.sensitive ? " · skyddsvärd" : " · fördefinierad") : ""}`,
  ];
  if (larm.length) {
    lines.push("", "## Larm");
    for (const r of larm.slice(0, 6)) lines.push(`- ${suspicionLevel(r.score) ? `**${suspicionLevel(r.score)}** · ` : ""}${cite(r)} — ${mdText(r.tidpunkt)} — ${mdText(reasonPhrases(r.reasons).join(", "))}`);
  }
  if (vehicles.length) {
    lines.push("", "## Fordon");
    for (const v of vehicles) lines.push(`- \`${v.canonical}\` — ${v.count} obs`);
  }
  if (craft.length) {
    lines.push("", "## Farkoster");
    for (const x of craft.slice(0, 10)) lines.push(`- ${cite(x)} — ${mdText(x.tidpunkt)} — ${mdText(x.label)}`);
  }
  if (actors.length) {
    lines.push("", "## Aktörer");
    for (const h of actors) lines.push(`- ${mdText(h.facets.map((f) => f.label).join(" + "))}`);
  }
  void labelLower;
  return answer(q, lines, c.reports.length);
}

function situationOverview(q: StructuredQuery, kb: KB): QueryAnswer {
  const threatCraft = kb.craft.filter((c) => c.threat > 0);
  const lines = [
    echoBlock(q),
    "# Lägesbild",
    `Rapporter: ${kb.reports.length} · Fordon: ${kb.vehicles.length} · Kännetecken: ${kb.marks.length} · ` +
      `Aktörer: ${kb.actors.length} · Platser: ${kb.places.length} · Larm: ${kb.larm.length} · Farkoster (relevanta): ${threatCraft.length}`,
  ];
  const larm = [...kb.larm].sort((a, b) => b.score - a.score).slice(0, 5);
  if (larm.length) {
    lines.push("", "## Främsta larm");
    for (const r of larm) lines.push(`- ${suspicionLevel(r.score) ? `**${suspicionLevel(r.score)}** · ` : ""}${cite(r)} — ${mdText(r.tidpunkt)} — ${mdText(r.plats)} — ${mdText(reasonPhrases(r.reasons).join(", "))}`);
  }
  const hot = [...kb.places].filter((c) => c.elevatedCount > 0).sort((a, b) => b.elevatedCount - a.elevatedCount).slice(0, 3);
  if (hot.length) {
    lines.push("", "## Hetaste platser");
    for (const c of hot) lines.push(`- **${mdText(c.label)}** — ${c.elevatedCount} misstänkta / ${c.reports.length} rapporter`);
  }
  const recentCraft = [...threatCraft].sort((a, b) => b.tidpunkt.localeCompare(a.tidpunkt)).slice(0, 5);
  if (recentCraft.length) {
    lines.push("", "## Senaste farkoster (relevanta)");
    for (const c of recentCraft) lines.push(`- ${cite(c)} — ${mdText(c.tidpunkt)} — ${mdText(c.plats)} — ${mdText(c.label)}`);
  }
  return answer(q, lines, kb.larm.length);
}

function answerSummary(q: StructuredQuery, kb: KB): QueryAnswer {
  const key = q.place ?? (q.target === "plats" ? q.term : undefined);
  if (key) {
    const c = findPlace(kb, key);
    if (c) return placeSummary(q, kb, c);
    return answer(q, [echoBlock(q), `# Lägesbild`, "", `_Ingen plats matchar \`${mdText(key)}\`._`], 0);
  }
  return situationOverview(q, kb);
}

// --- timeline --------------------------------------------------------------

function answerTimeline(q: StructuredQuery, kb: KB): QueryAnswer {
  const lines = [echoBlock(q), "# Tidslinje"];
  if (q.target === "larm") {
    const rows = kb.larm.filter((r) => passesFilters(r, q)).sort((a, b) => a.tidpunkt.localeCompare(b.tidpunkt));
    for (const r of rows) lines.push(`- ${mdText(r.tidpunkt)} — ${cite(r)} — ${mdText(r.plats)} — ${mdText(reasonPhrases(r.reasons).join(", "))}`);
    if (rows.length === 0) lines.push("", "_Inga larm matchar filtren._");
    return answer(q, lines, rows.length);
  }
  if (q.target === "farkost") {
    const type = q.term ? matchCraftTypes(q.term)[0]?.key : undefined;
    let rows = kb.craft.filter((c) => passesFilters(c, q));
    if (type) rows = rows.filter((c) => c.type === type);
    rows = rows.sort((a, b) => a.tidpunkt.localeCompare(b.tidpunkt));
    for (const c of rows) lines.push(`- ${mdText(c.tidpunkt)} — ${cite(c)} — ${mdText(c.plats)} — ${mdText(c.label)}`);
    if (rows.length === 0) lines.push("", "_Inga farkostobservationer matchar._");
    return answer(q, lines, rows.length);
  }
  const rows = kb.reports.filter((r) => passesFilters(r, q)).sort((a, b) => a.tidpunkt.localeCompare(b.tidpunkt));
  for (const r of rows) lines.push(`- ${mdText(r.tidpunkt)} — ${cite(r)} — ${mdText(r.plats)}${r.symbol ? " — " + mdText(r.symbol) : ""}`);
  if (rows.length === 0) lines.push("", "_Inga observationer matchar filtren._");
  return answer(q, lines, rows.length);
}

// --- dispatch --------------------------------------------------------------

export function executeQuery(q: StructuredQuery, kb: KB): QueryAnswer {
  if (q.guard) return answerIdentityGuard(q);
  switch (q.shape) {
    case "summary": return answerSummary(q, kb);
    case "timeline": return answerTimeline(q, kb);
    case "detail": return answerDetail(q, kb);
    case "list":
    default: return answerList(q, kb);
  }
}

/** Convenience: parse + execute. */
export function runQuery(raw: string, kb: KB): QueryAnswer {
  return executeQuery(parseQuery(raw), kb);
}
