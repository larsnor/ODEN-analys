/*
 * Operator observation template (pure) — builds a COMPLETE, valid 7S message the
 * operator authors by hand, so a manual note carries every field the analysis
 * needs (typ, tnr, tidpunkt, plats, coords, sägesman, Händelse, Symbol).
 *
 * Provenance: `källa: operatör`. Deliberately NOT `generator: 7s-plugin` — this is
 * the operator's own message, not an ODEN-owned note, so ODEN never prunes it. It
 * flows through the normal pipeline like any incoming report.
 */
import { findMgrsLatLon } from "./mgrs";

export interface ObservationInput {
  id: string; // e.g. "7S-<uuid>"
  tidpunkt: string; // ISO local "YYYY-MM-DDTHH:MM:SS"
  plats: string; // place name and/or MGRS grid
  sagesman: string;
  handelse: string;
  symbol?: string;
}

/** TNR = DDHHMM from the observation time (matches the Bin 1 convention). */
export function tnrFromTidpunkt(iso: string): string {
  const m = iso.match(/^\d{4}-\d{2}-(\d{2})T(\d{2}):(\d{2})/);
  return m ? `${m[1]}${m[2]}${m[3]}` : iso.replace(/\D/g, "").slice(6, 12);
}

export function renderObservation(o: ObservationInput): { filename: string; markdown: string } {
  const tnr = tnrFromTidpunkt(o.tidpunkt);
  const ll = findMgrsLatLon(o.plats); // derive coords if the plats carries a grid
  const q = (s: string) => s.replace(/"/g, "'");

  const fm = [
    "---",
    `id: ${o.id}`,
    "typ: 7S-rapport",
    `tnr: "${tnr}"`,
    `tidpunkt: "${o.tidpunkt}"`,
    "källa: operatör",
    `plats: "${q(o.plats)}"`,
  ];
  if (ll) fm.push(`lat: ${ll.lat}`, `lon: ${ll.lon}`, `location: "${ll.lat},${ll.lon}"`);
  fm.push(`sagesman: ${o.sagesman}`, "---", "");

  const body = [
    `**TNR:** ${tnr}`, "",
    `**Stund:** ${tnr}`, "",
    `**Ställe:** ${o.plats}`, "",
    `**Händelse:** ${o.handelse}`, "",
  ];
  if (o.symbol && o.symbol.trim()) body.push(`**Symbol:** ${o.symbol.trim()}`, "");
  body.push(`**Sagesman:** ${o.sagesman}`, "", "**Sedan:** -", "");

  return { filename: `TNR${tnr}.md`, markdown: fm.join("\n") + body.join("\n") + "\n" };
}
