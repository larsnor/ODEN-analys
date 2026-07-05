/*
 * Behaviour-vocabulary scorer (validation, not a unit test).
 *
 * Measures how well suspicion.ts THREAT_INDICATORS recognises hostile ACTIVITY from
 * out-of-distribution prose (sentences authored independently of the stem list), and
 * how often it false-fires on benign near-misses. Behaviour is ISOLATED the way
 * recon_indicators.test.ts does it: score each sentence far from the object in
 * daytime, so proximity/time contribute 0 and only a `beteende:*` signal scores.
 *
 * Complements test/scoring_reid.ts (the mark re-id layer). Prints recall/precision;
 * the harness asserts only the corpus-independent safety property (benign → no fire).
 */
import { scoreReport } from "../src/suspicion.ts";
import { Report } from "../src/parse.ts";

export type Mode = "recon" | "sabotage" | "infiltration" | "terrorism" | "benign";
export interface BehaviourCase {
  text: string;
  mode: Mode;
}

/** The `beteende:*` categories a sentence trips, isolated from proximity/time. */
function firedCategories(text: string): string[] {
  const r = {
    typ: "7S-rapport", tnr: "x", tidpunkt: "2026-06-16T13:00:00", plats: "p",
    lat: 58.0, lon: 16.0, sagesman: "AQ", handelse: text, links: [], embeds: [], file: "f.md",
  } as unknown as Report;
  return scoreReport(r).reasons
    .filter((x) => x.key.startsWith("beteende:"))
    .map((x) => x.key.slice("beteende:".length));
}

export interface BehaviourScore {
  hostileTotal: number;
  hostileCaught: number;
  recall: number;
  benignTotal: number;
  benignFalseFired: number;
  precision: number;
  perMode: Record<string, { total: number; caught: number }>;
  missed: string[]; // hostile sentences that raised NO signal (the recall gaps)
  falseFired: { text: string; cats: string[] }[]; // benign sentences that fired
}

export function scoreBehaviour(cases: BehaviourCase[]): BehaviourScore {
  const perMode: Record<string, { total: number; caught: number }> = {};
  let hostileTotal = 0, hostileCaught = 0, benignTotal = 0, benignFalseFired = 0;
  const missed: string[] = [];
  const falseFired: { text: string; cats: string[] }[] = [];

  for (const c of cases) {
    const cats = firedCategories(c.text);
    const fired = cats.length > 0;
    if (c.mode === "benign") {
      benignTotal++;
      if (fired) { benignFalseFired++; falseFired.push({ text: c.text, cats }); }
    } else {
      hostileTotal++;
      perMode[c.mode] ??= { total: 0, caught: 0 };
      perMode[c.mode].total++;
      if (fired) { hostileCaught++; perMode[c.mode].caught++; } else missed.push(c.text);
    }
  }

  return {
    hostileTotal,
    hostileCaught,
    recall: hostileTotal ? hostileCaught / hostileTotal : 1,
    benignTotal,
    benignFalseFired,
    precision: benignTotal ? (benignTotal - benignFalseFired) / benignTotal : 1,
    perMode,
    missed,
    falseFired,
  };
}

export function formatBehaviourReport(s: BehaviourScore, label: string): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push(`-- THREAT_INDICATORS on ${label} (behaviour isolated: far + daytime) --`);
  lines.push(`  RECALL   (hostile caught):        ${pct(s.recall)}  (${s.hostileCaught}/${s.hostileTotal})`);
  lines.push(`  PRECISION(benign not fired):      ${pct(s.precision)}  (${s.benignTotal - s.benignFalseFired}/${s.benignTotal})`);
  lines.push("  recall by hostility mode:");
  for (const [mode, v] of Object.entries(s.perMode)) {
    lines.push(`    ${mode.padEnd(13)} ${v.caught}/${v.total}`);
  }
  if (s.missed.length) {
    lines.push(`  MISSED hostile (recall gaps, ${s.missed.length}):`);
    for (const m of s.missed) lines.push(`    - ${m}`);
  }
  if (s.falseFired.length) {
    lines.push(`  FALSE-FIRED on benign (precision breaches, ${s.falseFired.length}):`);
    for (const f of s.falseFired) lines.push(`    - [${f.cats.join(",")}] ${f.text}`);
  }
  return lines.join("\n");
}
