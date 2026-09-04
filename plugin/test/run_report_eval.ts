/*
 * CLI: tier-2 djupanalys eval against a generator corpus with facit (LIVE
 * Ollama — deliberately NOT in `npm test`).
 *
 *   npx tsx test/run_report_eval.ts <corpusDir> [model] [url] [aoiLat,aoiLon]
 *
 * Prints (a) digest stats (reports, token estimate, chosen num_ctx), (b) the
 * guarded tier-2 hypotheses, (c) the facit's planted hostile cells (member,
 * subtype, TNRs) — side by side for HUMAN judgment: do the hypotheses point
 * at the cells? The sharpest case is the infiltration cell: individually
 * innocent sightings whose pattern only exists across messages. Results go in
 * docs/REPORT_VALIDATION.md.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as os from "node:os";
import { parseReport } from "../src/parse.ts";
import { ollamaChat, ollamaModelCtx, DEFAULT_OLLAMA_URL } from "../src/llm.ts";
import { stripThink, ensureCitations } from "../src/conversation.ts";
import {
  analyzeRange, buildLlmDigest, computeNumCtx, estimateTokens, presetRange,
  sanitizeHypotheses, CHUNK_SYS, HYPOTHESIS_SYS, SYNTH_SYS,
} from "../src/report.ts";
import { PluginState } from "../src/derive.ts";

const [dir, model = "qwen3-vl:4b", url = DEFAULT_OLLAMA_URL, aoiRaw] = process.argv.slice(2);
if (!dir) {
  console.error("usage: npx tsx test/run_report_eval.ts <corpusDir> [model] [url] [aoiLat,aoiLon]");
  process.exit(1);
}
const aoiParts = (aoiRaw ?? "59.2624,17.7123").split(",").map(Number);
const AOI = { lat: aoiParts[0], lon: aoiParts[1] };

const state: PluginState = {
  entitiesFolder: "entities",
  locationNicknames: {}, locationMerges: {}, locationNameAsked: {},
  actorNames: {}, actorMerges: {}, actorDecisions: {}, markDecisions: {},
  actorThreshold: 1,
};

const reports = readdirSync(dir)
  .filter((f) => /^TNR\d+(_\d+)?\.md$/.test(f))
  .map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), f));
const range = presetRange("allt", reports)!;
const analysis = analyzeRange(reports, range, { protectedLat: AOI.lat, protectedLon: AOI.lon, threshold: 5 }, state, undefined, AOI);

const probe = buildLlmDigest(analysis, state, Number.MAX_SAFE_INTEGER);
const chars = probe.chunked ? 0 : probe.text.length;
const modelMax = await ollamaModelCtx(url, model);
const numCtx = computeNumCtx(estimateTokens(chars), modelMax, os.totalmem());
const digest = buildLlmDigest(analysis, state, (numCtx - 1500) * 3);

console.log(`== ${dir}: ${analysis.reports.length} rapporter · digest ~${estimateTokens(chars)} tokens · num_ctx ${numCtx} (modelltak ${modelMax}) · ${model}`);
console.log(digest.chunked ? `== map-reduce: ${digest.chunks.length} dygnschunkar` : "== single-shot");

const t0 = Date.now();
const opts = { url, model, timeoutMs: 600_000, numCtx };
let prose: string | null = null;
let digestText = "";
if (!digest.chunked) {
  digestText = digest.text;
  prose = await ollamaChat(opts, [
    { role: "system", content: HYPOTHESIS_SYS },
    { role: "user", content: digest.text },
  ], false, false);
} else {
  const points: string[] = [];
  for (const c of digest.chunks) {
    digestText += c.text + "\n";
    process.stderr.write(`  dygn ${c.label}…\n`);
    const p = await ollamaChat(opts, [{ role: "system", content: CHUNK_SYS }, { role: "user", content: c.text }], false, false);
    if (p) points.push(`${c.label}:\n${stripThink(p)}`);
  }
  prose = points.length
    ? await ollamaChat(opts, [{ role: "system", content: SYNTH_SYS }, { role: "user", content: points.join("\n\n") }], false, false)
    : null;
}
const secs = Math.round((Date.now() - t0) / 1000);

console.log(`\n== HYPOTESER (${secs}s) =====================================`);
if (!prose) {
  console.log("(inget svar — Ollama nere/timeout)");
} else {
  const allowed = new Set(analysis.reports.map((r) => r.tnr));
  const { text, invented } = sanitizeHypotheses(stripThink(prose).trim(), allowed);
  console.log(ensureCitations(text, digestText));
  console.log(`\nhallucinerade TNR: ${invented.length}${invented.length ? " — " + invented.join(", ") : ""}`);
}

console.log("\n== FACIT (planterade celler) ================================");
try {
  const gt = JSON.parse(readFileSync(join(dir, "ground_truth.json"), "utf-8")) as {
    file: string; tnr: string; truth: string; subtype?: string | null; member?: string | null; sector?: number;
  }[];
  const cells = new Map<string, { subtype: string; tnrs: string[] }>();
  for (const g of gt) {
    if (!g.truth.startsWith("hostile") || !g.member) continue;
    const key = g.member;
    if (!cells.has(key)) cells.set(key, { subtype: g.subtype ?? "?", tnrs: [] });
    cells.get(key)!.tnrs.push(g.tnr);
  }
  for (const [member, c] of [...cells.entries()].sort()) {
    console.log(`  ${member} (${c.subtype}): ${c.tnrs.map((t) => `TNR${t}`).join(", ")}`);
  }
  if (!cells.size) console.log("  (facit saknar celler — kör add-hostiles på korpusen)");
} catch {
  console.log("  (ingen ground_truth.json i korpusen)");
}
