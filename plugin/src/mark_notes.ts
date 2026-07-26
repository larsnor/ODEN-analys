/*
 * Mark entity note rendering — mark nomination output, written ONLY after
 * operator confirmation. Pure TS, Obsidian-free.
 *
 * Provenance (two axes): `källa: 7s-plugin` = the plugin wrote the file;
 * `föreslagen-av: deterministisk` + `bekräftad-av: operatör` = deterministic
 * extraction nominated it, a human confirmed it. `metod: jobb-b` (mark
 * nomination) tags the note so per-job pruning never lets a plate re-id run
 * delete it (and vice-versa).
 */
import { markLabel } from "./marks";
import { MarkNomination } from "./jobb";
import { mdText } from "./mdsafe";
import { GENERATOR, METOD, OBJEKTET_STEM, RenderedNote, noteStem } from "./notes_common";

export function markFilename(nom: MarkNomination): string {
  return nom.id.replace(/[\\/:*?"<>|.\s]/g, "_") + ".md";
}

function tnrLink(o: { file: string; tnr: string }): string {
  return `[[${noteStem(o.file)}|TNR${mdText(o.tnr)}]]`;
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
    `metod: ${METOD.jobbB}`,
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
  if (nom.sagesmän.length) body.push(`**Sagesmän:** ${nom.sagesmän.join(", ")}  `);
  // Direct edge to the AOI node — the observation links below point at TNR
  // messages, which the graph filter (-file:TNR) hides; without a non-TNR edge
  // the confirmed mark would be an orphan (showOrphans:false) and never show.
  body.push(`**Operationsområde:** [[${OBJEKTET_STEM}]]`);
  body.push("");
  body.push("## Observationer");
  for (const m of nom.members) {
    body.push(`- ${tnrLink(m)} — ${mdText(m.tidpunkt)} — ${mdText(m.plats)}`);
  }
  body.push("");
  body.push(
    "_Bekräftad av operatör. Föreslagen av ODEN utifrån återkommande " +
      "beskrivningar. Ett kännetecken är en mänsklig bedömning — inte en säker " +
      "ID-match._",
  );

  return { filename: markFilename(nom), markdown: fm + "\n\n" + body.join("\n") + "\n" };
}
