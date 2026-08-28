/*
 * Demo playback scheduling — compresses the corpus' real span into a wall-clock
 * window while preserving its rhythm (bursts stay bursts).
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { corpusMinutes, demoSchedule, tnrMinutes } from "../src/demo.ts";

test("tnrMinutes: DDHHMM → monotonic minutes within the corpus month", () => {
  assert.equal(tnrMinutes("150000"), 15 * 24 * 60);
  assert.equal(tnrMinutes("150130"), 15 * 24 * 60 + 90);
  assert.ok(tnrMinutes("160000") > tnrMinutes("152359"));
});

test("demoSchedule: span compresses linearly into the window, bursts preserved", () => {
  // Two reports close together (a burst), then a long quiet gap, then one more.
  const tnrs = ["150000", "150010", "160000"]; // 10 min burst, then ~24h gap
  const out = demoSchedule(tnrs, 10, 0); // no min-gap → pure proportionality
  assert.equal(out[0], 0);
  assert.equal(out[2], 10 * 60_000, "last report lands at the end of the window");
  const frac = out[1] / out[2];
  assert.ok(frac < 0.01, `burst stays a burst (got ${frac})`);
});

test("demoSchedule: min gap keeps arrivals individually visible", () => {
  const tnrs = ["150000", "150001", "150002", "150003"]; // 1-min spacing, tiny span
  const out = demoSchedule(tnrs, 1, 2000);
  for (let i = 1; i < out.length; i++) {
    assert.ok(out[i] - out[i - 1] >= 2000, `gap ${i} = ${out[i] - out[i - 1]}`);
  }
});

test("corpusMinutes: month-wrap corpora order chronologically (Aug 29 → Sep 11)", () => {
  // The re-dated demo corpus: days 29,30,31 then 01..11 — plain day-of-month
  // ordering would play September first.
  const tnrs = ["290800", "301200", "310600", "010534", "111900"];
  const m = corpusMinutes(tnrs);
  for (let i = 1; i < m.length; i++) assert.ok(m[i] > m[i - 1], `monotonic at ${i}`);
  // A normal single-month corpus is untouched (identity with tnrMinutes).
  const plain = ["150000", "180000", "281200"];
  assert.deepEqual(corpusMinutes(plain), plain.map(tnrMinutes));
  // And demoSchedule stays monotonic across the wrap.
  const out = demoSchedule(tnrs, 10, 0);
  for (let i = 1; i < out.length; i++) assert.ok(out[i] >= out[i - 1], "schedule monotonic");
  assert.equal(out[0], 0);
});

test("demoSchedule: empty and single-report inputs", () => {
  assert.deepEqual(demoSchedule([], 15), []);
  assert.deepEqual(demoSchedule(["150000"], 15), [0]);
});
