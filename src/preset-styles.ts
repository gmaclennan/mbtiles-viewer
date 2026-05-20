import type { StyleSpecification } from "maplibre-gl";

export type StyleKind = "vector" | "raster";
export type StyleTone = "light" | "dark";
export type StyleCategory = "street" | "satellite" | "terrain" | "activity";
export type LicenseBucket = "open" | "attribution" | "restrictive";
/** Tile y-axis convention for raster sources. `xyz` = y grows downward
 *  (Google/OSM); `tms` = y grows upward (OGC TMS). */
export type TileScheme = "xyz" | "tms";

export interface StyleCategoryDef {
  id: StyleCategory;
  label: string;
}

export const PRESET_CATEGORIES: StyleCategoryDef[] = [
  { id: "street", label: "Street" },
  { id: "satellite", label: "Satellite" },
  { id: "terrain", label: "Topographic" },
  { id: "activity", label: "Activity" },
];

export const LICENSE_LABELS: Record<LicenseBucket, string> = {
  open: "Open",
  attribution: "Attribution",
  restrictive: "Restricted",
};

/** Dot/pill colours for each licence bucket, shared by the picker cards, the
 *  attribution popover, and the download-modal banner. */
export const LICENSE_COLORS: Record<LicenseBucket, string> = {
  open: "#1f7f3a",
  attribution: "#a06a10",
  restrictive: "#a83a3a",
};

export const CATEGORY_LABELS: Record<StyleCategory, string> =
  Object.fromEntries(
    PRESET_CATEGORIES.map((c) => [c.id, c.label]),
  ) as Record<StyleCategory, string>;

export interface PresetStyle {
  id: string;
  name: string;
  desc: string;
  url: string;
  kind: StyleKind;
  tone: StyleTone;
  category: StyleCategory;
  /** Attribution HTML rendered in the map's attribution popover and the
   *  download-modal licence banner. */
  attribution: string;
  /** Licence bucket — drives the download-modal acknowledgement gate. */
  license: LicenseBucket;
  /** Link to the source's published terms of use. Surfaced in the attribution
   *  popover and the download-modal licence banner. */
  termsUrl?: string;
  /** Raster tile scheme. Defaults to "xyz" when unset. */
  scheme?: TileScheme;
  /** Zoom for the picker preview tile. Defaults to a city-level zoom; lower it
   *  for sources whose tiles are sparse/placeholder at higher zoom. */
  previewZoom?: number;
  /** Raster tile URL template (with {z}/{x}/{y}) used to render a single-tile
   *  preview thumbnail in the style picker. For raster sources this is just the
   *  source URL; for vector styles, it points to a hand-picked raster basemap
   *  with a similar look. */
  previewTileUrl: string;
}

export interface CustomStyle {
  id: "custom";
  name: string;
  desc: string;
  url: string;
  kind: StyleKind;
  tone?: StyleTone;
  /** When set, the style is a fully-formed maplibre style spec (e.g. raster wrapper for tile URLs). */
  spec?: StyleSpecification;
  accessToken?: string;
  /** Set when the picker could resolve a max zoom synchronously (e.g. from a
   *  TileJSON during validate). Otherwise the modal resolves it at open time. */
  maxZoom?: number;
  /** Tile scheme chosen in the Custom URL panel for tile-template sources. */
  scheme?: TileScheme;
  /** Always present so the attribution popover has something to show. Custom
   *  URLs default to a "verify the licence yourself" message. */
  attribution: string;
  /** Custom URLs default to "restrictive" — we can't vouch for the source. */
  license: LicenseBucket;
  termsUrl?: string;
}

export interface MbtilesStyle {
  id: "mbtiles";
  name: string;
  desc: string;
  url: string;
  kind: StyleKind;
  tone?: StyleTone;
  isMbtiles: true;
  /** maplibre style for displaying the loaded mbtiles via the mbtiles:// protocol */
  spec: StyleSpecification;
  /** Max zoom from the mbtiles file's metadata. */
  maxZoom?: number;
  attribution: string;
  license: LicenseBucket;
  termsUrl?: string;
}

/** A style picked from the NextGIS QMS catalogue. */
export interface QmsStyle {
  /** App-side id, `qms-${qmsId}`. */
  id: string;
  /** NextGIS QMS service id. */
  qmsId: number;
  name: string;
  desc: string;
  url: string;
  kind: StyleKind;
  tone: StyleTone;
  category: StyleCategory;
  attribution: string;
  license: LicenseBucket;
  termsUrl?: string;
  scheme?: TileScheme;
}

export type AppStyle = PresetStyle | CustomStyle | MbtilesStyle | QmsStyle;

/** Safe fallback attribution for a user-pasted custom URL. */
export const CUSTOM_URL_ATTRIBUTION =
  "Custom user-provided source — verify licence with the provider.";

const OFM_ATTR =
  '© <a href="https://openfreemap.org">OpenFreeMap</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
const OFM_TERMS = "https://openfreemap.org/";
const ESRI_TERMS =
  "https://www.esri.com/en-us/legal/terms/full-master-agreement";
const ESRI_ATTR = (sources: string) =>
  `Tiles © <a href="https://www.esri.com">Esri</a> — Source: ${sources}`;

export const PRESET_STYLES: PresetStyle[] = [
  // ── Street ──────────────────────────────────────────────────────────────
  {
    id: "positron",
    name: "Positron",
    desc: "Carto-style minimal light basemap. Best for overlays.",
    url: "https://tiles.openfreemap.org/styles/positron",
    kind: "vector",
    tone: "light",
    category: "street",
    attribution: OFM_ATTR,
    license: "open",
    termsUrl: OFM_TERMS,
    previewTileUrl:
      "https://cartodb-basemaps-a.global.ssl.fastly.net/light_all/{z}/{x}/{y}.png",
  },
  {
    id: "liberty",
    name: "OSM Liberty",
    desc: "Full-color OpenStreetMap vector style.",
    url: "https://tiles.openfreemap.org/styles/liberty",
    kind: "vector",
    tone: "light",
    category: "street",
    attribution: OFM_ATTR,
    license: "open",
    termsUrl: OFM_TERMS,
    previewTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  },
  {
    id: "bright",
    name: "OSM Bright",
    desc: "High-contrast bright map. Strong type and roads.",
    url: "https://tiles.openfreemap.org/styles/bright",
    kind: "vector",
    tone: "light",
    category: "street",
    attribution: OFM_ATTR,
    license: "open",
    termsUrl: OFM_TERMS,
    previewTileUrl:
      "https://cartodb-basemaps-a.global.ssl.fastly.net/rastertiles/voyager/{z}/{x}/{y}.png",
  },
  {
    id: "dark",
    name: "Dark Matter",
    desc: "Dark monochrome basemap. Good under bright overlays.",
    url: "https://tiles.openfreemap.org/styles/dark",
    kind: "vector",
    tone: "dark",
    category: "street",
    attribution: OFM_ATTR,
    license: "open",
    termsUrl: OFM_TERMS,
    previewTileUrl:
      "https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png",
  },
  {
    id: "fiord",
    name: "Fiord",
    desc: "Muted blue-grey OpenFreeMap basemap.",
    url: "https://tiles.openfreemap.org/styles/fiord",
    kind: "vector",
    tone: "dark",
    category: "street",
    attribution: OFM_ATTR,
    license: "open",
    termsUrl: OFM_TERMS,
    previewTileUrl:
      "https://services.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  },

  // ── Satellite ───────────────────────────────────────────────────────────
  {
    id: "satellite",
    name: "Esri Satellite",
    desc: "Esri World Imagery. Raster, global coverage.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    kind: "raster",
    tone: "dark",
    category: "satellite",
    attribution: ESRI_ATTR(
      "Esri, Maxar, Earthstar Geographics, and the GIS User Community",
    ),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "esri-clarity",
    name: "Esri Clarity",
    desc: "Sharpened recent imagery emphasising structures.",
    url: "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    kind: "raster",
    tone: "dark",
    category: "satellite",
    attribution: ESRI_ATTR("Esri Clarity — Maxar Vivid"),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "sentinel2",
    name: "Sentinel-2 Cloudless",
    desc: "Cloud-free composite from EOX. Global, recent.",
    // EOX serves the same data on two hosts. `s2maps-tiles.eu` is fronted by
    // Cloudflare with a 403 wall; `tiles.maps.eox.at` returns proper CORS.
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
    kind: "raster",
    tone: "dark",
    category: "satellite",
    attribution:
      'Sentinel-2 cloudless — <a href="https://s2maps.eu">s2maps.eu</a> by <a href="https://eox.at">EOX IT Services GmbH</a> (Contains modified Copernicus Sentinel data)',
    license: "attribution",
    termsUrl: "https://s2maps.eu/",
    previewTileUrl:
      "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
  },
  {
    id: "nimbo",
    name: "NIMBO",
    desc: "Cloud-free Sentinel-2 mosaic, free for non-commercial use.",
    // NIMBO's free MapCache layer is served as an OGC TMS (y-axis up).
    url: "https://prod-data.nimbo.earth/mapcache-free/tms/1.0.0/latest@kermap/{z}/{x}/{y}.png",
    kind: "raster",
    tone: "dark",
    category: "satellite",
    scheme: "tms",
    attribution:
      'Imagery © <a href="https://nimbo.earth">NIMBO</a> by KERMAP · Contains modified Copernicus Sentinel-2 data',
    license: "restrictive",
    termsUrl: "https://nimbo.earth/earth-online/terms-of-use/",
    previewTileUrl:
      "https://prod-data.nimbo.earth/mapcache-free/tms/1.0.0/latest@kermap/{z}/{x}/{y}.png",
  },
  {
    id: "glad-landsat",
    name: "GLAD Landsat",
    desc: "GLAD seasonal Landsat composites for vegetation analysis.",
    url: "https://storage.googleapis.com/earthenginepartners-hansen/tiles/gfc_v1.12/last_543/{z}/{x}/{y}.jpg",
    kind: "raster",
    tone: "dark",
    category: "satellite",
    attribution:
      '© <a href="https://glad.umd.edu">GLAD, University of Maryland</a> · Landsat data courtesy of USGS',
    license: "attribution",
    termsUrl: "https://glad.umd.edu/",
    previewTileUrl:
      "https://storage.googleapis.com/earthenginepartners-hansen/tiles/gfc_v1.12/last_543/{z}/{x}/{y}.jpg",
  },

  // ── Topographic ─────────────────────────────────────────────────────────
  {
    id: "topo",
    name: "OpenTopoMap",
    desc: "Topographic raster from OpenStreetMap.",
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    kind: "raster",
    tone: "light",
    category: "terrain",
    attribution:
      'Map data: © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, SRTM · Style: © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
    license: "attribution",
    termsUrl: "https://opentopomap.org/about",
    previewTileUrl: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
  },
  {
    id: "esri-topo",
    name: "Esri Topographic",
    desc: "Esri World Topographic — contours, hillshade, labels.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    kind: "raster",
    tone: "light",
    category: "terrain",
    attribution: ESRI_ATTR(
      "Esri, HERE, Garmin, FAO, NOAA, USGS, OpenStreetMap contributors",
    ),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "hillshade",
    name: "Hillshade",
    desc: "Greyscale relief-only. Ideal as a contour underlay.",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    kind: "raster",
    tone: "light",
    category: "terrain",
    attribution: ESRI_ATTR("derived from SRTM, ASTER GDEM, GEBCO, and others"),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "esri-shaded-relief",
    name: "Esri Shaded Relief",
    desc: "Colour-graded shaded relief with elevation tinting.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
    kind: "raster",
    tone: "light",
    category: "terrain",
    attribution: ESRI_ATTR("ESRI, NGA, DeLorme"),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Shaded_Relief/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "esri-terrain-base",
    name: "Esri Terrain Base",
    desc: "Minimal terrain backdrop — bathymetry + landcover only.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
    kind: "raster",
    tone: "light",
    category: "terrain",
    attribution: ESRI_ATTR("USGS, Esri, TANA, DeLorme, NPS"),
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    // World Terrain Base has no tile data past low zooms — preview lower so the
    // card doesn't show Esri's "Map data not yet available" placeholder.
    previewZoom: 8,
    previewTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "esri-natgeo",
    name: "Esri National Geographic",
    desc: "National Geographic World Map — cartographic, illustrative.",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
    kind: "raster",
    tone: "light",
    category: "terrain",
    attribution:
      'Map © <a href="https://www.esri.com">Esri</a> & <a href="https://www.nationalgeographic.com">National Geographic</a>',
    license: "restrictive",
    termsUrl: ESRI_TERMS,
    previewTileUrl:
      "https://services.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}",
  },

  // ── Activity ────────────────────────────────────────────────────────────
  {
    id: "cyclosm",
    name: "CyclOSM",
    desc: "Bicycle-oriented map with cycle routes & infrastructure.",
    url: "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    kind: "raster",
    tone: "light",
    category: "activity",
    attribution:
      '© <a href="https://www.cyclosm.org">CyclOSM</a> · © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    license: "attribution",
    termsUrl: "https://www.cyclosm.org/",
    previewTileUrl:
      "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
  },
  {
    id: "humanitarian",
    name: "Humanitarian",
    desc: "HOT humanitarian style — emphasises infrastructure & POIs.",
    url: "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    kind: "raster",
    tone: "light",
    category: "activity",
    attribution:
      '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · Style: © <a href="https://www.hotosm.org">Humanitarian OpenStreetMap Team</a>',
    license: "attribution",
    termsUrl: "https://www.openstreetmap.fr/mentions-legales/",
    previewTileUrl: "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
  },
];

/** Compute XYZ tile indices for a lng/lat at zoom z. */
export function lngLatToTile(
  lng: number,
  lat: number,
  z: number,
): { x: number; y: number } {
  const n = 2 ** z;
  const clampedLat = Math.max(-85.05, Math.min(85.05, lat));
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(
    ((1 -
      Math.log(
        Math.tan((clampedLat * Math.PI) / 180) +
          1 / Math.cos((clampedLat * Math.PI) / 180),
      ) /
        Math.PI) /
      2) *
      n,
  );
  return {
    x: ((x % n) + n) % n,
    y: Math.max(0, Math.min(n - 1, y)),
  };
}

const DEFAULT_SUBDOMAINS = ["a", "b", "c"];
const SUBDOMAIN_RE = /\{subdomain\}|\{s\}/;
const SUBDOMAIN_RE_G = /\{subdomain\}|\{s\}/g;

/** Substitute z/x/y/quadkey/subdomain placeholders in a tile URL template.
 *  Picks a subdomain deterministically from `(x + y) % subdomains.length`
 *  (same pattern Leaflet uses) so adjacent tiles spread across hosts. */
export function fillTileUrl(
  template: string,
  z: number,
  x: number,
  y: number,
  subdomains?: string[],
): string {
  let url = template
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y));
  if (url.includes("{quadkey}")) {
    url = url.replace(/\{quadkey\}/g, computeQuadkey(z, x, y));
  }
  if (SUBDOMAIN_RE.test(url)) {
    const subs = subdomains?.length ? subdomains : DEFAULT_SUBDOMAINS;
    url = url.replace(SUBDOMAIN_RE_G, subs[(x + y) % subs.length]);
  }
  return url;
}

/** Bing-style quadkey for an XYZ tile. Empty string at z=0. */
export function computeQuadkey(z: number, x: number, y: number): string {
  let key = "";
  for (let i = z; i > 0; i--) {
    const mask = 1 << (i - 1);
    key += (x & mask ? 1 : 0) + (y & mask ? 2 : 0);
  }
  return key;
}

/** True if the URL contains either an XYZ-style template (`{z}/{x}/{y}` in
 *  either order) or a Bing-style `{quadkey}` placeholder. */
const TILE_URL_RE =
  /\{z\}.*\{x\}.*\{y\}|\{z\}.*\{y\}.*\{x\}|\{quadkey\}/;

export function isTileUrlTemplate(url: string): boolean {
  return TILE_URL_RE.test(url);
}

export function hasSubdomainPlaceholder(url: string): boolean {
  return SUBDOMAIN_RE.test(url);
}

/** Expand `{subdomain}` / `{s}` into one URL per subdomain. The SMP downloader
 *  and MapLibre both cycle through a `tiles[]` array, so this is the standard
 *  way to provide per-host load-balanced templates. */
export function expandSubdomainTiles(
  tileUrl: string,
  subdomains?: string[],
): string[] {
  if (!SUBDOMAIN_RE.test(tileUrl)) return [tileUrl];
  const subs = subdomains?.length ? subdomains : DEFAULT_SUBDOMAINS;
  return subs.map((s) => tileUrl.replace(SUBDOMAIN_RE_G, s));
}

/** Build a basic raster maplibre style for a tile URL template (z/x/y or
 *  quadkey). When the template contains `{subdomain}`/`{s}`, expand into one
 *  URL per subdomain so MapLibre can round-robin. The `scheme` controls the
 *  y-axis convention (xyz vs OGC tms). */
export function rasterStyleForTileUrl(
  tileUrl: string,
  subdomains?: string[],
  scheme: TileScheme = "xyz",
): StyleSpecification {
  return {
    version: 8,
    sources: {
      tiles: {
        type: "raster",
        tiles: expandSubdomainTiles(tileUrl, subdomains),
        tileSize: 256,
        scheme,
      },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#e9e7e1" },
      },
      {
        id: "tiles",
        type: "raster",
        source: "tiles",
      },
    ],
  };
}

/** Build a maplibre style for a TileJSON URL. The source `url` field
 *  triggers maplibre to fetch & inline the TileJSON automatically. */
export function styleForTileJson(
  tileJsonUrl: string,
  kind: StyleKind,
): StyleSpecification {
  if (kind === "vector") {
    return {
      version: 8,
      sources: {
        src: { type: "vector", url: tileJsonUrl },
      },
      // No layer styling — viewing a TileJSON without a style is rarely useful,
      // but at least the user can see the map area for the bbox flow.
      layers: [
        {
          id: "background",
          type: "background",
          paint: { "background-color": "#f5f4ee" },
        },
      ],
    };
  }
  return {
    version: 8,
    sources: {
      src: { type: "raster", url: tileJsonUrl, tileSize: 256 },
    },
    layers: [
      {
        id: "background",
        type: "background",
        paint: { "background-color": "#e9e7e1" },
      },
      { id: "src", type: "raster", source: "src" },
    ],
  };
}

/** Resolve an AppStyle to something MapLibre's `setStyle` can accept. */
export function buildMapStyle(
  style: AppStyle,
): string | StyleSpecification {
  if ("spec" in style && style.spec) return style.spec;
  if (isTileUrlTemplate(style.url)) {
    return rasterStyleForTileUrl(
      style.url,
      undefined,
      "scheme" in style ? style.scheme : undefined,
    );
  }
  return style.url;
}
