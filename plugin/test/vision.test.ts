/*
 * Vision adapter — the deterministic stub reads the plate embedded in a
 * JPEG comment; corroboration only ever confirms a plate already in the text.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { EmbeddedPlateVision, corroboratePlate, normalizePlate, PLATE_MARKER } from "../src/vision.ts";

const here = dirname(fileURLToPath(import.meta.url));
const vision = new EmbeddedPlateVision();

/** Build a minimal JPEG-shaped buffer with a COM (0xFFFE) segment. */
function jpegWithComment(comment: string): Uint8Array {
  const payload = new TextEncoder().encode(comment);
  const len = payload.length + 2; // length field includes its own 2 bytes
  return Uint8Array.from([
    0xff, 0xd8, // SOI
    0xff, 0xfe, (len >> 8) & 0xff, len & 0xff, ...payload, // COM
    0xff, 0xd9, // EOI
  ]);
}

test("reads the embedded plate from a JPEG comment", () => {
  const r = vision.readPlate(jpegWithComment(PLATE_MARKER + "RJK241"));
  assert.equal(r?.plate, "RJK241");
  assert.equal(r?.partial, false);
});

test("reads the plate from a REAL rendered mockup (end-to-end)", () => {
  const bytes = new Uint8Array(readFileSync(join(here, "fixtures", "plate_RJK241.jpg")));
  assert.equal(vision.readPlate(bytes)?.plate, "RJK241");
});

test("no marker → no reading (detection never depends on vision)", () => {
  assert.equal(vision.readPlate(jpegWithComment("bara ett vanligt fotografi")), null);
  assert.equal(vision.readPlate(Uint8Array.from([0xff, 0xd8, 0xff, 0xd9])), null);
});

test("a wildcard read is flagged partial", () => {
  assert.equal(vision.readPlate(jpegWithComment(PLATE_MARKER + "RJK2.1"))?.partial, true);
});

test("corroboration confirms a typed plate, never invents one", () => {
  const reading = vision.readPlate(jpegWithComment(PLATE_MARKER + "rjk 241")); // normalized on read
  assert.equal(reading?.plate, "RJK241");
  assert.equal(corroboratePlate(reading, ["RJK241", "ABC123"]), "confirmed");
  // read plate not among the typed plates → conflict, NOT a new plate
  assert.equal(corroboratePlate(reading, ["ZZZ999"]), "conflict");
  assert.equal(corroboratePlate(null, ["RJK241"]), "none");
});

test("normalizePlate upper-cases and strips spaces/hyphens", () => {
  assert.equal(normalizePlate("rjk 241"), "RJK241");
  assert.equal(normalizePlate("abc-12x"), "ABC12X");
});
