/*
 * Tiny table-driven Swedish noun inflector — pure TS, Obsidian-free.
 *
 * Generates the four surface forms (base, definite singular, plural, definite
 * plural) for the declension classes the craft taxonomy needs. Deliberately NOT
 * a general morphology: a wrong class assignment produces a visibly wrong form
 * in the committed vocabulary snapshot (test/fixtures/craft_vocabulary.ts), so
 * the effective word list stays explicit and diff-reviewed — the frozen-list
 * culture survives the generator.
 */

export type Declension =
  | "en-ar"          // båt→båten/båtar/båtarna; jolle→jollen/jollar; fyrhjuling→fyrhjulingen/fyrhjulingar
  | "en-ar-syncope"  // cykel→cykeln/cyklar/cyklarna (final -el drops the e in plural)
  | "en-er"          // traktor→traktorn/traktorer; cyklist→cyklisten/cyklister; moped→mopeden/mopeder
  | "a-or"           // kärra→kärran/kärror/kärrorna; färja→färjan/färjor
  | "are"            // drönare→drönaren/drönare/drönarna
  | "en-rar-syncope" // helikopter→helikoptern/helikoptrar; skoter→skotern/skotrar (final -er drops the e)
  | "et-0";          // neuter zero-plural: flygplan→flygplanet/flygplan/flygplanen; skepp→skeppet

const VOWEL = /[aeiouyåäö]$/;

/** The distinct surface forms [base, def.sg, pl, def.pl] for `base` in class
 *  `decl` (deduped — zero-plural classes repeat the base). */
export function inflectNoun(base: string, decl: Declension): string[] {
  let defSg: string, pl: string, defPl: string;
  switch (decl) {
    case "en-ar": {
      const stem = base.endsWith("e") ? base.slice(0, -1) : base;
      defSg = VOWEL.test(base) ? base + "n" : base + "en";
      pl = stem + "ar";
      defPl = stem + "arna";
      break;
    }
    case "en-ar-syncope": {
      // …el → …l + ar  (cykel → cykl-ar)
      const stem = base.slice(0, -2) + "l";
      defSg = base + "n";
      pl = stem + "ar";
      defPl = stem + "arna";
      break;
    }
    case "en-er":
      defSg = base + (base.endsWith("or") ? "n" : "en");
      pl = base + "er";
      defPl = base + "erna";
      break;
    case "a-or": {
      const stem = base.slice(0, -1);
      defSg = base + "n";
      pl = stem + "or";
      defPl = stem + "orna";
      break;
    }
    case "are":
      defSg = base + "n";
      pl = base;
      defPl = base.slice(0, -1) + "na";
      break;
    case "en-rar-syncope": {
      // …er → …r + ar  (helikopter → helikoptr-ar)
      const stem = base.slice(0, -2) + "r";
      defSg = base + "n";
      pl = stem + "ar";
      defPl = stem + "arna";
      break;
    }
    case "et-0":
      defSg = base + "et";
      pl = base;
      defPl = base + "en";
      break;
  }
  return [...new Set([base, defSg, pl, defPl])];
}
