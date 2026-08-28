/*
 * Demo playback scheduling (pure, Obsidian-free) — compresses the demo corpus'
 * real time span into a chosen wall-clock window while PRESERVING ITS RHYTHM:
 * quiet nights stay quiet, busy mornings arrive as bursts. The plugin shell
 * moves the files; this module only decides WHEN.
 */

/** Minutes since the corpus month's start for a TNR (DDHHMM). */
export function tnrMinutes(tnr: string): number {
  const m = tnr.match(/^(\d{2})(\d{2})(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 24 * 60 + Number(m[2]) * 60 + Number(m[3]);
}

/** Wrap-aware monotonic minutes for a whole corpus. TNR carries no month, so a
 *  corpus crossing a month boundary (day 29,30,31 → 01…) breaks plain
 *  day-of-month ordering — Sep 1 would sort before Aug 29. A ≤14-day corpus can
 *  never legitimately span >15 day-numbers, so when it appears to, the LOW day
 *  numbers are the NEXT month and get +31 days. (Found when re-dating the demo
 *  corpus to start Aug 29 for a live-mixing demo.) */
export function corpusMinutes(tnrs: string[]): number[] {
  const mins = tnrs.map(tnrMinutes);
  const days = mins.map((m) => Math.floor(m / (24 * 60)));
  const lo = Math.min(...days);
  const hi = Math.max(...days);
  if (hi - lo <= 15) return mins;
  const pivot = 15; // days below this are next-month when the span is impossible
  return mins.map((m) => (Math.floor(m / (24 * 60)) < pivot ? m + 31 * 24 * 60 : m));
}

/** Wall-clock offsets (ms from start) for each report, in input order.
 *  The real span maps linearly onto `minutes`; a minimum gap keeps arrivals
 *  individually visible in the feed (the watcher debounce is 1.5 s). */
export function demoSchedule(tnrs: string[], minutes: number, minGapMs = 2000): number[] {
  const n = tnrs.length;
  if (n === 0) return [];
  const t = corpusMinutes(tnrs);
  const span = Math.max(1, t[n - 1] - t[0]);
  const total = Math.max(1, minutes) * 60_000;
  const out: number[] = [];
  let prev = -Infinity;
  for (let i = 0; i < n; i++) {
    const ideal = ((t[i] - t[0]) / span) * total;
    const at = i === 0 ? 0 : Math.max(ideal, prev + minGapMs);
    out.push(at);
    prev = at;
  }
  return out;
}
