/*
 * Swedish-aware text matching primitives — pure TS, Obsidian-free.
 *
 * JS `\b` treats å/ä/ö as word boundaries, so `\bkväll\b` / `\båterkommande\b`
 * would wrongly fail; every word-boundary decision in the codebase goes through
 * the explicit non-letter/digit lookaround below. Shared by the craft matcher
 * (domain.ts) and query parsing (query.ts) so the layers can never diverge on
 * what counts as a word.
 */

const WORD_RE_CACHE = new Map<string, RegExp>();

/** Whole-word (Swedish-aware) match. Compiled regexes are cached per word. */
export function hasWord(text: string, word: string): boolean {
  let re = WORD_RE_CACHE.get(word);
  if (!re) {
    re = new RegExp(`(?<![a-zåäö0-9])${word}(?![a-zåäö0-9])`, "i");
    WORD_RE_CACHE.set(word, re);
  }
  return re.test(text);
}

export function hasAnyWord(text: string, words: string[]): boolean {
  return words.some((w) => hasWord(text, w));
}

/** Lowercased tokens split on the SAME character class the lookarounds use —
 *  token boundaries are therefore provably identical to hasWord boundaries. */
export function tokenizeSv(text: string): string[] {
  return (text ?? "").toLowerCase().split(/[^a-zåäö0-9]+/).filter(Boolean);
}

/** Bounded Levenshtein: true iff a and b are within ONE edit (substitution,
 *  insertion or deletion; a transposition counts as two edits and does NOT
 *  match — the craft typo layer and its perturbation harness use the same
 *  three operations, so the metric and the measurement agree). */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  if (la === lb) {
    // exactly one substitution allowed
    let diff = 0;
    for (let i = 0; i < la; i++) if (a[i] !== b[i]) { if (++diff > 1) return false; }
    return diff === 1;
  }
  // one insertion/deletion: align the longer against the shorter
  const [s, l] = la < lb ? [a, b] : [b, a];
  let i = 0, j = 0, skipped = false;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) { i++; j++; continue; }
    if (skipped) return false;
    skipped = true;
    j++; // skip one char in the longer string
  }
  return true; // any remaining tail in `l` is the single allowed extra char
}
