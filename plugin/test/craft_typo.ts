/*
 * CLI: typo-tolerance measurement for the craft matcher (issue #2 rework).
 *
 *   npx tsx test/craft_typo.ts <corpusDir> [...more]
 *
 * Two measurements per corpus:
 *  1. PERTURBATION RECALL — for every report with craft facit, the craft token
 *     in its prose gets ONE deterministic edit (sub/ins/del at a position seeded
 *     from the TNR via mulberry32 — the same three operations withinOneEdit
 *     counts, so metric and measurement agree). Reported with the typo layer
 *     off vs on. Types with typoTolerant:false stay unrecovered by design.
 *  2. CLEAN-PROSE DELTA — on UNperturBED text, predictions with the layer on
 *     must equal predictions with it off for every report. Any delta is the
 *     typo layer firing on real prose = a false positive the hazard audit
 *     missed. Gate: zero.
 */
import { basename } from "node:path";
import { tokenizeSv } from "../src/sv_match.ts";
import { matchCraftTypes } from "../src/domain.ts";
import { loadCraftCorpus } from "./scoring_craft.ts";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = "abcdefghijklmnopqrstuvwxyzåäö";

/** One deterministic edit on `word`: op and position from the seeded RNG. */
export function perturbWord(word: string, seed: number): string {
  const rnd = mulberry32(seed);
  const op = Math.floor(rnd() * 3);
  const pos = Math.floor(rnd() * word.length);
  const ch = ALPHABET[Math.floor(rnd() * ALPHABET.length)];
  if (op === 0) return word.slice(0, pos) + ch + word.slice(pos + 1); // substitute
  if (op === 1) return word.slice(0, pos) + ch + word.slice(pos); // insert
  if (word.length <= 1) return word + ch;
  return word.slice(0, pos) + word.slice(pos + 1); // delete
}

for (const dir of process.argv.slice(2)) {
  const c = loadCraftCorpus(dir);
  let total = 0, offOk = 0, onOk = 0, cleanDelta = 0;
  const missOn: string[] = [];
  for (const r of c.reports) {
    const text = [r.handelse, r.symbol].filter(Boolean).join(". ");
    const clean = (o: boolean) => matchCraftTypes(text, { typo: o }).map((t) => t.key).join(",");
    if (clean(true) !== clean(false)) cleanDelta++;
    const expected = c.facit.get(r.file);
    if (!expected) continue;
    for (const want of expected) {
      // the craft surface token: the first token the (typo-free) matcher maps to `want`
      const tok = tokenizeSv(text).find((t) => matchCraftTypes(t, { typo: false }).some((x) => x.key === want));
      if (!tok) continue; // facit word not individually resolvable (stem-only compounds)
      total++;
      const typo = perturbWord(tok, Number(r.tnr.replace(/\D/g, "")) || 1);
      const perturbed = text.replace(tok, typo);
      if (matchCraftTypes(perturbed, { typo: false }).some((x) => x.key === want)) offOk++;
      if (matchCraftTypes(perturbed, { typo: true }).some((x) => x.key === want)) onOk++;
      else if (missOn.length < 8) missOn.push(`[${want}] ${tok}→${typo}`);
    }
  }
  console.log(`-- ${basename(dir)}: ${total} perturbed craft tokens --`);
  console.log(`  recovered WITHOUT typo layer: ${offOk}/${total}`);
  console.log(`  recovered WITH typo layer:    ${onOk}/${total}`);
  console.log(`  clean-prose delta (must be 0): ${cleanDelta}`);
  if (missOn.length) console.log(`  sample unrecovered: ${missOn.join("; ")}`);
}
