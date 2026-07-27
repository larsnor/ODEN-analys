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
}

export interface FeedRow {
  kind: FeedKind;
  text: string;
  stem: string; // note stem for [[..]] / open
  severity: "larm" | "info" | "review" | "bevakad";
  review?: "actors" | "marks" | "place" | "photos" | "texts";
  place?: string;
  watchKey?: string;
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

/** Dedup by path (keep newest), sort newest-first, label, cap. */
export function buildFeed(items: FeedItem[], limit = 60): FeedRow[] {
  const byPath = new Map<string, FeedItem>();
  for (const it of items) {
    const prev = byPath.get(it.path);
    if (!prev || it.time > prev.time) byPath.set(it.path, it);
  }
  return [...byPath.values()]
    .sort((a, b) => b.time - a.time)
    .slice(0, limit)
    .map((it): FeedRow => ({
      kind: it.kind,
      text: label(it),
      stem: noteStem(it.file ?? it.path),
      severity: it.review ? "review" : it.kind === "larm" ? "larm" : it.kind === "bevakad" ? "bevakad" : "info",
      review: it.review,
      place: it.place,
      watchKey: it.watchKey,
    }));
}
