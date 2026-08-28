/*
 * FROZEN SNAPSHOT of the effective craft vocabulary — what matchCraftTypes
 * actually recognises after inflection expansion (sv_morph.ts) of the bases
 * and heads declared in domain.ts CRAFT_TAXONOMY. typoForms are the forms
 * the edit-distance-1 layer accepts one typo against (empty = typoTolerant
 * disabled for that type after the hazard audit).
 *
 * craft_vocabulary.test.ts asserts deep-equality with expandedCraftVocabulary(),
 * so ANY change to a base, declension class, keyword, stem, blocklist entry or
 * typo eligibility shows up here as a reviewable diff — the frozen-list culture
 * survives the generator. Regenerate ONLY via
 * run_craft_vocabulary_snapshot.ts (see its header); never hand-edit to
 * silence the test.
 */

export const EXPECTED_CRAFT_VOCABULARY = {
  types: [
    {
      key: "bil",
      exactForms: ["bil", "bilar", "bilarna", "bilen", "bilist", "bilisten", "bilister", "bilisterna", "personbil", "personbilar", "personbilarna", "personbilen"],
      headForms: [],
      stems: [],
      typoForms: ["bilarna", "bilist", "bilisten", "bilister", "bilisterna", "personbil", "personbilar", "personbilarna", "personbilen"],
    },
    {
      key: "lastbil",
      exactForms: ["lastbil", "lastbilar", "lastbilarna", "lastbilen", "pickup", "skåpbil", "skåpbilar", "skåpbilarna", "skåpbilen"],
      headForms: ["bil", "bilar", "bilarna", "bilen"],
      stems: ["lastbil", "skåpbil"],
      typoForms: ["lastbil", "lastbilar", "lastbilarna", "lastbilen", "pickup", "skåpbil", "skåpbilar", "skåpbilarna", "skåpbilen"],
    },
    {
      key: "traktor",
      exactForms: ["traktor", "traktorer", "traktorerna", "traktorn"],
      headForms: [],
      stems: ["traktor"],
      typoForms: ["traktor", "traktorer", "traktorerna", "traktorn"],
    },
    {
      key: "motorcykel",
      exactForms: ["fyrhjuling", "fyrhjulingar", "fyrhjulingarna", "fyrhjulingen", "mc", "moped", "mopeden", "mopeder", "mopederna", "motorcykel", "motorcykeln", "motorcyklar", "motorcyklarna", "motorcyklist", "motorcyklisten", "motorcyklister", "motorcyklisterna", "skoter", "skotern", "skotrar", "skotrarna"],
      headForms: ["motorcykel", "motorcykeln", "motorcyklar", "motorcyklarna"],
      stems: ["motorcyk"],
      typoForms: ["fyrhjuling", "fyrhjulingar", "fyrhjulingarna", "fyrhjulingen", "mopeden", "mopeder", "mopederna", "motorcykel", "motorcykeln", "motorcyklar", "motorcyklarna", "motorcyklist", "motorcyklisten", "motorcyklister", "motorcyklisterna", "skoter", "skotern", "skotrar", "skotrarna"],
    },
    {
      key: "buss",
      exactForms: ["buss", "bussar", "bussarna", "bussen", "minibuss", "minibussar", "minibussarna", "minibussen"],
      headForms: ["buss", "bussar", "bussarna", "bussen"],
      stems: [],
      typoForms: [],
    },
    {
      key: "cykel",
      exactForms: ["cykel", "cykeln", "cykla", "cyklade", "cyklar", "cyklarna", "cyklat", "cyklist", "cyklisten", "cyklister", "cyklisterna"],
      headForms: ["cykel", "cykeln", "cyklar", "cyklarna", "cyklist", "cyklisten", "cyklister", "cyklisterna"],
      stems: [],
      typoForms: ["cykeln", "cyklade", "cyklar", "cyklarna", "cyklat", "cyklist", "cyklisten", "cyklister", "cyklisterna"],
    },
    {
      key: "sparkcykel",
      exactForms: ["elcykel", "elcykeln", "elcyklar", "elcyklarna", "elsparkcykel", "elsparkcykeln", "elsparkcyklar", "elsparkcyklarna", "elsparkcyklist", "elsparkcyklisten", "elsparkcyklister", "elsparkcyklisterna", "scooter", "sparkcykel", "sparkcykeln", "sparkcyklar", "sparkcyklarna", "sparkcyklist", "sparkcyklisten", "sparkcyklister", "sparkcyklisterna"],
      headForms: ["sparkcykel", "sparkcykeln", "sparkcyklar", "sparkcyklarna", "sparkcyklist", "sparkcyklisten", "sparkcyklister", "sparkcyklisterna"],
      stems: [],
      typoForms: ["elcykel", "elcykeln", "elcyklar", "elcyklarna", "elsparkcykel", "elsparkcykeln", "elsparkcyklar", "elsparkcyklarna", "elsparkcyklist", "elsparkcyklisten", "elsparkcyklister", "elsparkcyklisterna", "scooter", "sparkcykel", "sparkcykeln", "sparkcyklar", "sparkcyklarna", "sparkcyklist", "sparkcyklisten", "sparkcyklister", "sparkcyklisterna"],
    },
    {
      key: "kärra",
      exactForms: ["kärra", "kärran", "kärror", "kärrorna"],
      headForms: ["kärra", "kärran", "kärror", "kärrorna"],
      stems: [],
      typoForms: [],
    },
    {
      key: "båt",
      exactForms: ["båt", "båtar", "båtarna", "båten", "fritidsbåt", "fritidsbåtar", "fritidsbåtarna", "fritidsbåten", "gummibåt", "gummibåtar", "gummibåtarna", "gummibåten", "jollar", "jollarna", "jolle", "jollen", "kajak", "kajaken", "kajaker", "kajakerna", "motorbåt", "motorbåtar", "motorbåtarna", "motorbåten", "ribbåt", "roddbåt", "roddbåtar", "roddbåtarna", "roddbåten", "segelbåt", "segelbåtar", "segelbåtarna", "segelbåten", "snabbåt", "vattenskoter", "vattenskotern", "vattenskotrar", "vattenskotrarna"],
      headForms: [],
      stems: ["båt", "kajak"],
      typoForms: [],
    },
    {
      key: "fartyg",
      exactForms: ["fartyg", "fartygen", "fartyget", "lastfartyg", "lastfartygen", "lastfartyget", "skepp", "skeppen", "skeppet", "tankfartyg", "tankfartygen", "tankfartyget", "örlogsfartyg", "örlogsfartygen", "örlogsfartyget"],
      headForms: [],
      stems: ["fartyg"],
      typoForms: ["fartyg", "fartygen", "fartyget", "lastfartyg", "lastfartygen", "lastfartyget", "skeppen", "skeppet", "tankfartyg", "tankfartygen", "tankfartyget", "örlogsfartyg", "örlogsfartygen", "örlogsfartyget"],
    },
    {
      key: "färja",
      exactForms: ["bilfärja", "bilfärjan", "bilfärjor", "bilfärjorna", "färja", "färjan", "färjor", "färjorna", "passagerarfärja", "passagerarfärjan", "passagerarfärjor", "passagerarfärjorna", "vägfärja", "vägfärjan", "vägfärjor", "vägfärjorna"],
      headForms: [],
      stems: ["färja"],
      typoForms: ["bilfärja", "bilfärjan", "bilfärjor", "bilfärjorna", "färjan", "färjor", "färjorna", "passagerarfärja", "passagerarfärjan", "passagerarfärjor", "passagerarfärjorna", "vägfärja", "vägfärjan", "vägfärjor", "vägfärjorna"],
    },
    {
      key: "drönare",
      exactForms: ["drönare", "drönaren", "drönarna", "kvadkopter", "multirotor", "quadcopter"],
      headForms: [],
      stems: ["drönar"],
      typoForms: [],
    },
    {
      key: "helikopter",
      exactForms: ["chopper", "helikopter", "helikoptern", "helikoptrar", "helikoptrarna"],
      headForms: [],
      stems: ["helikopt"],
      typoForms: ["chopper", "helikopter", "helikoptern", "helikoptrar", "helikoptrarna"],
    },
    {
      key: "flygplan",
      exactForms: ["flygplan", "flygplanen", "flygplanet", "propellerplan", "propellerplanen", "propellerplanet", "segelflygplan", "segelflygplanen", "segelflygplanet", "sjöflygplan", "sjöflygplanen", "sjöflygplanet", "ultralätt"],
      headForms: [],
      stems: ["flygplan"],
      typoForms: ["flygplan", "flygplanen", "flygplanet", "propellerplan", "propellerplanen", "propellerplanet", "segelflygplan", "segelflygplanen", "segelflygplanet", "sjöflygplan", "sjöflygplanen", "sjöflygplanet", "ultralätt"],
    },
  ],
  headBlock: ["automobil", "automobilen", "debil", "habil", "instabil", "labil", "mobil", "mobilen", "stabil"],
};
