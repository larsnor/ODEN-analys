/*
 * MGRS grid → WGS84 lat/lon (pure TS, zero dependencies).
 *
 * The new Bin 1 format sometimes carries an MGRS grid in `Ställe`/`plats` and no
 * lat/lon. Obsidian Map View + spatial clustering (§6.6) need lat/lon, so we
 * convert. Algorithm ported from proj4's battle-tested mgrs.js (Snyder series,
 * WGS84) — kept inline rather than as a dependency for reviewability (§11).
 * Verified against an independent oracle (the python `mgrs` lib) across the
 * Swedish UTM zones to ~sub-metre agreement (test/mgrs.test.ts).
 */

const A = 65, I = 73, O = 79, V = 86, Z = 90;
const SET_ORIGIN_COLUMN_LETTERS = "AJSAJS";
const SET_ORIGIN_ROW_LETTERS = "AFAFAF";

/** Minimum northing per latitude band (proj4 table). */
const MIN_NORTHING: Record<string, number> = {
  C: 1100000, D: 2000000, E: 2800000, F: 3700000, G: 4600000, H: 5500000,
  J: 6400000, K: 7300000, L: 8200000, M: 9100000, N: 0, P: 800000,
  Q: 1500000, R: 2300000, S: 3300000, T: 4100000, U: 4800000, V: 5500000,
  W: 6300000, X: 7000000,
};

function set100kForZone(zone: number): number {
  const s = zone % 6;
  return s === 0 ? 6 : s;
}

function eastingFromChar(ch: string, set: number): number {
  let cur = SET_ORIGIN_COLUMN_LETTERS.charCodeAt(set - 1);
  let easting = 100000;
  let rewound = false;
  while (cur !== ch.charCodeAt(0)) {
    cur++;
    if (cur === I) cur++;
    if (cur === O) cur++;
    if (cur > Z) {
      if (rewound) throw new Error("bad MGRS column letter");
      cur = A;
      rewound = true;
    }
    easting += 100000;
  }
  return easting;
}

function northingFromChar(ch: string, set: number): number {
  if (ch.charCodeAt(0) > V) throw new Error("bad MGRS row letter");
  let cur = SET_ORIGIN_ROW_LETTERS.charCodeAt(set - 1);
  let northing = 0;
  let rewound = false;
  while (cur !== ch.charCodeAt(0)) {
    cur++;
    if (cur === I) cur++;
    if (cur === O) cur++;
    if (cur > V) {
      if (rewound) throw new Error("bad MGRS row letter");
      cur = A;
      rewound = true;
    }
    northing += 100000;
  }
  return northing;
}

export interface LatLon {
  lat: number;
  lon: number;
}

/** Inverse UTM (WGS84) → lat/lon. */
function utmToLatLon(zone: number, northern: boolean, easting: number, northing: number): LatLon {
  const k0 = 0.9996;
  const a = 6378137.0;
  const e2 = 0.00669438;
  const e1 = (1 - Math.sqrt(1 - e2)) / (1 + Math.sqrt(1 - e2));
  const x = easting - 500000.0;
  let y = northing;
  if (!northern) y -= 10000000.0;

  const lonOrigin = (zone - 1) * 6 - 180 + 3;
  const ep2 = e2 / (1 - e2);
  const M = y / k0;
  const mu = M / (a * (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256));
  const phi1 =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu);
  const sinPhi1 = Math.sin(phi1);
  const cosPhi1 = Math.cos(phi1);
  const tanPhi1 = Math.tan(phi1);
  const N1 = a / Math.sqrt(1 - e2 * sinPhi1 * sinPhi1);
  const T1 = tanPhi1 * tanPhi1;
  const C1 = ep2 * cosPhi1 * cosPhi1;
  const R1 = (a * (1 - e2)) / Math.pow(1 - e2 * sinPhi1 * sinPhi1, 1.5);
  const D = x / (N1 * k0);

  let lat =
    phi1 -
    ((N1 * tanPhi1) / R1) *
      ((D * D) / 2 -
        ((5 + 3 * T1 + 10 * C1 - 4 * C1 * C1 - 9 * ep2) * D ** 4) / 24 +
        ((61 + 90 * T1 + 298 * C1 + 45 * T1 * T1 - 252 * ep2 - 3 * C1 * C1) * D ** 6) / 720);
  lat = (lat * 180) / Math.PI;

  let lon =
    (D -
      ((1 + 2 * T1 + C1) * D ** 3) / 6 +
      ((5 - 2 * C1 + 28 * T1 - 3 * C1 * C1 + 8 * ep2 + 24 * T1 * T1) * D ** 5) / 120) /
    cosPhi1;
  lon = lonOrigin + (lon * 180) / Math.PI;

  return { lat, lon };
}

const GRID_RE = /^(\d{1,2})([C-X])([A-Z])([A-Z])(\d+)$/;

/** Convert an MGRS string ("33VXF6665179308" or "33VXF 66651 79308") to lat/lon.
 *  Returns null if it isn't a parseable grid. */
export function mgrsToLatLon(grid: string): LatLon | null {
  const g = grid.replace(/\s+/g, "").toUpperCase();
  const m = GRID_RE.exec(g);
  if (!m) return null;
  const zone = parseInt(m[1], 10);
  const band = m[2];
  const colCh = m[3];
  const rowCh = m[4];
  const digits = m[5];
  if (zone < 1 || zone > 60 || digits.length % 2 !== 0 || digits.length === 0) return null;

  try {
    const set = set100kForZone(zone);
    const e100k = eastingFromChar(colCh, set);
    let n100k = northingFromChar(rowCh, set);
    const min = MIN_NORTHING[band] ?? 0;
    while (n100k < min) n100k += 2000000;

    const half = digits.length / 2;
    const scale = Math.pow(10, 5 - half);
    const easting = e100k + parseInt(digits.slice(0, half), 10) * scale;
    const northing = n100k + parseInt(digits.slice(half), 10) * scale;

    const northern = band >= "N";
    const { lat, lon } = utmToLatLon(zone, northern, easting, northing);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return { lat, lon };
  } catch {
    return null;
  }
}

/** Find and convert the first MGRS grid in a text blob, if any. */
export function findMgrsLatLon(text: string): LatLon | null {
  if (!text) return null;
  const m = /\b\d{1,2}[C-X][A-Z]{2}\s?\d{2,5}\s?\d{2,5}\b/.exec(text);
  return m ? mgrsToLatLon(m[0]) : null;
}

/** Parse an operator-entered coordinate — either an MGRS grid or a `lat,lon` pair —
 *  into WGS84, or null if it is neither. Used by the operation-setup dialog. */
export function parseCoord(s: string): LatLon | null {
  const t = s.trim();
  const g = mgrsToLatLon(t);
  if (g) return { lat: Math.round(g.lat * 1e5) / 1e5, lon: Math.round(g.lon * 1e5) / 1e5 };
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (m) {
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  }
  return null;
}
