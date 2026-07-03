#!/usr/bin/env python3
"""
Shared entity-stub logic, used by both generate_entities.py (batch, all
reports) and feed_reports.py (incremental, only delivered reports).

A stub is rebuilt from whatever set of reports it's given, so when the feeder
calls it with only the reports delivered so far, the stub naturally reflects
just the accumulated knowledge at that point in the timeline.
"""
import re
from pathlib import Path
from collections import defaultdict

PLATE = re.compile(r'[A-Z.]{3}[0-9.]{2}[0-9A-Z.]')
LINK  = re.compile(r'\[\[(.*?)\]\]')

# Canonical full plates known to the scenario. Partials may resolve to one of
# these even if the full plate never appears directly (every sighting masked).
# These are seeded ONLY when a partial that matches them has been seen.
CANONICAL_FULL = ["RJK241", "TLP893", "WBN84X", "PMR556", "SDG417",
                  "ABC123", "DEF456", "GHK78L", "MRT902"]

def classify(name):
    if PLATE.fullmatch(name):
        return "fordon-reg-partiell" if "." in name else "fordon-reg-full"
    return "kannetecken"

def safe_filename(name):
    safe = re.sub(r'[\\/:*?"<>|]', "_", name)
    return safe.replace(".", "_")

def needs_alias(name):
    return safe_filename(name) != name

def tag_for(typ):
    return {"fordon-reg-full":"fordon",
            "fordon-reg-partiell":"fordon",
            "kannetecken":"kännetecken"}[typ]

def scan_reports(report_paths):
    """Return mentions: entity-name -> sorted list of (tnr, stem)."""
    mentions = defaultdict(set)
    for p in report_paths:
        text = p.read_text(encoding="utf-8")
        tnr_m = re.search(r'^tnr:\s*(.+)$', text, re.MULTILINE)
        tnr = tnr_m.group(1).strip() if tnr_m else p.stem
        for name in LINK.findall(text):
            mentions[name].add((tnr, p.stem))
    return mentions

def build_stub_text(name, mentions, all_names):
    """Render one stub's markdown from current mentions + known entity names."""
    typ = classify(name)
    tag = tag_for(typ)
    fulls = [n for n in all_names if classify(n) == "fordon-reg-full"]

    def candidates_for(partial):
        rx = re.compile("^" + partial + "$")
        return [f for f in fulls if rx.match(f)]

    full_to_partials = defaultdict(list)
    for pa in [n for n in all_names if classify(n) == "fordon-reg-partiell"]:
        for f in candidates_for(pa):
            full_to_partials[f].append(pa)

    seen = sorted(mentions.get(name, set()))
    n = len(seen)
    alias_line = f"aliases: [\"{name}\"]\n" if needs_alias(name) else ""
    fm = ("---\n"
          f"typ: entitet\nslag: {typ}\nnamn: \"{name}\"\n{alias_line}"
          f"antal_observationer: {n}\ntaggar: [{tag}]\n---\n\n")
    body = [f"# {name}\n", f"**Typ:** {typ}  ", f"**Antal observationer:** {n}\n"]

    if typ == "fordon-reg-partiell":
        cands = candidates_for(name)
        if cands:
            body.append("**Möjliga fullständiga nummerplåtar (regex-match):** "
                        + ", ".join(f"[[{safe_filename(c)}|{c}]]" for c in cands) + "\n")
        else:
            body.append("_Ingen matchande fullständig plåt i materialet ännu._\n")
    if typ == "fordon-reg-full" and full_to_partials.get(name):
        body.append("**Partiella observationer som kan avse denna plåt:** "
                    + ", ".join(f"[[{safe_filename(pa)}|{pa}]]"
                                for pa in sorted(full_to_partials[name])) + "\n")

    body.append("\n## Observationer")
    if seen:
        body.append("Rapporter som nämner denna entitet "
                    "(backlinks visas även i panelen till höger):\n")
        for tnr, stem in seen:
            body.append(f"- [[{stem}]]  ({tnr})")
    else:
        body.append("_Denna fullständiga plåt har aldrig observerats direkt; "
                    "endast partiella observationer (se ovan)._")
    return fm + "\n".join(body) + "\n"

def known_entity_universe(mentions):
    """Names referenced so far, plus any canonical full plate that a SEEN
    partial could resolve to (so cross-refs have a target once the partial
    appears)."""
    names = set(mentions)
    seen_partials = [n for n in names if classify(n) == "fordon-reg-partiell"]
    for cf in CANONICAL_FULL:
        for pa in seen_partials:
            if re.match("^" + pa + "$", cf):
                names.add(cf); break
    return sorted(names)
