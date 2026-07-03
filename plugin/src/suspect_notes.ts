/*
 * Suspect marker notes (pure) — ONE note per suspicious AGENT (vehicle/person),
 * placed at its most recent observation. This is what appears on the map + graph
 * (red via the `#larm` rule): the popup shows the AGENT, not an abstract "alarm".
 *
 * Provenance: källa/generator: 7s-plugin, metod: larm (per-job pruned). The level
 * (Hög/Förhöjd/…) lives HERE (frontmatter `nivå` + a line), not in the feed/log.
 */
import { Suspect } from "./suspects";
import { safeAgentFilename } from "./notenames";
import { Nicknames, placeLabel } from "./places";

export const GENERATOR = "7s-plugin";
export const LARM_METOD = "larm";

export interface RenderedNote {
  filename: string;
  markdown: string;
}

/** Readable graph label ("Misstänkt fordon RJK241"), disambiguated by agent key. */
export function suspectFilename(s: Suspect): string {
  const kindWord = s.kind === "fordon" ? "fordon" : "person";
  return safeAgentFilename(`Misstänkt ${kindWord} ${s.label}`, s.key);
}

export function renderSuspectNote(s: Suspect, nicks?: Nicknames): RenderedNote {
  const latest = s.obs[s.obs.length - 1];
  const kindWord = s.kind === "fordon" ? "fordon" : "person";
  const name = `Misstänkt ${kindWord}: ${s.label}`;

  const fm: string[] = [
    "---",
    "typ: misstänkt",
    `källa: ${GENERATOR}`,
    `generator: ${GENERATOR}`,
    `metod: ${LARM_METOD}`,
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
  body.push(`# ⚠ ${name}`);
  body.push("");
  body.push(`**Bedömd nivå:** ${s.level}  `);
  body.push(`**Antal observationer:** ${s.obs.length}  `);
  body.push(`**Tidsspann:** ${s.firstSeen} → ${s.lastSeen}`);
  body.push("");
  body.push("## Observationer");
  for (const o of s.obs) {
    const stem = o.file.replace(/^.*\//, "").replace(/\.md$/, "");
    body.push(`- [[${stem}|TNR${o.tnr}]] — ${o.tidpunkt} — ${placeLabel(o.plats, nicks)}`);
  }
  body.push("");
  body.push(
    "_Misstänkt agent. Verifiera i ODEN-panelen för att skapa en bekräftad aktör. " +
      "Avförs automatiskt om aktiviteten avtar._",
  );

  return { filename: suspectFilename(s), markdown: fm.join("\n") + "\n\n" + body.join("\n") + "\n" };
}

export function renderSuspectNotes(suspects: Suspect[], nicks?: Nicknames): RenderedNote[] {
  return [...suspects]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((s) => renderSuspectNote(s, nicks));
}
