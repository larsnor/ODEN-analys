/*
 * Actor-node rendering — written ONLY after operator confirmation.
 * Pure TS, Obsidian-free.
 *
 * The materialized actor node is what the GRAPH then shows: a single node that
 * pulls together the vehicle + cap + bag + logo facets and their message trail.
 * "Grafen visar; pluginet resonerar" — the plugin reasoned the link, the human
 * confirmed it, and now the graph can display it.
 *
 * Provenance: källa: 7s-plugin (plugin wrote it), föreslagen-av:
 * deterministisk + bekräftad-av: operatör. metod: aktor tags it for per-job
 * pruning so plate re-identification / mark nomination runs never touch it.
 */
import { ActorHypothesis } from "./actor";
import { mdText } from "./mdsafe";
import { GENERATOR, METOD, NearLinker, RenderedNote, StemLinker, noteStem } from "./notes_common";
import { safeAgentFilename } from "./notenames";
import { Nicknames, placeLabel } from "./places";

/** Readable graph label. The 🕸️ emoji marks the type (the word "Aktör" stays in
 *  metadata only); the label is the operator's name if set, else the facet labels
 *  ("🕸️ RJK241 + ryggsäck"), disambiguated by the stable hypothesis id. */
export function actorFilename(h: ActorHypothesis, name?: string): string {
  const desc = name?.trim() || h.facets.map((f) => f.label).join(" + ") || `${h.vehicleCount}f ${h.markCount}k`;
  return safeAgentFilename(`🕸️ ${desc}`, h.id);
}

function tnrLink(s: { file: string; tnr: string }): string {
  return `[[${noteStem(s.file)}|TNR${mdText(s.tnr)}]]`;
}

export function renderActorNote(
  h: ActorHypothesis,
  label?: string,
  nicks?: Nicknames,
  fileName?: string,
  locStemOf?: StemLinker,
  recStemOf?: StemLinker,
  nearOf?: NearLinker,
): RenderedNote {
  const name = label ?? `${h.vehicleCount} fordon, ${h.markCount} kännetecken`;
  const fm = [
    "---",
    "typ: entitet",
    "slag: aktör",
    `id: "${h.id}"`,
    `namn: "${name}"`,
    `källa: ${GENERATOR}`,
    `generator: ${GENERATOR}`,
    "föreslagen-av: deterministisk",
    "bekräftad-av: operatör",
    `metod: ${METOD.aktor}`,
    `facetter: ${h.facets.length}`,
    `fordon: ${h.vehicleCount}`,
    `kännetecken: ${h.markCount}`,
    `forsta_observation: "${h.firstSeen}"`,
    `sista_observation: "${h.lastSeen}"`,
  ];
  // Map position for single-agent (suspect-derived) actors → blue on the map.
  if (h.lat !== undefined && h.lon !== undefined) {
    fm.push(`lat: ${h.lat}`, `lon: ${h.lon}`, `location: "${h.lat},${h.lon}"`);
  }
  // NOTE: `tags:` (Obsidian only reads this) — enables the #aktör graph/map colour.
  fm.push("tags: [aktör]", "---");

  const body: string[] = [];
  body.push(`# 🕸️ ${mdText(name)}`);
  body.push("");
  body.push(mdText(h.explanation));
  body.push("");
  body.push("## Facetter");
  for (const f of h.facets) {
    // Link to each facet's own entity note (vehicle or mark) by its stem.
    body.push(`- **${f.kind === "fordon" ? "Fordon" : "Kännetecken"}:** [[${f.noteStem}|${mdText(f.label)}]]`);
  }
  body.push("");
  body.push("## Evidenskedja (inget enskilt meddelande binder alla kännetecken)");
  for (const step of h.chain) {
    // Link the place to its location note → a direct actor↔plats graph edge; keep
    // the message link (tnrLink) for traceability. If the actor recurs at this
    // place, route through the recurrence node instead (one labelled hop).
    const stem = recStemOf?.(step.plats) ?? locStemOf?.(step.plats);
    const lbl = mdText(placeLabel(step.plats, nicks));
    const place = stem ? `[[${stem}|${lbl}]]` : lbl;
    // Dual place relation: also link the predefined place whose vicinity claimed
    // this observation (kept ALONGSIDE the reported place, unless it IS that place).
    const near = nearOf?.(step.file);
    const nearPart = near && near.stem !== stem ? ` _(nära [[${near.stem}|${mdText(near.label)}]])_` : "";
    body.push(`- ${tnrLink(step)} — ${mdText(step.tidpunkt)} — ${place}${nearPart} — _kopplar:_ ${mdText(step.facets.join(" + "))}`);
  }
  body.push("");
  body.push(
    "_Föreslagen av ODEN, bekräftad av operatör. ODEN härledde kopplingen; " +
      "operatören bekräftade den. Det är en preliminär koppling — granska " +
      "evidenskedjan ovan._",
  );

  return { filename: actorFilename(h, fileName), markdown: fm.join("\n") + "\n\n" + body.join("\n") + "\n" };
}
