# Craft vocabulary — measured validation (issue #2 morphological rework)

**Datum:** 2026-08-28 · **Layer:** `plugin/src/domain.ts` matchCraftTypes (+ `sv_morph.ts`, `sv_match.ts`)

Sibling of `BEHAVIOUR_VALIDATION.md` (activity vocabulary): same culture —
reproduce the reported baseline on corpora the vocabulary has never seen,
change, re-measure, freeze.

## Why

Issue #2's finding was a *class* of failure, not two missing words: Swedish
agent nouns and compounds (cyklist, kajakpaddlare, paketbil) pass whole-word
keyword lists, and the effect is binary per type (0 % on cykel and lastbil
while every listed type scored 100 %). The 2026-08-27 stopgap added the words
the corpora had exposed; the generator's own repertoire still held invisible
forms (`servicebil`, `leveransbil`, verb `cyklade`, `elsparkcyklist`).

## The rework (three layers under one precompiled matcher)

Per-token precedence: **blocklist → exact form → head-suffix (longest form
wins) → edit-distance-1**; the substring stems then run over the whole text
unchanged.

1. **Exact forms** — bases + declension classes (`sv_morph.ts`) expand to the
   four inflected forms; irregulars stay literal keywords. The expansion is
   frozen by deep-equality against `test/fixtures/craft_vocabulary.ts` — a
   generator does not weaken the frozen-list culture when its entire output is
   a committed, diff-reviewed snapshot.
2. **Head-suffix** — a token *properly ending* in an inflected head noun types
   its craft: `servicebilen` → lastbil without enumeration. Token-end anchoring
   dodges `cykelvägen`/`busshållplatsen` by construction; exact beats head
   (`personbilen` stays bil); the longest form wins across the taxonomy
   (`elsparkcyklisten` → sparkcykel, not cykel); `CRAFT_HEAD_BLOCK` kills the
   known homonyms (mobilen, stabil, labil, …).
3. **Edit-distance-1** — an unclaimed token ≥6 chars within one edit
   (sub/ins/del; a transposition is two) of the forms of exactly ONE
   typo-tolerant type. Ambiguity (two candidate types) matches nothing.

## Method

Five fresh corpora on unseen seeds (2101–2105), one per area shape:
suburban/airport/coastal/urban/port, 14 days each, ~2 260 reports with
`craft`-facit per report (`test/scoring_craft.ts` + `run_craft_scoring.ts`).
The urban corpus also carries a recon cell (seed 2104) for hostile-repertoire
prose. Facit quirks (both known upstream, issue #2 "omvänd paritetsnot"): the
generator stamps neither naked `bil` nor the definite plurals `båtar(na)` —
predicted-`bil` surplus is bucketed separately, and the 32 port-corpus "false
positives" are all *"Turister fotograferade båtarna."*, i.e. correct
predictions the facit fails to stamp. True false positives: **0** on all five
corpora.

## Results

| korpus | baseline | efter rework |
| --- | --- | --- |
| suburban (2101) | 100 % (52/52) | 100 % |
| airport (2102) | 100 % (211/211) | 100 % |
| coastal (2103) | 100 % (92/92) | 100 % |
| **urban (2104)** | **55,6 %** (144/259) — sparkcykel 0/47, lastbil 39/107 | **100 %** (259/259) |
| **port (2105)** | **85,3 %** (209/245) — lastbil 35/71 | **100 %** (245/245) |

The urban corpus reproduced the issue's binary pattern exactly: a whole type
(sparkcykel, via `Elsparkcyklist`) at 0 %.

**Typo layer** (`test/craft_typo.ts`: one seeded sub/ins/del on the facit
craft token of every stamped report, 859 tokens across the five corpora):
recovered 770/859 without the layer (stems carry some), **826/859 with it**;
**clean-prose delta 0** — on unperturbed text the layer never changes a
prediction across all ~2 600 reports. Hazard audit
(`test/run_typo_hazards.ts`): 11 184 distinct real tokens ≥6, **zero** within
one edit of the live typo surface. That surface is deliberately reduced:
`typoTolerant: false` on **båt, buss, kärra, drönare**, whose neighbourhoods
contain common words (kollar~jollar, snabbt~snabbåt, buskarna~bussarna,
kärnan~kärran, grönare~drönare) — for drönare (hotvikt 3) a false alert is
strictly worse than an unrecovered typo.

**Performance:** the old matcher built ~90 fresh RegExp per call (~33 µs);
the precompiled matcher runs the larger vocabulary at ~2,4 µs/call.

## Honest residuals

1. **`…bil`-compounds all type lastbil** — polisbil, brandbil, hyrbil would be
   typed lastbil. The generator never emits them; a measured offender becomes
   an exact base under `bil` (the personbil/bilist pattern).
2. **Typo recovery is bounded by design**: deletions in 6-char words produce
   5-char tokens (below the ≥6 floor — `fartyg`→`fatyg` stays unrecovered),
   and the four dense-neighbourhood types recover no typos at all.
3. **Head coverage is only as wide as the declared heads** — bil, buss,
   cykel/cyklist, sparkcykel/sparkcyklist, motorcykel, kärra. Watercraft and
   aircraft ride on their substring stems instead (båt, fartyg, färja, drönar,
   helikopt, flygplan), which already cover both prefix and suffix compounds.
4. **Corpora are synthetic** (deterministic generator seeds). The two real
   Bin-1 messages in the parity fixture are the only field prose; true field
   recall remains unknown until real traffic accumulates.

## Frozen boundary

`test/fixtures/craft_vocabulary.ts` (deep-equality test) is the frozen list;
`test/fixtures/craft_phrases.ts` (exact-set parity + benign negatives incl.
designed typo misses) is the behavioural contract; corpus floors in
`craft_parity.test.ts` lock the committed-corpora coverage. Regenerate the
snapshot only via `test/run_craft_vocabulary_snapshot.ts`, together with a
re-run of the measurements above.
