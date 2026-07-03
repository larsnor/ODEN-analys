/* Conversation seam — deterministic engine round-trip. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, Report } from "../src/parse.ts";
import { buildPlateEntities } from "../src/reid.ts";
import { KB } from "../src/query.ts";
import { converse, DeterministicConversation } from "../src/conversation.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures");
function kb(): KB {
  const dir = join(root, "reports");
  const reports: Report[] = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports/${f}`));
  return { reports, vehicles: buildPlateEntities(reports).entities, marks: [] };
}

test("deterministic engine: toQuery = keyword parse, narrate = the answer markdown", async () => {
  const eng = new DeterministicConversation();
  const q = await eng.toQuery("återkommande fordon");
  assert.equal(q.intent, "recurring");
  const { query, answer, prose } = await converse(eng, "RJK241", kb());
  assert.equal(query.intent, "entity");
  assert.equal(prose, answer.markdown); // narrate is a pass-through in Phase A
  assert.match(prose, /RJK241/);
  assert.match(prose, /\[\[TNR/); // citations preserved
});

test("converse is deterministic", async () => {
  const k = kb();
  const a = await converse(new DeterministicConversation(), "återkommande", k);
  const b = await converse(new DeterministicConversation(), "återkommande", k);
  assert.equal(a.prose, b.prose);
});
