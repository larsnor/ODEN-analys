/*
 * Actor-node rendering — §6.4, written ONLY after operator confirmation.
 * Pure TS, Obsidian-free.
 *
 * The materialized actor node is what the GRAPH then shows: a single node that
 * pulls together the vehicle + cap + bag + logo facets and their message trail.
 * "Grafen visar; pluginet resonerar" — the plugin reasoned the link, the human
 * confirmed it, and now the graph can display it.
 *
 * Provenance (§6.4): källa: 7s-plugin (plugin wrote it), föreslagen-av:
 * deterministisk + bekräftad-av: operatör. metod: aktor tags it for per-job
 * pruning so Job A / Job B runs never touch it.
 */
import { ActorHypothesis } from "./actor";
import { safeAgentFilename } from "./notenames";
import { Nicknames, placeLabel } from "./places";

export const GENERATOR = "7s-plugin";
export const ACTOR_METOD = "aktor";

export interface RenderedNote {
  filename: string;
  markdown: string;
}

/** Readable graph label. The 🕸️ emoji marks the type (the word "Aktör" stays in
 *  metadata only); the label is the operator's name if set, else the facet labels
 *  ("🕸️ RJK241 + ryggsäck"), disambiguated by the stable hypothesis id. */
export function actorFilename(h: ActorHypothesis, name?: string): string {
  const desc = name?.trim() || h.facets.map((f) => f.label).join(" + ") || `${h.vehicleCount}f ${h.markCount}k`;
  return safeAgentFilename(`🕸️ ${desc}`, h.id);
}

function tnrLink(s: { file: string; tnr: string }): string {
  const stem = s.file.replace(/^.*\//, "").replace(/\.md$/, "");
  return `[[${stem}|TNR${s.tnr}]]`;
}

/** Given an observation's raw `plats`, the stem of the location note to link to
 *  (or undefined if that place has no location node). Enables a direct actor↔plats
 *  graph edge that survives message-node filtering. */
export type LocationLinker = (plats: string) => string | undefined;

/** For a place in this actor's chain, the stem of the recurrence node to link
 *  INSTEAD of the location note (when this actor was seen there 2+ times). */
export type RecurrenceLinker = (plats: string) => string | undefined;

export function renderActorNote(
  h: ActorHypothesis,
  label?: string,
  nicks?: Nicknames,
  fileName?: string,
  locStemOf?: LocationLinker,
  recStemOf?: RecurrenceLinker,
): RenderedNote {
  const name = label ?? `${h.vehicleCount} fordon, ${h.markCount} kännetecken`;
  const fm = [
    "---",
    "typ: entitet",
    "slag: aktör",
    `namn: "${name}"`,
    `källa: ${GENERATOR}`,
    `generator: ${GENERATOR}`,
    "föreslagen-av: deterministisk",
    "bekräftad-av: operatör",
    `metod: ${ACTOR_METOD}`,
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
  body.push(`# 🕸️ ${name}`);
  body.push("");
  body.push(h.explanation);
  body.push("");
  body.push("## Facetter");
  for (const f of h.facets) {
    // Link to each facet's own entity note (vehicle or mark) by its stem.
    body.push(`- **${f.kind === "fordon" ? "Fordon" : "Kännetecken"}:** [[${f.noteStem}|${f.label}]]`);
  }
  body.push("");
  body.push("## Evidenskedja (inget enskilt meddelande binder alla kännetecken)");
  for (const step of h.chain) {
    // Link the place to its location note → a direct actor↔plats graph edge; keep
    // the message link (tnrLink) for traceability. If the actor recurs at this
    // place, route through the recurrence node instead (one labelled hop).
    const stem = recStemOf?.(step.plats) ?? locStemOf?.(step.plats);
    const place = stem ? `[[${stem}|${placeLabel(step.plats, nicks)}]]` : placeLabel(step.plats, nicks);
    body.push(`- ${tnrLink(step)} — ${step.tidpunkt} — ${place} — _kopplar:_ ${step.facets.join(" + ")}`);
  }
  body.push("");
  body.push(
    "_Föreslagen av ODEN, bekräftad av operatör. ODEN härledde kopplingen; " +
      "operatören bekräftade den. Det är en preliminär koppling — granska " +
      "evidenskedjan ovan._",
  );

  return { filename: actorFilename(h, fileName), markdown: fm.join("\n") + "\n\n" + body.join("\n") + "\n" };
}
