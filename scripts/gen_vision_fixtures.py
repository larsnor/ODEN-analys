#!/usr/bin/env python3
"""Render the synthetic plate-card fixtures for the vision bake-off harness.

Uses the 7S-generator's existing renderer (corpusgen/images.py) WITHOUT modifying
that repo — we only import it. Run with the generator's venv python (it has
Pillow):

    /path/to/7S-generator/.venv/bin/python3 scripts/gen_vision_fixtures.py

Output: plugin/test/fixtures/vision/plate_<PLATE>.jpg + ground_truth.json.
These are CLEAN cards → they measure BEST-CASE plate OCR only. Vehicle/person
attribute measurement needs the operator's real photo set (fixtures/vision_real/).
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GENERATOR = ROOT.parent / "7S-generator"
sys.path.insert(0, str(GENERATOR))

from corpusgen.images import render_plate  # noqa: E402

# Mix of the classic ABC123 format and the newer ABC12D (last char a letter).
# Chosen to exercise easily-confused glyphs (O/0, I/1, B/8, S/5, G/6, Z/2).
PLATES = [
    "RJK241", "PUP64F", "ABC123", "XYZ789", "GOB805",
    "SIS515", "OQD060", "ZUZ222", "BEB838", "MWM414",
    "HNH171", "CGC626", "KXK747", "TYT979", "DPD303",
    "JLJ161", "VFV353", "NRN888", "EWE494", "LDL525",
]

OUT = ROOT / "plugin" / "test" / "fixtures" / "vision"
OUT.mkdir(parents=True, exist_ok=True)

truth = {}
for p in PLATES:
    f = OUT / f"plate_{p}.jpg"
    render_plate(p, str(f), note="syntetisk provbild for OCR-harness")
    truth[f.name] = {"plate": p}

(OUT / "ground_truth.json").write_text(json.dumps(truth, indent=2, ensure_ascii=False) + "\n")
print(f"wrote {len(PLATES)} cards + ground_truth.json -> {OUT}")
