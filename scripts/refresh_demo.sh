#!/usr/bin/env bash
# Omdatera ett valvs demokassetter — för demos där demodata ska BLANDAS med
# skarp trafik i samma tidsera (flödet sorterar på observationstid; en gammal
# korpus sorterar under all färsk trafik och försvinner ur synfältet).
#
# Regenererar ALLA kassetter i scripts/cartridges.sh deterministiskt (samma
# seed → samma innehåll/berättelse, bara kalendern flyttad; klockslagen bevaras
# — nattmönstret ÄR signalen) och ersätter <valv>/demo/ med kassettmapparna.
#
# Användning:  scripts/refresh_demo.sh <valv-sökväg> [startdatum]
#              startdatum = YYYY-MM-DD, standard: idag.
# Kräver 7s-generator på PATH (github.com/larsnor/7S-generator).
set -euo pipefail

VAULT="${1:?Användning: refresh_demo.sh <valv-sökväg> [startdatum YYYY-MM-DD]}"
FROM="${2:-$(date +%Y-%m-%d)}"
BATCH=25
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=cartridges.sh
. "$ROOT/scripts/cartridges.sh"

command -v 7s-generator >/dev/null || { echo "FEL: 7s-generator saknas på PATH" >&2; exit 1; }
[ -d "$VAULT" ] || { echo "FEL: valvet finns inte: $VAULT" >&2; exit 1; }
# Skydd: mata aldrig om ovanpå redan inmatad demodata utan att operatören städat.
if ls "$VAULT/inkorg"/TNR*.md >/dev/null 2>&1; then
  echo "FEL: inkorg/ innehåller redan TNR-rapporter — kör Nollställ valvet (eller nytt valv) före omdatering." >&2
  exit 1
fi

rm -rf "$VAULT/demo"
mkdir -p "$VAULT/demo"
for line in "${CARTRIDGES[@]}"; do
  IFS='|' read -r c_id c_label _rest <<<"$line"
  TMP=$(mktemp -d)
  generate_cartridge "$line" "$TMP" "$FROM"
  split_cartridge "$TMP" "$VAULT/demo/$c_id" "$BATCH"
  cartridge_manifest "$line" > "$VAULT/demo/$c_id/cartridge.json"
  cartridge_readme "$line" "$FROM" > "$VAULT/demo/$c_id/LÄS-MIG.md"
  rm -rf "$TMP"
done
echo "Klart: $VAULT/demo omdaterad (start $FROM, ${#CARTRIDGES[@]} kassetter). Starta om Obsidian så registreras kommandona."
