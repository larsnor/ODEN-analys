#!/usr/bin/env python3
"""
Batch entity-stub generator: build ALL stubs from the full report set at once.
(For the incremental, on-demand version used during replay, see feed_reports.py,
which grows stubs as reports arrive. Both share entity_lib.py, so batch and
incremental modes produce identical end states.)

Usage:
    python3 generate_entities.py --reports ./reports [--out .]
Writes stubs to <out>/entities/ (default: alongside --reports).
"""
import argparse
from pathlib import Path
import entity_lib as EL

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--reports", default="./reports", type=Path)
    ap.add_argument("--out", default=None, type=Path)
    args = ap.parse_args()

    reports_dir = args.reports
    out_root = args.out if args.out else reports_dir.parent
    ent_dir = out_root / "entities"
    ent_dir.mkdir(parents=True, exist_ok=True)
    for old in ent_dir.glob("*.md"):
        old.unlink()

    mentions = EL.scan_reports(sorted(reports_dir.glob("*.md")))
    universe = EL.known_entity_universe(mentions)
    for name in universe:
        text = EL.build_stub_text(name, mentions, universe)
        (ent_dir / f"{EL.safe_filename(name)}.md").write_text(text, encoding="utf-8")

    fulls = sum(1 for n in universe if EL.classify(n)=="fordon-reg-full")
    parts = sum(1 for n in universe if EL.classify(n)=="fordon-reg-partiell")
    tells = sum(1 for n in universe if EL.classify(n)=="kannetecken")
    print(f"Wrote {len(universe)} entity stubs to {ent_dir}")
    print(f"  full plates: {fulls} | partial plates: {parts} | kännetecken: {tells}")

if __name__ == "__main__":
    main()
