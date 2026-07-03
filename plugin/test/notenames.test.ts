/* Note basenames — clean for normal names; hash only when truncated. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { safeAgentFilename } from "../src/notenames.ts";

test("normal-length names are clean — no (xxxx) suffix", () => {
  assert.equal(safeAgentFilename("Aktör RJK241", "fordon:RJK241"), "Aktör RJK241.md");
  assert.equal(
    safeAgentFilename("Misstänkt person mörk hoodie, kamera med teleobjektiv, ung", "person:…"),
    "Misstänkt person mörk hoodie, kamera med teleobjektiv, ung.md",
  );
  assert.doesNotMatch(safeAgentFilename("Plats Norra grinden", "plats:33VXF"), /\([a-z0-9]{4}\)/);
});

test("filesystem-forbidden characters are stripped", () => {
  const f = safeAgentFilename("Aktör a/b: c*d?", "k");
  assert.doesNotMatch(f, /[\\/:*?"<>|#^[\]]/);
  assert.ok(f.endsWith(".md"));
});

test("only overlong names get a short stable hash (tail could otherwise collide)", () => {
  const long = "x".repeat(90);
  const a = safeAgentFilename(long + "AAA", "keyA");
  const b = safeAgentFilename(long + "BBB", "keyB");
  assert.match(a, / \([a-z0-9]{4}\)\.md$/, "truncated → disambiguated");
  assert.notEqual(a, b, "same prefix, different keys → distinct files");
  // Same key → same file (deterministic, idempotent).
  assert.equal(safeAgentFilename(long, "keyA"), safeAgentFilename(long, "keyA"));
});
