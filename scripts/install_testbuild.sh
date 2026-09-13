#!/usr/bin/env bash
# ODEN — installera ett TESTBYGGE av Oden tillsammans med valvet (macOS).
#
# Ligger en fix man behöver i en öppen pull request i Oden, i stället för i en
# release, bygger Oden en förhandsutgåva av den. Det här skriptet slår upp rätt
# bygge och lämnar över till install_system.sh, som gör själva installationen —
# valv, app och de manuella stegen — precis som vid en vanlig installation.
#
# Användning (ange PR-numret, inte taggen: taggen byter namn vid varje ny commit):
#   curl -fsSL https://raw.githubusercontent.com/larsnor/ODEN-analys/main/scripts/install_testbuild.sh | bash -s -- 269
#
# Går också:
#   … | bash -s -- pr-269-snapshot-32ccf68   # en exakt tagg
#   … | bash -s -- senaste                   # senaste testbygget av main
#
# Env-variabler: ODEN_PROFILE=training för övningsvalvet, ODEN_VALV_DIR för en
# annan målkatalog, ODEN_ANALYS_REF för att hämta install_system.sh från en
# annan gren än main.
set -euo pipefail

ODEN_REPO="NicklasAndersson/oden"
ANALYS_REF="${ODEN_ANALYS_REF:-main}"
INSTALL_SYSTEM="https://raw.githubusercontent.com/larsnor/ODEN-analys/${ANALYS_REF}/scripts/install_system.sh"

info() { printf '\033[0;34mℹ %s\033[0m\n' "$1"; }
ok()   { printf '\033[0;32m✓ %s\033[0m\n' "$1"; }
fail() { printf '\033[0;31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

usage() {
  cat >&2 <<'USAGE'
Ange vilket testbygge som ska installeras:

  … | bash -s -- 269                       PR-numret i Oden (rekommenderas)
  … | bash -s -- pr-269-snapshot-32ccf68   en exakt tagg
  … | bash -s -- senaste                   senaste testbygget av main

PR-numret står i länken till pull requesten: github.com/NicklasAndersson/oden/pull/269
USAGE
  exit 2
}

[ "$(uname)" = "Darwin" ] || fail "Det här skriptet är för macOS. Se INSTALL.md för andra plattformar."
command -v python3 >/dev/null || fail "python3 saknas (ingår i macOS — kör xcode-select --install)."
[ $# -ge 1 ] || usage
WANT="$1"

# Slå upp den senaste förhandsutgåvan för ett PR-nummer. Taggen innehåller
# commitens sha, så den byter namn varje gång PR:en uppdateras — därför slås den
# upp i stället för att skrivas för hand.
resolve_pr_tag() {
  local pr="$1" json tag
  json=$(curl -fsSL "https://api.github.com/repos/${ODEN_REPO}/releases?per_page=100") ||
    fail "Kunde inte läsa listan över utgåvor från GitHub."
  tag=$(PR="$pr" python3 -c '
import json, os, sys
prefix = "pr-" + os.environ["PR"] + "-snapshot-"
releases = json.load(sys.stdin)
builds = [r for r in releases if not r.get("draft") and r.get("tag_name", "").startswith(prefix)]
builds.sort(key=lambda r: r.get("created_at", ""), reverse=True)
print(builds[0]["tag_name"] if builds else "")
' <<<"$json")
  [ -n "$tag" ] || fail "Hittade inget testbygge för PR #${pr}. Bygget görs först när PR:en har etiketten snapshot-release — be den som äger repot att sätta den."
  printf '%s' "$tag"
}

case "$WANT" in
  senaste|latest)
    info "Installerar senaste testbygget av main."
    exec env ODEN_APP_CHANNEL=snapshot bash -c "curl -fsSL '$INSTALL_SYSTEM' | bash"
    ;;
  pr-*-snapshot-* | snapshot-*)
    TAG="$WANT"
    ;;
  [0-9]*)
    info "Letar efter testbygget för PR #${WANT}…"
    TAG=$(resolve_pr_tag "$WANT")
    ;;
  *)
    usage
    ;;
esac

ok "Testbygge: $TAG"
printf '\n'
info "Ett testbygge är till för att prova, inte för skarp drift."
info "Avsluta Oden.app innan du fortsätter — en app som byts ut medan den kör blir trasig."
printf '\n'

# install_system.sh äger installationen: valvet rörs inte, en pinnad tagg
# ersätter en redan installerad Oden.app, och de manuella stegen skrivs ut.
exec env ODEN_SNAPSHOT_TAG="$TAG" bash -c "curl -fsSL '$INSTALL_SYSTEM' | bash"
