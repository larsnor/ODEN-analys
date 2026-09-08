#!/usr/bin/env bash
# Build ODEN's release artifacts:
#   dist/ODEN-plugin-<v>.zip — bare plugin + drop-in Obsidian config, for users
#                              with an existing vault (INSTALL.md "Väg B").
#   dist/ODEN-valv-<v>.zip   — OPERATIONAL: a complete preconfigured vault
#                              (ODEN + Map View (MIT, pinned, license) + config
#                              + Välkommen.md), no demo data.
#   dist/ODEN-ovning-<v>.zip — TRAINING: the same vault (folder ODEN-övning)
#                              plus every demo cartridge in feed batches.
# Requirements: node/npm, curl, zip, python3, and `7s-generator` on PATH
# (github.com/larsnor/7S-generator) for the demo corpus. Network is needed once
# to fetch the pinned Map View release (cached in dist/cache/).
# Usage:  cd plugin && npm run package   (or: bash scripts/package.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/plugin"
VERSION="$(node -p "require('$PLUGIN/manifest.json').version")"

# Map View — bundled under its MIT license; keep pinned + license file shipped.
MAPVIEW_VERSION="6.1.4"
MAPVIEW_BASE="https://github.com/esm7/obsidian-map-view/releases/download/$MAPVIEW_VERSION"
MAPVIEW_LICENSE_URL="https://raw.githubusercontent.com/esm7/obsidian-map-view/master/LICENSE"

# Demo cartridges — regenerated deterministically at package time from the
# shared table in cartridges.sh. Seeds fix the CONTENT; the start date rolls
# with the build day so a fresh install's demo data mixes with live traffic
# instead of sorting months under it in the feed. Override with
# ODEN_DEMO_FROM=YYYY-MM-DD for a demo on a specific date.
# shellcheck source=cartridges.sh
. "$ROOT/scripts/cartridges.sh"
DEMO_FROM="${ODEN_DEMO_FROM:-$(date +%Y-%m-%d)}"
BATCH_SIZE="25"

echo "== Packaging ODEN v$VERSION =="

command -v 7s-generator >/dev/null || {
  echo "FEL: 7s-generator saknas på PATH — installera från github.com/larsnor/7S-generator" >&2
  echo "     (pip install -e '.[images]' från en klon)" >&2
  exit 1
}

# 1. Gate on a clean, green build.
cd "$PLUGIN"
npm run typecheck
npm test
npm run build

# 2. Fetch + cache the pinned Map View release.
CACHE="$ROOT/dist/cache/obsidian-map-view-$MAPVIEW_VERSION"
mkdir -p "$CACHE"
for f in main.js manifest.json styles.css; do
  [ -s "$CACHE/$f" ] || curl -fsSL "$MAPVIEW_BASE/$f" -o "$CACHE/$f"
done
[ -s "$CACHE/LICENSE" ] || curl -fsSL "$MAPVIEW_LICENSE_URL" -o "$CACHE/LICENSE"

# 3. Generate every demo cartridge (deterministic) into a cache, once per
#    (cartridge, seed, date) — a daily rebuild regenerates, a same-day rebuild
#    reuses.
CARTRIDGE_CACHE_DIRS=()
for line in "${CARTRIDGES[@]}"; do
  IFS='|' read -r c_id c_label c_aoi c_area c_days c_seed _rest <<<"$line"
  CDIR="$ROOT/dist/cache/cartridge-$c_id-$c_seed-$DEMO_FROM-$c_days"
  if [ ! -d "$CDIR" ]; then
    echo "== Genererar demokassett $c_label (seed $c_seed) =="
    TMP_CORPUS="$(mktemp -d)"
    generate_cartridge "$line" "$TMP_CORPUS" "$DEMO_FROM"
    mkdir -p "$CDIR"
    mv "$TMP_CORPUS"/* "$CDIR/"
    rmdir "$TMP_CORPUS"
  fi
  CARTRIDGE_CACHE_DIRS+=("$CDIR")
done

# 4. Stage the PLUGIN zip (existing-vault users).
STAGE_P="$(mktemp -d)"
STAGE_V="$(mktemp -d)"
trap 'rm -rf "$STAGE_P" "$STAGE_V"' EXIT
mkdir -p "$STAGE_P/7s-analys" "$STAGE_P/obsidian-config"
cp "$PLUGIN/main.js" "$PLUGIN/manifest.json" "$STAGE_P/7s-analys/"
cp "$ROOT/obsidian-config/"* "$STAGE_P/obsidian-config/"
cp "$ROOT/INSTALL.md" "$ROOT/LICENSE" "$STAGE_P/"

# 5+6. Stage the VAULT zips — TWO flavours from one source:
#   ODEN-valv-<v>.zip    OPERATIONAL: the vault as it should look in service —
#                        no demo/, Välkommen without the training section.
#   ODEN-ovning-<v>.zip  TRAINING: the same vault plus every demo cartridge,
#                        vault folder "ODEN-övning" so both can coexist.
# The plugin is identical; the demo commands hide themselves without demo/.
stage_vault() {
  local VAULT="$1" WITH_DEMO="$2"
  local OBS="$VAULT/.obsidian"
  mkdir -p "$OBS/plugins/7s-analys" "$OBS/plugins/obsidian-map-view" "$OBS/snippets" "$VAULT/inkorg"
  # Obsidian config (templates are the single source of truth).
  cp "$ROOT/obsidian-config/app.json" "$OBS/app.json"
  cp "$ROOT/obsidian-config/core-plugins.json" "$OBS/core-plugins.json"
  cp "$ROOT/obsidian-config/graph.json" "$OBS/graph.json"
  cp "$ROOT/obsidian-config/workspace.json" "$OBS/workspace.json"
  cp "$ROOT/obsidian-config/oden-lock.css" "$OBS/snippets/oden-lock.css"
  printf '{\n  "theme": "obsidian",\n  "enabledCssSnippets": ["oden-lock"]\n}\n' > "$OBS/appearance.json"
  printf '[\n  "7s-analys",\n  "obsidian-map-view"\n]\n' > "$OBS/community-plugins.json"
  # Plugins.
  cp "$PLUGIN/main.js" "$PLUGIN/manifest.json" "$OBS/plugins/7s-analys/"
  cp "$CACHE/main.js" "$CACHE/manifest.json" "$CACHE/styles.css" "$CACHE/LICENSE" "$OBS/plugins/obsidian-map-view/"
  cp "$ROOT/obsidian-config/map-view-data.json" "$OBS/plugins/obsidian-map-view/data.json"
  printf 'Rapporter som ska analyseras läggs i den här mappen.\n' > "$VAULT/inkorg/LÄS-MIG.md"

  if [ "$WITH_DEMO" = "1" ]; then
    cp "$ROOT/packaging/Välkommen.md" "$VAULT/Välkommen.md"
    # demo/<id>/: every cartridge split chronologically into drag-in batches,
    # with its manifest (the plugin's discovery contract), facit and LÄS-MIG.
    mkdir -p "$VAULT/demo"
    local i=0 line
    for line in "${CARTRIDGES[@]}"; do
      IFS='|' read -r c_id c_label _rest <<<"$line"
      split_cartridge "${CARTRIDGE_CACHE_DIRS[$i]}" "$VAULT/demo/$c_id" "$BATCH_SIZE"
      cartridge_manifest "$line" > "$VAULT/demo/$c_id/cartridge.json"
      cartridge_readme "$line" "$DEMO_FROM" > "$VAULT/demo/$c_id/LÄS-MIG.md"
      i=$((i + 1))
    done
    {
      echo "# Demokassetter"
      echo
      echo "Varje undermapp är en fristående övningskorpus (\"kassett\") med egen plats,"
      echo "egen hotbild och eget facit. Kommandopaletten har ett kommando per kassett:"
      echo "**\"ODEN: Mata demodata — <plats>\"** — det erbjuder sig att byta"
      echo "operationsområde till kassettens plats, frågar efter speltid och matar"
      echo "rapporterna i korpusens egen rytm. Samma kommando pausar/återupptar."
      echo
      for line in "${CARTRIDGES[@]}"; do
        IFS='|' read -r c_id c_label c_aoi c_area c_days c_seed c_photos c_h c_p c_desc <<<"$line"
        echo "- **$c_label** (\`$c_id/\`, $c_days dygn): $c_desc"
      done
      echo
      echo "Alla kassetter är syntetiska (inga riktiga personer eller fordon) och daterade"
      echo "från paketeringsdagen **$DEMO_FROM**. Nollställ valvet flyttar matade rapporter"
      echo "tillbaka till sin kassett. Se \`Välkommen.md\` för hela genomgången."
    } > "$VAULT/demo/LÄS-MIG.md"
  else
    # Operational Välkommen = the training one minus its "Testa med demodata"
    # section (single source; the section is delimited by ## headings).
    python3 - "$ROOT/packaging/Välkommen.md" "$VAULT/Välkommen.md" <<'PYEOF'
import re, sys
src, dst = sys.argv[1], sys.argv[2]
text = open(src, encoding="utf-8").read()
text = re.sub(r"## Testa med demodata\n.*?(?=\n## )", "", text, count=1, flags=re.S)
open(dst, "w", encoding="utf-8").write(text)
PYEOF
  fi
}

STAGE_T="$(mktemp -d)"
trap 'rm -rf "$STAGE_P" "$STAGE_V" "$STAGE_T"' EXIT
stage_vault "$STAGE_V/ODEN-valv" 0
stage_vault "$STAGE_T/ODEN-övning" 1

# 7. Zip both. Python's zipfile sets the UTF-8 name flag (macOS `zip` does not),
#    so "Välkommen.md" survives unzipping on Windows.
mkdir -p "$ROOT/dist"
OUT_P="$ROOT/dist/ODEN-plugin-$VERSION.zip"
OUT_V="$ROOT/dist/ODEN-valv-$VERSION.zip"
OUT_T="$ROOT/dist/ODEN-ovning-$VERSION.zip"
rm -f "$OUT_P" "$OUT_V" "$OUT_T"
pyzip() { python3 - "$1" "$2" <<'PYEOF'
import os, sys, zipfile
root, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames.sort()
        for f in sorted(filenames):
            p = os.path.join(dirpath, f)
            z.write(p, os.path.relpath(p, root))
PYEOF
}
pyzip "$STAGE_P" "$OUT_P"
pyzip "$STAGE_V" "$OUT_V"
pyzip "$STAGE_T" "$OUT_T"

echo "== Skrev $OUT_P =="
unzip -l "$OUT_P" | tail -3
echo "== Skrev $OUT_V (operativt valv, utan demo) =="
unzip -l "$OUT_V" | tail -3
echo "== Skrev $OUT_T (övningsvalv, med kassetter) =="
unzip -l "$OUT_T" | tail -3
echo "   (Map View $MAPVIEW_VERSION bundlad under MIT-licens; licensfil medföljer)"
