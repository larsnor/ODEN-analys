/*
 * Craft-vocabulary parity fixture — one realistic phrasing per craft TYPE, plus
 * the agent-noun / compound forms that the whole-word matcher historically missed.
 *
 * WHY THIS EXISTS (GitHub issue #2): the format has a parity contract with
 * 7S-generator (TODO.md), but the PROSE VOCABULARY had none — so `cyklist`,
 * `paketbil` and `kajakpaddlare` sat unmatched in our own committed corpora
 * (reports_new: lastbil 0/600, cykel 43/600) without any test noticing.
 *
 * ── Provenance, and what these numbers therefore mean ────────────────────────
 * `source` records where each phrasing came from, because the value of the test
 * depends on it (cf. the blind-authoring protocol in BEHAVIOUR_VALIDATION.md):
 *   "corpus"   — verbatim from a committed fixture corpus or one of the two REAL
 *                Bin-1 example messages. Authored independently of this vocabulary.
 *   "issue"    — verbatim from issue #2, written by an external reporter who had
 *                not seen the taxonomy. Independent.
 *   "authored" — written here, WITH knowledge of the taxonomy, only for types no
 *                corpus exercises. These prove REACHABILITY, not recall — a type
 *                covered solely by "authored" phrasings is untested against real
 *                prose, and that is a known gap, not a measurement.
 *
 * This is a COVERAGE FLOOR, never a recall figure. The head-suffix /
 * agent-noun / typo rework issue #2 called for landed 2026-08-28 — recall was
 * then measured on five fresh unseen-seed generator corpora (100 % per type;
 * docs/CRAFT_VALIDATION.md holds the tables and the honest residuals).
 */

export interface CraftPhrase {
  text: string;
  /** Craft type keys `matchCraftTypes` must return — exactly, order-independent. */
  expect: string[];
  source: "corpus" | "issue" | "authored";
}

export const CRAFT_PHRASES: CraftPhrase[] = [
  // --- plated ground ---------------------------------------------------------
  { text: "Bil stannade vid busshållplatsen, släppte av passagerare.", expect: ["bil"], source: "corpus" },
  // Agent noun for the bare car (bilist ~ cyklist) — and "snabbt" (one edit from
  // "snabbåt") must NOT drag båt in: exact-set equality probes both.
  { text: "Bilisten bromsade snabbt vid infarten.", expect: ["bil"], source: "authored" },
  { text: "Lastbil hämtade container vid terminalen.", expect: ["lastbil"], source: "corpus" },
  { text: "Bring skåpbil, reg CUD339. Förare i arbetskläder/varselväst.", expect: ["lastbil"], source: "corpus" },
  // REGRESSION (issue #2): the compound `paketbil` — 47 reports in reports_new.
  { text: "Paketbil levererade vid säteriets infart.", expect: ["lastbil"], source: "corpus" },
  { text: "Paketbil levererade till klubbstugan.", expect: ["lastbil"], source: "issue" },
  { text: "Körde traktor längs vägkanten.", expect: ["traktor"], source: "corpus" },
  // MORPHOLOGY (issue #2 rework): "…bil" compounds resolve via the head — these
  // two are verbatim generator prose (urban resp. port areas) that the keyword
  // list never covered.
  { text: "Leveransbil lossade utanför butiken.", expect: ["lastbil"], source: "corpus" },
  { text: "Servicebil vid hamnkontoret.", expect: ["lastbil"], source: "corpus" },
  { text: "Motorcykel passerade i hög fart norrut.", expect: ["motorcykel"], source: "authored" },
  { text: "Moped stod parkerad vid grinden.", expect: ["motorcykel"], source: "authored" },
  { text: "Buss stannade och släppte av passagerare.", expect: ["buss"], source: "authored" },

  // --- unplated ground -------------------------------------------------------
  { text: "Postutdelare på cykel längs Vällingevägen.", expect: ["cykel"], source: "corpus" },
  // REGRESSION (issue #2): the agent noun `cyklist` — 43 reports in reports_new.
  { text: "Cyklist i gul jacka passerade söderut.", expect: ["cykel"], source: "corpus" },
  { text: "Cyklist i gul jacka vid grinden.", expect: ["cykel"], source: "issue" },
  { text: "Ungdom på elsparkcykel, ljus jacka.", expect: ["sparkcykel"], source: "corpus" },
  // MORPHOLOGY (issue #2 rework): longest-head-wins — elsparkcyklist ends in
  // both "sparkcyklist" and "cyklist"; sparkcykel must claim it, not cykel.
  { text: "Elsparkcyklist passerade på gågatan.", expect: ["sparkcykel"], source: "corpus" },
  // The verb form — the generator facit stamps "cyklade" (hostile repertoire:
  // "Cyklade långsamt förbi vakten …").
  { text: "Cyklade långsamt förbi vakten, vände och kom tillbaka.", expect: ["cykel"], source: "corpus" },
  { text: "Motorcyklist stannade vid vägkanten.", expect: ["motorcykel"], source: "authored" },
  { text: "Dragkärran stod kvar vid förrådet.", expect: ["kärra"], source: "authored" },
  { text: "Skottkärra lämnad vid staketet.", expect: ["kärra"], source: "authored" },

  // --- watercraft ------------------------------------------------------------
  { text: "Fritidsbåt lade till i gästhamnen.", expect: ["båt"], source: "corpus" },
  // Real Bin-1 example message (TNR260838) — unedited operator prose.
  { text: "Såg en fyrmanna ribbåt kör in i en liten vik två personer på båten mörkt klädda inga lampor tända", expect: ["båt"], source: "corpus" },
  // Real Bin-1 example message (TNR260916).
  { text: "Kajak paddlade till Åland", expect: ["båt"], source: "corpus" },
  // REGRESSION (issue #2 addendum): the agent noun `kajakpaddlare`.
  { text: "Kajakpaddlare vid viken.", expect: ["båt"], source: "issue" },
  { text: "Ett lastfartyg passerade långsamt i farleden.", expect: ["fartyg"], source: "authored" },
  { text: "Färjan lade till vid terminalen.", expect: ["färja"], source: "authored" },

  // --- aircraft --------------------------------------------------------------
  { text: "En drönare cirklade över området.", expect: ["drönare"], source: "authored" },
  { text: "Helikopter flög lågt över fältet.", expect: ["helikopter"], source: "authored" },
  { text: "Ett litet flygplan startade från fältet.", expect: ["flygplan"], source: "authored" },

  // --- typos (edit-distance-1 layer; sub/ins/del only — a transposition like
  //     "lastbli" is TWO edits and by design does not match) -----------------
  { text: "Lasbil hämtade container vid kajen.", expect: ["lastbil"], source: "authored" },
  { text: "Trakor plöjde åkern.", expect: ["traktor"], source: "authored" },
  { text: "Mopedn stod parkerad vid grinden.", expect: ["motorcykel"], source: "authored" },
  { text: "Helikoptter passerade lågt.", expect: ["helikopter"], source: "authored" },
];

/**
 * Benign near-misses that must yield NO craft. These are the precision side of
 * the same coin: every one of them CONTAINS a craft substring, and each would
 * break under a naive substring/stem widening — so they are the guard rail for
 * the head-suffix rework as much as for today's matcher.
 */
export const CRAFT_BENIGN: string[] = [
  "Se bild.", // bil ⊄ bild — the photo-report homonym
  "Bilden visar en person vid grinden.",
  "Tog en bild med mobilen.", // mobil must never read as a car
  "Joggade förbi längs cykelvägen.", // a cycle path is not a bicycle
  "Motionär joggade på cykelbanan.",
  "Väntade vid busshållplatsen.", // a bus stop is not a bus
  "Objektiv bedömning av läget.", // 'objektiv' as an adjective
  // MORPHOLOGY (issue #2 rework): tokens that END in a head form but are not
  // crafts — the head blocklist, and suffix anchoring itself, under test.
  "Skickade ett sms från mobilen.", // mobilen ends in "bilen"
  "Grinden var stabil.", // stabil ends in "bil"
  "Läget bedömdes som instabilt.", // instabilt does NOT end in a head form — anchor check
  // Typo-layer designed misses: dense-neighbourhood types have typoTolerant
  // OFF after the hazard audit (buskarna~bussarna, grönare~drönare, kollar~
  // jollar, snabbt~snabbåt) — these must stay silent even though each is one
  // edit from a craft form.
  "Buskarna rörde sig i vinden.",
  "Gräset var grönare vid banvallen.",
  "Vakten kollar grinden varje timme.",
];
