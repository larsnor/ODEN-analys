# Simulator — syntetisk 7S-datamimik

Härmar den **centrala applikationen** (Signal → formaterat 7S-Markdown): skapar
realistiska testmeddelanden att utveckla och validera pluginet mot. Skapar **inga**
entitetsnoter och gör **ingen** analys — bara rena, korrekt formaterade meddelanden.
Analysen hör hemma i pluginet.

## Skript

- **`generate_reports_newformat.py`** — genererar en syntetisk korpus i det aktuella
  formatet (fri prosa i `Händelse`, MGRS-rutor, UUID-id) till `reports_new/`, plus
  facit i `ground_truth_new.json`. Deterministiskt (fast frö) så körningar är
  reproducerbara. Bäddar in "ground truth": brus, pendlare (falsk-positiv-fälla)
  och en spaningsgrupp vars sammanhang måste *härledas* — inte serveras färdigt.
- **`feed_reports.py`** — interaktiv matare som droppar rapporter i vaulten i
  tidsordning, som applikationen skulle göra när meddelanden anländer. Kopierar även
  refererade bilagor (`attachments/`) så inbäddningar fungerar i vaulten.
- **`gen_images.py`** — genererar platshållarbilder till `attachments/`.

## Bilder (plåtfoton)

Generatorn bifogar ett **plåtfoto** till varje meddelande vars text nämner en
plåt (korroborerande — fotot bekräftar en plåt en människa redan skrivit). Plåten
ritas läsbart OCH bäddas in i JPEG-kommentaren (`7SPLATE:`) så att pluginets
deterministiska vision-stub kan läsa den offline; en riktig vision-modell läser
pixlarna i stället. Bildgenerering kräver **Pillow**:

```bash
python3 -m venv .venv
./.venv/bin/pip install Pillow
```

Kör med `./.venv/bin/python3` nedan (eller lägg till `--no-images` för att hoppa
över foton, då behövs inte Pillow).

## Platsprofiler (`--site`)

Generatorn har två utbytbara **platsprofiler** med samma scenarioform och samma
beteenderepertoar — bara geografin, platsnamnen och personerna skiljer. Poängen är
att pluginets fasta regelverk (suspicion `RECON_INDICATORS`, `vocab.ts`) ska hitta
spaningscellen på **båda** platserna utan att tunas om per korpus.

- `--site vallinge` — HvSS Vällinge (fem sektorer AQ–EQ). Skriver `reports_new/`.
- `--site tierp` — Tierp flygfält (ESKT ~60.345 N, 17.422 E), fyra plutoner
  AQ/BQ/CQ/DQ runt fältet, sju nya spaningsindivider. Skriver `reports_tierp/`.

MGRS-rutorna beräknas från lat/lon med `mgrs_forward.py` (WGS84 → MGRS, matchar
pluginets inversa `mgrs.ts` — verifierat mot Vällinges rutor och genom
round-trip).

## Användning

```bash
# Vällinge (med plåtfoton — kräver Pillow-venv)
./.venv/bin/python3 generate_reports_newformat.py --site vallinge
python3 feed_reports.py --source ./reports_new --vault /sökväg/till/Vault

# Tierp (utan foton)
python3 generate_reports_newformat.py --site tierp --no-images
python3 feed_reports.py --source ./reports_tierp --vault /sökväg/till/Vault
```

> Sätt skyddsobjektets koordinat i ODEN-inställningarna till platsen du matar in
> (Vällinge 59.2622,17.712 · Tierp 60.345,17.422) så att närhets-signalen mäter
> mot rätt objekt.

Matarkommandon: `send` (nästa) · `send 5` · `auto` (~15 min) · `auto 5` ·
`status` · `reset` (töm) · `quit`.

## Noter

- Meddelandeformatet beskrivs i [`../docs/FORMAT_SPEC.md`](../docs/FORMAT_SPEC.md).
- Pluginets testsvit validerar mot en **snapshot** av korpusen i
  `../plugin/test/fixtures/` — den regenereras inte automatiskt av skripten här.
- Den äldre generatorn (`generate_reports.py`, äldre meddelandeformat) ligger i
  [`../archive/`](../archive/).
