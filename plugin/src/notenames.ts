/*
 * Readable, filesystem-safe note basenames for agent nodes (pure).
 *
 * Obsidian's graph shows the file BASENAME as the node label, so names must be
 * human-readable ("Misstänkt fordon RJK241") — not internal keys. We keep Swedish
 * letters, spaces and commas and strip characters Obsidian/the OS forbid in
 * filenames. Normal-length names are used verbatim (clean). Only when a name is
 * long enough to be TRUNCATED — where the lost tail could make two different
 * descriptions collide — do we append a short deterministic hash of the stable
 * key to keep them distinct.
 */

// Forbidden in filenames: \ / : * ? " < > | and Obsidian's link chars # ^ [ ]
const FORBIDDEN = /[\\/:*?"<>|#^[\]]+/g;

/** djb2 → base36, low 4 digits (they vary most for similar keys). Deterministic
 *  (no Math.random — blocked in tests). */
function shortHash(key: string): string {
  let h = 5381;
  for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) >>> 0;
  return h.toString(36).padStart(4, "0").slice(-4);
}

/**
 * A readable `.md` basename from a display string. Clean for normal-length names;
 * a short stable-key hash is appended ONLY when the name had to be truncated.
 * e.g. safeAgentFilename("Aktör RJK241", "fordon:RJK241") → "Aktör RJK241.md"
 */
export function safeAgentFilename(display: string, key: string, max = 72): string {
  const clean = display.replace(FORBIDDEN, " ").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return `${clean}.md`;
  return `${clean.slice(0, max).trim()}… (${shortHash(key)}).md`;
}
