/*
 * Mark entity note rendering — Job B, written ONLY after operator confirmation
 * (PLUGIN_DESIGN §5, §6.1, §6.4). Pure TS, Obsidian-free.
 *
 * Provenance (two axes, §6.4): `källa: 7s-plugin` = the plugin wrote the file;
 * `föreslagen-av: deterministisk` + `bekräftad-av: operatör` = deterministic
 * extraction nominated it, a human confirmed it. `metod: jobb-b` tags the note
 * so per-job pruning never lets a Job A run delete it (and vice-versa).
 */
import { markLabel } from "./marks";
import { MarkNomination } from "./jobb";

export const GENERATOR = "7s-plugin";
export const JOBB_METOD = "jobb-b";

export interface RenderedNote {
  filename: string;
  markdown: string;
}

export function markFilename(nom: MarkNomination): string {
  return nom.id.replace(/[\\/:*?"<>|.\s]/g, "_") + ".md";
}

function tnrLink(o: { file: string; tnr: string }): string {
  const stem = o.file.replace(/^.*\//, "").replace(/\.md$/, "");
  return `[[${stem}|TNR${o.tnr}]]`;
}

/** Render a CONFIRMED mark nomination as a provenance-marked entity note. */
export function renderMarkNote(nom: MarkNomination): RenderedNote {
  const label = markLabel(nom.object, nom.canonicalAttrs);
  const fm = [
    "---",
    "typ: entitet",
    "slag: kannetecken",
    `kategori: ${nom.object}`,
    `namn: "${label}"`,
    `signatur: "${nom.signature}"`,
    `källa: ${GENERATOR}`,
    `generator: ${GENERATOR}`,
    "föreslagen-av: deterministisk",
    "bekräftad-av: operatör",
    `metod: ${JOBB_METOD}`,
    `antal_observationer: ${nom.count}`,
    `forsta_observation: "${nom.firstSeen}"`,
    `sista_observation: "${nom.lastSeen}"`,
    "taggar: [kännetecken]",
    "---",
  ].join("\n");

  const body: string[] = [];
  body.push(`# ${label}`);
  body.push("");
  body.push(`**Kategori:** ${nom.object}  `);
  body.push(`**Antal observationer:** ${nom.count}  `);
  body.push(`**Tidsspann:** ${nom.firstSeen} → ${nom.lastSeen}  `);
  if (nom.sagesmän.length) body.push(`**Sagesmän:** ${nom.sagesmän.join(", ")}`);
  body.push("");
  body.push("## Observationer");
  for (const m of nom.members) {
    body.push(`- ${tnrLink(m)} — ${m.tidpunkt} — ${m.plats}`);
  }
  body.push("");
  body.push(
    "_Bekräftad av operatör. Föreslagen av ODEN utifrån återkommande " +
      "beskrivningar. Ett kännetecken är en mänsklig bedömning — inte en säker " +
      "ID-match._",
  );

  return { filename: markFilename(nom), markdown: fm + "\n\n" + body.join("\n") + "\n" };
}
