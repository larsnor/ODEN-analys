/*
 * Place display (pure) — operator nicknames for locations.
 *
 * The MGRS grid stays the stable IDENTITY everywhere (clustering key, note-file
 * hash, links). A nickname is DISPLAY-ONLY metadata the operator adds; it lives
 * in ODEN's settings (keyed by the raw `plats` string), never in message files.
 * Rendering translates a plats → its nickname when one exists; identity does not.
 */
export type Nicknames = Record<string, string>;

// An MGRS grid token, e.g. "33VXF5490371882" (spaces tolerated: "33VXF 54903 71882").
const GRID_RE = /^\d{1,2}[C-X][A-Z][A-Z]\d+$/;

/** Is this plats a bare MGRS grid (i.e. it has no human-friendly name)? */
export function isMgrsGrid(plats: string): boolean {
  return GRID_RE.test((plats ?? "").trim().replace(/\s+/g, ""));
}

/** Friendly label for a plats: the operator's nickname if set, else the raw plats. */
export function placeLabel(plats: string, nicks?: Nicknames): string {
  const key = (plats ?? "").trim();
  const n = nicks?.[key];
  return n && n.trim() ? n.trim() : plats;
}
