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

## Användning

```bash
./.venv/bin/python3 generate_reports_newformat.py
python3 feed_reports.py --source ./reports_new --vault /sökväg/till/Vault
```

Matarkommandon: `send` (nästa) · `send 5` · `auto` (~15 min) · `auto 5` ·
`status` · `reset` (töm) · `quit`.

## Noter

- Meddelandeformatet beskrivs i [`../docs/FORMAT_SPEC.md`](../docs/FORMAT_SPEC.md).
- Pluginets testsvit validerar mot en **snapshot** av korpusen i
  `../plugin/test/fixtures/` — den regenereras inte automatiskt av skripten här.
- Den äldre generatorn (`generate_reports.py`, äldre meddelandeformat) ligger i
  [`../archive/`](../archive/).
