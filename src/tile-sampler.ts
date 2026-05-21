import {
  randomTilesInBbox,
  SAMPLE_TILES_PER_SOURCE,
  type BboxArr,
} from "./estimate.ts";
import {
  fillTileUrl,
  isTileUrlTemplate,
  lngLatToTile,
  type AppStyle,
} from "./preset-styles.ts";

/** Highest zoom we'll probe to. Most public tile providers stop at 19–20. */
const PROBE_MAX_ZOOM = 22;
const PROBE_MIN_ZOOM = 4;

interface TileJsonish {
  tiles?: string[];
  tilejson?: string;
  format?: string;
  maxzoom?: number;
}

interface MaplibreStyleish {
  version?: number;
  sources?: Record<string, MaplibreSourceish>;
}

interface MaplibreSourceish {
  type?: string;
  url?: string;
  tiles?: string[];
  maxzoom?: number;
}

/** Resolve an AppStyle to the underlying tile URL templates we'd actually
 *  download from. Walks style.json → TileJSON when needed. Returns [] for
 *  mbtiles or anything unresolvable. */
export async function resolveDataTileUrls(
  style: AppStyle,
  signal?: AbortSignal,
): Promise<string[]> {
  if ("isMbtiles" in style && style.isMbtiles) return [];

  if ("spec" in style && style.spec) {
    return collectTileUrlsFromSpec(
      style.spec as unknown as MaplibreStyleish,
      signal,
    );
  }

  if (isTileUrlTemplate(style.url)) return [style.url];

  // The url is either a maplibre style.json or a TileJSON.
  try {
    const r = await fetch(style.url, { signal });
    if (!r.ok) return [];
    const json = (await r.json()) as MaplibreStyleish & TileJsonish;
    if (json.version === 8 && json.sources) {
      return collectTileUrlsFromSpec(json, signal);
    }
    if (Array.isArray(json.tiles) && json.tiles.length) return json.tiles;
  } catch {
    /* swallow — sampler falls back to default size */
  }
  return [];
}

async function collectTileUrlsFromSpec(
  spec: MaplibreStyleish,
  signal?: AbortSignal,
): Promise<string[]> {
  const out: string[] = [];
  for (const src of Object.values(spec.sources ?? {})) {
    if (
      src.type !== "vector" &&
      src.type !== "raster" &&
      src.type !== "raster-dem"
    ) {
      continue;
    }
    if (Array.isArray(src.tiles) && src.tiles.length) {
      out.push(src.tiles[0]);
    } else if (src.url) {
      try {
        const tj = (await fetch(src.url, { signal }).then((r) =>
          r.json(),
        )) as TileJsonish;
        if (Array.isArray(tj.tiles) && tj.tiles.length) {
          out.push(tj.tiles[0]);
        }
      } catch {
        /* skip; sampler will simply have one fewer source */
      }
    }
  }
  return out;
}

/** Fetch up to `SAMPLE_TILES_PER_SOURCE` random tiles inside the bbox at
 *  `maxzoom` for each tile URL template, and return the average byte size of
 *  successful responses. Returns null if every fetch failed. */
export async function sampleAvgTileBytes({
  tileUrls,
  bounds,
  maxzoom,
  signal,
}: {
  tileUrls: string[];
  bounds: BboxArr;
  maxzoom: number;
  signal?: AbortSignal;
}): Promise<number | null> {
  if (!tileUrls.length) return null;
  const tasks: Promise<number | null>[] = [];
  for (const tmpl of tileUrls) {
    const tiles = randomTilesInBbox(bounds, maxzoom, SAMPLE_TILES_PER_SOURCE);
    for (const t of tiles) {
      const url = fillTileUrl(tmpl, t.z, t.x, t.y);
      tasks.push(measureTileBytes(url, signal));
    }
  }
  const results = await Promise.all(tasks);
  // Drop 0-byte responses too — some tile servers reply 200-OK with an empty
  // body for "no tile here", which would otherwise pull the average to ~0.
  const sizes = results.filter(
    (s): s is number => typeof s === "number" && s > 0,
  );
  if (!sizes.length) return null;
  return sizes.reduce((a, b) => a + b, 0) / sizes.length;
}

async function measureTileBytes(
  url: string,
  signal?: AbortSignal,
): Promise<number | null> {
  try {
    const res = await fetch(url, { signal, mode: "cors" });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return buf.byteLength;
  } catch {
    return null;
  }
}

/** Synchronous max-zoom probe — covers presets and styles whose source
 *  maxzooms are inlined in the spec (mbtiles, anything we built locally). */
export function getStyleMaxZoomSync(style: AppStyle): number | null {
  if ("maxZoom" in style && typeof style.maxZoom === "number") {
    return style.maxZoom;
  }
  if ("spec" in style && style.spec) {
    return maxZoomFromSpec(style.spec as unknown as MaplibreStyleish);
  }
  return null;
}

/** Async resolver. Walks the actual data source to find a real maxzoom:
 *   - mbtiles or already-built specs: read inline source.maxzoom
 *   - maplibre style URL: fetch style.json, then each source's TileJSON
 *   - bare TileJSON URL: read maxzoom directly
 *   - tile URL template (no metadata): probe tile availability around the bbox
 *
 *  Returns null only when nothing in the chain produced a usable answer. */
export async function getStyleMaxZoomAsync(
  style: AppStyle,
  bbox: BboxArr,
  signal?: AbortSignal,
): Promise<number | null> {
  // Synchronous spec walk first (covers mbtiles + custom-with-spec where the
  // spec was built locally so source.maxzoom is inline).
  const sync = getStyleMaxZoomSync(style);
  if (sync != null) return sync;

  // mbtiles without metadata.maxzoom — fallback to probing the bbox.
  if ("isMbtiles" in style && style.isMbtiles) return null;

  // Resolve the underlying tile URLs first; for tile URL templates that's the
  // template itself, for style URLs we walk style.json -> TileJSON.
  const tileUrls = await resolveDataTileUrls(style, signal);

  // Try each source's TileJSON / spec entry for a stated maxzoom.
  if (!isTileUrlTemplate(style.url) && !("spec" in style && style.spec)) {
    try {
      const r = await fetch(style.url, { signal });
      if (r.ok) {
        const json = (await r.json()) as MaplibreStyleish & TileJsonish;
        if (json.version === 8 && json.sources) {
          const m = await maxZoomFromSpecAsync(json, signal);
          if (m != null) return m;
        }
        if (typeof json.maxzoom === "number") return json.maxzoom;
      }
    } catch {
      /* fall through to probe */
    }
  }

  // Last resort: probe tile availability at the bbox center.
  if (tileUrls.length === 0 || signal?.aborted) return null;
  return probeMaxZoomAtCenter(tileUrls[0], bbox, signal);
}

/** Binary-search the highest z at which the tile under the bbox center
 *  responds with 200 OK. Costs ~5 GET requests on average. */
export async function probeMaxZoomAtCenter(
  tileUrl: string,
  bbox: BboxArr,
  signal?: AbortSignal,
): Promise<number | null> {
  const cx = (bbox[0] + bbox[2]) / 2;
  const cy = (bbox[1] + bbox[3]) / 2;

  let low = PROBE_MIN_ZOOM;
  let high = PROBE_MAX_ZOOM;
  let best: number | null = null;

  // Quick check: does the source even respond at the lowest zoom? If not,
  // there's no point binary-searching — we have nothing.
  if (!(await probeTileOk(tileUrl, low, cx, cy, signal))) return null;
  best = low;

  while (low <= high) {
    if (signal?.aborted) return null;
    const mid = Math.floor((low + high) / 2);
    if (mid === best) {
      // Avoid re-probing the boundary we already cleared.
      low = mid + 1;
      continue;
    }
    const ok = await probeTileOk(tileUrl, mid, cx, cy, signal);
    if (ok) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

async function probeTileOk(
  tileUrl: string,
  z: number,
  lng: number,
  lat: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const { x, y } = lngLatToTile(lng, lat, z);
  const url = fillTileUrl(tileUrl, z, x, y);
  try {
    const res = await fetch(url, { signal, mode: "cors" });
    if (!res.ok) return false;
    // Some tile servers return 200 with a 0-byte body for "no tile here";
    // treat that as unavailable.
    const buf = await res.arrayBuffer();
    return buf.byteLength > 0;
  } catch {
    return false;
  }
}

/** Walk a style spec's sources synchronously, returning the LARGEST maxzoom
 *  found inline (the highest zoom at which at least one source still has new
 *  data — the SMP downloader clamps each source to its own maxzoom internally,
 *  so picking the max here doesn't cause requests past any source's bound).
 *  Returns null when no source has an inline maxzoom. */
function maxZoomFromSpec(spec: MaplibreStyleish): number | null {
  let max: number | null = null;
  for (const src of Object.values(spec.sources ?? {})) {
    if (typeof src.maxzoom !== "number") continue;
    if (max == null || src.maxzoom > max) max = src.maxzoom;
  }
  return max;
}

/** Async variant — for style sources that point at a TileJSON URL we follow
 *  the URL and read its maxzoom. Returns the largest maxzoom across sources. */
async function maxZoomFromSpecAsync(
  spec: MaplibreStyleish,
  signal?: AbortSignal,
): Promise<number | null> {
  let max: number | null = null;
  for (const src of Object.values(spec.sources ?? {})) {
    let candidate: number | null = null;
    if (typeof src.maxzoom === "number") {
      candidate = src.maxzoom;
    } else if (src.url) {
      try {
        const tj = (await fetch(src.url, { signal }).then((r) =>
          r.json(),
        )) as TileJsonish;
        if (typeof tj.maxzoom === "number") candidate = tj.maxzoom;
      } catch {
        /* skip this source */
      }
    }
    if (candidate != null && (max == null || candidate > max)) max = candidate;
  }
  return max;
}
