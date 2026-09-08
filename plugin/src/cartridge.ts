/*
 * Demo cartridges (pure, Obsidian-free) — several self-contained demo corpora
 * side by side under demo/, each loadable from the command palette
 * ("Mata demodata — Tierps flygfält").
 *
 * Layout the packager produces:
 *   demo/<id>/cartridge.json   — this manifest (label, AOI, mix, …)
 *   demo/<id>/facit.json       — the generator's ground truth
 *   demo/<id>/LÄS-MIG.md
 *   demo/<id>/batch-NN/…       — chronological drag-in batches
 *
 * Legacy layout (vaults packaged before cartridges): batch-NN directly under
 * demo/ with demo/facit.json — discovered as ONE unnamed cartridge rooted at
 * demo/, so the old command keeps working unchanged.
 */

export interface CartridgeManifest {
  id: string;
  label: string;
  /** Operation area the corpus was generated around — offered to the operator
   *  when a cartridge is started, so demo reports land near the objektet. */
  aoi?: { lat: number; lon: number };
  area?: string;
  days?: number;
  /** Operator-facing one-liner: threat mix, volume, what to look for. */
  beskrivning?: string;
}

export interface Cartridge extends CartridgeManifest {
  /** Vault folder holding facit.json and the batch-NN folders. */
  root: string;
}

const ID_RE = /^[a-z0-9][a-z0-9_-]{0,40}$/;

/** Parse demo/<id>/cartridge.json; null when malformed (the folder is then
 *  ignored rather than crashing the command registration). */
export function parseCartridgeManifest(json: string, root: string): Cartridge | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const id = typeof o.id === "string" ? o.id : "";
  const label = typeof o.label === "string" ? o.label.trim() : "";
  if (!ID_RE.test(id) || !label) return null;
  const aoiRaw = o.aoi as { lat?: unknown; lon?: unknown } | undefined;
  const aoi =
    aoiRaw && typeof aoiRaw.lat === "number" && typeof aoiRaw.lon === "number" && Number.isFinite(aoiRaw.lat) && Number.isFinite(aoiRaw.lon)
      ? { lat: aoiRaw.lat, lon: aoiRaw.lon }
      : undefined;
  return {
    id,
    label,
    root,
    aoi,
    area: typeof o.area === "string" ? o.area : undefined,
    days: typeof o.days === "number" ? o.days : undefined,
    beskrivning: typeof o.beskrivning === "string" ? o.beskrivning : undefined,
  };
}

/** Discover cartridges from a listing of the demo/ folder's immediate
 *  children plus the manifests the shell managed to read. `hasLegacyBatches`
 *  = batch-NN folders directly under demo/ (pre-cartridge vaults). */
export function discoverCartridges(
  manifests: { root: string; json: string }[],
  hasLegacyBatches: boolean,
): Cartridge[] {
  const out: Cartridge[] = [];
  for (const m of manifests) {
    const c = parseCartridgeManifest(m.json, m.root);
    if (c) out.push(c);
  }
  out.sort((a, b) => a.label.localeCompare(b.label, "sv"));
  if (hasLegacyBatches) out.unshift({ id: "", label: "Demodata", root: "demo" });
  return out;
}

/** Command id for a cartridge — stable, palette-safe. */
export function cartridgeCommandId(c: Cartridge): string {
  return c.id ? `feed-demo-${c.id}` : "feed-demo";
}

/** Palette name: "Mata demodata — Tierps flygfält" (legacy: "Mata demodata"). */
export function cartridgeCommandName(c: Cartridge): string {
  return c.id ? `Mata demodata — ${c.label}` : "Mata demodata";
}

/** Does starting this cartridge call for switching the operation area? Only
 *  when the manifest carries an AOI that is materially elsewhere (> 1 km). */
export function cartridgeNeedsAoiSwitch(c: Cartridge, current: { lat: number; lon: number }, haversineM: (a: number, b: number, c: number, d: number) => number): boolean {
  if (!c.aoi) return false;
  return haversineM(c.aoi.lat, c.aoi.lon, current.lat, current.lon) > 1000;
}
