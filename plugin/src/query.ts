/*
 * Step 4 — deterministic text query interface (PLUGIN_DESIGN §7.1). Pure TS,
 * Obsidian-free → testable outside Obsidian.
 *
 * This is the DEGRADED/no-LLM mode that is also the foundation: the operator's
 * input is parsed by a DETERMINISTIC keyword parser into a StructuredQuery, the
 * interpretation is ECHOED back (so a misread is visible and corrected at the
 * query, §7.1 guardrail 1), and the answer is computed deterministically from
 * the knowledge base with a citation per row (guardrails 2–4). A future LLM
 * (Step 7) only needs to produce the same StructuredQuery — the findings never
 * originate in a model.
 *
 * Write-wall (§7.1 guardrail 6): the engine RETRIEVES; it never asserts identity
 * or writes findings. An identity question ("är dessa samma?") is routed to the
 * evidence/hunch flow (§9.3), not answered with a yes/no.
 */
import { Report } from "./parse";
import { PlateEntity } from "./reid";
import { MarkNomination } from "./jobb";
import { mdText } from "./mdsafe";

/** Snapshot of current knowledge (reflects gradual vault buildup). */
export interface KB {
  reports: Report[];
  vehicles: PlateEntity[];
  /** CONFIRMED mark entities only (operator-approved Job B nominations). */
  marks: MarkNomination[];
}

export type QueryIntent = "entity" | "recurring" | "observations" | "search" | "identity-guard";
export type Kind = "fordon" | "marke" | "alla";

export interface TimeWindow {
  startMin: number; // minutes from midnight, inclusive
  endMin: number; // inclusive; wraps past midnight when startMin > endMin
  label: string;
}

export interface StructuredQuery {
  intent: QueryIntent;
  kind: Kind;
  term?: string; // entity id / free-text search
  minCount?: number; // recurring threshold
  time?: TimeWindow;
  place?: string; // plats substring (lowercased)
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
  "mellan", "kl", "klockan", "återkommande", "fordon", "märke", "märken",
  "natt", "natten", "i", "på", "och",
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

function parseKind(lower: string): Kind {
  if (hasAnyWord(lower, ["märke", "märken", "ryggsäck", "keps", "mössa", "dekal", "kännetecken"])) return "marke";
  if (hasAnyWord(lower, ["fordon", "bil", "plåt", "plåtar", "reg", "registreringsskylt"])) return "fordon";
  return "alla";
}

function describe(q: Omit<StructuredQuery, "echo" | "raw">): string {
  const parts = [`avsikt=${q.intent}`];
  if (q.kind !== "alla") parts.push(`typ=${q.kind}`);
  if (q.term) parts.push(`term="${q.term}"`);
  if (q.minCount) parts.push(`minst=${q.minCount}`);
  if (q.time) parts.push(`tid=${q.time.label}`);
  if (q.place) parts.push(`plats~"${q.place}"`);
  return parts.join(", ");
}

export function parseQuery(raw: string): StructuredQuery {
  const lower = raw.toLowerCase().trim();
  const tokens = lower.split(/\s+/).filter(Boolean);
  const kind = parseKind(lower);
  const time = parseTime(lower);
  const place = parsePlace(tokens);

  // Identity assertion → write-wall (route to §9.3, never assert).
  if (hasWord(lower, "samma") && (lower.includes("?") || hasAnyWord(lower, ["är", "aktör", "person", "fordon"]))) {
    const base = { intent: "identity-guard" as const, kind, time, place };
    return { ...base, echo: describe(base), raw };
  }

  // Entity lookup: an explicit "entitet X" or a plate-shaped token.
  const plate = raw.match(PLATE_RE);
  const entityKw = lower.match(/\bentitet\s+([^\s,?.!]+)/);
  if (entityKw || plate) {
    const term = (entityKw?.[1] ?? plate?.[1] ?? "").toUpperCase();
    const base = { intent: "entity" as const, kind, term, time, place };
    return { ...base, echo: describe(base), raw };
  }

  // Recurring entities.
  if (hasAnyWord(lower, ["återkommande", "upprepad", "upprepade", "återkommer"]) || /flera gånger|mer än en gång/.test(lower)) {
    const minM = lower.match(/\b(?:minst|mer än)\s*(\d+)/);
    const minCount = minM ? Math.max(2, parseInt(minM[1], 10)) : 2;
    const base = { intent: "recurring" as const, kind, minCount, time, place };
    return { ...base, echo: describe(base), raw };
  }

  // Observations with filters (time/place/kind present), else free search.
  if (time || place || kind !== "alla") {
    const base = { intent: "observations" as const, kind, time, place };
    return { ...base, echo: describe(base), raw };
  }

  const base = { intent: "search" as const, kind, term: lower.replace(/[?.!]+$/, "").trim() };
  return { ...base, echo: describe(base), raw };
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

function reportMatchesFilters(r: Report, q: StructuredQuery): boolean {
  if (q.time) {
    const min = minuteOf(r.tidpunkt);
    if (min === null || !inWindow(min, q.time)) return false;
  }
  if (q.place && !(r.plats ?? "").toLowerCase().includes(q.place)) return false;
  return true;
}

function stem(file: string): string {
  return file.replace(/^.*\//, "").replace(/\.md$/, "");
}
function cite(r: { file: string; tnr: string }): string {
  // tnr is attacker-controlled report content inside a wikilink alias — escape it.
  return `[[${stem(r.file)}|TNR${mdText(r.tnr)}]]`;
}

function echoBlock(q: StructuredQuery): string {
  return ["> **Tolkad fråga:** `" + q.echo + "`", "> _(rätta genom att omformulera frågan; fynden nedan är deterministiska)_", ""].join("\n");
}

function answerEntity(q: StructuredQuery, kb: KB): QueryAnswer {
  const term = (q.term ?? "").toUpperCase();
  const v = kb.vehicles.find((e) => e.canonical.toUpperCase() === term);
  const lines: string[] = [echoBlock(q)];
  if (v) {
    lines.push(`# Fordon ${v.canonical}`);
    lines.push(`Slag: ${v.slag} · ${v.count} observationer · ${mdText(v.firstSeen)} → ${mdText(v.lastSeen)}`);
    if (v.resolvedPartials.length) lines.push(`Auto-sammanslagna partialer: ${v.resolvedPartials.map((p) => "`" + p + "`").join(", ")}`);
    lines.push("", "## Observationer");
    for (const o of v.observations) lines.push(`- ${cite(o)} — ${mdText(o.tidpunkt)} — ${mdText(o.plats)}`);
    return { query: q, markdown: lines.join("\n"), rowCount: v.observations.length };
  }
  const term2 = (q.term ?? "").toLowerCase();
  const mk = kb.marks.find((m) => m.signature.toLowerCase().includes(term2) || m.label.toLowerCase().includes(term2));
  if (mk) {
    lines.push(`# Kännetecken ${mk.label}`);
    lines.push(`${mk.count} observationer · ${mdText(mk.firstSeen)} → ${mdText(mk.lastSeen)}`, "", "## Observationer");
    for (const o of mk.members) lines.push(`- ${cite(o)} — ${mdText(o.tidpunkt)} — ${mdText(o.plats)}`);
    return { query: q, markdown: lines.join("\n"), rowCount: mk.members.length };
  }
  lines.push(`Ingen entitet matchar \`${q.term}\` i nuvarande material.`);
  return { query: q, markdown: lines.join("\n"), rowCount: 0 };
}

function answerRecurring(q: StructuredQuery, kb: KB): QueryAnswer {
  const minCount = q.minCount ?? 2;
  const lines: string[] = [echoBlock(q), `# Återkommande (minst ${minCount} observationer)`];
  let rows = 0;
  if (q.kind !== "marke") {
    const vs = kb.vehicles.filter((e) => e.count >= minCount).sort((a, b) => b.count - a.count);
    if (vs.length) {
      lines.push("", "## Fordon");
      for (const v of vs) {
        rows++;
        lines.push(`- **${v.canonical}** — ${v.count} obs (${mdText(v.firstSeen)} → ${mdText(v.lastSeen)}) — ${v.observations.map(cite).slice(0, 12).join(", ")}`);
      }
    }
  }
  if (q.kind !== "fordon") {
    const ms = kb.marks.filter((m) => m.count >= minCount).sort((a, b) => b.count - a.count);
    if (ms.length) {
      lines.push("", "## Kännetecken (bekräftade)");
      for (const m of ms) {
        rows++;
        lines.push(`- **${m.label}** — ${m.count} obs (${mdText(m.firstSeen)} → ${mdText(m.lastSeen)})`);
      }
    }
  }
  if (rows === 0) lines.push("", "_Inga återkommande entiteter över tröskeln._");
  return { query: q, markdown: lines.join("\n"), rowCount: rows };
}

function answerObservations(q: StructuredQuery, kb: KB): QueryAnswer {
  const lines: string[] = [echoBlock(q), "# Observationer"];
  let matches = kb.reports.filter((r) => reportMatchesFilters(r, q));
  if (q.kind === "fordon") matches = matches.filter((r) => r.links.some((l) => l.kind !== "mark"));
  // (kind=marke filtering needs confirmed-mark membership; approximate via reports in confirmed marks)
  if (q.kind === "marke") {
    const markFiles = new Set(kb.marks.flatMap((m) => m.members.map((x) => x.file)));
    matches = matches.filter((r) => markFiles.has(r.file));
  }
  matches = matches.sort((a, b) => a.tidpunkt.localeCompare(b.tidpunkt));
  for (const r of matches) {
    lines.push(`- ${cite(r)} — ${mdText(r.tidpunkt)} — ${mdText(r.plats)}${r.symbol ? " — " + mdText(r.symbol) : ""}`);
  }
  if (matches.length === 0) lines.push("", "_Inga observationer matchar filtren._");
  return { query: q, markdown: lines.join("\n"), rowCount: matches.length };
}

function answerSearch(q: StructuredQuery, kb: KB): QueryAnswer {
  const term = (q.term ?? "").toLowerCase();
  const lines: string[] = [echoBlock(q), `# Sökning: "${q.term}"`];
  if (term.length < 2) {
    lines.push("", "_Ange minst två tecken._");
    return { query: q, markdown: lines.join("\n"), rowCount: 0 };
  }
  const hits = kb.reports
    .filter((r) =>
      (r.symbol ?? "").toLowerCase().includes(term) ||
      (r.plats ?? "").toLowerCase().includes(term) ||
      r.links.some((l) => l.raw.toLowerCase().includes(term)),
    )
    .sort((a, b) => a.tidpunkt.localeCompare(b.tidpunkt));
  for (const r of hits) lines.push(`- ${cite(r)} — ${mdText(r.tidpunkt)} — ${mdText(r.plats)} — ${mdText(r.symbol)}`);
  if (hits.length === 0) lines.push("", "_Inga träffar._");
  return { query: q, markdown: lines.join("\n"), rowCount: hits.length };
}

function answerIdentityGuard(q: StructuredQuery): QueryAnswer {
  const md = [
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
  ].join("\n");
  return { query: q, markdown: md, rowCount: 0 };
}

export function executeQuery(q: StructuredQuery, kb: KB): QueryAnswer {
  switch (q.intent) {
    case "entity":
      return answerEntity(q, kb);
    case "recurring":
      return answerRecurring(q, kb);
    case "observations":
      return answerObservations(q, kb);
    case "identity-guard":
      return answerIdentityGuard(q);
    case "search":
    default:
      return answerSearch(q, kb);
  }
}

/** Convenience: parse + execute. */
export function runQuery(raw: string, kb: KB): QueryAnswer {
  return executeQuery(parseQuery(raw), kb);
}
