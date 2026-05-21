import type { GeoBbox } from "./bbox-map.ts";

/** Default per-tile bytes used while a real sample is in flight (or when sampling
 *  is impossible — e.g., mbtiles, or a tile server without CORS). */
export const DEFAULT_AVG_TILE_BYTES = 18 * 1024;

/** Number of random tiles fetched per source on each sample run. */
export const SAMPLE_TILES_PER_SOURCE = 6;

/** At/above this tile count or estimated size, show a soft (yellow) warning. */
export const WARN_TILES = 25_000;
export const WARN_MB = 250;

/** At/above this tile count or estimated size, show a hard (red) warning and
 *  gate the download behind a typed confirmation. */
export const HUGE_TILES = 500_000;
export const HUGE_MB = 2_500;

export const MAX_ZOOM_LIMIT = 18;
export const MIN_ZOOM_LIMIT = 0;
export const DEFAULT_MAX_ZOOM = 14;

/** [west, south, east, north] — same shape `styled-map-package-api` uses. */
export type BboxArr = [number, number, number, number];

export function bboxToArr(g: GeoBbox): BboxArr {
  return [g.west, g.south, g.east, g.north];
}

// ─── Tile iteration: matches styled-map-package-api/tile-downloader exactly ───
//
// We reproduce its algorithm here (instead of importing) so the count is computed
// synchronously for the modal without pulling sphericalmercator into the main
// chunk. The `px - 1` trick is what avoids double-counting tiles when the bbox
// edge lands exactly on a tile boundary.

const D2R = Math.PI / 180;
const TILE = 256;

function lngLatToPx(
  lng: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const c = TILE * Math.pow(2, z);
  const f = Math.min(Math.max(Math.sin(D2R * lat), -0.9999), 0.9999);
  return {
    x: c / 2 + lng * (c / 360),
    y: c / 2 + 0.5 * Math.log((1 + f) / (1 - f)) * -(c / (2 * Math.PI)),
  };
}

interface XYZRange {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function bboxToXYZRange(bbox: BboxArr, z: number): XYZRange {
  const nw = lngLatToPx(bbox[0], bbox[3], z);
  const se = lngLatToPx(bbox[2], bbox[1], z);
  const max = Math.pow(2, z) - 1;
  return {
    minX: Math.max(0, Math.floor(nw.x / TILE)),
    minY: Math.max(0, Math.floor(nw.y / TILE)),
    maxX: Math.min(max, Math.floor((se.x - 1) / TILE)),
    maxY: Math.min(max, Math.floor((se.y - 1) / TILE)),
  };
}

export function* tileIterator({
  bounds,
  minzoom = 0,
  maxzoom,
}: {
  bounds: BboxArr;
  minzoom?: number;
  maxzoom: number;
}): Generator<{ x: number; y: number; z: number }, void, undefined> {
  for (let z = minzoom; z <= maxzoom; z++) {
    const { minX, minY, maxX, maxY } = bboxToXYZRange(bounds, z);
    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        yield { x, y, z };
      }
    }
  }
}

/** Exact tile count for the given bbox, z=0..maxzoom (inclusive). */
export function countTiles(bbox: BboxArr | null, maxzoom: number): number {
  if (!bbox) return 0;
  let n = 0;
  for (let z = 0; z <= maxzoom; z++) {
    const r = bboxToXYZRange(bbox, z);
    if (r.maxX < r.minX || r.maxY < r.minY) continue;
    n += (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
  }
  return n;
}

/** Sample up to `count` unique tile coords inside the bbox at zoom z. */
export function randomTilesInBbox(
  bbox: BboxArr,
  z: number,
  count: number,
): { x: number; y: number; z: number }[] {
  const r = bboxToXYZRange(bbox, z);
  if (r.maxX < r.minX || r.maxY < r.minY) return [];
  const total = (r.maxX - r.minX + 1) * (r.maxY - r.minY + 1);
  const out: { x: number; y: number; z: number }[] = [];
  if (total <= count) {
    for (let x = r.minX; x <= r.maxX; x++) {
      for (let y = r.minY; y <= r.maxY; y++) {
        out.push({ x, y, z });
      }
    }
    return out;
  }
  const seen = new Set<string>();
  while (out.length < count) {
    const x = r.minX + Math.floor(Math.random() * (r.maxX - r.minX + 1));
    const y = r.minY + Math.floor(Math.random() * (r.maxY - r.minY + 1));
    const key = `${x},${y}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x, y, z });
  }
  return out;
}
