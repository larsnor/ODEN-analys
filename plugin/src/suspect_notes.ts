/*
 * Suspect marker notes (pure) — ONE note per suspicious AGENT (vehicle/person),
 * placed at its most recent observation. This is what appears on the map + graph
 * (red via the `#larm` rule): the popup shows the AGENT, not an abstract "alarm".
 *
 * Provenance: källa/generator: 7s-plugin, metod: larm (per-job pruned). The level
 * (Hög/Förhöjd/…) lives HERE (frontmatter `nivå` + a line), not in the feed/log.
 */
import { Suspect } from "./suspects";
import { safeFilename } from "./entity_notes";
import { safeAgentFilename } from "./notenames";
import { mdText } from "./mdsafe";
import { GENERATOR, METOD, RenderedNote, StemLinker, noteStem } from "./notes_common";
import { Nicknames, placeLabel } from "./places";

/** Readable graph label ("⚠️ RJK241"), disambiguated by agent key. The ⚠️ emoji
 *  marks the type (kind stays in the `agent:` metadata, not the note name). */
export function suspectFilename(s: Suspect): string {
  return safeAgentFilename(`⚠️ ${s.label}`, s.key);
}

export function renderSuspectNote(s: Suspect, nicks?: Nicknames, locStemOf?: StemLinker): RenderedNote {
  const latest = s.obs[s.obs.length - 1];
  const kindWord = s.kind === "fordon" ? "fordon" : "person";
  const name = s.label;

  const fm: string[] = [
    "---",
    "typ: misstänkt",
    `källa: ${GENERATOR}`,
    `generator: ${GENERATOR}`,
    `metod: ${METOD.larm}`,
    "tags: [larm]",
    `agent: ${kindWord}`,
    `namn: "${s.label.replace(/"/g, "'")}"`,
    `nivå: ${s.level}`,
    `antal_observationer: ${s.obs.length}`,
  ];
  if (latest?.lat !== undefined && latest?.lon !== undefined) {
    fm.push(`lat: ${latest.lat}`, `lon: ${latest.lon}`, `location: "${latest.lat},${latest.lon}"`);
  }
  fm.push("---");

  const body: string[] = [];
  body.push(`# ⚠️ ${mdText(name)}`);
  body.push("");
  body.push(`**Bedömd nivå:** ${s.level}  `);
  body.push(`**Antal observationer:** ${s.obs.length}  `);
  body.push(`**Tidsspann:** ${mdText(s.firstSeen)} → ${mdText(s.lastSeen)}`);
  // A vehicle suspect links straight to its vehicle entity node → a direct
  // larm↔fordon edge (keeps the larm node connected when messages are hidden).
  if (s.kind === "fordon") body.push(`  \n**Fordon:** [[${safeFilename(s.label).replace(/\.md$/, "")}|${mdText(s.label)}]]`);
  body.push("");
  body.push("## Observationer");
  for (const o of s.obs) {
    const stem = noteStem(o.file);
    // Keep the message link (traceability) AND link the place directly → the larm
    // node stays in the graph (via a plats edge) even with TNR nodes filtered out.
    const locStem = locStemOf?.(o.plats);
    const lbl = mdText(placeLabel(o.plats, nicks));
    const place = locStem ? `[[${locStem}|${lbl}]]` : lbl;
    body.push(`- [[${stem}|TNR${mdText(o.tnr)}]] — ${mdText(o.tidpunkt)} — ${place}`);
  }
  body.push("");
  body.push(
    "_Misstänkt agent. Verifiera i ODEN-panelen för att skapa en bekräftad aktör. " +
      "Avförs automatiskt om aktiviteten avtar._",
  );

  return { filename: suspectFilename(s), markdown: fm.join("\n") + "\n\n" + body.join("\n") + "\n" };
}

export function renderSuspectNotes(suspects: Suspect[], nicks?: Nicknames, locStemOf?: StemLinker): RenderedNote[] {
  return [...suspects]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((s) => renderSuspectNote(s, nicks, locStemOf));
}
