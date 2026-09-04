/*
 * "Genomför analys" — date-range analysis report (pure, Obsidian-free).
 *
 * Tier 1 is fully deterministic and is the product: counts, larm, timeline,
 * actors, recurrences, marks, hotspots — instant, cited, works with Ollama off.
 * Tier 2 hands the LLM the COMPLETE in-range message roster (every message,
 * none dropped — the patterns tier 2 exists to find hide in messages the
 * deterministic layer scored 0) plus the deterministic findings as
 * orientation, and asks for 2–5 TNR-cited pattern HYPOTHESES to verify —
 * never facts. Guards (sanitizeHypotheses here + stripThink/ensureCitations
 * from conversation.ts) make invented citations impossible to miss.
 *
 * The E19 export mirrors the operator's underrättelseregister workbook: one
 * CSV row per in-range message, graded only as honestly as a machine can —
 * tillförlitlighet always F (source track record is a human judgment),
 * sakriktighet 2/3/6 from deterministic corroboration, never 1/4/5.
 */
import { Report } from "./parse";
import { analyzeSuspicion, SuspicionAnalysis, SuspicionOpts } from "./suspicion";
import { buildPlateEntities, JobAResult } from "./reid";
import { buildMarkNominations, JobBResult } from "./jobb";
import { ActorResult } from "./actor";
import { mergedActors, buildRecurrences, Recurrences, PluginState } from "./derive";
import { buildLocations, LocationCluster, PredefinedLocation } from "./location_notes";
import { CraftObservation, extractAllCraft } from "./craft";
import { plateIdentifiers } from "./ids";
import { reasonPhrases, suspicionLevel } from "./present";
import { placeLabel } from "./places";
import { noteStem } from "./notes_common";
import { mdText } from "./mdsafe";

// --- Date range --------------------------------------------------------------

/** Inclusive local-time range. `from`/`to` are full ISO-local timestamps so the
 *  codebase's string-compare idiom works directly against `tidpunkt`. */
export interface DateRange {
  from: string; // "YYYY-MM-DDTHH:MM:00"
  to: string; // "YYYY-MM-DDTHH:MM:59"
  label: string; // operator-facing, e.g. "2026-09-01 00:00 – 2026-09-05 23:59"
}

const RANGE_INPUT = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})$/;

/** Build an inclusive DateRange from two "YYYY-MM-DDTHH:MM" inputs (the shape
 *  a datetime-local input emits). Null when unparseable or from > to. */
export function normalizeRange(fromRaw: string, toRaw: string): DateRange | null {
  const f = RANGE_INPUT.exec((fromRaw ?? "").trim());
  const t = RANGE_INPUT.exec((toRaw ?? "").trim());
  if (!f || !t) return null;
  const from = `${f[1]}T${f[2]}:00`;
  const to = `${t[1]}T${t[2]}:59`;
  if (from > to) return null;
  return { from, to, label: `${f[1]} ${f[2]} – ${t[1]} ${t[2]}` };
}

/** Quick presets, anchored to the NEWEST report (not the wall clock) so they
 *  do the right thing for both a live operation and a re-dated demo corpus. */
export function presetRange(kind: "dygn" | "vecka" | "allt", reports: Report[]): DateRange | null {
  const times = reports.map((r) => r.tidpunkt).filter(Boolean).sort();
  if (!times.length) return null;
  const newest = times[times.length - 1];
  const oldest = times[0];
  const cut = (iso: string) => iso.slice(0, 16); // → "YYYY-MM-DDTHH:MM"
  if (kind === "allt") return normalizeRange(cut(oldest), cut(newest));
  const ms = Date.parse(newest) - (kind === "dygn" ? 24 : 7 * 24) * 3_600_000;
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  const fromLocal = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return normalizeRange(fromLocal, cut(newest));
}

export function inRange(tidpunkt: string, r: DateRange): boolean {
  return tidpunkt >= r.from && tidpunkt <= r.to;
}

export function filterReports(reports: Report[], r: DateRange): Report[] {
  return reports.filter((x) => inRange(x.tidpunkt, r));
}

// --- Range analysis (recompute, never filter results) --------------------------

export interface RangeAnalysis {
  range: DateRange;
  reports: Report[]; // the filtered set
  suspicion: SuspicionAnalysis;
  jobA: JobAResult;
  jobB: JobBResult;
  actors: ActorResult;
  locations: LocationCluster[];
  recurrences: Recurrences;
  craft: CraftObservation[];
}

/** Everything recomputed ON THE FILTERED SET — filtering precomputed results
 *  would describe out-of-range evidence (entity counts, firstSeen/lastSeen,
 *  recurrence thresholds, actor chains). All pure and fast. NB: an actor
 *  hypothesis id derived from a narrower facet set can differ from the
 *  full-corpus id, so a confirmed actor may show as "föreslagen" in a narrow
 *  range — honest (the confirmation rested on different evidence). */
export function analyzeRange(
  all: Report[],
  range: DateRange,
  suspicionOpts: SuspicionOpts,
  state: PluginState,
  predefined?: Record<string, PredefinedLocation>,
  aoi?: { lat: number; lon: number },
): RangeAnalysis {
  const reports = filterReports(all, range);
  const suspicion = analyzeSuspicion(reports, suspicionOpts);
  const jobA = buildPlateEntities(reports);
  const jobB = buildMarkNominations(reports);
  const actors = mergedActors(reports, suspicion, state.actorThreshold);
  const locations = buildLocations(reports, suspicion, state.locationMerges, predefined, aoi);
  const recurrences = buildRecurrences(locations, actors.hypotheses, state);
  const craft = extractAllCraft(reports);
  return { range, reports, suspicion, jobA, jobB, actors, locations, recurrences, craft };
}

// --- Automatic context sizing --------------------------------------------------

/** Rough Swedish-text token estimate (≈3.2 chars/token). */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 3.2);
}

/** Context window for a tier-2 call: need + output headroom, capped by the
 *  model's trained context AND a RAM tier (KV cache ≈144 KB/token on 4b;
 *  beyond 32k, prompt time and long-context degradation outgrow the chunked
 *  path). Floor 8192 (the validated minimum). No operator knob — the chosen
 *  value and its inputs are printed in the report's Underlag instead. */
export function computeNumCtx(neededTokens: number, modelMaxCtx: number | null, totalRamBytes: number): number {
  const ramCeiling = totalRamBytes <= 17 * 1024 ** 3 ? 16384 : 32768;
  const want = neededTokens + 1500;
  return Math.max(8192, Math.min(want, modelMaxCtx ?? 32768, ramCeiling));
}

// --- Tier-2 digest + prompts ----------------------------------------------------

export const REPORT_PROMPT_VERSION = "1";

export type DigestPlan =
  | { chunked: false; text: string }
  | { chunked: true; chunks: { label: string; text: string }[] };

/** The whole tier-2 sizing decision in ONE place (both the plugin flow and the
 *  eval harness use it — two callers doing their own chars↔tokens math is how
 *  the first eval ended up chunking a digest that fit in a single call).
 *  Single-shot whenever the computed window can hold the full digest;
 *  otherwise per-day chunks against the same window. */
export function planDigest(
  a: RangeAnalysis,
  state: PluginState,
  modelMaxCtx: number | null,
  totalRamBytes: number,
): { plan: DigestPlan; numCtx: number; needTokens: number } {
  const full = buildLlmDigest(a, state, Number.MAX_SAFE_INTEGER);
  const fullText = full.chunked ? "" : full.text; // MAX_SAFE_INTEGER never chunks
  const needTokens = estimateTokens(fullText.length);
  const numCtx = computeNumCtx(needTokens, modelMaxCtx, totalRamBytes);
  if (needTokens + 1500 <= numCtx) return { plan: full, numCtx, needTokens };
  // Window clamped below the need — chunk per day within the same window.
  const budgetChars = Math.floor((numCtx - 1500) * 3.2);
  return { plan: buildLlmDigest(a, state, budgetChars), numCtx, needTokens };
}

function rosterLine(r: Report, nicks: Record<string, string>): string {
  const hhmm = r.tidpunkt.slice(11, 16);
  const day = r.tidpunkt.slice(0, 10);
  const parts = [`[[TNR${r.tnr}]] ${day} ${hhmm} ${placeLabel(r.plats, nicks)} — "${(r.handelse ?? "").trim()}"`];
  const extra = [r.symbol?.trim(), r.sagesman ? `sagesman ${r.sagesman}` : ""].filter(Boolean).join("; ");
  if (extra) parts.push(`(${extra})`);
  return parts.join(" ");
}

function findingsTables(a: RangeAnalysis, state: PluginState): string {
  const nicks = state.locationNicknames;
  const out: string[] = [];
  out.push(`PERIOD: ${a.range.label}`);
  out.push(
    `RAPPORTER: ${a.reports.length} · LARM: ${a.suspicion.elevated.length} · FORDON: ${a.jobA.entities.length} · AKTÖRSFÖRSLAG: ${a.actors.hypotheses.length}`,
  );
  if (a.suspicion.elevated.length) {
    out.push("LARM (deterministiskt):");
    for (const row of a.suspicion.elevated) {
      out.push(`- [[TNR${row.tnr}]] ${row.tidpunkt.slice(0, 16)} ${placeLabel(row.plats, nicks)} — ${reasonPhrases(row.reasons).join(", ")} (${suspicionLevel(row.score)})`);
    }
  }
  const recurring = a.jobA.entities.filter((e) => e.count >= 2);
  if (recurring.length) {
    out.push("ÅTERKOMMANDE FORDON:");
    for (const e of recurring) {
      const obs = e.observations.map((o) => `[[TNR${o.tnr}]]`).join(" ");
      out.push(`- ${e.canonical} (${e.count} obs): ${obs}`);
    }
  }
  const hot = a.locations.filter((c) => c.elevatedCount > 0).slice(0, 8);
  if (hot.length) {
    out.push("HETA PLATSER:");
    for (const c of hot) out.push(`- ${placeLabel(c.label, nicks)}: ${c.elevatedCount} larm / ${c.reports.length} rapporter`);
  }
  return out.join("\n");
}

/** The COMPLETE in-range roster (nothing dropped — operator requirement:
 *  the pattern may hide in messages the deterministic layer scored 0) plus
 *  the deterministic findings as orientation. Chunked per day only when the
 *  whole digest exceeds `maxChars` (the computed context budget). */
export function buildLlmDigest(a: RangeAnalysis, state: PluginState, maxChars: number): DigestPlan {
  const nicks = state.locationNicknames;
  const sorted = [...a.reports].sort((x, y) => x.tidpunkt.localeCompare(y.tidpunkt) || x.tnr.localeCompare(y.tnr));
  const roster = sorted.map((r) => rosterLine(r, nicks));
  const head = findingsTables(a, state);
  const full = `${head}\n\nALLA MEDDELANDEN I PERIODEN (fullständig lista):\n${roster.join("\n")}`;
  if (full.length <= maxChars) return { chunked: false, text: full };

  // Per-day chunks; the findings tables ride only with the synthesis step, so
  // each chunk is pure roster + its day label.
  const byDay = new Map<string, string[]>();
  for (const r of sorted) {
    const day = r.tidpunkt.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(rosterLine(r, nicks));
  }
  const chunks = [...byDay.entries()].map(([day, lines]) => ({
    label: day,
    text: `DYGN: ${day}\nMEDDELANDEN:\n${lines.join("\n")}`,
  }));
  return { chunked: true, chunks };
}

export const HYPOTHESIS_SYS =
  "Du är ODEN:s analysassistent. Du får ett deterministiskt underlag för en vald tidsperiod: " +
  "först ODEN:s egna fynd (larm, återkommande fordon, heta platser), därefter ALLA meddelanden i " +
  "perioden — även de som inte utlöst något. Din uppgift är att föreslå MÖNSTERHYPOTESER som " +
  "operatören ska VERIFIERA: tidsmönster, rumsliga mönster, tecken på samordning mellan " +
  "observationer, och avvikelser. Leta särskilt efter mönster bland de oflaggade meddelandena. " +
  "Regler: (1) Du hittar ALDRIG på fakta — varje påstående måste stödjas av rader i underlaget. " +
  "(2) Varje hypotes MÅSTE citera sina källor i formatet [[TNR123456]] exakt som de står i " +
  "underlaget — skriv aldrig om, förkorta eller hitta på TNR-nummer. " +
  '(3) Skriv 2–5 hypoteser som punktlista: "- **Hypotes (tidsmönster|rumsligt|samordning|avvikelse):** ' +
  'en mening. Evidens: [[TNR…]], [[TNR…]]". ' +
  "(4) Hypoteserna är förslag att verifiera, inte fakta. " +
  "(5) Svara ENDAST med punktlistan, på svenska, högst 200 ord.";

export const CHUNK_SYS =
  "Du är ODEN:s analysassistent. Du får ett deterministiskt dygnsunderlag (alla meddelanden det " +
  "dygnet). Lista de högst 3 viktigaste mönstren eller avvikelserna i JUST detta dygn, som korta " +
  "punkter med källor i formatet [[TNR123456]] exakt som de står. Hitta ALDRIG på fakta eller " +
  "TNR-nummer. Svara ENDAST med punktlistan, på svenska, högst 80 ord.";

export const SYNTH_SYS =
  "Du är ODEN:s analysassistent. Du får dygnsvisa mönsterpunkter (redan källhänvisade med " +
  "[[TNR…]]) från en längre period, samt ODEN:s deterministiska fynd. Väg samman dem till 2–5 " +
  "PERIODÖVERGRIPANDE mönsterhypoteser (tidsmönster, rumsliga mönster, samordning, avvikelser) " +
  "för operatören att verifiera. Behåll källhänvisningarna exakt. Hitta ALDRIG på fakta eller " +
  'TNR-nummer. Format: "- **Hypotes (typ):** en mening. Evidens: [[TNR…]]". Svenska, högst 200 ord.';

/** Tier-2 model preference — MEASURED (docs/REPORT_VALIDATION.md, 2026-09-04):
 *  the qwen3-vl tags Ollama ships are the THINKING variants and ignore
 *  think:false — on a 9.5k-token analytical prompt, 4b and 8b spent their
 *  entire output budget reasoning and returned EMPTY content. The text-family
 *  qwen3 honors think:false: qwen3:32b delivered 5 cited hypotheses in 59 s
 *  and pointed at 2 of 3 planted cells (incl. the infiltration cell); 8b is
 *  marginal (one cell-pointing hypothesis, zero hallucinations, but noisy
 *  citation-spam); 4b TEXT leaked English chain-of-thought into content and
 *  never produced a hypothesis — dropped from the ladder (14b is unmeasured
 *  but sits between two measured points). Fall back to the vision model,
 *  which then yields an honest failure line rather than silence. */
export const DEEP_TEXT_MODELS = ["qwen3:32b", "qwen3:14b", "qwen3:8b"];

export function pickDeepModel(available: readonly string[], visionModel: string): string {
  for (const m of DEEP_TEXT_MODELS) if (available.includes(m)) return m;
  return visionModel;
}

/** Format gate: did the model actually answer in the demanded shape? A weak
 *  model can leak chain-of-thought prose into content (measured: qwen3:4b) —
 *  that must become the failure line, never operator-facing rambling. */
export function looksLikeHypotheses(text: string): boolean {
  return /\*\*Hypotes/.test(text) && /\[\[TNR|okänd källa/.test(text);
}

/** Single user message with the TASK AT THE END — measured requirement: with
 *  instructions first (system role), the model lost the task behind the long
 *  roster and produced nothing usable. Data first, then UPPGIFT. */
export function buildDeepPrompt(digestText: string, sys: string): string {
  return `${digestText}\n\n---\nUPPGIFT:\n${sys}`;
}

/** Inverse citation guard: any [[TNR…]] the model produced that is NOT in the
 *  range's TNR set is de-linked and flagged — an invented citation must never
 *  become a clickable link. Complements conversation.ts ensureCitations. */
export function sanitizeHypotheses(prose: string, allowedTnrs: ReadonlySet<string>): { text: string; invented: string[] } {
  const invented: string[] = [];
  const text = prose.replace(/\[\[TNR(\d+(?:_\d+)?)(?:\|[^\]]*)?\]\]/g, (whole, tnr: string) => {
    if (allowedTnrs.has(tnr)) return whole;
    invented.push(tnr);
    return `TNR${tnr} (okänd källa — kontrollera)`;
  });
  return { text, invented };
}

// --- Tier-1 note -----------------------------------------------------------------

export const DEEP_PLACEHOLDER = "_Djupanalys pågår… (lokal modell)_";

export function deepFailureText(): string {
  return "_Djupanalysen misslyckades (Ollama otillgänglig eller timeout). Rapporten ovan är komplett utan den._";
}

export interface ReportNoteInput {
  analysis: RangeAnalysis;
  state: PluginState;
  /** Photo findings for in-range reports, assembled by the shell from caches. */
  photoRows: { file: string; tnr: string; labels: string[] }[];
  /** Set when djupanalys was requested — renders the placeholder section. */
  deep?: { model: string; promptV: string; numCtx: number; numCtxWhy: string };
  /** Deep requested but unavailable (Ollama down) — honest section text. */
  deepUnavailable?: boolean;
  generatedAt: string;
  operationName: string;
  build: string;
}

const cite = (file: string, tnr: string) => `[[${noteStem(file)}|TNR${mdText(tnr)}]]`;

export function buildTier1Report(i: ReportNoteInput): string {
  const a = i.analysis;
  const s = i.state;
  const nicks = s.locationNicknames;
  const out: string[] = [];

  out.push(`# Analys ${a.range.label}`);
  out.push("");
  out.push(
    `**Sammanfattning:** ${a.reports.length} rapporter · ${a.suspicion.elevated.length} larm · ` +
      `${a.jobA.entities.length} identifierade fordon · ${a.actors.hypotheses.length} aktörsförslag · ` +
      `${a.locations.filter((c) => c.elevatedCount > 0).length} platser med misstänkt aktivitet.`,
  );

  out.push("", "## Larm");
  const larm = [...a.suspicion.elevated].sort((x, y) => y.score - x.score);
  if (!larm.length) out.push("_Inga larm i perioden._");
  for (const row of larm) {
    out.push(
      `- **${suspicionLevel(row.score)}** ${cite(row.file, row.tnr)} ${mdText(row.tidpunkt.slice(0, 16).replace("T", " "))} — ` +
        `${mdText(placeLabel(row.plats, nicks))} (${reasonPhrases(row.reasons).map(mdText).join(", ")})`,
    );
  }

  out.push("", "## Tidslinje (förhöjda händelser)");
  const chrono = [...a.suspicion.elevated].sort((x, y) => x.tidpunkt.localeCompare(y.tidpunkt));
  if (!chrono.length) out.push("_Inga förhöjda händelser i perioden._");
  for (const row of chrono) {
    out.push(`- ${mdText(row.tidpunkt.slice(0, 16).replace("T", " "))} ${cite(row.file, row.tnr)} — ${mdText(placeLabel(row.plats, nicks))}`);
  }

  out.push("", "## Återkommande fordon");
  const rec = a.jobA.entities.filter((e) => e.count >= 2);
  if (!rec.length) out.push("_Inga återkommande fordon i perioden._");
  for (const e of rec) {
    const obs = e.observations.map((o) => cite(o.file, o.tnr)).join(", ");
    out.push(`- **${mdText(e.canonical)}** — ${e.count} observationer: ${obs}`);
  }
  if (a.recurrences.pairs.length) {
    for (const p of a.recurrences.pairs) {
      out.push(`  - ${mdText(p.entityLabel)} återkom ${p.count}× vid ${mdText(p.placeLabel)}`);
    }
  }

  out.push("", "## Aktörer");
  const confirmed = a.actors.hypotheses.filter((h) => s.actorDecisions[h.id] === "confirmed");
  const pendingActors = a.actors.hypotheses.filter((h) => !s.actorDecisions[h.id]).length;
  if (!confirmed.length) out.push("_Inga bekräftade aktörer i perioden._");
  for (const h of confirmed) {
    const name = s.actorNames[h.id];
    out.push(
      `- **${mdText(name ?? `${h.vehicleCount} fordon + ${h.markCount} kännetecken`)}** — ` +
        `${h.chain.length} meddelanden ${mdText(h.firstSeen.slice(0, 10))}–${mdText(h.lastSeen.slice(0, 10))}`,
    );
  }
  if (pendingActors > 0) out.push(`- _${pendingActors} förslag väntar på granskning i panelen._`);

  out.push("", "## Kännetecken");
  const marks = a.jobB.nominations.filter((n) => s.markDecisions[n.signature] === "confirmed");
  const pendingMarks = a.jobB.nominations.filter((n) => !s.markDecisions[n.signature]).length;
  if (!marks.length) out.push("_Inga bekräftade kännetecken i perioden._");
  for (const n of marks) out.push(`- **${mdText(n.label)}** — ${n.count} observationer`);
  if (pendingMarks > 0) out.push(`- _${pendingMarks} förslag väntar på granskning._`);

  out.push("", "## Platser");
  const places = [...a.locations].sort((x, y) => y.elevatedCount - x.elevatedCount || y.reports.length - x.reports.length).slice(0, 12);
  if (!places.length) out.push("_Inga relevanta platser i perioden._");
  for (const c of places) {
    const hot = c.elevatedCount > 0 ? ` — **${c.elevatedCount} larm**` : "";
    out.push(`- ${mdText(placeLabel(c.label, nicks))}: ${c.reports.length} rapporter${hot}`);
  }

  out.push("", "## Bildfynd");
  if (!i.photoRows.length) out.push("_Inga bildfynd i perioden._");
  for (const p of i.photoRows) out.push(`- ${cite(p.file, p.tnr)}: ${p.labels.map(mdText).join("; ")}`);

  return out.join("\n");
}

export function renderReportNote(i: ReportNoteInput): string {
  const a = i.analysis;
  const fm = [
    "---",
    "typ: analysrapport",
    "källa: 7s-plugin",
    "generator: 7s-plugin",
    `period-fran: "${a.range.from}"`,
    `period-till: "${a.range.to}"`,
    `skapad: "${i.generatedAt}"`,
    `rapporter: ${a.reports.length}`,
    `modell: "${i.deep ? i.deep.model : "-"}"`,
    `promptversion: "${i.deep ? i.deep.promptV : "-"}"`,
    "tags: [analysrapport]",
    "---",
  ];

  const provenance: string[] = ["", "## Underlag", ""];
  provenance.push(`- **Period:** ${a.range.label} (inklusive)`);
  provenance.push(`- **Rapporter i underlaget:** ${a.reports.length}`);
  provenance.push(`- **Genererad:** ${mdText(i.generatedAt)} · ODEN ${mdText(i.build)}${i.operationName ? ` · operation ${mdText(i.operationName)}` : ""}`);
  if (i.deep) {
    provenance.push(`- **Djupanalys:** modell ${mdText(i.deep.model)}, promptversion ${i.deep.promptV}, kontextfönster ${i.deep.numCtx} (${mdText(i.deep.numCtxWhy)})`);
  }
  provenance.push(
    "- **Gradering i E19-listan:** tillförlitlighet sätts alltid till F (maskinen bedömer inte källor); " +
      "sakriktighet 2 = oberoende samstämmighet (annan sagesman eller foto), 3 = samstämmighet från samma sagesman, " +
      "6 = kan ej bedömas. Aldrig 1/4/5 automatiskt — justera själv i listan.",
  );
  provenance.push(
    "- _Obs: entiteter och aktörer är beräknade enbart på periodens rapporter — ett aktörsförslag kan " +
      "därför skilja sig från panelens (som ser hela korpusen)._",
  );
  const sorted = [...a.reports].sort((x, y) => x.tidpunkt.localeCompare(y.tidpunkt));
  provenance.push(`- **Meddelanden:** ${sorted.map((r) => cite(r.file, r.tnr)).join(", ")}`);

  const deepSection: string[] = ["", "## Djupanalys (mönsterhypoteser)", ""];
  if (i.deep) {
    deepSection.push("_Föreslagen-av: llm — hypoteser att verifiera, inte fakta._", "", DEEP_PLACEHOLDER);
  } else if (i.deepUnavailable) {
    deepSection.push("_Ej tillgänglig (Ollama nere eller modellen saknas) — rapporten ovan är komplett utan den._");
  } else {
    deepSection.push("_Ej begärd._");
  }

  return fm.join("\n") + "\n\n" + buildTier1Report(i) + provenance.join("\n") + "\n" + deepSection.join("\n") + "\n";
}

/** "Analys 2026-09-01–2026-09-05.md"; collision → " (2)", " (3)"… */
export function reportFilename(range: DateRange, taken: (name: string) => boolean): string {
  const base = `Analys ${range.from.slice(0, 10)}–${range.to.slice(0, 10)}`;
  let name = `${base}.md`;
  for (let n = 2; taken(name); n++) name = `${base} (${n}).md`;
  return name;
}

// --- E19 collation export ----------------------------------------------------------

export interface E19Row {
  lopnummer: string;
  tnr: string;
  stund: string;
  plats: string;
  mgrs: string;
  struktureringsbegrepp: "Händelse";
  handelsebeskrivning: string;
  tillforlitlighet: "F";
  sakriktighet: "2" | "3" | "6";
  refUndbehov: "";
  kalla: string;
  diarienr: "";
}

const MGRS_IN_TEXT = /\b\d{1,2}[C-X][A-Z]{2}\s?\d{2,5}\s?\d{2,5}\b/;

/** Deterministic sakriktighet: 2 when independently corroborated (same full
 *  plate seen EARLIER by a different sagesman, or a photo-corroborated plate —
 *  independent sensor), 3 when only the same sagesman saw it before, else 6.
 *  Never 1/4/5 — those require human judgment ODEN does not fake. */
function gradeSakriktighet(r: Report, all: Report[], photoCorroborated: ReadonlySet<string>): "2" | "3" | "6" {
  if (photoCorroborated.has(r.file)) return "2";
  const plates = plateIdentifiers(r).filter((p) => !p.partial).map((p) => p.value);
  if (!plates.length) return "6";
  let sameSource = false;
  for (const prior of all) {
    if (prior.file === r.file || prior.tidpunkt >= r.tidpunkt) continue;
    const priorPlates = new Set(plateIdentifiers(prior).filter((p) => !p.partial).map((p) => p.value));
    if (!plates.some((p) => priorPlates.has(p))) continue;
    if (prior.sagesman !== r.sagesman) return "2";
    sameSource = true;
  }
  return sameSource ? "3" : "6";
}

/** One row per in-range message, graded against the FULL corpus history
 *  (prior observations outside the range still count as "tidigare information"). */
export function buildE19Rows(
  analysis: RangeAnalysis,
  all: Report[],
  prefix: string,
  photoCorroborated: ReadonlySet<string> = new Set(),
): E19Row[] {
  const sorted = [...analysis.reports].sort((x, y) => x.tidpunkt.localeCompare(y.tidpunkt) || x.tnr.localeCompare(y.tnr));
  return sorted.map((r, idx) => ({
    lopnummer: `${prefix}_${String(idx + 1).padStart(4, "0")}`,
    tnr: r.tnr,
    stund: r.stund ?? "",
    plats: r.plats ?? "",
    mgrs: MGRS_IN_TEXT.exec(r.stalle ?? "")?.[0] ?? "",
    struktureringsbegrepp: "Händelse",
    handelsebeskrivning: (r.handelse ?? "").trim(),
    tillforlitlighet: "F",
    sakriktighet: gradeSakriktighet(r, all, photoCorroborated),
    refUndbehov: "",
    kalla: r.sagesman ?? "",
    diarienr: "",
  }));
}

/** CSV for Swedish Excel: UTF-8 BOM, semicolons, CRLF, quoted fields. */
export function renderE19Csv(rows: E19Row[]): string {
  const q = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
  const header = [
    "Löpnummer", "TNR", "Stund", "Plats", "MGRS", "Struktureringsbegrepp",
    "Händelsebeskrivning", "Tillförlitlighet", "Sakriktighet", "Ref till Undbehov", "Källa", "Diarienr",
  ];
  const lines = [header.map(q).join(";")];
  for (const r of rows) {
    lines.push(
      [r.lopnummer, r.tnr, r.stund, r.plats, r.mgrs, r.struktureringsbegrepp,
        r.handelsebeskrivning, r.tillforlitlighet, r.sakriktighet, r.refUndbehov, r.kalla, r.diarienr]
        .map(q).join(";"),
    );
  }
  return "﻿" + lines.join("\r\n") + "\r\n";
}
