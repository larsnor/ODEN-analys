/*
 * Out-of-distribution BEHAVIOUR measurement (suspicion.ts THREAT_INDICATORS).
 *
 * Two blind-authored corpora (a separate model instance wrote them WITHOUT seeing
 * the stem list — see the fixture headers): corpus A (dev) guided the precision-gated
 * expansion, corpus B (held-out) validates that the expansion generalises rather than
 * fits A. Prints recall/precision/per-mode for both; asserts only regression guards
 * and the real safety invariant (no benign prose trips a WEIGHT-3 category, which
 * would flag a civilian as a saboteur/terrorist). Recall is the acknowledged ceiling,
 * floored (not pinned) so a future edit can't silently gut it. See
 * docs/BEHAVIOUR_VALIDATION.md.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { scoreBehaviour, formatBehaviourReport } from "./scoring_behaviour.ts";
import { CORPUS_A } from "./fixtures/behaviour_ood/corpus_a.ts";
import { CORPUS_B } from "./fixtures/behaviour_ood/corpus_b.ts";

// The weight-3 categories self-elevate a report at night — a benign sentence tripping
// one is the dangerous false positive. The soft weight-2 categories (optik/observation)
// firing on a birdwatcher is tolerable (needs geo+time to actually elevate; documented).
const WEIGHT3 = new Set(["sabotage", "attentat"]);

test("OOD behaviour: measure recall/precision (printed), assert guards + safety", () => {
  const a = scoreBehaviour(CORPUS_A);
  const b = scoreBehaviour(CORPUS_B);
  console.log("\n" + formatBehaviourReport(a, "corpus A (dev)"));
  console.log("\n" + formatBehaviourReport(b, "corpus B (held-out)") + "\n");

  // SAFETY: no benign sentence may trip a weight-3 (self-elevating) hostile category.
  for (const s of [a, b])
    for (const f of s.falseFired)
      assert.equal(
        f.cats.some((c) => WEIGHT3.has(c)),
        false,
        `benign prose tripped a weight-3 category: [${f.cats}] ${f.text}`,
      );

  // Regression floors (well below the measured 62%/74% recall, 97%/91% precision), so
  // a future change that guts recall or precision fails loudly. Not pinned to exact
  // numbers — recall is an acknowledged ceiling, precision has the optik ambiguity.
  assert.ok(a.recall >= 0.55, `corpus A recall regressed: ${(a.recall * 100).toFixed(0)}%`);
  assert.ok(b.recall >= 0.65, `corpus B recall regressed: ${(b.recall * 100).toFixed(0)}%`);
  assert.ok(a.precision >= 0.85, `corpus A precision regressed: ${(a.precision * 100).toFixed(0)}%`);
  assert.ok(b.precision >= 0.85, `corpus B precision regressed: ${(b.precision * 100).toFixed(0)}%`);
});
