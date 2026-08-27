/* Derived event/alarm feed — dedup, sort newest-first, labels, severity. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildFeed, FeedItem } from "../src/feed.ts";

const ms = (s: string) => Date.parse(s);

test("sorts newest-first, dedups by path, labels and flags severity", () => {
  const items: FeedItem[] = [
    { path: "entities/marke-abc.md", kind: "kännetecken", time: ms("2026-06-15T14:00:00"), label: "röd jacka" },
    { path: "entities/RJK241.md", kind: "fordon", time: ms("2026-06-15T15:00:00"), label: "RJK241", count: 4 },
    { path: "reports/TNR160300.md", kind: "larm", time: ms("2026-06-16T03:00:00"), plats: "Grindarna", level: "Hög", reasons: ["nära objektet", "nattetid"] },
    // duplicate path, older — should be dropped in favour of the newer one above
    { path: "reports/TNR160300.md", kind: "larm", time: ms("2026-06-16T02:00:00"), plats: "Grindarna", level: "Förhöjd" },
  ];
  const rows = buildFeed(items);
  assert.equal(rows.length, 3, "deduped to 3");
  // newest first: the larm (06-16 03:00) leads
  assert.equal(rows[0].kind, "larm");
  assert.equal(rows[0].severity, "larm");
  assert.ok(rows[0].text.startsWith("⚠"));
  assert.match(rows[0].text, /Misstänkt aktivitet/);
  assert.match(rows[0].text, /nära objektet, nattetid/);
  assert.equal(rows[0].stem, "TNR160300");
  // vehicle + message are "info"
  assert.ok(rows.every((r) => r.kind === "larm" || r.severity === "info"));
  assert.match(rows.find((r) => r.kind === "fordon")!.text, /Fordon RJK241 identifierat \(4 observationer\)/);
  assert.match(rows.find((r) => r.kind === "kännetecken")!.text, /Kännetecken bekräftat: röd jacka/);
});

test("pending-suggestion rows pin to top with a review action", () => {
  const items: FeedItem[] = [
    { path: "entities/RJK241.md", kind: "fordon", time: ms("2026-06-15T15:00:00"), label: "RJK241", count: 4 },
    { path: "review:actors", kind: "förslag-aktör", time: Number.MAX_SAFE_INTEGER, pending: 2, review: "actors" },
    { path: "review:marks", kind: "förslag-märke", time: Number.MAX_SAFE_INTEGER - 1, pending: 3, review: "marks" },
  ];
  const rows = buildFeed(items);
  assert.equal(rows[0].review, "actors");
  assert.equal(rows[0].severity, "review");
  assert.match(rows[0].text, /2 aktörsförslag att granska/);
  assert.equal(rows[1].review, "marks");
  assert.match(rows[1].text, /3 kopplingsförslag att granska/);
  assert.equal(rows[2].kind, "fordon"); // real events below the suggestions
});

test("a child row hangs directly under its parent, marked for indentation", () => {
  const items: FeedItem[] = [
    // Deliberately interleaved times: another arrival lands between the flagged
    // report and its alarm — the child must still stick to ITS parent.
    { path: "reports/TNR160300.md", kind: "mottaget", time: ms("2026-06-16T03:00:00"), tnr: "160300", plats: "Grindarna" },
    { path: "larm:reports/TNR160300.md", kind: "larm", time: ms("2026-06-16T03:00:00"), plats: "Grindarna", level: "Hög", reasons: ["nära objektet"], file: "reports/TNR160300.md", parentPath: "reports/TNR160300.md" },
    { path: "reports/TNR160305.md", kind: "mottaget", time: ms("2026-06-16T03:05:00"), tnr: "160305", plats: "Bryggan" },
  ];
  const rows = buildFeed(items);
  assert.deepEqual(rows.map((r) => r.kind), ["mottaget", "mottaget", "larm"], "newest arrival first; alarm under its own arrival");
  assert.equal(rows[1].stem, "TNR160300");
  assert.equal(rows[2].child, true, "alarm indents under the arrival");
  assert.equal(rows[2].stem, "TNR160300", "child clicks through to the report");
  assert.equal(rows[0].child, undefined, "unrelated arrival stays top-level");
});

test("an orphan child (parent deduped/capped away) degrades to a normal top-level row", () => {
  const items: FeedItem[] = [
    { path: "larm:reports/TNR160300.md", kind: "larm", time: ms("2026-06-16T03:00:00"), plats: "Grindarna", level: "Hög", file: "reports/TNR160300.md", parentPath: "reports/TNR160300.md" },
  ];
  const rows = buildFeed(items);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "larm");
  assert.equal(rows[0].child, undefined, "no parent present → not indented");
});

test("respects the limit", () => {
  const items: FeedItem[] = Array.from({ length: 100 }, (_, i) => ({
    path: `reports/TNR${i}.md`,
    kind: "larm" as const,
    time: i,
  }));
  assert.equal(buildFeed(items, 20).length, 20);
});

test("bildanalys + förslag-bild rows: labels, severity and the click-target override", () => {
  const items: FeedItem[] = [
    { path: "bildanalys:reports/TNR150900.md", kind: "bildanalys", time: Number.MAX_SAFE_INTEGER - 3, tnr: "150900", plats: "Norra grinden", file: "reports/TNR150900.md" },
    { path: "review:photos", kind: "förslag-bild", time: Number.MAX_SAFE_INTEGER - 2, pending: 2, review: "photos" },
    { path: "reports/TNR150900.md", kind: "larm", time: ms("2026-06-16T03:00:00"), plats: "Norra grinden", level: "Hög" },
  ];
  const rows = buildFeed(items);
  assert.equal(rows.length, 3, "synthetic bildanalys path must NOT dedup away the report's own larm row");
  assert.match(rows[0].text, /2 bildfynd att granska/);
  assert.equal(rows[0].severity, "review");
  assert.equal(rows[0].review, "photos");
  const analysing = rows.find((r) => r.kind === "bildanalys")!;
  assert.match(analysing.text, /📷 Bild mottagen, analys startad — TNR150900 — Norra grinden/);
  assert.equal(analysing.severity, "info");
  assert.equal(analysing.stem, "TNR150900", "click opens the report, not the synthetic path");
});
