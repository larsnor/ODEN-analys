/*
 * Plate re-identification scoring against ground_truth.json.
 *
 * Pure TS, Obsidian-free. The PLUGIN never ships ground truth — this is a
 * test/measurement aid. It answers the measurement questions for the ID layer:
 *   - "slås rätt partialer ihop?"  → partial-resolution recall
 *   - "hittas cellen?"             → each true plate recovered as one cluster
 *   - false merges (the dangerous failure) → precision
 */
import { JobAResult, PlateEntity } from "../src/reid";

/** One ground_truth.json record (only the fields scoring cares about). */
export interface GroundTruthRow {
  file: string;
  tnr: string;
  truth: string; // "noise" | "POI" | "commuter"
  plate?: string; // TRUE full plate (annotation)
  plate_shown?: string; // what the report actually displayed (full or masked)
  tells?: string[]; // mark-nomination scoring key: tell_bag | tell_cap | tell_logo
}

export interface JobAScore {
  /** GT reports that carry a plate annotation. */
  plateReports: number;
  /** …correctly placed in an entity whose canonical == true plate. */
  correctlyClustered: number;
  /** Of GT reports whose shown plate was PARTIAL, fraction resolved correctly. */
  partialReports: number;
  partialsResolvedCorrectly: number;
  /** Distinct true plates that were fully recovered (all their GT sightings in
   *  one entity, canonical == true plate). */
  truePlates: number;
  truePlatesRecovered: number;
  /** Entities that merge reports of DIFFERING true plates (must be 0). */
  falseMerges: number;
  falseMergeDetails: string[];
  /** Convenience ratios in [0,1]. */
  clusterRecall: number;
  partialRecall: number;
  precision: number;
}

/** Map every report file → the entity that contains it (by canonical). */
function fileToEntity(result: JobAResult): Map<string, PlateEntity> {
  const map = new Map<string, PlateEntity>();
  for (const e of result.entities) {
    for (const o of e.observations) {
      // A report could in principle appear under multiple plates; for re-id
      // scoring each GT plate report has a single plate, so last-write is fine,
      // but prefer the entity whose canonical matches if several exist.
      const existing = map.get(o.file);
      if (!existing) map.set(o.file, e);
    }
  }
  return map;
}

/** Look up by file with basename tolerance (GT uses bare filenames). */
function findEntity(map: Map<string, PlateEntity>, gtFile: string): PlateEntity | undefined {
  if (map.has(gtFile)) return map.get(gtFile);
  for (const [k, v] of map) {
    if (k === gtFile || k.endsWith("/" + gtFile)) return v;
  }
  return undefined;
}

export function scoreJobA(result: JobAResult, groundTruth: GroundTruthRow[]): JobAScore {
  const map = fileToEntity(result);
  const plateRows = groundTruth.filter((g) => g.plate);

  let correctlyClustered = 0;
  let partialReports = 0;
  let partialsResolvedCorrectly = 0;

  for (const g of plateRows) {
    const ent = findEntity(map, g.file);
    const ok = !!ent && ent.canonical === g.plate;
    if (ok) correctlyClustered++;
    if (g.plate_shown && g.plate_shown.includes(".")) {
      partialReports++;
      if (ok) partialsResolvedCorrectly++;
    }
  }

  // True-plate recovery: every GT sighting of plate P lands in canonical P.
  const truePlateSet = new Set(plateRows.map((g) => g.plate!));
  let truePlatesRecovered = 0;
  for (const p of truePlateSet) {
    const rows = plateRows.filter((g) => g.plate === p);
    const allIn = rows.every((g) => findEntity(map, g.file)?.canonical === p);
    if (allIn) truePlatesRecovered++;
  }

  // False merges: an entity whose members map to >1 distinct TRUE plate.
  const gtByFile = new Map<string, GroundTruthRow>();
  for (const g of groundTruth) gtByFile.set(g.file, g);
  const truthOf = (file: string): string | undefined => {
    if (gtByFile.has(file)) return gtByFile.get(file)!.plate;
    for (const [k, v] of gtByFile) if (file.endsWith("/" + k) || file === k) return v.plate;
    return undefined;
  };
  let falseMerges = 0;
  const falseMergeDetails: string[] = [];
  for (const e of result.entities) {
    const truths = new Set(
      e.observations.map((o) => truthOf(o.file)).filter((t): t is string => !!t),
    );
    if (truths.size > 1) {
      falseMerges++;
      falseMergeDetails.push(`${e.canonical}: merges true plates {${[...truths].join(", ")}}`);
    }
  }

  const totalMergedEntities = result.entities.filter((e) => e.count > 1).length;
  return {
    plateReports: plateRows.length,
    correctlyClustered,
    partialReports,
    partialsResolvedCorrectly,
    truePlates: truePlateSet.size,
    truePlatesRecovered,
    falseMerges,
    falseMergeDetails,
    clusterRecall: plateRows.length ? correctlyClustered / plateRows.length : 1,
    partialRecall: partialReports ? partialsResolvedCorrectly / partialReports : 1,
    precision: totalMergedEntities ? 1 - falseMerges / totalMergedEntities : 1,
  };
}

// ---------------------------------------------------------------------------
// Mark extraction + nomination scoring vs ground_truth.json `tells`.
// ---------------------------------------------------------------------------
import { JobBResult } from "../src/jobb";
import { NormalizedMark } from "../src/marks";
import { ObjectCategory, TELL_CATEGORY } from "../src/vocab";

export interface JobBScore {
  // extraction recall: a distinctive mark of the right category per GT tell.
  tellInstances: number;
  tellInstancesFound: number;
  extractionRecall: number;
  recallByCategory: Record<string, string>; // category -> "found/total"
  // extraction precision: distinctive marks that don't correspond to a GT tell.
  distinctiveMarks: number;
  falseMarks: number;
  falseMarkDetails: string[];
  extractionPrecision: number;
  // normalization collapse: distinct signatures per tell category (ideal 1).
  signaturesPerCategory: Record<string, number>;
  // nomination quality.
  noiseInNominations: number;
  noiseNominationDetails: string[];
  nominationPairPrecision: number;
  nominationPairRecall: number;
}

function baseName(file: string): string {
  return file.replace(/^.*\//, "");
}

export function scoreJobB(
  result: JobBResult,
  marks: NormalizedMark[],
  groundTruth: GroundTruthRow[],
): JobBScore {
  const gtByFile = new Map<string, GroundTruthRow>();
  for (const g of groundTruth) gtByFile.set(g.file, g);
  const gtFor = (file: string): GroundTruthRow | undefined =>
    gtByFile.get(file) ?? gtByFile.get(baseName(file));

  // GT tell categories present per file.
  const gtCatsByFile = new Map<string, Set<ObjectCategory>>();
  for (const g of groundTruth) {
    const cats = new Set<ObjectCategory>();
    for (const t of g.tells ?? []) {
      const c = TELL_CATEGORY[t];
      if (c) cats.add(c);
    }
    if (cats.size) gtCatsByFile.set(g.file, cats);
  }

  // Distinctive marks indexed by file -> categories found.
  const distinctive = marks.filter((m) => m.distinctive);
  const foundCatsByFile = new Map<string, Set<ObjectCategory>>();
  for (const m of distinctive) {
    if (!foundCatsByFile.has(baseName(m.file))) foundCatsByFile.set(baseName(m.file), new Set());
    foundCatsByFile.get(baseName(m.file))!.add(m.object);
  }

  // (a) Extraction recall over (file, tell) instances.
  let tellInstances = 0;
  let tellInstancesFound = 0;
  const recallNum: Record<string, number> = {};
  const recallDen: Record<string, number> = {};
  for (const [file, cats] of gtCatsByFile) {
    const found = foundCatsByFile.get(baseName(file)) ?? new Set<ObjectCategory>();
    for (const c of cats) {
      tellInstances++;
      recallDen[c] = (recallDen[c] ?? 0) + 1;
      if (found.has(c)) {
        tellInstancesFound++;
        recallNum[c] = (recallNum[c] ?? 0) + 1;
      }
    }
  }
  const recallByCategory: Record<string, string> = {};
  for (const c of Object.keys(recallDen)) recallByCategory[c] = `${recallNum[c] ?? 0}/${recallDen[c]}`;

  // (b) Extraction precision: a distinctive mark whose category is NOT a GT tell
  //     of its file is a false mark (noise/decoy leakage).
  let falseMarks = 0;
  const falseMarkDetails: string[] = [];
  for (const m of distinctive) {
    const cats = gtCatsByFile.get(gtFor(m.file)?.file ?? baseName(m.file));
    if (!cats || !cats.has(m.object)) {
      falseMarks++;
      const truth = gtFor(m.file)?.truth ?? "?";
      falseMarkDetails.push(`${baseName(m.file)} (${truth}): ${m.signature}`);
    }
  }

  // (c) Normalization collapse: distinct signatures per category on true tells.
  const sigsByCat = new Map<ObjectCategory, Set<string>>();
  for (const m of distinctive) {
    const cats = gtCatsByFile.get(gtFor(m.file)?.file ?? baseName(m.file));
    if (cats && cats.has(m.object)) {
      if (!sigsByCat.has(m.object)) sigsByCat.set(m.object, new Set());
      sigsByCat.get(m.object)!.add(m.signature);
    }
  }
  const signaturesPerCategory: Record<string, number> = {};
  for (const [c, set] of sigsByCat) signaturesPerCategory[c] = set.size;

  // (d) Nomination quality: noise leakage + pairwise precision/recall.
  let noiseInNominations = 0;
  const noiseNominationDetails: string[] = [];
  let correctPairs = 0;
  let nominatedPairs = 0;
  for (const nom of result.nominations) {
    const files = nom.members.map((m) => baseName(m.file));
    for (const f of files) {
      if (gtFor(f)?.truth === "noise") {
        noiseInNominations++;
        noiseNominationDetails.push(`${nom.signature} ⊇ ${f} (noise)`);
      }
    }
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        nominatedPairs++;
        const ci = gtCatsByFile.get(gtFor(files[i])?.file ?? files[i]);
        const cj = gtCatsByFile.get(gtFor(files[j])?.file ?? files[j]);
        if (ci?.has(nom.object) && cj?.has(nom.object)) correctPairs++;
      }
    }
  }

  // Gold same-tell pairs (over files that carry each tell category).
  let goldPairs = 0;
  let goldPairsCovered = 0;
  for (const cat of new Set(Object.values(TELL_CATEGORY))) {
    const files = [...gtCatsByFile.entries()].filter(([, cs]) => cs.has(cat)).map(([f]) => baseName(f));
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        goldPairs++;
        const inSameNom = result.nominations.some((n) => {
          if (n.object !== cat) return false;
          const fs = new Set(n.members.map((m) => baseName(m.file)));
          return fs.has(files[i]) && fs.has(files[j]);
        });
        if (inSameNom) goldPairsCovered++;
      }
    }
  }

  return {
    tellInstances,
    tellInstancesFound,
    extractionRecall: tellInstances ? tellInstancesFound / tellInstances : 1,
    recallByCategory,
    distinctiveMarks: distinctive.length,
    falseMarks,
    falseMarkDetails,
    extractionPrecision: distinctive.length ? (distinctive.length - falseMarks) / distinctive.length : 1,
    signaturesPerCategory,
    noiseInNominations,
    noiseNominationDetails,
    nominationPairPrecision: nominatedPairs ? correctPairs / nominatedPairs : 1,
    nominationPairRecall: goldPairs ? goldPairsCovered / goldPairs : 1,
  };
}
