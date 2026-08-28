/*
 * CLI: regenerate the frozen craft-vocabulary snapshot after a DELIBERATE
 * taxonomy change (and re-run the corpus measurements in
 * docs/CRAFT_VALIDATION.md — the snapshot diff and the measurements travel
 * together in review):
 *   npx tsx test/run_craft_vocabulary_snapshot.ts > test/fixtures/craft_vocabulary.ts
 */
import { expandedCraftVocabulary } from "../src/domain.ts";

const v = expandedCraftVocabulary();
const out: string[] = [];
out.push("/*");
out.push(" * FROZEN SNAPSHOT of the effective craft vocabulary — what matchCraftTypes");
out.push(" * actually recognises after inflection expansion (sv_morph.ts) of the bases");
out.push(" * and heads declared in domain.ts CRAFT_TAXONOMY. typoForms are the forms");
out.push(" * the edit-distance-1 layer accepts one typo against (empty = typoTolerant");
out.push(" * disabled for that type after the hazard audit).");
out.push(" *");
out.push(" * craft_vocabulary.test.ts asserts deep-equality with expandedCraftVocabulary(),");
out.push(" * so ANY change to a base, declension class, keyword, stem, blocklist entry or");
out.push(" * typo eligibility shows up here as a reviewable diff — the frozen-list culture");
out.push(" * survives the generator. Regenerate ONLY via");
out.push(" * run_craft_vocabulary_snapshot.ts (see its header); never hand-edit to");
out.push(" * silence the test.");
out.push(" */");
out.push("");
out.push("export const EXPECTED_CRAFT_VOCABULARY = {");
out.push("  types: [");
for (const t of v.types) {
  out.push("    {");
  out.push(`      key: ${JSON.stringify(t.key)},`);
  for (const f of ["exactForms", "headForms", "stems", "typoForms"] as const) {
    out.push(`      ${f}: [${t[f].map((x) => JSON.stringify(x)).join(", ")}],`);
  }
  out.push("    },");
}
out.push("  ],");
out.push(`  headBlock: [${v.headBlock.map((x) => JSON.stringify(x)).join(", ")}],`);
out.push("};");
console.log(out.join("\n"));
