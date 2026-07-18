/*
 * Conversation seam — the chatbox routes through this so the engine
 * (deterministic now, Ollama LLM later) is a drop-in swap. The LLM is only ever
 * a TRANSLATOR (free text → the SAME StructuredQuery) and NARRATOR (deterministic
 * result → prose); findings never originate in the model (§7.1).
 */
import { executeQuery, KB, Kind, parseQuery, QueryAnswer, QueryIntent, StructuredQuery } from "./query";
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

const INTENTS: QueryIntent[] = ["entity", "recurring", "observations", "search", "identity-guard"];
const KINDS: Kind[] = ["fordon", "marke", "alla"];

const QUERY_PROMPT =
  "Tolka operatörens fråga till ett strukturerat sökuttryck. Svara ENDAST med JSON: " +
  '{"intent":"","kind":"","term":"","place":""}. ' +
  "intent ∈ [entity, recurring, observations, search, identity-guard]; " +
  "kind ∈ [fordon, marke, alla]; term = fritext eller entitets-id; place = platsnamn. " +
  "Utelämna fält du är osäker på.";

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
    const raw = await ollamaChat(this.opts, [{ role: "user", content: `${QUERY_PROMPT}\n\nFRÅGA: ${text}` }], true);
    if (!raw) return base;
    try {
      const o = JSON.parse(raw) as Record<string, unknown>;
      const intent = typeof o.intent === "string" && (INTENTS as string[]).includes(o.intent) ? (o.intent as QueryIntent) : base.intent;
      const kind = typeof o.kind === "string" && (KINDS as string[]).includes(o.kind) ? (o.kind as Kind) : base.kind;
      const term = typeof o.term === "string" && o.term.trim() ? o.term.trim() : base.term;
      const place = typeof o.place === "string" && o.place.trim() ? o.place.trim().toLowerCase() : base.place;
      return { ...base, intent, kind, term, place, echo: `${base.echo} (LLM-tolkad)` };
    } catch {
      return base;
    }
  }

  async narrate(answer: QueryAnswer): Promise<string> {
    const raw = await ollamaChat(
      this.opts,
      [
        { role: "system", content: NARRATE_SYS },
        { role: "user", content: `Fråga: ${answer.query.echo}\nResultat (Markdown):\n${answer.markdown}` },
      ],
      false,
    );
    return raw?.trim() || answer.markdown; // fall back to the deterministic answer
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
