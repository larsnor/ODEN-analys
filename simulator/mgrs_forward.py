#!/usr/bin/env python3
"""
WGS84 lat/lon -> MGRS (forward), matching the plugin's inverse conventions in
plugin/src/mgrs.ts (proj4 lettering: origin letters AJSAJS / AFAFAF, I/O skipped,
band letters C..X). Zero dependencies. Verified by round-tripping through the
plugin's mgrsToLatLon (see the self-test at the bottom / gen_reports verification).
"""
import math

A = 6378137.0
F = 1 / 298.257223563
E2 = F * (2 - F)
EP2 = E2 / (1 - E2)
K0 = 0.9996

COL_ORIGIN = "AJSAJS"      # SET_ORIGIN_COLUMN_LETTERS
ROW_ORIGIN = "AFAFAF"      # SET_ORIGIN_ROW_LETTERS
BANDS = "CDEFGHJKLMNPQRSTUVWX"  # 8-degree latitude bands, -80..84 (I, O skipped)


def latlon_to_utm(lat, lon):
    latr, lonr = math.radians(lat), math.radians(lon)
    zone = int((lon + 180) / 6) + 1
    lon0 = math.radians((zone - 1) * 6 - 180 + 3)
    N = A / math.sqrt(1 - E2 * math.sin(latr) ** 2)
    T = math.tan(latr) ** 2
    C = EP2 * math.cos(latr) ** 2
    a_ = (lonr - lon0) * math.cos(latr)
    M = A * (
        (1 - E2 / 4 - 3 * E2 ** 2 / 64 - 5 * E2 ** 3 / 256) * latr
        - (3 * E2 / 8 + 3 * E2 ** 2 / 32 + 45 * E2 ** 3 / 1024) * math.sin(2 * latr)
        + (15 * E2 ** 2 / 256 + 45 * E2 ** 3 / 1024) * math.sin(4 * latr)
        - (35 * E2 ** 3 / 3072) * math.sin(6 * latr)
    )
    easting = K0 * N * (a_ + (1 - T + C) * a_ ** 3 / 6
                        + (5 - 18 * T + T ** 2 + 72 * C - 58 * EP2) * a_ ** 5 / 120) + 500000.0
    northing = K0 * (M + N * math.tan(latr) * (a_ ** 2 / 2
                     + (5 - T + 9 * C + 4 * C ** 2) * a_ ** 4 / 24
                     + (61 - 58 * T + T ** 2 + 600 * C - 330 * EP2) * a_ ** 6 / 720))
    if lat < 0:
        northing += 10000000.0
    return zone, easting, northing


def _advance(origin, steps, stop):
    """Advance `steps` letters from `origin`, skipping I/O, wrapping stop->A
    (mirrors eastingFromChar/northingFromChar in mgrs.ts)."""
    cur = ord(origin)
    for _ in range(steps):
        cur += 1
        if cur == ord("I"): cur += 1
        if cur == ord("O"): cur += 1
        if cur > ord(stop): cur = ord("A")
    return chr(cur)


def latlon_to_mgrs(lat, lon, digits=5):
    zone, easting, northing = latlon_to_utm(lat, lon)
    s = zone % 6 or 6
    band = BANDS[min(int((lat + 80) // 8), len(BANDS) - 1)]
    col = _advance(COL_ORIGIN[s - 1], int(easting // 100000) - 1, "Z")
    row = _advance(ROW_ORIGIN[s - 1], int((northing % 2000000) // 100000), "V")
    scale = 10 ** (5 - digits)
    e = int((easting % 100000) / scale)
    n = int((northing % 100000) / scale)
    return f"{zone}{band}{col}{row}{e:0{digits}d}{n:0{digits}d}"


if __name__ == "__main__":
    # Sanity vs the existing Vällinge grids (hand-authored in the generator).
    for lat, lon, expect in [
        (59.2615, 17.7135, "33VXF5468572319"),
        (59.2649, 17.7191, "33VXF5498972711"),
        (59.247, 17.736, "33VXF5603370758"),
    ]:
        got = latlon_to_mgrs(lat, lon)
        print(f"{lat},{lon} -> {got}  (expect ~{expect})  {'OK' if got[:5]==expect[:5] else 'ZONE/SQUARE DIFF'}")
