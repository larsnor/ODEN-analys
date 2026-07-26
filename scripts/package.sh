#!/usr/bin/env bash
# Build ODEN's release artifacts:
#   dist/ODEN-plugin-<v>.zip — bare plugin + drop-in Obsidian config, for users
#                              with an existing vault (INSTALL.md "Väg B").
#   dist/ODEN-valv-<v>.zip   — a COMPLETE preconfigured vault: ODEN + Map View
#                              (MIT, pinned version, license included) + all
#                              config + Välkommen.md + demo/ corpus in feed
#                              batches. The 3-step novice path ("Väg A").
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

# Demo corpus — regenerated deterministically (fixed seed) at package time.
DEMO_AOI="59.26239628419817,17.712273532270785"
DEMO_SEED="2026"
DEMO_FROM="2026-06-15"
DEMO_DAYS="14"
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

# 3. Generate the demo corpus (deterministic) into a cache, once per version set.
DEMO_CACHE="$ROOT/dist/cache/demo-$DEMO_SEED-$DEMO_FROM-$DEMO_DAYS"
if [ ! -d "$DEMO_CACHE" ]; then
  echo "== Genererar demokorpus (seed $DEMO_SEED) =="
  TMP_CORPUS="$(mktemp -d)"
  7s-generator generate --aoi "$DEMO_AOI" --area suburban \
    --from "$DEMO_FROM" --days "$DEMO_DAYS" --name "HvSS Vällinge (demo)" \
    --seed "$DEMO_SEED" --images --photos --obsidian --out "$TMP_CORPUS"
  7s-generator add-hostiles --corpus "$TMP_CORPUS" --type recon --photos --seed "$DEMO_SEED"
  7s-generator add-protesters --corpus "$TMP_CORPUS" --type demonstranter --seed "$DEMO_SEED"
  mkdir -p "$DEMO_CACHE"
  mv "$TMP_CORPUS"/* "$DEMO_CACHE/"
  rmdir "$TMP_CORPUS"
fi

# 4. Stage the PLUGIN zip (existing-vault users).
STAGE_P="$(mktemp -d)"
STAGE_V="$(mktemp -d)"
trap 'rm -rf "$STAGE_P" "$STAGE_V"' EXIT
mkdir -p "$STAGE_P/7s-analys" "$STAGE_P/obsidian-config"
cp "$PLUGIN/main.js" "$PLUGIN/manifest.json" "$STAGE_P/7s-analys/"
cp "$ROOT/obsidian-config/"* "$STAGE_P/obsidian-config/"
cp "$ROOT/INSTALL.md" "$ROOT/LICENSE" "$STAGE_P/"

# 5. Stage the VAULT zip (the novice path).
VAULT="$STAGE_V/ODEN-valv"
OBS="$VAULT/.obsidian"
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
# Onboarding note + a placeholder so inkorg/ survives zipping.
cp "$ROOT/packaging/Välkommen.md" "$VAULT/Välkommen.md"
printf 'Rapporter som ska analyseras läggs i den här mappen.\n' > "$VAULT/inkorg/LÄS-MIG.md"

# 6. demo/: split the corpus chronologically into drag-in batches. A report's
#    attachment folder (Obsidian wikilink layout) travels with its report.
python3 - "$DEMO_CACHE" "$VAULT/demo" "$BATCH_SIZE" <<'PYEOF'
import os, re, shutil, sys
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
reports = sorted(f for f in os.listdir(src) if re.fullmatch(r"TNR\d+\.md", f))
os.makedirs(dst, exist_ok=True)
# Map each report to its per-message attachment dir (named <signaltid>_<TNR-tid>-<uuid>).
dirs = [d for d in os.listdir(src) if os.path.isdir(os.path.join(src, d))]
def att_dirs(report):
    tnr = report[3:-3]
    return [d for d in dirs if f"_{tnr}-" in d]
batches = [reports[i:i+size] for i in range(0, len(reports), size)]
for i, batch in enumerate(batches, 1):
    bdir = os.path.join(dst, f"batch-{i:02d}")
    os.makedirs(bdir, exist_ok=True)
    for r in batch:
        shutil.copy2(os.path.join(src, r), bdir)
        for d in att_dirs(r):
            shutil.copytree(os.path.join(src, d), os.path.join(bdir, d), dirs_exist_ok=True)
print(f"demo/: {len(reports)} rapporter i {len(batches)} batchar")
PYEOF
cp "$DEMO_CACHE/ground_truth.json" "$VAULT/demo/facit.json"
cat > "$VAULT/demo/LÄS-MIG.md" <<'EOF'
# Demodata — så matar du in den

Övningskorpus: 14 dygn kring HvSS Vällinge (syntetisk — inga riktiga personer
eller fordon). Sätt först operationsområdet till `59.2622,17.712`
(kommandot "ODEN: Konfigurera operationsområde").

Dra sedan innehållet i `batch-01/` till mappen `inkorg/` — ODEN analyserar
direkt. Fortsätt med nästa batch i din egen takt. Bildmappar ska följa med
sina rapporter (markera hela batchens innehåll).

När du är klar: `facit.json` visar sanningen per rapport (`civil` /
`hostile` = spaningscellen / `protester`) — jämför med vad du hittade.

Se `Välkommen.md` för hela genomgången.
EOF

# 7. Zip both. Python's zipfile sets the UTF-8 name flag (macOS `zip` does not),
#    so "Välkommen.md" survives unzipping on Windows.
mkdir -p "$ROOT/dist"
OUT_P="$ROOT/dist/ODEN-plugin-$VERSION.zip"
OUT_V="$ROOT/dist/ODEN-valv-$VERSION.zip"
rm -f "$OUT_P" "$OUT_V"
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

echo "== Skrev $OUT_P =="
unzip -l "$OUT_P" | tail -3
echo "== Skrev $OUT_V =="
unzip -l "$OUT_V" | tail -3
echo "   (Map View $MAPVIEW_VERSION bundlad under MIT-licens; licensfil medföljer)"
