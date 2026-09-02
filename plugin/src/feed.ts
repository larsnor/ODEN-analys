/*
 * Live event/alarm feed (pure) — DERIVED from what already exists in the vault
 * (reports + ODEN's own entity/larm notes). No separate log is written; the feed
 * is recomputed each render. Operator language only (no architecture meta).
 *
 * main.ts gathers raw FeedItem[] from the analysis bundle (each carries an
 * observation time in ms) and calls buildFeed() to dedup, sort newest-first,
 * label, and cap.
 */
import { noteStem } from "./notes_common";

export type FeedKind =
  | "mottaget"
  | "fordon"
  | "kännetecken"
  | "aktör"
  | "larm"
  | "bevakad"
  | "bildanalys"
  | "textanalys"
  | "förslag-aktör"
  | "förslag-märke"
  | "förslag-bild"
  | "förslag-text"
  | "namnge-plats";

export interface FeedItem {
  /** Vault path of the file this event refers to (the click target). */
  path: string;
  kind: FeedKind;
  /** Sort key — observation time in ms (Date.parse of tidpunkt). */
  time: number;
  tnr?: string;
  plats?: string;
  label?: string; // entity/actor display name
  count?: number; // observations for an entity
  level?: string; // larm severity word (Hög/Förhöjd/Att bevaka)
  reasons?: string[]; // larm reasons (already operator-phrased)
  pending?: number; // number of suggestions awaiting review
  /** Clicking a suggestion row opens a review screen / action instead of a note. */
  review?: "actors" | "marks" | "place" | "photos" | "texts";
  /** For a "namnge-plats" row: the MGRS grid to name. */
  place?: string;
  /** Vehicle has ≥1 photo-corroborated plate observation. */
  photo?: boolean;
  /** Click-target override when `path` is synthetic (e.g. a transient
   *  "bildanalys" row keyed `bildanalys:<file>` so it never dedups away the
   *  report's own larm row) — the real vault path to open. */
  file?: string;
  /** For a "bevakad" row: the watchlist key — clicking marks the activity seen
   *  (baseline reset) in addition to opening the entity note. */
  watchKey?: string;
  /** Path of the item this row hangs UNDER (e.g. a larm under its report's
   *  "mottaget" row). The child renders indented directly below its parent; an
   *  orphan (parent deduped/capped away) falls back to a normal top-level row. */
  parentPath?: string;
}

export interface FeedRow {
  kind: FeedKind;
  text: string;
  stem: string; // note stem for [[..]] / open
  severity: "larm" | "info" | "review" | "bevakad";
  review?: "actors" | "marks" | "place" | "photos" | "texts";
  place?: string;
  watchKey?: string;
  /** Render indented under the row above (a derived event hanging under its
   *  message's arrival row). */
  child?: boolean;
  /** REAL vault path of the report behind this row — only for report-backed
   *  kinds (mottaget, larm), where path-keyed actions (operator larmflagga)
   *  need the full path rather than the display stem. */
  file?: string;
  tnr?: string;
}

function label(item: FeedItem): string {
  switch (item.kind) {
    case "mottaget":
      return `Meddelande TNR${item.tnr} mottaget${item.plats ? " — " + item.plats : ""}`;
    case "fordon":
      return `Fordon ${item.label} identifierat${item.count ? ` (${item.count} observationer)` : ""}${item.photo ? " 📷" : ""}`;
    case "kännetecken":
      return `Kännetecken bekräftat: ${item.label}`;
    case "aktör":
      return `Aktör bekräftad: ${item.label}`;
    case "larm":
      return `⚠ Misstänkt aktivitet${item.plats ? " — " + item.plats : ""}${item.reasons && item.reasons.length ? " (" + item.reasons.join(", ") + ")" : ""}`;
    case "bevakad":
      return `🔭 Bevakad: ${item.label} — +${item.count} nya observationer`;
    case "bildanalys":
      return `📷 Bild mottagen, analys startad — TNR${item.tnr}${item.plats ? " — " + item.plats : ""}`;
    case "textanalys":
      return `📝 Meddelande mottaget, analyseras — TNR${item.tnr}${item.plats ? " — " + item.plats : ""}`;
    case "förslag-aktör":
      return `🔗 ${item.pending} aktörsförslag att granska →`;
    case "förslag-märke":
      return `🎒 ${item.pending} kopplingsförslag att granska →`;
    case "förslag-bild":
      return `📷 ${item.pending} bildfynd att granska →`;
    case "förslag-text":
      return `📝 ${item.pending} textfynd att granska →`;
    case "namnge-plats":
      return `📍 Namnge plats ${item.place} →`;
  }
}

/** Dedup by path (keep newest), sort newest-first, hang children under their
 *  parents (an alarm indents under its message's arrival row), label. The log
 *  is UNCAPPED by default — the operator's log is the log (the cap parameter
 *  remains for tests/special callers). Rendering is a plain full re-render
 *  (one div + a few closures per row): hundreds of rows are fine; tens of
 *  thousands would need virtualization, which we deliberately don't do yet. */
export function buildFeed(items: FeedItem[], limit = Infinity): FeedRow[] {
  const byPath = new Map<string, FeedItem>();
  for (const it of items) {
    const prev = byPath.get(it.path);
    if (!prev || it.time > prev.time) byPath.set(it.path, it);
  }
  const sorted = [...byPath.values()].sort((a, b) => b.time - a.time);

  // Children attach directly under their parent regardless of sort ties; an
  // orphan (parent missing) degrades to a normal top-level row. Grouping runs
  // BEFORE the cap so a child is never separated from its parent by the limit.
  const childrenOf = new Map<string, FeedItem[]>();
  const top: FeedItem[] = [];
  const present = new Set(sorted.filter((i) => !i.parentPath).map((i) => i.path));
  for (const it of sorted) {
    if (it.parentPath && present.has(it.parentPath)) {
      if (!childrenOf.has(it.parentPath)) childrenOf.set(it.parentPath, []);
      childrenOf.get(it.parentPath)!.push(it);
    } else {
      top.push(it);
    }
  }
  const flat: Array<{ it: FeedItem; child: boolean }> = [];
  for (const it of top) {
    flat.push({ it, child: false });
    for (const c of childrenOf.get(it.path) ?? []) flat.push({ it: c, child: true });
  }

  return flat.slice(0, limit).map(({ it, child }): FeedRow => ({
    kind: it.kind,
    text: label(it),
    stem: noteStem(it.file ?? it.path),
    severity: it.review ? "review" : it.kind === "larm" ? "larm" : it.kind === "bevakad" ? "bevakad" : "info",
    review: it.review,
    place: it.place,
    watchKey: it.watchKey,
    ...(child ? { child: true } : {}),
    ...(it.kind === "mottaget" || it.kind === "larm" ? { file: it.file ?? it.path } : {}),
    ...(it.tnr ? { tnr: it.tnr } : {}),
  }));
}
