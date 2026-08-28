#!/usr/bin/env bash
# Omdatera ett valvs demokorpus — för demos där demodata ska BLANDAS med skarp
# trafik i samma tidsera (flödet sorterar på observationstid; en junidaterad
# korpus sorterar under all färsk trafik och försvinner ur 60-radersfönstret).
#
# Regenererar korpusen deterministiskt (samma seed → samma innehåll/berättelse,
# bara kalendern flyttad; klockslagen bevaras — nattmönstret ÄR signalen) och
# ersätter <valv>/demo/ med kronologiskt delade batchar + facit.
#
# Användning:  scripts/refresh_demo.sh <valv-sökväg> [startdatum]
#              startdatum = YYYY-MM-DD, standard: idag.
# Kräver 7s-generator på PATH (github.com/larsnor/7S-generator).
# OBS: en korpus som korsar månadsskifte kräver ODEN ≥ den wrap-medvetna
# demomataren (2026-08-28); LÄS-MIG i demo/ förklarar blanddemo-tekniken.
set -euo pipefail

VAULT="${1:?Användning: refresh_demo.sh <valv-sökväg> [startdatum YYYY-MM-DD]}"
FROM="${2:-$(date +%Y-%m-%d)}"
AOI="59.26239628419817,17.712273532270785"
SEED="2026"; DAYS="14"; BATCH=25

command -v 7s-generator >/dev/null || { echo "FEL: 7s-generator saknas på PATH" >&2; exit 1; }
[ -d "$VAULT" ] || { echo "FEL: valvet finns inte: $VAULT" >&2; exit 1; }
# Skydd: mata aldrig om ovanpå redan inmatad demodata utan att operatören städat.
if ls "$VAULT/inkorg"/TNR*.md >/dev/null 2>&1; then
  echo "FEL: inkorg/ innehåller redan TNR-rapporter — städa (eller nytt valv) före omdatering." >&2
  exit 1
fi

TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT
7s-generator generate --aoi "$AOI" --area suburban --from "$FROM" --days "$DAYS" \
  --name "HvSS Vällinge (demo)" --seed "$SEED" --images --photos --obsidian --out "$TMP"
7s-generator add-hostiles   --corpus "$TMP" --type recon --photos --seed "$SEED"
7s-generator add-protesters --corpus "$TMP" --type demonstranter --seed "$SEED"

rm -rf "$VAULT/demo"
python3 - "$TMP" "$VAULT/demo" "$BATCH" <<'PYEOF'
import os, re, shutil, sys
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
def tidpunkt(p):
    for line in open(p, encoding="utf-8"):
        if line.startswith("tidpunkt:"): return line.split(":", 1)[1].strip().strip('"')
    return ""
# Sortera på tidpunkt, inte filnamn — TNR saknar månad, så en korpus som korsar
# månadsskifte namnsorterar fel (Sep 01 före Aug 29).
reports = sorted((f for f in os.listdir(src) if re.fullmatch(r"TNR\d+\.md", f)),
                 key=lambda f: (tidpunkt(os.path.join(src, f)), f))
os.makedirs(dst, exist_ok=True)
dirs = [d for d in os.listdir(src) if os.path.isdir(os.path.join(src, d))]
for i in range(0, len(reports), size):
    bdir = os.path.join(dst, f"batch-{i // size + 1:02d}")
    os.makedirs(bdir, exist_ok=True)
    for r in reports[i:i + size]:
        shutil.copy2(os.path.join(src, r), bdir)
        for d in dirs:
            if f"_{r[3:-3]}-" in d:
                shutil.copytree(os.path.join(src, d), os.path.join(bdir, d), dirs_exist_ok=True)
shutil.copy2(os.path.join(src, "ground_truth.json"), os.path.join(dst, "facit.json"))
print(f"demo/: {len(reports)} rapporter, start {tidpunkt(os.path.join(src, reports[0]))}")
PYEOF
cat > "$VAULT/demo/LÄS-MIG.md" <<LASEOF
# Demodata — så matar du in den

Övningskorpus: $DAYS dygn kring HvSS Vällinge med start **$FROM** (syntetisk —
inga riktiga personer eller fordon; daterad för att kunna blandas med skarp
trafik). Sätt operationsområdet till \`59.2622,17.712\` och kör
**"ODEN: Mata demodata"** (samma kommando pausar/återupptar).

**Blanddemo-tips:** batch-01–02 ≈ första dygnet — mata dem, eller pausa
uppspelningen i tid, så håller sig demodatan till samma dag som den skarpa
trafiken; senare batchar är daterade framåt och sorterar över dagens rader i
flödet. Facit i \`facit.json\`.
LASEOF
echo "Klart: $VAULT/demo omdaterad (start $FROM)."
