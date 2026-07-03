#!/usr/bin/env python3
"""
Interactive feeder — mimics the central application delivering 7S messages
into the Obsidian vault over time.

This is Bin 1 (data mimic) only. It does exactly one thing: drip pre-generated
report files into the vault in chronological order, as the real central
application would as Signal messages arrive and are formatted. It does NOT
create entity stubs or resolve links — that is analysis (Bin 3, the plugin).

Usage:
    python3 feed_reports.py --source ./reports --vault /path/to/Vault

Commands:
    send [n]   deliver the next n reports (default 1)
    auto [m]   replay the week over ~m minutes of wall clock (default 15)
    status     progress + next timestamp
    reset      remove delivered reports from the vault, start over
    quit
"""
import argparse, re, shutil, sys, time
from datetime import datetime
from pathlib import Path

FM_TIME = re.compile(r"^tidpunkt:\s*(.+)$", re.MULTILINE)

def load_reports(src: Path):
    items = []
    for p in sorted(src.glob("*.md")):
        text = p.read_text(encoding="utf-8")
        m = FM_TIME.search(text)
        if not m:
            continue
        items.append((datetime.fromisoformat(m.group(1).strip().strip('"')), p))
    items.sort(key=lambda x: x[0])
    return items

class Feeder:
    def __init__(self, src: Path, vault: Path):
        self.src = src
        self.vault = vault
        self.vault.mkdir(parents=True, exist_ok=True)
        self.reports = load_reports(src)
        self.idx = 0
        if not self.reports:
            print(f"No reports found in {src}", file=sys.stderr); sys.exit(1)
        present = {p.name for p in self.vault.glob("*.md")}
        while self.idx < len(self.reports) and self.reports[self.idx][1].name in present:
            self.idx += 1

    def _copy(self, p: Path):
        shutil.copy2(p, self.vault / p.name)
        # Copy any referenced attachments (bilagor) so embeds resolve in the vault.
        text = p.read_text(encoding="utf-8")
        att_src = self.src.parent / "attachments"
        att_dst = self.vault / "attachments"
        for m in re.findall(r'!\[\[([^\]]+)\]\]', text):
            src_img = att_src / m
            if src_img.exists():
                att_dst.mkdir(parents=True, exist_ok=True)
                shutil.copy2(src_img, att_dst / m)

    def send(self, n=1):
        sent = 0
        while sent < n and self.idx < len(self.reports):
            ts, p = self.reports[self.idx]
            self._copy(p)
            print(f"  + {p.name}   [{ts:%a %Y-%m-%d %H:%M}]")
            self.idx += 1; sent += 1
        if self.idx >= len(self.reports):
            print("  (all reports delivered)")
        return sent

    def auto(self, minutes=15.0):
        remaining = self.reports[self.idx:]
        if not remaining:
            print("  (all reports already delivered)"); return
        t0 = remaining[0][0]; t1 = self.reports[-1][0]
        span = (t1 - t0).total_seconds() or 1.0
        budget = minutes * 60.0; factor = span / budget
        print(f"  Replaying {len(remaining)} reports over ~{minutes:.0f} min "
              f"(≈{factor:.0f}× real time). Ctrl-C to pause.")
        try:
            prev = t0
            for ts, p in remaining:
                time.sleep(min(max(0.0,(ts-prev).total_seconds()/factor), budget))
                self._copy(p); self.idx += 1
                print(f"  + {p.name}   [{ts:%a %H:%M}]")
                prev = ts
            print("  (replay complete)")
        except KeyboardInterrupt:
            print("\n  paused — back to prompt.")

    def status(self):
        done = self.idx; total = len(self.reports)
        print(f"  Delivered {done}/{total}.")
        if done < total:
            ts, p = self.reports[self.idx]
            print(f"  Next: {p.name} [{ts:%a %Y-%m-%d %H:%M}]")
        print(f"  Span: {self.reports[0][0]:%Y-%m-%d %H:%M} -> {self.reports[-1][0]:%Y-%m-%d %H:%M}")

    def reset(self):
        r = 0
        for p in self.vault.glob("*.md"):
            p.unlink(); r += 1
        self.idx = 0
        print(f"  Removed {r} reports. Reset to start.")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", default="./reports", type=Path)
    ap.add_argument("--vault", required=True, type=Path,
                    help="Folder where reports are dropped (your Obsidian vault or a subfolder)")
    args = ap.parse_args()

    f = Feeder(args.source, args.vault)
    print(f"Loaded {len(f.reports)} reports.")
    print(f"  Reports -> {f.vault}")
    f.status()
    print("Commands: send [n] | auto [mins] | status | reset | quit")
    while True:
        try:
            raw = input("7S> ").strip()
        except (EOFError, KeyboardInterrupt):
            print(); break
        if not raw: continue
        parts = raw.split(); cmd = parts[0].lower()
        if cmd in ("quit","exit","q"): break
        elif cmd == "send":
            n = int(parts[1]) if len(parts)>1 and parts[1].isdigit() else 1
            f.send(n)
        elif cmd == "auto":
            f.auto(float(parts[1]) if len(parts)>1 else 15.0)
        elif cmd == "status": f.status()
        elif cmd == "reset": f.reset()
        else: print("  ? send [n] | auto [mins] | status | reset | quit")

if __name__ == "__main__":
    main()
