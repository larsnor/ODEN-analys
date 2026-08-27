/*
 * Craft-vocabulary PARITY guard (GitHub issue #2).
 *
 * The 7S report FORMAT has a parity contract with 7S-generator (TODO.md); the
 * prose VOCABULARY had none. Consequence: `cyklist` (43 reports) and `paketbil`
 * (47 reports) went unmatched in our own committed corpus for as long as it has
 * existed, and every existing craft test still passed — because they only ever
 * asserted phrasings the taxonomy already knew.
 *
 * Two layers, because they catch different failures:
 *   1. PER-PHRASE expectations — catches a missing surface form (this bug).
 *   2. TYPE REACHABILITY — catches a whole craft type falling out of the
 *      taxonomy. NB this is the weaker guard: it would NOT have caught issue #2,
 *      since cykel/lastbil/båt each stayed "covered" via their other forms.
 *   3. CORPUS FLOORS — locks the fix against silent regression on real corpora.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { CRAFT_TAXONOMY, matchCraftTypes } from "../src/domain.ts";
import { extractAllCraft } from "../src/craft.ts";
import { parseReport, Report } from "../src/parse.ts";
import { CRAFT_PHRASES, CRAFT_BENIGN } from "./fixtures/craft_phrases.ts";

const here = dirname(fileURLToPath(import.meta.url));
const corpusDir = (name: string) => join(here, "fixtures", name);

function load(name: string): Report[] {
  const dir = corpusDir(name);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `${name}/${f}`));
}

/** reports (not observations) carrying each craft type. */
function countByType(reports: Report[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of extractAllCraft(reports)) m.set(c.type, (m.get(c.type) ?? 0) + 1);
  return m;
}

test("every craft phrasing resolves to exactly its expected type(s)", () => {
  const failures: string[] = [];
  for (const p of CRAFT_PHRASES) {
    const got = matchCraftTypes(p.text).map((t) => t.key).sort();
    const want = [...p.expect].sort();
    if (got.join(",") !== want.join(",")) {
      failures.push(`[${p.source}] "${p.text.slice(0, 60)}" → [${got}] expected [${want}]`);
    }
  }
  assert.deepEqual(failures, [], `craft phrasings mis-typed:\n  ${failures.join("\n  ")}`);
});

test("benign near-misses yield NO craft (substring/stem precision guard)", () => {
  const fired = CRAFT_BENIGN.map((t) => ({ t, got: matchCraftTypes(t).map((x) => x.key) })).filter((x) => x.got.length);
  assert.deepEqual(fired, [], `benign prose falsely typed: ${fired.map((f) => `${f.t} → ${f.got}`).join(" | ")}`);
});

test("PARITY: every craft type in the taxonomy is reachable from realistic prose", () => {
  const hits = new Map<string, number>();
  for (const p of CRAFT_PHRASES) for (const t of matchCraftTypes(p.text)) hits.set(t.key, (hits.get(t.key) ?? 0) + 1);

  // Print the table so a partial gap is visible even when the assertion passes.
  const rows = CRAFT_TAXONOMY.map((t) => {
    const real = CRAFT_PHRASES.filter((p) => p.source !== "authored" && p.expect.includes(t.key)).length;
    return `  ${t.key.padEnd(12)} hits=${String(hits.get(t.key) ?? 0).padStart(2)}  independent-prose=${real}`;
  });
  console.log(`\ncraft parity (independent-prose = phrasings NOT authored against the taxonomy):\n${rows.join("\n")}\n`);

  const unreachable = CRAFT_TAXONOMY.filter((t) => !hits.has(t.key)).map((t) => t.key);
  assert.deepEqual(unreachable, [], `craft types unreachable from any phrasing: ${unreachable}`);
});

// --- corpus floors: the fix must not silently regress on real corpora --------
// Measured over the committed corpora at the time issue #2 was fixed. `>=` not
// `===` so ADDING vocabulary never fails the test; only losing coverage does.

const FLOORS: Record<string, Record<string, number>> = {
  reports_new: { cykel: 86, lastbil: 47, bil: 41 },
  reports: { cykel: 14, lastbil: 20, traktor: 19, sparkcykel: 14 },
};

for (const [corpus, floors] of Object.entries(FLOORS)) {
  test(`corpus floor: ${corpus} keeps its craft coverage`, { skip: !existsSync(corpusDir(corpus)) }, () => {
    const counts = countByType(load(corpus));
    for (const [type, min] of Object.entries(floors)) {
      const got = counts.get(type) ?? 0;
      assert.ok(got >= min, `${corpus}: craft "${type}" fell to ${got} reports (floor ${min})`);
    }
  });
}
