/*
 * §7.2 — alerts-with-pointer (pure TS, Obsidian-free).
 *
 * Turns the current analysis state into alert items, each with a TEXT POINTER to
 * where the operator should look in Obsidian's existing graph / Map View / the
 * report. The plugin NEVER opens or drives those views (§7.3) — it only points.
 *
 * The watcher (main.ts) diffs these items against a persisted "seen" set so only
 * genuinely NEW activity raises a notice — no flood from the existing corpus.
 */
import { SuspicionAnalysis } from "./suspicion";
import { JobBResult } from "./jobb";
import { ActorResult } from "./actor";
import { JobAResult } from "./reid";
import { Report } from "./parse";
import { reasonPhrases } from "./present";
import { noteStem } from "./notes_common";
import { Nicknames, placeLabel } from "./places";

export type AlertKind = "förhöjd" | "aktör" | "märke" | "fordon";

export interface Alert {
  /** Stable key for the seen-set (alert once per item). */
  key: string;
  kind: AlertKind;
  title: string;
  /** Where to look — §7.2. Describes clicks; never performs them. */
  pointer: string;
  citations: string[]; // note stems for [[..]] links
  rank: number; // higher = more salient (for ordering / notice priority)
}

export interface AnalysisBundle {
  reports: Report[];
  suspicion: SuspicionAnalysis;
  jobB: JobBResult;
  actors: ActorResult;
  jobA: JobAResult;
}

/** Compute all current alert-worthy items (deterministic). */
export function computeAlertItems(b: AnalysisBundle, nicks?: Nicknames): Alert[] {
  const out: Alert[] = [];

  // Elevated observations — the directly-actionable pointer (the report + the
  // Map View location both already exist, no build step needed).
  for (const r of b.suspicion.elevated) {
    const s = noteStem(r.file);
    const near = r.reasons.some((x) => x.key === "proximity" && x.weight === 3);
    const place = placeLabel(r.plats, nicks);
    out.push({
      key: `förhöjd:${r.file}`,
      kind: "förhöjd",
      title: `Misstänkt aktivitet${near ? " — nära objektet" : ""} — ${place}`,
      pointer:
        `Öppna [[${s}|TNR${r.tnr}]] (${r.tidpunkt}, ${r.sagesman}). ` +
        `I Map View: zooma till "${place}". Skäl: ${reasonPhrases(r.reasons).join(", ")}.`,
      citations: [s],
      rank: 100 + r.score,
    });
  }

  // Actor candidates — node appears in the graph after confirmation.
  for (const h of b.actors.hypotheses) {
    out.push({
      key: `aktör:${h.id}`,
      kind: "aktör",
      title: `Aktörsförslag: ${h.vehicleCount} fordon + ${h.markCount} kännetecken`,
      pointer:
        "Granska aktörsförslagen i ODEN-panelen och bekräfta; " +
        "aktörsnoden visas sedan i grafvyn.",
      citations: h.chain.slice(0, 6).map((c) => noteStem(c.file)),
      rank: 80 + h.facets.length,
    });
  }

  // Recurring descriptive marks.
  for (const n of b.jobB.nominations) {
    out.push({
      key: `märke:${n.signature}`,
      kind: "märke",
      title: `Återkommande kännetecken: ${n.label} (${n.count} observationer)`,
      pointer:
        "Granska kännetecken-förslagen i ODEN-panelen och bekräfta; " +
        "därefter syns kännetecken-noden i grafen.",
      citations: n.members.slice(0, 6).map((m) => noteStem(m.file)),
      rank: 60 + n.count,
    });
  }

  // Recurring vehicles (same registration plate).
  for (const e of b.jobA.entities.filter((e) => e.count > 1)) {
    out.push({
      key: `fordon:${e.canonical}`,
      kind: "fordon",
      title: `Återkommande fordon ${e.canonical} (${e.count} observationer)`,
      pointer:
        `Noden [[${e.canonical}]] länkar alla observationer i grafen; ` +
        "på kartan visas observationsplatserna.",
      citations: e.observations.slice(0, 6).map((o) => noteStem(o.file)),
      rank: 40 + e.count,
    });
  }

  out.sort((a, b2) => b2.rank - a.rank || a.key.localeCompare(b2.key));
  return out;
}

/** Items not present in the seen-set = genuinely new (for the watcher). */
export function newAlerts(items: Alert[], seen: Record<string, unknown>): Alert[] {
  return items.filter((a) => !(a.key in seen));
}

const KIND_ICON: Record<AlertKind, string> = { förhöjd: "⚠️", aktör: "🕸️", märke: "🎒", fordon: "🚗" };

/** Render a set of alerts as Markdown (for the panel / the "Larm" view). */
export function alertsToMarkdown(items: Alert[], heading = "Larm", note?: string): string {
  const lines: string[] = [`# ODEN — ${heading}`, ""];
  if (note) lines.push(note, "");
  if (items.length === 0) {
    lines.push("_Inga larm._");
    return lines.join("\n");
  }
  for (const a of items) {
    lines.push(`- ${KIND_ICON[a.kind]} **${a.title}**`);
    lines.push(`  - ${a.pointer}`);
  }
  lines.push("");
  lines.push("_ODEN pekar mot var du ska titta — du klickar själv i graf och karta._");
  return lines.join("\n");
}
