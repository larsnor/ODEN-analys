/*
 * Write-contract ownership (§5.1/§5.2) — which existing files writeOwnedNotes may
 * (over)write. Regression guard: a stray EMPTY file must be overwritable, else a
 * 0-byte note blocks the real content forever → orphan node hidden from the graph
 * (the "confirmed actor shows in list but not in graph" bug).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isPluginOwned, isOverwritable } from "../src/entity_notes.ts";

const OWNED = `---
typ: entitet
generator: 7s-plugin
metod: aktor
tags: [aktör]
---

# Aktör RJK241
`;

const USER_NOTE = `---
tags: [meeting]
---

# My own note about RJK241
Don't touch this.
`;

test("isPluginOwned only trusts the generator: 7s-plugin marker", () => {
  assert.equal(isPluginOwned(OWNED), true);
  assert.equal(isPluginOwned(USER_NOTE), false);
  assert.equal(isPluginOwned(""), false, "empty file is NOT owned");
});

test("REGRESSION: an empty/whitespace file is overwritable (0-byte note must not block writes)", () => {
  assert.equal(isOverwritable(""), true, "0-byte file → overwrite");
  assert.equal(isOverwritable("   \n\t \n"), true, "whitespace-only → overwrite");
});

test("plugin-owned files are overwritable; genuine user notes are protected", () => {
  assert.equal(isOverwritable(OWNED), true, "our own note → overwrite (idempotent rewrite)");
  assert.equal(isOverwritable(USER_NOTE), false, "non-empty, non-owned user note → never touch");
});
