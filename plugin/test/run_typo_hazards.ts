/*
 * CLI: hazard audit for the craft edit-distance-1 layer (issue #2 rework).
 *
 * Lists every DISTINCT token (≥6 chars) across the given corpora/fixture dirs
 * that (a) matches no existing craft mechanism, and (b) is within ONE edit
 * (sub/ins/del) of an exact craft form ≥6 chars. Every hit is a human decision:
 * plausible typo neighbour (leave) or Swedish word in its own right (add to
 * CRAFT_TYPO_BLOCK). Run before enabling/altering the typo layer; findings go
 * in docs/CRAFT_VALIDATION.md.
 *   npx tsx test/run_typo_hazards.ts <dir> [...more]
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tokenizeSv, withinOneEdit } from "../src/sv_match.ts";
import { expandedCraftVocabulary, matchCraftTypes } from "../src/domain.ts";

const vocab = expandedCraftVocabulary();
const forms: { form: string; key: string }[] = [];
for (const t of vocab.types)
  for (const f of t.typoForms) forms.push({ form: f, key: t.key });

const tokens = new Map<string, number>();
for (const dir of process.argv.slice(2)) {
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".md"))) {
    for (const tok of tokenizeSv(readFileSync(join(dir, f), "utf-8")))
      if (tok.length >= 6) tokens.set(tok, (tokens.get(tok) ?? 0) + 1);
  }
}
console.log(`${tokens.size} distinct tokens ≥6 across ${process.argv.length - 2} dirs`);
for (const [tok, n] of [...tokens.entries()].sort()) {
  if (matchCraftTypes(tok, { typo: false }).length > 0) continue; // claimed by a NON-typo mechanism
  // (typo:false — otherwise the typo layer itself would mask exactly the hazards we hunt)
  const near = forms.filter((f) => withinOneEdit(tok, f.form));
  if (near.length) console.log(`  ${tok} (${n}×) ~ ${near.map((f) => `${f.form}[${f.key}]`).join(", ")}`);
}
