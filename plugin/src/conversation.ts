/*
 * Conversation seam — the chatbox routes through this so the engine
 * (deterministic now, Ollama LLM later) is a drop-in swap. The LLM is only ever
 * a TRANSLATOR (free text → the SAME StructuredQuery) and NARRATOR (deterministic
 * result → prose); findings never originate in the model (§7.1).
 */
import { executeQuery, KB, parseQuery, QueryAnswer, Shape, StructuredQuery, Target } from "./query";
import { OllamaOpts, ollamaChat } from "./llm";

export interface Conversation {
  /** Free-text utterance → structured query (interpretation is shown to the operator). */
  toQuery(text: string): Promise<StructuredQuery>;
  /** Deterministic query result → operator-facing prose. */
  narrate(answer: QueryAnswer): Promise<string>;
}

/** Phase A engine: deterministic keyword parser + raw deterministic answer. */
export class DeterministicConversation implements Conversation {
  async toQuery(text: string): Promise<StructuredQuery> {
    return parseQuery(text);
  }
  async narrate(answer: QueryAnswer): Promise<string> {
    return answer.markdown;
  }
}

const SHAPES: Shape[] = ["detail", "list", "timeline", "summary"];
const TARGETS: Target[] = ["reports", "fordon", "kannetecken", "aktor", "plats", "larm", "farkost", "alla"];

/** Above this size the deterministic markdown IS the answer. Re-telling a large
 *  result list through a small local model is minutes of prompt-processing +
 *  generation (reads as a locked chat) and lossy (rows get dropped). Narration
 *  adds value on SMALL results only; big tables render deterministically. */
const NARRATE_MAX_CHARS = 1500;
/** Chat calls get SHORT timeouts (the batch vision/text jobs keep their long
 *  ones): a translate that hasn't answered in 30 s / a narrate in 60 s falls
 *  back to the deterministic result instead of holding the chat. */
const TRANSLATE_TIMEOUT_MS = 30_000;
const NARRATE_TIMEOUT_MS = 60_000;

/** Strip a qwen3 `<think>…</think>` reasoning preamble (belt-and-braces for
 *  servers that ignore `think:false`). */
export function stripThink(s: string): string {
  return s.replace(/^\s*<think>[\s\S]*?<\/think>\s*/i, "");
}

const QUERY_PROMPT =
  "Tolka operatörens fråga till ett strukturerat sökuttryck. Svara ENDAST med JSON: " +
  '{"shape":"","target":"","term":"","place":"","observer":""}. ' +
  "shape ∈ [detail, list, timeline, summary] (hur svaret ska visas); " +
  "target ∈ [reports, fordon, kannetecken, aktor, plats, larm, farkost, alla] (vad frågan gäller; " +
  "farkost = drönare/båt/traktor/lastbil m.m.); term = fritext, entitets-id eller farkosttyp; " +
  "place = platsnamn; observer = anropssignal (t.ex. AQ). Utelämna fält du är osäker på.";

const NARRATE_SYS =
  "Du är ODEN:s assistent. Du omformulerar FÄRDIGA sökresultat till kort, saklig " +
  "svenska. Du hittar ALDRIG på fakta — använd bara det som står i resultatet. " +
  "Är resultatet tomt, säg det kort.";

/** Phase B chat engine (local Ollama). The LLM only REFINES the deterministic
 *  parse (intent/kind/term/place) and NARRATES the deterministic answer — findings
 *  never originate in the model (§7.1). Any failure falls back to deterministic. */
export class OllamaConversation implements Conversation {
  constructor(private opts: OllamaOpts) {}

  async toQuery(text: string): Promise<StructuredQuery> {
    const base = parseQuery(text); // deterministic floor: time window, echo, raw
    const raw = await ollamaChat(
      { ...this.opts, timeoutMs: TRANSLATE_TIMEOUT_MS },
      [{ role: "user", content: `${QUERY_PROMPT}\n\nFRÅGA: ${text}` }],
      true,
      false,
    );
    if (!raw) return base;
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      // The LLM only REFINES the deterministic parse — never invents an axis. The
      // guard (identity write-wall) is deterministic-only and never overridden.
      const shape = typeof o.shape === "string" && (SHAPES as string[]).includes(o.shape) ? (o.shape as Shape) : base.shape;
      const target = typeof o.target === "string" && (TARGETS as string[]).includes(o.target) ? (o.target as Target) : base.target;
      const term = typeof o.term === "string" && o.term.trim() ? o.term.trim() : base.term;
      const place = typeof o.place === "string" && o.place.trim() ? o.place.trim().toLowerCase() : base.place;
      const observer = typeof o.observer === "string" && o.observer.trim() ? o.observer.trim().toUpperCase() : base.observer;
      return { ...base, shape, target, term, place, observer, echo: `${base.echo} (LLM-tolkad)` };
    } catch {
      return base;
    }
  }

  async narrate(answer: QueryAnswer): Promise<string> {
    // A large deterministic result IS the operator-readable answer — skip the LLM.
    if (answer.markdown.length > NARRATE_MAX_CHARS) return answer.markdown;
    const raw = await ollamaChat(
      { ...this.opts, timeoutMs: NARRATE_TIMEOUT_MS },
      [
        { role: "system", content: NARRATE_SYS },
        { role: "user", content: `Fråga: ${answer.query.echo}\nResultat (Markdown):\n${answer.markdown}` },
      ],
      false,
      false,
    );
    const clean = raw ? stripThink(raw).trim() : "";
    return clean || answer.markdown; // fall back to the deterministic answer
  }
}

/** Run one chat turn through a given engine over the current KB. */
export async function converse(
  engine: Conversation,
  text: string,
  kb: KB,
): Promise<{ query: StructuredQuery; answer: QueryAnswer; prose: string }> {
  const query = await engine.toQuery(text);
  const answer = executeQuery(query, kb);
  const prose = await engine.narrate(answer);
  return { query, answer, prose };
}
