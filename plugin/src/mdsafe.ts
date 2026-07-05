/*
 * Markdown-injection safety for attacker-controlled report text.
 *
 * 7S reports arrive from an external intake, so every report field is
 * attacker-controlled. When report text is interpolated into Markdown that ODEN
 * then RENDERS - the query panel (MarkdownRenderer.render) and owned notes opened
 * in Reading view - a crafted value like `![x](https://evil.example/p.png)` makes
 * Obsidian fetch a remote image: a network beacon that punctures the offline
 * guarantee, plus link/embed spoofing. (Obsidian strips raw HTML, so this is about
 * network EGRESS + link injection, not script execution.)
 *
 * `mdText` drops control characters and backslash-escapes the structural characters
 * of Markdown links/images/embeds/wikilinks/tags, so the value renders as literal
 * text in BOTH plain-text and [[...|alias]] contexts (a backslash between two ]
 * also stops a crafted ]] from closing a wikilink early). Legitimate field values
 * (plates, place names, ISO timestamps, clothing prose) contain none of these
 * characters and pass through unchanged; only an injection attempt shows visible
 * backslashes. This is the single escaping boundary - apply it wherever a
 * report-derived string is interpolated into a note body or a query answer.
 */

/** Escape report-derived text before it enters RENDERED Markdown. */
export function mdText(s: string | undefined): string {
  let out = "";
  for (const ch of s ?? "") {
    const c = ch.codePointAt(0) ?? 0;
    out += c < 0x20 || c === 0x7f ? " " : ch; // control chars / newlines -> space
  }
  return out.replace(/([\\`[\]()!<>|#])/g, "\\$1"); // links/images/embeds/wikilinks/tags/code/html
}
