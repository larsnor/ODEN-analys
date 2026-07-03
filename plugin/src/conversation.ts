/*
 * Conversation seam — the chatbox routes through this so the engine
 * (deterministic now, Ollama LLM later) is a drop-in swap. The LLM is only ever
 * a TRANSLATOR (free text → the SAME StructuredQuery) and NARRATOR (deterministic
 * result → prose); findings never originate in the model (§7.1).
 */
import { executeQuery, KB, parseQuery, QueryAnswer, StructuredQuery } from "./query";

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
