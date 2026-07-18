/*
 * Ollama client (the swappable LLM engine). Thin HTTP wrapper around a LOCAL
 * Ollama server — no cloud, no keys (§8.2). Today it serves the vision capability
 * (photo → PhotoSighting); the same client + model will later serve text-reasoning
 * (qwen3-vl is a full language model, so one pulled model covers both).
 *
 * Degrade-not-crash: any failure returns null / {ok:false}; the caller drops to
 * deterministic and greys the capability chip. Detection never depends on this.
 */
import { PhotoSighting, PhotoVision, SIGHTING_PROMPT, parseSighting } from "./photo_analysis";
import { TextExtraction, TEXT_PROMPT, parseTextExtraction } from "./text_reasoning";
import { threatConcepts } from "./suspicion";

/** The curated model list — the settings dropdown, frozen from docs/VISION_VALIDATION.md.
 *  Default first. 8b/32b are reserved for higher-RAM machines (the 8b swaps on 16 GB). */
export const VISION_MODELS = [
  { tag: "qwen3-vl:4b", label: "qwen3-vl:4b — standard (snabb, ~3 GB)" },
  { tag: "qwen3-vl:8b", label: "qwen3-vl:8b — noggrann (≥32 GB RAM)" },
  { tag: "qwen3-vl:32b", label: "qwen3-vl:32b — insatsmaskin (GPU/stor RAM)" },
] as const;

export const DEFAULT_VISION_MODEL = VISION_MODELS[0].tag;
export const DEFAULT_OLLAMA_URL = "http://localhost:11434";

export interface OllamaOpts {
  url: string;
  model: string;
  timeoutMs?: number;
}

export interface HealthResult {
  ok: boolean;
  models?: string[];
  error?: string;
}

/** base64 a byte array without Buffer (browser/Electron `btoa`), chunked to stay
 *  under the argument-count limit for large images. */
function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

interface ChatMessage {
  role: "user" | "system";
  content: string;
  images?: string[];
}

/** One raw Ollama /api/chat turn → the message content, or null on any failure
 *  (network/timeout/non-2xx). num_ctx>=8192 is MANDATORY (the 4096 default
 *  truncates structured JSON mid-object — proven in the bake-off). */
export async function ollamaChat(
  opts: OllamaOpts,
  messages: ChatMessage[],
  json = false,
): Promise<string | null> {
  try {
    const res = await fetch(`${opts.url.replace(/\/+$/, "")}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: opts.model,
        stream: false,
        keep_alive: "10m",
        format: json ? "json" : undefined,
        options: { temperature: 0, num_ctx: 8192 },
        messages,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 600_000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { message?: { content?: string } };
    return body.message?.content ?? null;
  } catch {
    return null;
  }
}

/** Is Ollama reachable, and which models are pulled? Drives the connection dot. */
export async function ollamaHealth(url: string): Promise<HealthResult> {
  try {
    const res = await fetch(`${url.replace(/\/+$/, "")}/api/tags`, { signal: AbortSignal.timeout(5_000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const body = (await res.json()) as { models?: { name?: string }[] };
    return { ok: true, models: (body.models ?? []).map((m) => m.name ?? "").filter(Boolean) };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}

export class OllamaVision implements PhotoVision {
  constructor(private opts: OllamaOpts) {}
  async analyzePhoto(image: Uint8Array): Promise<PhotoSighting | null> {
    const text = await ollamaChat(this.opts, [{ role: "user", content: SIGHTING_PROMPT, images: [toBase64(image)] }], true);
    return text ? parseSighting(text) : null;
  }
  health(): Promise<HealthResult> {
    return ollamaHealth(this.opts.url);
  }
}

/** Open-vocabulary text extractor (kännetecken + behaviours the frozen keyword
 *  lists miss). Same model as vision (qwen3-vl is a full LM). */
export class OllamaText {
  constructor(private opts: OllamaOpts) {}
  async extract(prose: string): Promise<TextExtraction | null> {
    const raw = await ollamaChat(this.opts, [{ role: "user", content: `${TEXT_PROMPT}\n\nTEXT:\n${prose}` }], true);
    if (!raw) return null;
    const concepts = new Map(threatConcepts().map((c) => [c.key, { label: c.label, weight: c.weight }]));
    return parseTextExtraction(raw, concepts);
  }
  health(): Promise<HealthResult> {
    return ollamaHealth(this.opts.url);
  }
}

/** Deterministic stub for CI (no live Ollama) — returns a preset sighting. */
export class FakePhotoVision implements PhotoVision {
  constructor(private canned: PhotoSighting | null = null) {}
  analyzePhoto(): Promise<PhotoSighting | null> {
    return Promise.resolve(this.canned);
  }
}
