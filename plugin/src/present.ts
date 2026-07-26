/*
 * Presentation layer (pure) — turns internal analysis facts into OPERATOR
 * language. The single place that decides what the human sees, so the UI never
 * leaks architecture meta (internal job names, design-doc references, raw
 * scores, +weights, "deterministisk", "nominering", signatures).
 */
import { Signal } from "./suspicion";

/** Qualitative suspicion band from the (hidden) numeric score. */
export function suspicionLevel(score: number): "Hög" | "Förhöjd" | "Att bevaka" | "" {
  if (score >= 9) return "Hög";
  if (score >= 6) return "Förhöjd";
  if (score >= 5) return "Att bevaka";
  return "";
}

/** Clean operator phrase for one suspicion reason — no weights, no jargon. */
const REASON_PHRASE: Record<string, string> = {
  proximity: "nära objektet",
  natt: "nattetid",
  skymning: "skymning/gryning",
  "beteende:observation": "övervakande beteende",
  "beteende:optik": "kamera/kikare",
  "beteende:registrering": "antecknande/mätande",
  "beteende:kontraspaning": "kontraspaningsbeteende",
  "beteende:dröjande": "dröjande/upprepad närvaro",
  "beteende:perimeter": "närmande mot objektet",
  "beteende:teknik": "teknisk avlyssning/spaning",
  "beteende:sabotage": "sabotage/åverkan",
  "beteende:attentat": "misstänkt föremål/fordonshot",
  "beteende:infiltration": "obehörigt tillträde",
  återkomst: "återkommande",
};

export function reasonPhrase(s: Signal): string {
  if (REASON_PHRASE[s.key]) return REASON_PHRASE[s.key];
  // Craft signals (farkost:<type>) — the type label reads as its own reason
  // (e.g. "drönare" alongside "nära objektet", "nattetid").
  if (s.key.startsWith("farkost:")) return s.label.replace(/^farkost:\s*/i, "");
  // Fallback: scrub any "(+N)" weight or "(~123 m)" distance from a raw label.
  return s.label.replace(/\s*\(\+\d+\)/g, "").replace(/\s*\(~\d+\s*m\)/g, "").trim();
}

/** Distinct, ordered operator phrases for a set of reasons. */
export function reasonPhrases(reasons: Signal[]): string[] {
  const out: string[] = [];
  for (const r of reasons) {
    const p = reasonPhrase(r);
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}
