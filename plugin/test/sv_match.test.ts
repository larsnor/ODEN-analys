/*
 * sv_match.ts + sv_morph.ts — the shared Swedish matching/morphology primitives
 * under the craft matcher (domain.ts) and query parsing (query.ts).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { hasWord, tokenizeSv, withinOneEdit } from "../src/sv_match.ts";
import { inflectNoun } from "../src/sv_morph.ts";

test("hasWord respects Swedish letters as word characters", () => {
  assert.ok(hasWord("såg en bil vid grinden", "bil"));
  assert.ok(!hasWord("tog en bild", "bil")); // bil ⊄ bild
  assert.ok(!hasWord("mobilen ringde", "bil"));
  assert.ok(hasWord("åkte förbi kvällen", "kvällen")); // JS \b would break on ä
});

test("tokenizeSv boundaries are identical to hasWord boundaries", () => {
  assert.deepEqual(tokenizeSv("Såg en BIL vid grinden."), ["såg", "en", "bil", "vid", "grinden"]);
  assert.deepEqual(tokenizeSv("kajak-paddlare, åä/ö1"), ["kajak", "paddlare", "åä", "ö1"]);
  assert.deepEqual(tokenizeSv(""), []);
});

test("withinOneEdit: sub/ins/del are one edit; transposition and 2-edits are not", () => {
  assert.ok(withinOneEdit("lastbil", "lastbil")); // equal
  assert.ok(withinOneEdit("lastbli", "lastbil") === false); // transposition = 2 edits
  assert.ok(withinOneEdit("lastbik", "lastbil")); // substitution
  assert.ok(withinOneEdit("lastbiil", "lastbil")); // insertion
  assert.ok(withinOneEdit("lastbi", "lastbil")); // deletion
  assert.ok(!withinOneEdit("lastb", "lastbil")); // length diff 2
  assert.ok(!withinOneEdit("lestbik", "lastbil")); // two substitutions
  assert.ok(withinOneEdit("xlastbil", "lastbil")); // leading insertion
  assert.ok(withinOneEdit("astbil", "lastbil")); // leading deletion
});

test("inflectNoun produces correct Swedish paradigms per class", () => {
  assert.deepEqual(inflectNoun("båt", "en-ar"), ["båt", "båten", "båtar", "båtarna"]);
  assert.deepEqual(inflectNoun("jolle", "en-ar"), ["jolle", "jollen", "jollar", "jollarna"]);
  assert.deepEqual(inflectNoun("cykel", "en-ar-syncope"), ["cykel", "cykeln", "cyklar", "cyklarna"]);
  assert.deepEqual(inflectNoun("traktor", "en-er"), ["traktor", "traktorn", "traktorer", "traktorerna"]);
  assert.deepEqual(inflectNoun("cyklist", "en-er"), ["cyklist", "cyklisten", "cyklister", "cyklisterna"]);
  assert.deepEqual(inflectNoun("kärra", "a-or"), ["kärra", "kärran", "kärror", "kärrorna"]);
  assert.deepEqual(inflectNoun("drönare", "are"), ["drönare", "drönaren", "drönarna"]);
  assert.deepEqual(inflectNoun("helikopter", "en-rar-syncope"), ["helikopter", "helikoptern", "helikoptrar", "helikoptrarna"]);
  assert.deepEqual(inflectNoun("flygplan", "et-0"), ["flygplan", "flygplanet", "flygplanen"]);
});
