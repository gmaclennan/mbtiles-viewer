import type { StyleSpecification } from "maplibre-gl";

export type StyleKind = "vector" | "raster";
export type StyleTone = "light" | "dark";

export interface PresetStyle {
  id: string;
  name: string;
  desc: string;
  url: string;
  kind: StyleKind;
  tone: StyleTone;
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
}

export type AppStyle = PresetStyle | CustomStyle | MbtilesStyle;

export const PRESET_STYLES: PresetStyle[] = [
  {
    id: "positron",
    name: "Positron",
    desc: "Carto-style minimal light basemap. Best for overlays.",
    url: "https://tiles.openfreemap.org/styles/positron",
    kind: "vector",
    tone: "light",
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
    previewTileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
  },
  {
    id: "bright",
    name: "OSM Bright",
    desc: "High-contrast bright map. Strong type and roads.",
    url: "https://tiles.openfreemap.org/styles/bright",
    kind: "vector",
    tone: "light",
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
    previewTileUrl:
      "https://cartodb-basemaps-a.global.ssl.fastly.net/dark_all/{z}/{x}/{y}.png",
  },
  {
    id: "satellite",
    name: "Satellite",
    desc: "Esri World Imagery. Raster, global coverage.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    kind: "raster",
    tone: "dark",
    previewTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "topo",
    name: "OpenTopoMap",
    desc: "Topographic raster from OpenStreetMap.",
    url: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
    kind: "raster",
    tone: "light",
    previewTileUrl: "https://a.tile.opentopomap.org/{z}/{x}/{y}.png",
  },
  {
    id: "esri-topo",
    name: "Esri Topographic",
    desc: "Detailed multi-color topo with shaded relief.",
    url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
    kind: "raster",
    tone: "light",
    previewTileUrl:
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "esri-hillshade",
    name: "Hillshade",
    desc: "Esri terrain shading. Greyscale relief.",
    url: "https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
    kind: "raster",
    tone: "light",
    previewTileUrl:
      "https://services.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "esri-imagery-clarity",
    name: "Satellite (Clarity)",
    desc: "Esri high-resolution imagery. Sharper than the default.",
    url: "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    kind: "raster",
    tone: "dark",
    previewTileUrl:
      "https://clarity.maptiles.arcgis.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
  },
  {
    id: "cyclosm",
    name: "CyclOSM",
    desc: "Bright cycle-routes raster from OSM-FR.",
    url: "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
    kind: "raster",
    tone: "light",
    previewTileUrl:
      "https://a.tile-cyclosm.openstreetmap.fr/cyclosm/{z}/{x}/{y}.png",
  },
  {
    id: "hot",
    name: "Humanitarian",
    desc: "High-contrast HOT style for field mapping.",
    url: "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
    kind: "raster",
    tone: "light",
    previewTileUrl:
      "https://a.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
  },
  {
    id: "sentinel2",
    name: "Sentinel-2 Cloudless",
    desc: "EOX cloudless satellite mosaic. Non-commercial.",
    // EOX serves the same data on two hosts. `s2maps-tiles.eu` is fronted by
    // Cloudflare with a 403 wall; `tiles.maps.eox.at` returns proper CORS.
    url: "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
    kind: "raster",
    tone: "dark",
    previewTileUrl:
      "https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2024_3857/default/g/{z}/{y}/{x}.jpg",
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

/** Substitute z/x/y placeholders in a tile URL template. */
export function fillTileUrl(
  template: string,
  z: number,
  x: number,
  y: number,
): string {
  return template
    .replace(/\{z\}/g, String(z))
    .replace(/\{x\}/g, String(x))
    .replace(/\{y\}/g, String(y));
}

const TILE_URL_RE = /\{z\}.*\{x\}.*\{y\}|\{z\}.*\{y\}.*\{x\}/;

export function isTileUrlTemplate(url: string): boolean {
  return TILE_URL_RE.test(url);
}

/** Build a basic raster maplibre style for a tile URL template (z/x/y). */
export function rasterStyleForTileUrl(tileUrl: string): StyleSpecification {
  return {
    version: 8,
    sources: {
      tiles: {
        type: "raster",
        tiles: [tileUrl],
        tileSize: 256,
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
  if (isTileUrlTemplate(style.url)) return rasterStyleForTileUrl(style.url);
  return style.url;
}
