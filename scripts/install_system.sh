#!/usr/bin/env bash
# ODEN — one-stop-installation av HELA systemet (macOS):
#   1. ODEN-valv-<v>.zip  (färdigt analysvalv: ODEN-analys + Map View + demo)
#   2. Oden.app           (Bin 1: Signal → 7S-rapporter) via Odens EGET
#                         officiella installationsskript — återimplementeras aldrig här
#   3. skriver ut de manuella stegen (Obsidian + setup-wizard + kartnyckel)
#
# Principer: inget sudo; skriver aldrig över ett befintligt valv; hoppar över
# redan installerade delar (idempotent); Obsidian förblir obundlat (proprietärt)
# och installeras aldrig automatiskt.
#
# Användning:
#   curl -fsSL https://raw.githubusercontent.com/larsnor/ODEN-analys/main/scripts/install_system.sh | bash
#   ODEN_VALV_DIR=~/Skrivbord/valv  …  | bash    # annan målkatalog
set -euo pipefail

REPO="larsnor/ODEN-analys"
# Oden (Bin 1) installeras från dess STABILA release-kanal. (2026-08-27 till
# 2026-08-28 var snapshot standard här: dåvarande release v3.1.2 tappade foton
# i 7S-rapporter och skrev fel MGRS-koordinater. v3.2.0, släppt 2026-08-28,
# innehåller båda fixarna — verifierat mot taggens träd — så stabila kanalen är
# rätt igen.) Vill man ändå ha senaste snapshot:  ODEN_APP_CHANNEL=snapshot  …  | bash
ODEN_INSTALLER_SNAPSHOT="https://raw.githubusercontent.com/NicklasAndersson/oden/main/scripts/install_snapshot_mac.sh"
ODEN_INSTALLER_RELEASE="https://raw.githubusercontent.com/NicklasAndersson/oden/main/scripts/install_mac.sh"
# Äldsta Oden-version utan kända 7S-luckor (foton + koordinater).
ODEN_MIN_OK="3.2.0"
TARGET_PARENT="${ODEN_VALV_DIR:-$HOME/Documents}"
VALV_DIR="$TARGET_PARENT/ODEN-valv"

info()  { printf '\033[0;34mℹ %s\033[0m\n' "$1"; }
ok()    { printf '\033[0;32m✓ %s\033[0m\n' "$1"; }
fail()  { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ "$(uname)" = "Darwin" ] || fail "Det här skriptet är för macOS. Se INSTALL.md för andra plattformar."
command -v python3 >/dev/null || fail "python3 saknas (ingår i macOS — kör xcode-select --install)."

printf '\n\033[1m=== ODEN — installation av hela systemet ===\033[0m\n\n'

# --- 1. ODEN-valv -----------------------------------------------------------
if [ -e "$VALV_DIR" ]; then
  ok "Valvet finns redan: $VALV_DIR (rörs inte — ett valv skrivs aldrig över)"
else
  info "Hämtar senaste ODEN-valv från GitHub-releasen…"
  ASSET_URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" | python3 -c '
import json, sys
rel = json.load(sys.stdin)
for a in rel.get("assets", []):
    if a["name"].startswith("ODEN-valv-") and a["name"].endswith(".zip"):
        print(a["browser_download_url"]); break
')
  [ -n "$ASSET_URL" ] || fail "Hittade ingen ODEN-valv-*.zip i senaste releasen ($REPO)."
  TMP_ZIP=$(mktemp -t oden-valv).zip
  trap 'rm -f "$TMP_ZIP"' EXIT
  curl -fsSL "$ASSET_URL" -o "$TMP_ZIP"
  mkdir -p "$TARGET_PARENT"
  # Zippen innehåller toppmappen ODEN-valv/ — packas upp bredvid, aldrig över.
  python3 -c "import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])" "$TMP_ZIP" "$TARGET_PARENT"
  [ -d "$VALV_DIR" ] || fail "Uppackningen gav inte $VALV_DIR — kontrollera zip-innehållet."
  ok "Valv på plats: $VALV_DIR"
fi

# --- 2. Oden.app (Bin 1) — via dess egna officiella installationsskript ------
if [ -d "/Applications/Oden.app" ]; then
  ODEN_VER=$(defaults read /Applications/Oden.app/Contents/Info.plist CFBundleShortVersionString 2>/dev/null || echo "okänd")
  ok "Oden.app finns redan i /Applications (version $ODEN_VER — hoppar över)"
  case "$ODEN_VER" in
    snapshot-*) : ;; # testkanal — bedöms inte mot versionsnumret
    *)
      if [ "$(printf '%s\n' "$ODEN_VER" "$ODEN_MIN_OK" | sort -V | head -1)" != "$ODEN_MIN_OK" ]; then
        info "OBS: Oden före $ODEN_MIN_OK tappar foton i 7S-rapporter och kan skriva fel koordinater."
        info "Uppgradera (avsluta Oden först):  curl -fsSL $ODEN_INSTALLER_RELEASE | bash"
      fi ;;
  esac
elif [ "$(uname -m)" != "arm64" ]; then
  # Oden ≥4.0.0 bygger macOS-appen enbart för Apple Silicon — Intel-Macar kör
  # Oden via Docker i stället (se Odens README).
  info "OBS: den här datorn är inte Apple Silicon — Oden.app finns bara för arm64 sedan v4.0.0."
  info "Kör Oden via Docker: se https://github.com/NicklasAndersson/oden#docker"
elif [ "${ODEN_APP_CHANNEL:-release}" = "snapshot" ]; then
  info "Installerar Oden (senaste snapshot — testkanal)…"
  curl -fsSL "$ODEN_INSTALLER_SNAPSHOT" | ODEN_SNAPSHOT_SELECT=latest bash
else
  info "Installerar Oden (senaste stabila release) via dess officiella skript…"
  curl -fsSL "$ODEN_INSTALLER_RELEASE" | bash
fi

# --- 3. Manuella steg -------------------------------------------------------
printf '\n\033[1m=== Klart att installera — så här fortsätter du ===\033[0m\n\n'
if [ ! -d "/Applications/Obsidian.app" ]; then
  printf '1. Installera Obsidian (gratis): https://obsidian.md/download\n'
else
  printf '1. Obsidian är redan installerat ✓\n'
fi
if [ -d "$HOME/Library/Application Support/obsidian" ]; then
  printf '   OBS: Obsidian har använts på den här datorn tidigare — den kan öppna ett\n'
  printf '   tidigare valv direkt och HOPPA ÖVER valv-väljaren och Trust-frågan.\n'
  printf '   För en helt färsk upplevelse (t.ex. installationstest), avsluta Obsidian\n'
  printf '   och radera först:  ~/Library/Application Support/obsidian\n'
fi
cat <<EOF
2. Öppna valvet: Obsidian → "Open folder as vault" → $VALV_DIR
   → svara "Trust author and enable plugins". Noten Välkommen.md leder vidare
   (operationsområde, namngivna platser, kartnyckel för CartoDB).
3. Starta Oden.app och kör setup-wizarden (öppnas på http://127.0.0.1:8080):
   - Länka Signal-kontot (QR-kod; använd ett dedikerat nummer, inte ditt privata)
   - Vault-sökväg:  $VALV_DIR
   - Obsidian-mallsteget: HOPPA ÖVER — valvet är redan komplett konfigurerat
     (Oden rör aldrig en befintlig .obsidian-mapp)
4. Rekommenderat: låt rapporterna landa i inkorg/ (i stället för en mapp per
   Signal-grupp). I Odens dashboard: fliken Konfiguration → Katalogstruktur →
   stäng av "Grupp uppdelning"; fliken Pipelines → 7S RAPPORT-pipeline →
   slå på "Underkatalog (relativ till vault)" = inkorg → Spara.
   (ODEN analyserar hela valvet oavsett — detta är ordning, inte funktion.)
5. Testa: skicka ett 7S RAPPORT-meddelande i Signal-gruppen — rapporten landar i
   inkorg/ och dyker upp i ODEN-panelens flöde.
EOF
printf '\n'
ok "Klart."
