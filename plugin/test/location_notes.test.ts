/* Location nodes — one note per relevant place, linking the reports observed
 * there so the location shows as a graph hub. */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { Report } from "../src/parse.ts";
import { analyzeSuspicion } from "../src/suspicion.ts";
import { buildLocations, renderLocationNote } from "../src/location_notes.ts";

const PROT = { protectedLat: 59.0, protectedLon: 17.0, threshold: 5 };

function report(over: Partial<Report>): Report {
  return {
    id: over.tnr ?? "x",
    typ: "7S-rapport",
    tnr: over.tnr ?? "000000",
    tidpunkt: "2026-06-16T03:00:00", // night → contributes to elevation
    plats: "GRID-A",
    lat: 59.001, // ~111 m from the protected object → proximity
    lon: 17.0,
    sagesman: "AQ",
    links: [],
    embeds: [],
    file: `reports/TNR${over.tnr ?? "000000"}.md`,
    ...over,
  };
}

test("groups reports by plats; keeps only locations with suspicion or a vehicle", () => {
  const reports = [
    // GRID-A: two suspicious reports (elevated via proximity+night) → relevant
    report({ tnr: "100000", handelse: "Person fotograferar med kamera." }),
    report({ tnr: "100100", handelse: "Person kvar på platsen.", file: "reports/TNR100100.md" }),
    // GRID-B: benign, far away, daytime, no plate → NOT relevant
    report({ tnr: "200000", plats: "GRID-B", lat: 58.0, lon: 16.0, tidpunkt: "2026-06-16T12:00:00", handelse: "Lugnt.", file: "reports/TNR200000.md" }),
    // GRID-C: daytime, far, but has a vehicle plate → relevant (vehicle)
    report({ tnr: "300000", plats: "GRID-C", lat: 58.0, lon: 16.0, tidpunkt: "2026-06-16T12:00:00", handelse: "Fordon RJK241 parkerat.", file: "reports/TNR300000.md" }),
  ];
  const locs = buildLocations(reports, analyzeSuspicion(reports, PROT));
  const keys = locs.map((l) => l.key).sort();
  assert.deepEqual(keys, ["GRID-A", "GRID-C"], "benign GRID-B is excluded");

  const a = locs.find((l) => l.key === "GRID-A")!;
  assert.equal(a.reports.length, 2, "both reports at GRID-A grouped");
  assert.equal(a.elevatedCount, 2);

  const c = locs.find((l) => l.key === "GRID-C")!;
  assert.deepEqual(c.plates, ["RJK241"], "vehicle recorded at GRID-C");
});

test("rendered location note is provenance-marked, tagged #plats, and links its reports", () => {
  const reports = [report({ tnr: "100000", handelse: "Person fotograferar med kamera." })];
  const [loc] = buildLocations(reports, analyzeSuspicion(reports, PROT));
  const note = renderLocationNote(loc);
  assert.ok(note.filename.startsWith("Plats GRID-A"));
  assert.match(note.markdown, /generator: 7s-plugin/);
  assert.match(note.markdown, /metod: plats/);
  assert.match(note.markdown, /tags: \[plats\]/);
  assert.match(note.markdown, /\[\[TNR100000\|TNR100000\]\]/, "links the report → graph edge");
  assert.match(note.markdown, /location: "59.001,17"/, "coords for the map");
});

test("a nickname renames the node (display) but keeps the grid as identity", () => {
  const reports = [report({ tnr: "100000", plats: "33VXF5490371882", handelse: "Person fotograferar med kamera." })];
  const [loc] = buildLocations(reports, analyzeSuspicion(reports, PROT));
  const nicks = { "33VXF5490371882": "Norra grinden" };
  const raw = renderLocationNote(loc);
  const named = renderLocationNote(loc, nicks);

  assert.equal(raw.filename, "Plats 33VXF5490371882.md", "clean name, no hash suffix");
  assert.equal(named.filename, "Plats Norra grinden.md", "graph label uses the nickname, clean");
  assert.match(named.markdown, /# 📍 Plats: Norra grinden/);
  assert.match(named.markdown, /MGRS: 33VXF5490371882/, "grid still shown for traceability");
  assert.match(named.markdown, /mgrs: "33VXF5490371882"/, "grid kept in frontmatter (identity)");
});
