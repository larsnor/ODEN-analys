/*
 * The craft vocabulary FREEZE (issue #2 morphological rework).
 *
 * The taxonomy declares bases/heads + declension classes; sv_morph.ts expands
 * them. This test pins the EFFECTIVE vocabulary to the committed snapshot, so
 * the expansion is exactly as auditable as a hand-written list: any change is
 * a visible fixture diff, reviewed like any other frozen-vocabulary change.
 * Plus the structural invariants the matcher's precedence rules rely on.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { expandedCraftVocabulary } from "../src/domain.ts";
import { EXPECTED_CRAFT_VOCABULARY } from "./fixtures/craft_vocabulary.ts";

const vocab = expandedCraftVocabulary();

test("effective craft vocabulary matches the committed snapshot", () => {
  assert.deepEqual(vocab, EXPECTED_CRAFT_VOCABULARY);
});

test("no exact or head form maps to two types", () => {
  const exact = new Map<string, string>();
  const heads = new Map<string, string>();
  for (const t of vocab.types) {
    for (const f of t.exactForms) {
      assert.ok(!exact.has(f) || exact.get(f) === t.key, `exact "${f}": ${exact.get(f)} vs ${t.key}`);
      exact.set(f, t.key);
    }
    for (const f of t.headForms) {
      assert.ok(!heads.has(f) || heads.get(f) === t.key, `head "${f}": ${heads.get(f)} vs ${t.key}`);
      heads.set(f, t.key);
    }
  }
});

test("every blocklist token actually ends in a head form (no dead entries)", () => {
  const headForms = vocab.types.flatMap((t) => t.headForms);
  for (const b of vocab.headBlock) {
    assert.ok(
      headForms.some((h) => b.length > h.length && b.endsWith(h)),
      `blocklist entry "${b}" ends in no head form — dead entry`,
    );
  }
});

test("every form is a single lowercase Swedish token", () => {
  for (const t of vocab.types)
    for (const f of [...t.exactForms, ...t.headForms, ...t.stems])
      assert.match(f, /^[a-zåäö0-9]+$/, `"${f}" (${t.key})`);
});
