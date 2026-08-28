# Behaviour-vocabulary validation — what THREAT_INDICATORS can and can't do

This is the sibling of `RE-ID_VALIDATION.md`. It records, honestly, what we measured
about the **behaviour keyword layer** (`suspicion.ts` `THREAT_INDICATORS`) — the
~110-stem list that raises a report's suspicion score when its prose describes hostile
activity (recon / sabotage / infiltration / terrorism). It is the **second fixed
keyword vocabulary** in ODEN and carried the same overfitting exposure `vocab.ts`
(marks) was shown to have.

## Why it needed its own test
`recon_indicators.test.ts` *looks* like an out-of-distribution test, but every hostile
sentence in it embeds a listed stem verbatim — so its 100% recall was an artifact of
construction, not evidence of generalisation. The real question — does the list catch
hostile activity described in prose that does **not** reuse its stems — was untested.

## Method (blind authoring + train/test split)
Two Claude instances, each **never shown the stem list** (a pure authoring task, no
repo access), wrote realistic terse Home-Guard observations — 50 hostile (across the 4
modes) + 32 benign near-misses each. Their prose is therefore independent of the
recogniser. Committed frozen as `plugin/test/fixtures/behaviour_ood/corpus_{a,b}.ts`.
Each sentence is scored in **behaviour isolation** (far from the object, daytime, so
only a `beteende:*` signal scores — the trick from `recon_indicators.test.ts`).
Corpus **A** guided the expansion; corpus **B** was held out to check the expansion
generalises rather than fits A. Harness: `plugin/test/scoring_behaviour.ts` +
`behaviour_ood.test.ts`.

## The finding
**Baseline OOD recall ≈ 24%** on *both* corpora (12/50) — the behaviour list was as
overfit as the mark list. The dominant cause: the stems were **past-tense-locked** to
the generator's phrasings. The generator wrote "smet in / utgav sig / skuggade /
bände upp / klippte upp"; independent observers wrote the present tense "smiter in /
utger sig / skuggar / bänder upp / klipper upp", which the substring matcher missed.
`infiltration` scored **0/10** on both corpora for exactly this reason. Precision was
~91–97% — the false-fires were all birdwatchers/photographers (binoculars/camera →
`optik`), an inherent ambiguity of the soft optics signal.

## The bounded, precision-gated expansion
Guided by corpus A's misses, we added **tense/conjugation coverage** (present + supine
of the same hostile verbs) plus a few unambiguous hostile phrases — each checked to
fire on **zero** benign sentences (in A, B, and `recon_indicators`). Ambiguous concepts
that a keyword cannot separate from benign life were **deliberately left out**:
filming/photographing (vs tourists), measuring (vs a surveyor), maintenance verbs
`skruvar`/`vrider`/`kapar`/`häller` (vs an electrician), `lämnar ett paket` (vs a
courier), and social-engineering questions. Those are the geo+time weighting's job and,
ultimately, Phase B's.

Result — the expansion **generalised** (the held-out corpus rose *more* than the dev one,
which is the opposite of overfitting):

| | recall before | recall after | precision after |
|---|---|---|---|
| Corpus A (dev)       | 24% (12/50) | **62%** (31/50) | 97% |
| Corpus B (held-out)  | 24% (12/50) | **74%** (37/50) | 91% |

The list is now **frozen** at this size (a comment marks the boundary in
`suspicion.ts`). The remaining ~26–38% gap is the keyword ceiling — activities only
separable from benign life by *context*, which is open-vocabulary (LLM) territory.

## Infiltration expansion + weight promotion (2026-08-28, GitHub #3)

An external reporter measured infiltration-cell recall at **0.22** against
0.80–1.00 for the other modes on generated corpora, with two causes we verified
independently: missing ELICITATION vocabulary (asking about routines/pass
times/pass cards — no stem existed), and a weight asymmetry — infiltration is
structurally a DAYTIME activity (guard changes, staff flows), so the night bonus
never helps it, and weight 2 + närområde 2 = 4 stalled under the threshold even
when a stem DID hit ("skuggade en", "gled in vid", "saknade arbetsorder").

Fix, precision-gated per the standing protocol: seven elicitation/false-
authority stems ("om rutiner", "passertider", "passerkorten", "kändes inte
igen", "prata sig förbi"/"pratar sig förbi", "begär tillträde") — each verified
to fire on ZERO benign sentences across corpus A, corpus B and the
recon_indicators benign sets — and `infiltration` promoted to **weight 3**. The
promotion is enforced, not assumed: infiltration now sits inside the WEIGHT3
safety assertion in `behaviour_ood.test.ts`, so any future benign fire fails CI.

| | infiltration before | after | overall recall before | after |
|---|---|---|---|---|
| Corpus A (dev) | 7/10 | **10/10** | 62% | **68%** |
| Corpus B (held-out) | 8/10 | **10/10** | 74% | **78%** |
| Reporter's corpus (seed 21 + infiltration seed 31, 18 hostile) | **0.22** (4/18) | **0.78** (14/18) | — | civilian FP unchanged (8) |

Regression floors raised to 55→60% (A) and 65→70% (B).

Residuals, honestly: (1) "Fotograferade skyltar och passersystem" scores only
via `optik` (weight 2) — optik can NEVER be promoted (the birdwatcher/tourist
ambiguity is inherent); (2) a lone infiltration signal far from the objektet in
daytime still does not self-elevate (3 < 5) — by design; (3) "ställde
elsparkcykeln utom synhåll" is outside any keyword vocabulary — 📝-layer
territory. Caveat on the broadest new stem: "om rutiner" would fire on
administrative prose like "informerade om rutinerna", which the blind corpora
never produced as a field observation — the weight-3 reason line names the
matched stem, so an operator sees exactly why.

## Two things an operator must keep in mind
1. **A missed behaviour keyword usually silences the report.** A weight-2 behaviour
   hit needs geo+time support to reach the elevation threshold (5); a report elevates
   with *no* keyword only when it is both <800 m from the object **and** between 22:00
   and 05:00. So behaviour recall gaps translate fairly directly into missed alerts —
   the geometry/time floor catches only the close-and-nocturnal minority.
2. **Precision on the soft optics signal is not perfect.** A civilian with binoculars
   raises the `optik` signal; it only becomes an *alert* with proximity + time, but the
   signal itself is not a reliable "hostile" marker. The one guarantee the test
   enforces is that **no benign prose trips a weight-3 category** (sabotage/attentat) —
   ODEN will not flag a civilian as a saboteur or bomber on wording alone.

## Caveat
Like the mark validation, this is **synthetic and model-authored** (blind, but still a
model, not real Home-Guard traffic). The numbers are a far better estimate than the
in-distribution 100% — but the true field recall/precision remain unknown until tested
on real reports.
