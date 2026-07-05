/*
 * Member-based re-identification scorer (validation, not a unit test).
 *
 * Truth is the generator's OBJECTIVE `member` label (H1, H2…) — independent of the
 * plugin's vocabulary — so this measures whether the mark layer re-identifies the
 * SAME person across PARAPHRASED sightings, without merging different people or
 * civilians. Complements test/scoring.ts (which scores against hand-annotated tell
 * categories on the in-distribution corpus).
 */
import { buildMarkNominations } from "../src/jobb.ts";
import { extractNormalized } from "../src/marks.ts";
import { Report } from "../src/parse.ts";

export interface ReidGT {
  file: string;
  truth: string;
  member?: string | null;
  tells?: string[];
}

// Objective tell → the plugin's category (or an out-of-taxonomy label the plugin
// has no category for → it can never re-identify these; that's the ceiling).
const TELL_CAT: Record<string, string> = {
  tell_bag: "bag", tell_cap: "cap",
  tell_optics: "optics", tell_tattoo: "tattoo", tell_case: "case", tell_vest: "vest",
};
const IN_TAXONOMY = new Set(["bag", "cap", "optics"]);

const base = (f: string) => f.replace(/^.*\//, "");
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

export interface ReidScore {
  activeMembers: number;      // hostile members with ≥2 appearances (the re-id universe)
  trueSamePairs: number;
  predictedPairs: number;
  pairPrecision: number;      // of predicted same-actor pairs, fraction truly same member
  pairRecall: number;         // of true same-member pairs, fraction clustered together
  byCategory: Record<string, { members: number; reidentified: number }>;
  mixedNominations: number;   // nominations conflating >1 true member (or a civilian)
  nominations: number;
  membersMergedBySignature: number; // distinct members sharing one distinctive signature
  signaturesPerCategory: Record<string, number>;
  falseMarksOnCivil: string[]; // distinctive marks on truth:civil — the SAFETY breach
}

export function scoreReid(reports: Report[], gt: ReidGT[]): ReidScore {
  const gtByFile = new Map(gt.map((r) => [base(r.file), r]));
  const truthOf = (f: string) => gtByFile.get(base(f))?.truth;
  const memberOf = (f: string) => {
    const r = gtByFile.get(base(f));
    return r?.truth === "hostile" ? r.member ?? null : null;
  };
  const catOf = (f: string) => {
    const t = gtByFile.get(base(f))?.tells?.[0];
    return t ? TELL_CAT[t] : undefined;
  };

  // Members with ≥2 appearances (only these can be re-identified).
  const memberFiles = new Map<string, string[]>();
  for (const r of gt) {
    if (r.truth === "hostile" && r.member) {
      if (!memberFiles.has(r.member)) memberFiles.set(r.member, []);
      memberFiles.get(r.member)!.push(base(r.file));
    }
  }
  const active = [...memberFiles.entries()].filter(([, fs]) => fs.length >= 2);

  const trueSame = new Set<string>();
  for (const [, fs] of active)
    for (let i = 0; i < fs.length; i++)
      for (let j = i + 1; j < fs.length; j++) trueSame.add(pairKey(fs[i], fs[j]));

  const jobb = buildMarkNominations(reports);
  const nomFiles = jobb.nominations.map((n) => [...new Set(n.members.map((m) => base(m.file)))]);

  const predictedSame = new Set<string>();
  let mixedNominations = 0;
  for (const fs of nomFiles) {
    for (let i = 0; i < fs.length; i++)
      for (let j = i + 1; j < fs.length; j++) predictedSame.add(pairKey(fs[i], fs[j]));
    const ids = new Set(fs.map((f) => memberOf(f) ?? `civil:${f}`));
    if (ids.size > 1) mixedNominations++;
  }

  const inter = [...predictedSame].filter((p) => trueSame.has(p)).length;
  const pairRecall = trueSame.size ? inter / trueSame.size : 1;
  const pairPrecision = predictedSame.size ? inter / predictedSame.size : 1;

  const byCategory: Record<string, { members: number; reidentified: number }> = {};
  for (const [, fs] of active) {
    const cat = catOf(fs[0]) ?? "?";
    byCategory[cat] ??= { members: 0, reidentified: 0 };
    byCategory[cat].members++;
    const reid = nomFiles.some((nf) => fs.filter((f) => nf.includes(f)).length >= 2);
    if (reid) byCategory[cat].reidentified++;
  }

  // Coarse-signature merge: how many distinct members share one distinctive signature.
  const allMarks = extractNormalized(reports);
  const membersBySig = new Map<string, Set<string>>();
  const sigByCat = new Map<string, Set<string>>();
  for (const m of allMarks) {
    if (!m.distinctive) continue;
    const mem = memberOf(m.file);
    if (mem) {
      if (!membersBySig.has(m.signature)) membersBySig.set(m.signature, new Set());
      membersBySig.get(m.signature)!.add(mem);
    }
    const c = catOf(m.file);
    if (c) {
      if (!sigByCat.has(c)) sigByCat.set(c, new Set());
      sigByCat.get(c)!.add(m.signature);
    }
  }
  let mergedMembers = 0;
  for (const mems of membersBySig.values()) if (mems.size > 1) mergedMembers += mems.size;

  const falseMarksOnCivil = allMarks
    .filter((m) => m.distinctive && truthOf(m.file) === "civil")
    .map((m) => `${base(m.file)}: ${m.signature}`);

  return {
    activeMembers: active.length,
    trueSamePairs: trueSame.size,
    predictedPairs: predictedSame.size,
    pairPrecision,
    pairRecall,
    byCategory,
    mixedNominations,
    nominations: jobb.nominations.length,
    membersMergedBySignature: mergedMembers,
    signaturesPerCategory: Object.fromEntries([...sigByCat].map(([k, v]) => [k, v.size])),
    falseMarksOnCivil,
  };
}

export function formatReidReport(s: ReidScore): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const lines: string[] = [];
  lines.push("── Re-identification on the OUT-OF-DISTRIBUTION corpus (member truth) ──");
  lines.push(`  active members (≥2 sightings): ${s.activeMembers}   nominations: ${s.nominations}`);
  lines.push(`  pair RECALL   (same person clustered):   ${pct(s.pairRecall)}  (${s.trueSamePairs} true pairs)`);
  lines.push(`  pair PRECISION(clustered really same):   ${pct(s.pairPrecision)}  (${s.predictedPairs} predicted pairs)`);
  lines.push(`  nominations conflating >1 person/civil:  ${s.mixedNominations}`);
  lines.push(`  distinct members merged by one signature: ${s.membersMergedBySignature}`);
  lines.push("  re-identified by tell category (caught / members):");
  for (const [cat, v] of Object.entries(s.byCategory)) {
    const tag = IN_TAXONOMY.has(cat) ? "in-taxonomy" : "OUT-of-taxonomy";
    lines.push(`    ${cat.padEnd(8)} ${v.reidentified}/${v.members}   (${tag})`);
  }
  lines.push(`  signatures per category: ${JSON.stringify(s.signaturesPerCategory)}`);
  lines.push(`  SAFETY — false distinctive marks on civilians: ${s.falseMarksOnCivil.length}`);
  for (const f of s.falseMarksOnCivil.slice(0, 8)) lines.push(`      ${f}`);
  return lines.join("\n");
}
