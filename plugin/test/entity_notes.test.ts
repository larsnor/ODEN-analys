/*
 * Write-contract ownership (§5.1/§5.2) — which existing files writeOwnedNotes may
 * (over)write. Regression guard: a stray EMPTY file must be overwritable, else a
 * 0-byte note blocks the real content forever → orphan node hidden from the graph
 * (the "confirmed actor shows in list but not in graph" bug).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isPluginOwned, isOverwritable, ownedMetod, renderEntityNote } from "../src/entity_notes.ts";
import { PlateEntity } from "../src/reid.ts";

const ENTITY: PlateEntity = {
  id: "RJK241",
  slag: "fordon-reg-full",
  canonical: "RJK241",
  observations: [
    { tnr: "100000", tidpunkt: "2026-06-15T10:00:00", plats: "Grindarna", file: "reports/TNR100000.md", shown: "RJK241", kind: "plate-full", sagesman: "AQ" },
    { tnr: "100100", tidpunkt: "2026-06-16T11:00:00", plats: "Bryggan", file: "reports/TNR100100.md", shown: "RJK241", kind: "plate-full", sagesman: "BQ" },
  ],
  resolvedPartials: [],
  candidateFulls: [],
  firstSeen: "2026-06-15T10:00:00",
  lastSeen: "2026-06-16T11:00:00",
  count: 2,
  sagesmän: ["AQ", "BQ"],
  method: "jobb-a",
};

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

test("image corroboration (§6.7) surfaces on the entity note, and is opt-in", () => {
  // Without a corroboration set → byte-identical to the pre-vision output.
  const plain = renderEntityNote(ENTITY);
  assert.doesNotMatch(plain.markdown, /Bildstyrkt|📷|bild_styrkt/);

  // One observation photo-corroborated → frontmatter flag, a summary line, and a
  // 📷 on exactly that observation.
  const withPhoto = renderEntityNote(ENTITY, new Set(["reports/TNR100000.md"]));
  assert.match(withPhoto.markdown, /bild_styrkt: 1/);
  assert.match(withPhoto.markdown, /📷 Bildstyrkt:\*\* 1 observation/);
  assert.match(withPhoto.markdown, /TNR100000\]\] — .* 📷/);
  assert.doesNotMatch(withPhoto.markdown, /TNR100100\]\] — [^\n]*📷/, "uncorroborated obs unmarked");
});

test("ownedMetod reads the metod tag (drives the per-job prune)", () => {
  assert.equal(ownedMetod("---\ngenerator: 7s-plugin\nmetod: aktor\ntags: [aktör]\n---\n# x"), "aktor");
  assert.equal(ownedMetod("---\nmetod:   plats  \n---"), "plats");
  assert.equal(ownedMetod("---\ntyp: entitet\n---\nno metod here"), "");
  assert.equal(ownedMetod(""), "");
});
