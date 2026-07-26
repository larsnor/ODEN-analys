/*
 * Demo playback scheduling (pure, Obsidian-free) — compresses the demo corpus'
 * real time span into a chosen wall-clock window while PRESERVING ITS RHYTHM:
 * quiet nights stay quiet, busy mornings arrive as bursts. The plugin shell
 * moves the files; this module only decides WHEN.
 */

/** Minutes since the corpus month's start for a TNR (DDHHMM). A corpus spans at
 *  most one month and TNR order is chronological, so day·24·60 + h·60 + m is a
 *  valid monotonic clock for scheduling. */
export function tnrMinutes(tnr: string): number {
  const m = tnr.match(/^(\d{2})(\d{2})(\d{2})/);
  if (!m) return 0;
  return Number(m[1]) * 24 * 60 + Number(m[2]) * 60 + Number(m[3]);
}

/** Wall-clock offsets (ms from start) for each report, in input order.
 *  The real span maps linearly onto `minutes`; a minimum gap keeps arrivals
 *  individually visible in the feed (the watcher debounce is 1.5 s). */
export function demoSchedule(tnrs: string[], minutes: number, minGapMs = 2000): number[] {
  const n = tnrs.length;
  if (n === 0) return [];
  const t = tnrs.map(tnrMinutes);
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
