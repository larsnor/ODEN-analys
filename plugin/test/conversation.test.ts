/* Conversation seam — deterministic engine round-trip. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, Report } from "../src/parse.ts";
import { buildPlateEntities } from "../src/reid.ts";
import { KB } from "../src/query.ts";
import { converse, DeterministicConversation, OllamaConversation, stripThink } from "../src/conversation.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures");
function kb(): KB {
  const dir = join(root, "reports");
  const reports: Report[] = readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports/${f}`));
  return { reports, vehicles: buildPlateEntities(reports).entities, marks: [], actors: [], places: [], larm: [], craft: [] };
}

test("deterministic engine: toQuery = keyword parse, narrate = the answer markdown", async () => {
  const eng = new DeterministicConversation();
  const q = await eng.toQuery("återkommande fordon");
  assert.equal(q.shape, "list");
  assert.ok(q.minCount && q.minCount >= 2);
  const { query, answer, prose } = await converse(eng, "RJK241", kb());
  assert.equal(query.target, "fordon");
  assert.equal(query.shape, "detail");
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

test("narrate skips the LLM for large results (deterministic markdown IS the answer)", async () => {
  // Unreachable server: the size cap must short-circuit BEFORE any network call,
  // so a big result comes back verbatim and instantly.
  const eng = new OllamaConversation({ url: "http://127.0.0.1:1", model: "x", timeoutMs: 1 });
  const big = "# Larm\n" + "- rad\n".repeat(600);
  const t0 = Date.now();
  const prose = await eng.narrate({ query: await new DeterministicConversation().toQuery("larm"), markdown: big, rowCount: 600 });
  assert.equal(prose, big);
  assert.ok(Date.now() - t0 < 500, "large-answer narrate must not wait on the model");
});

test("stripThink removes a qwen3 reasoning preamble", () => {
  assert.equal(stripThink("<think>hm…</think>\nSvar."), "Svar.");
  assert.equal(stripThink("Svar utan tänk."), "Svar utan tänk.");
});
