#!/usr/bin/env bash
# Demo cartridges — the single source of truth shared by package.sh (release
# vaults) and refresh_demo.sh (re-dating a live vault). Each line:
#   id|label|aoi|area|days|seed|photos|hostiles|protesters|beskrivning
#   hostiles   = comma list of type[:count][:photos]   (7s-generator add-hostiles)
#   protesters = comma list of type[:seed]             (7s-generator add-protesters)
#   photos     = 1 → generate --photos (bank photos; ~7 MB/cartridge — keep rare)
# Seeds fix the CONTENT; the start date rolls with the build day (package.sh).
# The plugin discovers cartridges from demo/<id>/cartridge.json (cartridge.ts).
CARTRIDGES=(
  "vallinge|HvSS Vällinge|59.26239628419817,17.712273532270785|suburban|14|2026|1|recon:photos,infiltration|demonstranter|Standardkorpusen: fjorton dygn med en spaningscell, en infiltrationscell och en demonstration — foton ingår."
  "uppsala|Centrala Uppsala|59.8560,17.6345|urban|7|3011|0|recon:1|demonstranter,demonstranter:3111|Demonstrationstung stadsmiljö mellan slottet och domkyrkan, hög volym, en enda diskret spanare."
  "tranbygge|Tranbygge läger|59.5495,17.7397|military|10|3012|0|recon:2,infiltration:3||Medelhög–hög hotnivå: spanings- och infiltrationscell mot lägret på Kungsängens övningsfält."
  "norrtalje|Norrtälje hamn|59.7579,18.7150|port|10|3013|0|sabotage:2||Medelhög hotnivå: en sabotagecell i hamnen mitt i staden — få men allvarliga observationer."
  "tierp|Tierps flygfält|60.3444,17.4222|airport|10|3014|1|recon:3:photos,infiltration:2|demonstranter|Hög hotnivå: spanings- och infiltrationscell, en demonstration, foton att analysera."
  "sodertaljesyd|Södertälje Syd|59.1626,17.6458|urban|7|3015|0|recon:2||Låg hotnivå: stationsmiljö med en liten spaningscell (två personer) i pendlarbruset."
)

# generate_cartridge <line> <outdir> <from YYYY-MM-DD>
# Deterministic: same line + same date → same corpus. Requires 7s-generator on PATH.
generate_cartridge() {
  local line="$1" out="$2" from="$3"
  local id label aoi area days seed photos hostiles protesters beskrivning
  IFS='|' read -r id label aoi area days seed photos hostiles protesters beskrivning <<<"$line"
  local photoflag=()
  [ "$photos" = "1" ] && photoflag=(--photos)
  7s-generator generate --aoi "$aoi" --area "$area" --from "$from" --days "$days" \
    --name "$label (demo)" --seed "$seed" --images ${photoflag[@]+"${photoflag[@]}"} --obsidian --out "$out"
  local spec typ count pflag
  IFS=',' read -r -a specs <<<"$hostiles"
  for spec in ${specs[@]+"${specs[@]}"}; do
    [ -n "$spec" ] || continue
    typ="${spec%%:*}"; count=""; pflag=()
    local rest="${spec#*:}"
    if [ "$rest" != "$spec" ]; then
      IFS=':' read -r -a parts <<<"$rest"
      for p in "${parts[@]}"; do
        case "$p" in
          photos) pflag=(--photos) ;;
          *) count="$p" ;;
        esac
      done
    fi
    7s-generator add-hostiles --corpus "$out" --type "$typ" --seed "$seed" \
      ${count:+--count "$count"} ${pflag[@]+"${pflag[@]}"}
  done
  IFS=',' read -r -a pspecs <<<"$protesters"
  for spec in ${pspecs[@]+"${pspecs[@]}"}; do
    [ -n "$spec" ] || continue
    typ="${spec%%:*}"
    local pseed="$seed"
    [ "${spec#*:}" != "$spec" ] && pseed="${spec#*:}"
    7s-generator add-protesters --corpus "$out" --type "$typ" --seed "$pseed"
  done
}

# cartridge_manifest <line> > cartridge.json
cartridge_manifest() {
  local line="$1"
  local id label aoi area days seed photos hostiles protesters beskrivning
  IFS='|' read -r id label aoi area days seed photos hostiles protesters beskrivning <<<"$line"
  python3 - "$id" "$label" "$aoi" "$area" "$days" "$beskrivning" <<'PYEOF'
import json, sys
id_, label, aoi, area, days, beskrivning = sys.argv[1:7]
lat, lon = (float(x) for x in aoi.split(","))
print(json.dumps({"id": id_, "label": label, "aoi": {"lat": lat, "lon": lon}, "area": area,
                  "days": int(days), "beskrivning": beskrivning}, ensure_ascii=False, indent=2))
PYEOF
}

# split_cartridge <src corpus> <dst demo/<id>> <batch size>
# Chronological (tidpunkt, then filename) fixed-size batches; a report's
# attachment folder (Obsidian wikilink layout) travels with its report.
split_cartridge() {
  python3 - "$1" "$2" "$3" <<'PYEOF'
import os, re, shutil, sys
src, dst, size = sys.argv[1], sys.argv[2], int(sys.argv[3])
def tidpunkt(p):
    for line in open(p, encoding="utf-8"):
        if line.startswith("tidpunkt:"): return line.split(":", 1)[1].strip().strip('"')
    return ""
# Sort on tidpunkt, not filename — TNR has no month, so a corpus that crosses a
# month boundary name-sorts wrong (Sep 01 before Aug 29).
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
print(f"{dst}: {len(reports)} rapporter i {(len(reports) + size - 1) // size} batchar")
PYEOF
}

# cartridge_readme <line> <from> > LÄS-MIG.md
cartridge_readme() {
  local line="$1" from="$2"
  local id label aoi area days seed photos hostiles protesters beskrivning
  IFS='|' read -r id label aoi area days seed photos hostiles protesters beskrivning <<<"$line"
  cat <<EOF
# Demokassett: $label

$beskrivning

Övningskorpus: $days dygn kring $label med start **$from** (syntetisk — inga
riktiga personer eller fordon; daterad från paketeringsdagen så att demodata
blandas naturligt med skarp trafik i flödet). Operationsområde: \`$aoi\` —
kommandot **"ODEN: Mata demodata — $label"** erbjuder sig att byta dit.

Samma kommando pausar och återupptar. Vill du hellre mata för hand: dra
innehållet i \`batch-01/\` till \`inkorg/\`, batch för batch (bildmappar ska
följa med sina rapporter). Facit i \`facit.json\` (\`truth\`/\`subtype\`
per rapport).
EOF
}
