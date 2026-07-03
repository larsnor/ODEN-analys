# ODEN — 7S-lägesanalys

ODEN är ett Obsidian-plugin som analyserar svenska **7S-lägesrapporter** från
hemvärnet: det känner igen återkommande fordon och kännetecken, kopplar ihop dem
till **aktörer**, poängsätter **misstänkt aktivitet** transparent, visar platser i
graf och karta, och **larmar** vid ny aktivitet. Alla kopplingar bekräftas av
operatören — ODEN föreslår, människan avgör.

All analys är **deterministisk** och körbar utan nätverk eller språkmodell; den är
byggd för att kunna granskas och valideras rad för rad.

## Struktur

| Mapp | Vad |
|------|-----|
| [`plugin/`](plugin/) | Obsidian-pluginet (TypeScript). Självständigt — testerna kör mot fixturerna i [`plugin/test/fixtures/`](plugin/test/fixtures/). |
| [`obsidian-config/`](obsidian-config/) | Färdig Obsidian-konfiguration: graffärger, Map View-regler och ett "lås panelerna"-snitt. |
| [`docs/`](docs/) | Format-spec, plugin-design, överlämningsanteckningar och frontmatter-schema. |
| [`archive/`](archive/) | Avvecklat/referens: äldre generator, tidig Python-prototyp, dataset-zip. Ingår inte i pipelinen. |

## Snabbstart

### Bygg och testa pluginet
```bash
cd plugin
npm install
npm run typecheck   # inga typfel
npm test            # kör hela testsviten mot fixturerna
npm run build       # skapar main.js
```
Kopiera sedan `plugin/main.js` + `plugin/manifest.json` till
`<din-vault>/.obsidian/plugins/7s-analys/` och aktivera pluginet i Obsidian.
(`main.js` byggs lokalt och versionshanteras inte — kör `npm run build`.)

### Generera och mata in testdata
Testkorpusar skapas och matas in med det fristående verktyget
**[7S-generator](https://github.com/larsnor/7S-generator)** (eget repo, CLI, inga
beroenden). Det producerar samma 7S-format som pluginet läser:
```bash
python3 -m corpusgen generate --aoi 60.345,17.422 --area airport \
  --from 2026-06-15 --days 14 --callsigns AQ,BQ,CQ,DQ --out ./corpus_tierp
python3 -m corpusgen add-hostiles --corpus ./corpus_tierp --type recon
python3 -m corpusgen feed --corpus ./corpus_tierp --vault /sökväg/till/Vault
```
Sätt sedan skyddsobjektets koordinat i ODEN till samma AOI (t.ex. via
"Konfigurera operationsområde"). Pluginets egna tester är självständiga och
behöver inte verktyget — de kör mot den incheckade snapshoten i
[`plugin/test/fixtures/`](plugin/test/fixtures/).

### Obsidian-konfiguration
Se [`obsidian-config/README.md`](obsidian-config/README.md). Graffärgerna och
kartinställningarna behöver skrivas medan Obsidian är **stängt** (Obsidian skriver
över dem annars vid stängning).

## Designprinciper

- **Skrivkontrakt:** pluginet rör aldrig meddelandefiler. Det skapar bara sina
  egna noter (märkta `generator: 7s-plugin`) och är idempotent.
- **Föreslå, bekräfta aldrig automatiskt:** säkra ID-matchningar (samma
  registreringsnummer) slås ihop; allt annat föreslås och bekräftas av operatören.
- **Transparent poäng:** misstankepoängen är en förklarbar viktad summa — varje
  rad visar sina skäl, ingen svart låda.
- **Pekar, styr inte:** pluginet pekar mot var operatören ska titta i graf och
  karta; operatören klickar själv.

Detaljerad design finns i [`docs/PLUGIN_DESIGN.md`](docs/PLUGIN_DESIGN.md) och
meddelandeformatet i [`docs/FORMAT_SPEC.md`](docs/FORMAT_SPEC.md).
