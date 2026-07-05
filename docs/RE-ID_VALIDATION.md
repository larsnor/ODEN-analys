# Re-identification validation — what the mark layer can and can't do

This records, honestly, what we measured about the **soft mark re-identification**
layer (Job B / `vocab.ts` + `marks.ts`) — the part that links two report sightings
of the same person by a distinctive *kännetecken* (a marked backpack, a night-vision
optic, a bolt-cutter). It does **not** concern plate-based re-id (Job A, exact
string match — robust) or the suspicion scoring (proximity + time + behaviour — a
separate, broader layer). The behaviour keyword vocabulary of that suspicion layer
has its own out-of-distribution measurement in
[`BEHAVIOUR_VALIDATION.md`](BEHAVIOUR_VALIDATION.md).

## The finding
The layer's original in-distribution scores were ~100% precision and recall. That
was an **artifact of the first synthetic corpus** — the vocabulary and that corpus
were effectively co-designed. We measured it out-of-distribution with a harness
(`plugin/test/scoring_reid.ts` + `reid_ood.test.ts` over `test/fixtures/ood/`): a
*second* generator config, each hostile **paraphrased** across sightings, with truth
= the generator's objective `member` label (not a hand annotation). Across 8
independent corpora:

- **Safety generalises** — **0** fabricated distinctive marks on civilians (incl.
  birdwatcher-with-binoculars / tourist-with-camera / worker-with-toolbag decoys).
  This is the one corpus-independent guarantee: it never invents a mark on noise.
- **Recall collapses** ~100% → **~6%**. A fixed keyword taxonomy cannot see tells it
  doesn't list; the narrow colour vocabulary drops green/blue gear; paraphrase gaps
  drop more.
- **Precision is corpus-dependent** ~100% → **~65%** — distinct people carrying
  similar gear collapse onto one coarse signature (the merge problem). The old 1.0
  held only because that corpus never had two people share a signature.

## Why we did not "fix it" by growing the vocabulary
A *comprehensive* deterministic vocabulary cannot exist: the space of distinctive
descriptors is open-ended, so a hand-list never converges, becomes unmaintainable,
and breaks its own precision (coarse signatures over-merge; fine ones over-split —
no stable middle). Corpus-statistics (rare-token / idf) is also out: the plugin sees
messages **stream in**, so it never holds a corpus to compute rarity (cold-start).
World knowledge lives in a model, not a list.

So there are two stable designs — a **narrow high-precision seed** (this) and an
**LLM** (open-vocabulary, future "Phase B"). We kept the seed and **froze** it.

## The frozen seed — the one principle
A descriptor is a usable re-id key by **base rate + specificity** (see the header
comment in `plugin/src/vocab.ts`):

- **Common carriables** (backpack, cap, vehicle decal, **optics/camera**) are keys
  ONLY with a *distinguishing attribute*. A plain backpack or plain `kikare` is
  filtered; a "dark backpack with an emblem" or a "camera with **teleobjektiv** /
  **nattkikare** / **värmekamera**" is the tell. (This is why the OOD test still
  merged the backpack people — the shared civilian base rate; the attribute is all
  that saves any of these families, optics included.)
- **Rare items** (breaching tools `verktyg`, signals gear `teknik`) have base rate
  ≈ 0, so presence of the specific item is a fair key on its own; signatures key on
  the *item* (`verktyg#item:bultsax`) so a bolt-cutter person ≠ a crowbar person.

Optics also raise the **suspicion** score independently (`suspicion.ts`
`THREAT_INDICATORS.optik`), so the operator is alerted to binoculars/cameras
regardless of re-id; the mark layer only decides whether they *link* sightings.

## Bottom line for operators
Treat mark-based actor nominations as **candidate links a human confirms**, not
findings. The layer will miss real links on live data and can propose an "actor"
that is actually two people — always review the evidence chain. Its guarantee is
that it won't manufacture a link out of civilian noise.
