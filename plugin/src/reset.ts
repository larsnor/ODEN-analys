/*
 * Vault reset — the pure planning half of "Nollställ valvet".
 *
 * The demo feeder MOVES reports out of demo/ into inkorg/, so a reset must
 * move them back or the corpus is gone. demo/facit.json (the generator's
 * ground truth) is the authority on which files belong to the corpus; the
 * batch layout is reproduced exactly the way the packager built it:
 * chronological order (tidpunkt, then filename), fixed-size chunks,
 * zero-padded batch-NN folders.
 */

/** One row of demo/facit.json (ground_truth.json from the generator). */
export interface FacitEntry {
  file: string;
  id?: string;
  tidpunkt?: string;
}

export const DEMO_BATCH_SIZE = 25;

/** Target folder under demo/ for every corpus file, reproducing the
 *  packager's chronological batch split. */
export function demoBatchPlan(facit: FacitEntry[], batchSize = DEMO_BATCH_SIZE): Map<string, string> {
  const ordered = [...facit].sort(
    (a, b) => (a.tidpunkt ?? "").localeCompare(b.tidpunkt ?? "") || a.file.localeCompare(b.file),
  );
  const plan = new Map<string, string>();
  ordered.forEach((entry, i) => {
    const batch = Math.floor(i / batchSize) + 1;
    plan.set(entry.file, `demo/batch-${String(batch).padStart(2, "0")}`);
  });
  return plan;
}

/** Lookup keys identifying a report as demo-origin: its generator id
 *  (frontmatter `id`, survives a rename) and its original filename. */
export function demoOriginKeys(facit: FacitEntry[]): { ids: Set<string>; files: Set<string> } {
  const ids = new Set<string>();
  const files = new Set<string>();
  for (const e of facit) {
    if (e.id) ids.add(e.id);
    files.add(e.file);
  }
  return { ids, files };
}
