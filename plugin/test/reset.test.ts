/*
 * Vault-reset planning — the batch plan must reproduce the packager's split
 * (scripts/package.sh: sort on (tidpunkt, file), chunks of 25, batch-NN).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { demoBatchPlan, demoOriginKeys, FacitEntry } from "../src/reset.ts";

function entry(file: string, tidpunkt: string, id?: string): FacitEntry {
  return { file, tidpunkt, id };
}

test("batch plan: chronological chunks with zero-padded folder names", () => {
  const facit: FacitEntry[] = [];
  for (let i = 0; i < 60; i++) {
    facit.push(entry(`TNR${String(i).padStart(6, "0")}.md`, `2026-08-${String(1 + (i % 28)).padStart(2, "0")}T05:00:00`));
  }
  const plan = demoBatchPlan(facit, 25);
  assert.equal(plan.size, 60);
  const counts = new Map<string, number>();
  for (const folder of plan.values()) counts.set(folder, (counts.get(folder) ?? 0) + 1);
  assert.deepEqual(
    [...counts.entries()].sort(),
    [["demo/batch-01", 25], ["demo/batch-02", 25], ["demo/batch-03", 10]],
  );
});

test("batch plan: sorts on tidpunkt, not filename (month wrap)", () => {
  // TNR carries day+time only — Sep 1 name-sorts BEFORE Aug 29. The plan must
  // follow tidpunkt so the restored layout matches the shipped one.
  const sep1 = entry("TNR010534.md", "2026-09-01T05:31:00");
  const aug29 = entry("TNR290539.md", "2026-08-29T05:39:00");
  const plan = demoBatchPlan([sep1, aug29], 1);
  assert.equal(plan.get("TNR290539.md"), "demo/batch-01");
  assert.equal(plan.get("TNR010534.md"), "demo/batch-02");
});

test("batch plan: ties on tidpunkt break by filename", () => {
  const a = entry("TNR010200.md", "2026-09-01T02:00:00");
  const b = entry("TNR010201.md", "2026-09-01T02:00:00");
  const plan = demoBatchPlan([b, a], 1);
  assert.equal(plan.get("TNR010200.md"), "demo/batch-01");
  assert.equal(plan.get("TNR010201.md"), "demo/batch-02");
});

test("origin keys: ids and filenames, id optional", () => {
  const keys = demoOriginKeys([entry("TNR010534.md", "2026-09-01T05:31:00", "7S-abc"), entry("TNR290539.md", "2026-08-29T05:39:00")]);
  assert.ok(keys.ids.has("7S-abc"));
  assert.equal(keys.ids.size, 1);
  assert.ok(keys.files.has("TNR010534.md"));
  assert.ok(keys.files.has("TNR290539.md"));
});
