#!/usr/bin/env bash
# Build + assemble the shareable ODEN release zip (private-repo distribution).
# Usage:  cd plugin && npm run package   (or: bash scripts/package.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN="$ROOT/plugin"
VERSION="$(node -p "require('$PLUGIN/manifest.json').version")"
echo "== Packaging ODEN v$VERSION =="

# 1. Gate on a clean, green build.
cd "$PLUGIN"
npm run typecheck
npm test
npm run build

# 2. Stage the drop-in layout.
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE/7s-analys" "$STAGE/obsidian-config"
cp "$PLUGIN/main.js" "$PLUGIN/manifest.json" "$STAGE/7s-analys/"
cp "$ROOT/obsidian-config/"* "$STAGE/obsidian-config/"
cp "$ROOT/INSTALL.md" "$ROOT/LICENSE" "$STAGE/"

# 3. Zip it.
mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/ODEN-$VERSION.zip"
rm -f "$OUT"
( cd "$STAGE" && zip -r -q "$OUT" . )

echo "== Wrote $OUT =="
unzip -l "$OUT"
