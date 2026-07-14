/*
 * Vision bake-off harness (MANUAL — needs a live Ollama; NOT part of `npm test`).
 *
 * Measures candidate VLMs on ODEN's actual tasks before the model list is frozen
 * (the project's OOD-validation culture: our numbers, not benchmark blog posts).
 *
 *   npx tsx test/vision_harness.ts qwen3-vl:8b llava:7b          # plate passes
 *   npx tsx test/vision_harness.ts --sighting qwen3-vl:8b        # + full JSON
 *   OLLAMA_URL=http://box:11434 npx tsx test/vision_harness.ts qwen3-vl:32b
 *
 * Passes:
 *   1. SYNTHETIC plates (fixtures/vision/) — best-case OCR ceiling.
 *   2. REAL plates (fixtures/vision_real/, `plate_conf: high|medium`, `country: SE`)
 *      — the honest field-OCR number.
 *   Each read → exact / near (edit ≤2) / miss (says NONE) / WRONG (confident but
 *   incorrect — the hallucination class that motivates nomination-gating).
 *   3. --sighting: full PhotoSighting JSON prompt (the prompt the plugin will use)
 *      on every real image; prints model JSON next to the ground-truth note for
 *      human review, plus a rough person-count delta. Attribute F1 is judged by
 *      the operator from the printout (fuzzy: is "oliv" == "grön"?).
 *
 * Results feed docs/VISION_VALIDATION.md.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const OLLAMA = process.env.OLLAMA_URL ?? "http://localhost:11434";
const args = process.argv.slice(2);
const doSighting = args.includes("--sighting");
// --files a.jpeg,b.jpeg — limit the sighting pass (rerun failures cheaply).
const filesArg = args.find((a) => a.startsWith("--files="))?.slice("--files=".length);
const onlyFiles = filesArg ? new Set(filesArg.split(",")) : undefined;
const MODELS = args.filter((a) => !a.startsWith("--"));
if (MODELS.length === 0) MODELS.push("llava:7b");

const PLATE_PROMPT =
  "You are reading a Swedish vehicle registration plate from an image. " +
  "Reply with ONLY the plate characters (letters and digits, no spaces, no punctuation). " +
  "If no plate is clearly readable, reply exactly NONE.";

// The candidate PhotoSighting prompt (Swedish; lifted into photo_analysis.ts once
// frozen). Rules: describe only what is CLEARLY visible; prefer "okänd" over a
// guess; describe attributes, NEVER identity; age only as coarse bands.
const SIGHTING_PROMPT =
  "Du analyserar ett foto från en säkerhetsobservation. Svara ENDAST med JSON. " +
  "Beskriv bara det som TYDLIGT syns; använd \"okänd\" hellre än att gissa. " +
  "Identifiera ALDRIG vem en person är — beskriv endast synliga attribut. " +
  "Ålder endast som ung/medelålders/äldre/okänd.\n" +
  "Schema: {\"fordon\":[{\"typ\":\"\",\"marke\":\"\",\"farg\":\"\",\"skylt\":\"\"}]," +
  "\"personer\":[{\"kon\":\"man|kvinna|okänd\",\"alder\":\"\",\"klader\":[\"\"],\"utrustning\":[\"\"]}]," +
  "\"ovrigt\":[\"\"]}";

interface ChatResponse {
  message?: { content?: string };
  error?: string;
}

async function chat(model: string, prompt: string, imageB64: string, json = false): Promise<{ text: string; ms: number }> {
  const t0 = Date.now();
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      keep_alive: "10m",
      format: json ? "json" : undefined,
      // num_ctx: Ollama's DEFAULT is 4096 — a VLM image eats ~2-4k tokens, so
      // structured-output runs truncate mid-JSON ("ogiltig JSON" epidemic) or
      // 400 outright. 8192 fits the 8b on 16 GB. The real integration must set
      // this too (documented in VISION_VALIDATION.md).
      options: { temperature: 0, num_ctx: 8192 },
      messages: [{ role: "user", content: prompt, images: [imageB64] }],
    }),
    signal: AbortSignal.timeout(600_000),
  });
  const body = (await res.json()) as ChatResponse;
  if (!res.ok || body.error) throw new Error(body.error ?? `HTTP ${res.status}`);
  return { text: body.message?.content ?? "", ms: Date.now() - t0 };
}

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9ÅÄÖ]/g, "");

function editDist(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

const b64 = (dir: string, f: string) => readFileSync(join(dir, f)).toString("base64");

/** Score a plate pass over `items` (file → expected plate). */
async function platePass(model: string, dir: string, items: [string, string][], title: string): Promise<void> {
  let exact = 0, near = 0, miss = 0, wrong = 0;
  const times: number[] = [];
  const notes: string[] = [];
  for (const [f, wantRaw] of items) {
    const want = norm(wantRaw);
    const { text, ms } = await chat(model, PLATE_PROMPT, b64(dir, f));
    times.push(ms);
    const raw = text.trim();
    const got = norm(raw.replace(/\bNONE\b/i, ""));
    if (got === "" || /^NONE$/i.test(raw)) miss++;
    else if (got === want) exact++;
    else if (editDist(got, want) <= 2) { near++; notes.push(`${f}: ${want} → ${got} (near)`); }
    else { wrong++; notes.push(`${f}: ${want} → ${got} (WRONG)`); }
    process.stdout.write(".");
  }
  const n = items.length;
  const avg = times.length ? Math.round(times.reduce((s, t) => s + t, 0) / times.length) : 0;
  console.log(`\n  ${title} (n=${n}): exact ${exact} (${Math.round((100 * exact) / n)}%)  near ${near}  miss ${miss}  WRONG ${wrong}  ~${avg} ms/img`);
  for (const nt of notes) console.log(`      ${nt}`);
}

interface Truth {
  plate?: string | null;
  plate_conf?: "high" | "medium" | "low";
  country?: string;
  persons?: unknown[];
  hard?: boolean;
  expect_unknown?: boolean;
  notes?: string;
}

async function sightingPass(model: string, dir: string, truth: Record<string, Truth>): Promise<void> {
  console.log(`\n  --sighting (full JSON prompt; review model vs note):`);
  let countOk = 0, countTot = 0, failures = 0;
  const entries = Object.entries(truth).filter(([k]) => !k.startsWith("_") && (!onlyFiles || onlyFiles.has(k)));
  for (const [f, t] of entries) {
    let line: string;
    let delta = "";
    // Per-image tolerance: one stalled call (Mac sleep, model reload) must not
    // kill the pass — retry once, then record the failure and continue.
    for (let attempt = 1; ; attempt++) {
      try {
        const { text, ms } = await chat(model, SIGHTING_PROMPT, b64(dir, f), true);
        try {
          const parsed = JSON.parse(text) as { personer?: unknown[] };
          const got = parsed.personer?.length ?? 0;
          const want = t.persons?.length ?? 0;
          countTot++;
          if (Math.abs(got - want) <= (want >= 4 ? 1 : 0)) countOk++;
          delta = ` [personer modell ${got} / facit ${want}]`;
        } catch {
          delta = " [ogiltig JSON]";
        }
        line = `${text.replace(/\s+/g, " ").slice(0, 240)} (${ms} ms)`;
        break;
      } catch (err) {
        if (attempt >= 2) {
          line = `FAILED — ${(err as Error).message}`;
          failures++;
          break;
        }
      }
    }
    const flag = t.expect_unknown ? " ⚠okänd-förväntat" : t.hard ? " (svår)" : "";
    console.log(`    ${f}${flag} — facit: ${t.notes}${delta}`);
    console.log(`      → ${line}`);
  }
  console.log(`  personantal rätt (±1 vid grupper ≥4): ${countOk}/${countTot}; misslyckade anrop: ${failures}`);
}

async function main(): Promise<void> {
  console.log(`Ollama: ${OLLAMA}${doSighting ? "  (+sighting)" : ""}`);
  const synthDir = join(here, "fixtures", "vision");
  const realDir = join(here, "fixtures", "vision_real");

  const synthTruth: Record<string, { plate: string }> = JSON.parse(readFileSync(join(synthDir, "ground_truth.json"), "utf-8"));
  const synthItems = readdirSync(synthDir).filter((f) => f.endsWith(".jpg")).sort().map((f) => [f, synthTruth[f].plate] as [string, string]);

  const hasReal = existsSync(realDir) && existsSync(join(realDir, "ground_truth.json"));
  const realTruth: Record<string, Truth> = hasReal ? JSON.parse(readFileSync(join(realDir, "ground_truth.json"), "utf-8")) : {};
  // Auto-scorable real plates: confident + Swedish + a known plate string.
  const realPlateItems = Object.entries(realTruth)
    .filter(([k, t]) => !k.startsWith("_") && t.country === "SE" && (t.plate_conf === "high" || t.plate_conf === "medium") && t.plate)
    .map(([f, t]) => [f, t.plate as string] as [string, string]);

  for (const model of MODELS) {
    console.log(`\n=== ${model} ===`);
    try {
      // Warm-up (model load) — excluded from latency.
      await chat(model, "Reply OK.", b64(synthDir, synthItems[0][0]));
      // --sighting runs ONLY the sighting pass (the plate passes are measured
      // separately and are expensive to repeat at VLM latencies).
      if (doSighting) {
        if (hasReal) await sightingPass(model, realDir, realTruth);
      } else {
        await platePass(model, synthDir, synthItems, "synthetic cards (best-case OCR)");
        if (hasReal) await platePass(model, realDir, realPlateItems, "REAL Swedish plates (field OCR)");
      }
    } catch (err) {
      console.error(`  ${model}: FAILED — ${(err as Error).message}`);
    }
  }
  if (!hasReal) console.log("\n(vision_real/ absent — real-photo passes skipped)");
}

void main();
