/*
 * Alerts-with-pointer — diffing vs the seen-set, pointer content, determinism.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseReport, Report } from "../src/parse.ts";
import { analyzeSuspicion, DEFAULT_SUSPICION } from "../src/suspicion.ts";
import { buildMarkNominations } from "../src/jobb.ts";
import { buildActorHypotheses } from "../src/actor.ts";
import { buildPlateEntities } from "../src/reid.ts";
import { alertsToMarkdown, AnalysisBundle, computeAlertItems, newAlerts } from "../src/alerts.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "fixtures");
const dir = join(root, "reports_new");
const have = existsSync(dir);

function bundleFrom(reports: Report[]): AnalysisBundle {
  return {
    reports,
    suspicion: analyzeSuspicion(reports, DEFAULT_SUSPICION),
    jobB: buildMarkNominations(reports),
    actors: buildActorHypotheses(reports, { threshold: 1 }),
    jobA: buildPlateEntities(reports),
  };
}
function loadNew(): Report[] {
  return readdirSync(dir).filter((f) => f.endsWith(".md")).map((f) => parseReport(readFileSync(join(dir, f), "utf-8"), `reports_new/${f}`));
}

test("elevated observations produce alerts with a where-to-look pointer", { skip: !have }, () => {
  const items = computeAlertItems(bundleFrom(loadNew()));
  const elevated = items.filter((a) => a.kind === "förhöjd");
  assert.ok(elevated.length >= 20, `expected the recon elevations, got ${elevated.length}`);
  const a = elevated[0];
  assert.match(a.pointer, /\[\[TNR/); // cite the report
  assert.match(a.pointer, /Map View/); // point at the map
  assert.ok(a.citations.length >= 1);
});

test("seen-set suppresses old, surfaces only new", { skip: !have }, () => {
  const reports = loadNew();
  const items = computeAlertItems(bundleFrom(reports));
  // baseline: everything seen
  const seen: Record<string, true> = {};
  for (const a of items) seen[a.key] = true;
  assert.equal(newAlerts(items, seen).length, 0, "nothing new after baseline");

  // a NEW elevated report arrives → exactly one new alert
  const newReport = parseReport(
    ['---', 'id: Z', 'typ: 7S-rapport', 'tnr: "010230"', 'tidpunkt: "2026-06-28T02:30:00"', "lat: 59.2615", "lon: 17.7135", "sagesman: AQ", "---",
     "", "**Händelse:** Stod stilla länge och betraktade grindarna, fotograferade mot säteriet."].join("\n"),
    "reports_new/TNR010230.md",
  );
  const items2 = computeAlertItems(bundleFrom([...reports, newReport]));
  const fresh = newAlerts(items2, seen);
  assert.ok(fresh.some((a) => a.key === "förhöjd:reports_new/TNR010230.md"), "the new elevated report alerts");
  assert.ok(fresh.every((a) => a.kind === "förhöjd"), "only the genuinely new item is fresh");
});

test("computeAlertItems is deterministic; markdown carries the pointer disclaimer", { skip: !have }, () => {
  const reports = loadNew();
  assert.deepEqual(computeAlertItems(bundleFrom(reports)), computeAlertItems(bundleFrom(reports)));
  const md = alertsToMarkdown(computeAlertItems(bundleFrom(reports)), "Larm");
  assert.match(md, /du klickar själv i graf och karta/);
});
