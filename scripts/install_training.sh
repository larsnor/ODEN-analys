#!/usr/bin/env bash
# ODEN — one-line installation of the TRAINING variant: the same system as
# install_system.sh, but the vault package with every demo cartridge
# (ODEN-övning). Usage:
#   curl -fsSL https://raw.githubusercontent.com/larsnor/ODEN-analys/main/scripts/install_training.sh | bash
set -euo pipefail
curl -fsSL "https://raw.githubusercontent.com/larsnor/ODEN-analys/main/scripts/install_system.sh" | ODEN_PROFILE=training bash
