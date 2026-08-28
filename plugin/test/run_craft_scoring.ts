/*
 * CLI: measure craft typing against one or more generator corpora.
 *   npx tsx test/run_craft_scoring.ts <corpusDir> [...more]
 * See scoring_craft.ts for metric definitions (incl. the bil-surplus quirk).
 */
import { basename } from "node:path";
import { loadCraftCorpus, scoreCraft, formatCraftReport } from "./scoring_craft.ts";

for (const dir of process.argv.slice(2)) {
  console.log(formatCraftReport(scoreCraft(loadCraftCorpus(dir)), basename(dir)) + "\n");
}
