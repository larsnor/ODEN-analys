/*
 * Craft-vocabulary scorer (validation, not a unit test).
 *
 * Measures how well domain.ts matchCraftTypes (via craft.ts extractCraft) recovers
 * the craft facit of a 7S-generator corpus (ground_truth.json, `craft: [types]` per
 * report that mentions a craft). Per-type recall is the headline; type-level
 * precision counts predicted types the facit does not list.
 *
 * Facit quirk (issue #2 "omvänd paritetsnot"): the generator never stamps naked
 * "bil" as craft while the taxonomy tags it, so predicted-`bil`-without-facit is
 * counted in a separate `bilSurplus` bucket, EXCLUDED from the precision figure and
 * reported alongside it. Complements scoring_behaviour.ts (activity vocabulary).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Report, parseReport } from "../src/parse.ts";
import { extractCraft } from "../src/craft.ts";

export interface CraftCorpus {
  reports: Report[];
  /** file → facit craft type keys (only files the facit stamps). */
  facit: Map<string, string[]>;
}

export function loadCraftCorpus(dir: string): CraftCorpus {
  const gt = JSON.parse(readFileSync(join(dir, "ground_truth.json"), "utf-8")) as {
    file: string;
    craft?: string[];
  }[];
  const facit = new Map<string, string[]>();
  for (const g of gt) if (g.craft?.length) facit.set(g.file, g.craft);
  const reports = readdirSync(dir)
    .filter((f) => /^TNR\d+(_\d+)?\.md$/.test(f))
    .map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), f));
  return { reports, facit };
}

export interface CraftScore {
  perType: Record<string, { total: number; caught: number }>;
  recall: number; // micro over all facit (file, type) pairs
  falsePositives: { file: string; type: string; handelse: string }[]; // predicted, not in facit (bil excluded)
  bilSurplus: number; // predicted `bil` with no facit backing (known quirk, not an error)
  missed: { file: string; type: string; handelse: string }[];
}

export function scoreCraft(c: CraftCorpus): CraftScore {
  const perType: Record<string, { total: number; caught: number }> = {};
  const missed: CraftScore["missed"] = [];
  const falsePositives: CraftScore["falsePositives"] = [];
  let bilSurplus = 0;

  for (const r of c.reports) {
    const predicted = new Set(extractCraft(r).map((o) => o.type));
    const expected = new Set(c.facit.get(r.file) ?? []);
    for (const t of expected) {
      perType[t] ??= { total: 0, caught: 0 };
      perType[t].total++;
      if (predicted.has(t)) perType[t].caught++;
      else missed.push({ file: r.file, type: t, handelse: (r.handelse ?? "").slice(0, 100) });
    }
    for (const t of predicted) {
      if (expected.has(t)) continue;
      if (t === "bil" && !expected.has("bil")) bilSurplus++;
      else falsePositives.push({ file: r.file, type: t, handelse: (r.handelse ?? "").slice(0, 100) });
    }
  }

  const total = Object.values(perType).reduce((s, v) => s + v.total, 0);
  const caught = Object.values(perType).reduce((s, v) => s + v.caught, 0);
  return { perType, recall: total ? caught / total : 1, falsePositives, bilSurplus, missed };
}

export function formatCraftReport(s: CraftScore, label: string): string {
  const lines: string[] = [];
  lines.push(`-- craft typing on ${label} --`);
  for (const [t, v] of Object.entries(s.perType).sort()) {
    lines.push(`  ${t.padEnd(12)} ${v.caught}/${v.total}`);
  }
  const total = Object.values(s.perType).reduce((a, v) => a + v.total, 0);
  const caught = Object.values(s.perType).reduce((a, v) => a + v.caught, 0);
  lines.push(`  RECALL ${(s.recall * 100).toFixed(1)}% (${caught}/${total}) | false positives ${s.falsePositives.length} | bil-surplus ${s.bilSurplus} (known facit quirk)`);
  if (s.missed.length) {
    lines.push(`  MISSED (${s.missed.length}):`);
    for (const m of s.missed) lines.push(`    - [${m.type}] ${m.file}: ${m.handelse}`);
  }
  if (s.falsePositives.length) {
    lines.push(`  FALSE POSITIVES (${s.falsePositives.length}):`);
    for (const f of s.falsePositives) lines.push(`    - [${f.type}] ${f.file}: ${f.handelse}`);
  }
  return lines.join("\n");
}
