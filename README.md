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
| [`simulator/`](simulator/) | Python som **genererar** och **matar in** syntetiska 7S-rapporter (härmar den centrala applikationen som skickar meddelanden). |
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
```bash
cd simulator
python3 generate_reports_newformat.py                 # skapar reports_new/ + facit
python3 feed_reports.py --source ./reports_new --vault /sökväg/till/Vault
```
Matarkommandon: `send` / `send 5` / `auto` / `status` / `reset` / `quit`.

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
