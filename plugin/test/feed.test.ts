/* Derived event/alarm feed — dedup, sort newest-first, labels, severity. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildFeed, FeedItem } from "../src/feed.ts";

const ms = (s: string) => Date.parse(s);

test("sorts newest-first, dedups by path, labels and flags severity", () => {
  const items: FeedItem[] = [
    { path: "reports/TNR140000.md", kind: "mottaget", time: ms("2026-06-15T14:00:00"), tnr: "140000", plats: "Grindarna", tid: "14:00" },
    { path: "entities/RJK241.md", kind: "fordon", time: ms("2026-06-15T15:00:00"), label: "RJK241", count: 4 },
    { path: "reports/TNR160300.md", kind: "larm", time: ms("2026-06-16T03:00:00"), plats: "Grindarna", level: "Hög", reasons: ["nära skyddsobjekt", "nattetid"] },
    // duplicate path, older — should be dropped in favour of the newer one above
    { path: "reports/TNR160300.md", kind: "mottaget", time: ms("2026-06-16T02:00:00"), tnr: "160300", plats: "Grindarna" },
  ];
  const rows = buildFeed(items);
  assert.equal(rows.length, 3, "deduped to 3");
  // newest first: the larm (06-16 03:00) leads
  assert.equal(rows[0].kind, "larm");
  assert.equal(rows[0].severity, "larm");
  assert.ok(rows[0].text.startsWith("⚠"));
  assert.match(rows[0].text, /Misstänkt aktivitet/);
  assert.match(rows[0].text, /nära skyddsobjekt, nattetid/);
  assert.equal(rows[0].stem, "TNR160300");
  // vehicle + message are "info"
  assert.ok(rows.every((r) => r.kind === "larm" || r.severity === "info"));
  assert.match(rows.find((r) => r.kind === "fordon")!.text, /Fordon RJK241 identifierat \(4 observationer\)/);
  assert.match(rows.find((r) => r.kind === "mottaget")!.text, /Meddelande TNR140000 mottaget/);
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

test("respects the limit", () => {
  const items: FeedItem[] = Array.from({ length: 100 }, (_, i) => ({
    path: `reports/TNR${i}.md`,
    kind: "mottaget" as const,
    time: i,
  }));
  assert.equal(buildFeed(items, 20).length, 20);
});
