/*
 * Vault reset — the pure planning half of "Nollställ valvet".
 *
 * The demo feeder MOVES reports out of demo/ into inkorg/, so a reset must
 * move them back or the corpus is gone. demo/facit.json (the generator's
 * ground truth) is the authority on which files belong to the corpus; the
 * batch layout is reproduced exactly the way the packager built it:
 * chronological order (tidpunkt, then filename), fixed-size chunks,
 * zero-padded batch-NN folders.
 *
 * Everything else is decided by ALLOWLIST, not by recognizing formats: the
 * reset keeps exactly what a freshly installed vault ships and removes the
 * rest. A denylist would have to know every shape a report can take — the
 * intake app writes its own note format (group notes, sender notes, per-message
 * attachment folders) that is not a 7S report at all, and it drifts between
 * versions. What ships in the package does not.
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

/** Vault-root entries a freshly installed vault ships (packaging/): the demo
 *  queue, the inbox, the welcome note — plus ODEN's own entities folder, which
 *  the reset empties rather than removes. Everything else at the root is
 *  something that arrived after installation and goes. */
export function keptRootEntries(entitiesFolder: string): Set<string> {
  const entitiesRoot = entitiesFolder.replace(/^\/+|\/+$/g, "").split("/")[0];
  return new Set(["demo", "inkorg", "Välkommen.md", ...(entitiesRoot ? [entitiesRoot] : [])]);
}

/** Inside the kept folders, the only survivors are the shipped fixtures:
 *  the whole demo queue and the inbox's LÄS-MIG. The entities folder is
 *  emptied completely — every note in it is derived and comes back. */
export function isShippedFixture(path: string): boolean {
  return path === "demo" || path.startsWith("demo/") || path === "inkorg/LÄS-MIG.md" || path === "Välkommen.md";
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
