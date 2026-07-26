/*
 * Vision adapter — image → plate reading, pure and Obsidian-free.
 *
 * Iron rule: images NOMINATE, never assert. A read plate only ever CORROBORATES
 * a plate a human already typed in the message text — it never introduces a new
 * plate. Detection never depends on vision.
 *
 * `PlateVision` is the swappable adapter. Today the deterministic
 * `EmbeddedPlateVision` reads the plate the mock generator embedded in the JPEG
 * comment (marker `7SPLATE:`), so the whole pipeline runs offline and is testable.
 * A real multimodal model (the LLM phase) implements the same interface by OCR on
 * the pixels — same wiring, no other change.
 */

/** Marker the mock plate renderer writes into the JPEG comment (see gen_images.py). */
export const PLATE_MARKER = "7SPLATE:";

export interface PlateReading {
  plate: string; // normalized (upper-case, no spaces)
  /** True when the read is uncertain (contains a wildcard) — emit as partial. */
  partial?: boolean;
}

/** A source of plate readings from an image. Swap the implementation, not the wiring. */
export interface PlateVision {
  readPlate(image: Uint8Array): PlateReading | null;
}

/** Normalize a plate for comparison: upper-case, strip spaces/hyphens. */
export function normalizePlate(s: string): string {
  return s.toUpperCase().replace(/[\s-]/g, "");
}

/**
 * Deterministic offline stub: scans the JPEG for a COM segment (marker 0xFFFE)
 * and returns the plate the generator embedded (`7SPLATE:<plate>`). Returns null
 * if there is no such marker. Stands in for a real OCR/VLM adapter.
 */
export class EmbeddedPlateVision implements PlateVision {
  readPlate(image: Uint8Array): PlateReading | null {
    const marker = new TextEncoder().encode(PLATE_MARKER);
    // Walk COM (0xFF 0xFE) segments; the comment we want starts with the marker.
    for (let i = 0; i + 4 < image.length; i++) {
      if (image[i] !== 0xff || image[i + 1] !== 0xfe) continue;
      const len = (image[i + 2] << 8) | image[i + 3]; // includes the 2 length bytes
      const start = i + 4;
      const end = Math.min(i + 2 + len, image.length);
      if (!startsWith(image, start, marker)) continue;
      const raw = new TextDecoder("ascii").decode(image.subarray(start + marker.length, end)).trim();
      if (!raw) return null;
      return { plate: normalizePlate(raw), partial: raw.includes(".") };
    }
    return null;
  }
}

function startsWith(buf: Uint8Array, at: number, needle: Uint8Array): boolean {
  if (at + needle.length > buf.length) return false;
  for (let k = 0; k < needle.length; k++) if (buf[at + k] !== needle[k]) return false;
  return true;
}

export type Corroboration = "confirmed" | "conflict" | "none";

/**
 * Compare a read plate against the plates a human typed in the SAME report.
 *  - `confirmed`: the read plate exactly matches a typed plate (photo backs it up).
 *  - `conflict`: a plate was read but matches none of the typed plates (do NOT
 *    treat as a new plate — flag for the operator; vision never asserts).
 *  - `none`: nothing read.
 */
export function corroboratePlate(reading: PlateReading | null, textPlates: string[]): Corroboration {
  if (!reading) return "none";
  const typed = new Set(textPlates.map(normalizePlate));
  return typed.has(reading.plate) ? "confirmed" : "conflict";
}
