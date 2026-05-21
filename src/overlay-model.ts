import type { Feature, FeatureCollection, Geometry } from "geojson";

// ── Types ─────────────────────────────────────────────────────────────────
export type GeomType = "lines" | "areas" | "points";
export type SizeToken = "xs" | "s" | "m" | "l";
export type DashToken = "solid" | "dashed" | "dotted";

/** Label styling — present on every layer regardless of geometry. */
export interface LabelStyle {
  showLabels: boolean;
  labelField: string;
  labelSize: SizeToken;
  labelColor: string;
}

export interface LineStyle extends LabelStyle {
  color: string;
  width: SizeToken;
  dash: DashToken;
}

export interface AreaStyle extends LabelStyle {
  color: string;
  /** Snapped to one of OPACITY_PRESETS. */
  opacity: number;
  strokeWidth: SizeToken;
  dash: DashToken;
}

export interface PointStyle extends LabelStyle {
  color: string;
  size: SizeToken;
  /** 'circle' | 'square' | 'triangle' | a Maki icon id. */
  shape: string;
}

export type LayerStyle = LineStyle | AreaStyle | PointStyle;

/** A patch is a partial of the widened style — callers only ever touch fields
 *  valid for the layer's geometry. */
export type StylePatch = Partial<LineStyle & AreaStyle & PointStyle>;

/** One file fans out into one layer per geometry family present. */
export interface OverlayLayer {
  id: string;
  /** Original upload name, e.g. 'royal-parks.geojson'. */
  fileName: string;
  /** Editable display name; default = sentence-cased file + ` (${geom})`. */
  name: string;
  geomType: GeomType;
  /** Filtered to ONLY the features of this layer's geomType. */
  geojson: FeatureCollection;
  featureCount: number;
  visible: boolean;
  style: LayerStyle;
}

// ── Constants ─────────────────────────────────────────────────────────────

/** Rotated through on each new file so successive drops get distinct defaults. */
export const OVERLAY_DEFAULT_COLORS = [
  "#1854f6", // blue (app accent)
  "#e83b87", // magenta
  "#f59e0b", // amber
  "#10b981", // emerald
  "#a855f7", // violet
  "#ef4444", // red
];

/** The 7 curated swatches shown in every colour picker. */
export const OVERLAY_SWATCH_PALETTE = [
  "#1854f6", // blue
  "#0ea5e9", // sky
  "#10b981", // emerald
  "#f59e0b", // amber
  "#ef4444", // red
  "#e83b87", // magenta
  "#a855f7", // violet
];

export const SIZE_TOKENS: SizeToken[] = ["xs", "s", "m", "l"];

export const STROKE_PX: Record<SizeToken, number> = {
  xs: 1.25,
  s: 2.5,
  m: 4,
  l: 6.5,
};
export const POINT_PX: Record<SizeToken, number> = {
  xs: 3.5,
  s: 5.5,
  m: 8,
  l: 11,
};
export const LABEL_PX: Record<SizeToken, number> = {
  xs: 10,
  s: 11.5,
  m: 13.5,
  l: 16,
};

export const OPACITY_PRESETS: { label: string; value: number }[] = [
  { label: "None", value: 0 },
  { label: "Soft", value: 0.25 },
  { label: "Bold", value: 0.45 },
  { label: "Solid", value: 1 },
];

export const DEFAULT_LABEL_COLOR = "#1a1d24";

// ── Geometry inspection ───────────────────────────────────────────────────

const GEOM_FAMILY: Record<string, GeomType> = {
  LineString: "lines",
  MultiLineString: "lines",
  Polygon: "areas",
  MultiPolygon: "areas",
  Point: "points",
  MultiPoint: "points",
};

/** Report which geometry families a FeatureCollection contains. */
export function inspectGeoJSON(fc: FeatureCollection): Record<GeomType, boolean> {
  const has: Record<GeomType, boolean> = {
    lines: false,
    areas: false,
    points: false,
  };
  for (const f of fc.features) {
    const family = f.geometry && GEOM_FAMILY[f.geometry.type];
    if (family) has[family] = true;
  }
  return has;
}

/** Filter a FeatureCollection down to only features of a given family. */
export function filterByGeomType(
  fc: FeatureCollection,
  geomType: GeomType,
): FeatureCollection {
  return {
    type: "FeatureCollection",
    features: fc.features.filter(
      (f) => f.geometry && GEOM_FAMILY[f.geometry.type] === geomType,
    ),
  };
}

/** 'thames-trails.geojson' + 'lines' → 'Thames trails (lines)'. */
export function formatLayerName(fileName: string, geomType: GeomType): string {
  const base = fileName
    .replace(/\.(geojson|json)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim();
  const sentence = base
    ? base.charAt(0).toUpperCase() + base.slice(1).toLowerCase()
    : "Overlay";
  return `${sentence} (${geomType})`;
}

/** Default style for a freshly-created layer of the given geometry type. */
export function buildLayerStyle(
  geomType: GeomType,
  colorIndex: number,
): LayerStyle {
  const color =
    OVERLAY_DEFAULT_COLORS[colorIndex % OVERLAY_DEFAULT_COLORS.length];
  const common: LabelStyle = {
    showLabels: false,
    labelField: "name",
    labelSize: "m",
    labelColor: DEFAULT_LABEL_COLOR,
  };
  if (geomType === "lines") {
    return { ...common, color, width: "m", dash: "solid" };
  }
  if (geomType === "areas") {
    return { ...common, color, opacity: 0.25, strokeWidth: "s", dash: "solid" };
  }
  return { ...common, color, size: "m", shape: "circle" };
}

// ── File ingestion ────────────────────────────────────────────────────────

const BARE_GEOMETRY_TYPES = new Set([
  "Point",
  "MultiPoint",
  "LineString",
  "MultiLineString",
  "Polygon",
  "MultiPolygon",
  "GeometryCollection",
]);

/** Accept a FeatureCollection, a single Feature, or a bare Geometry and
 *  normalise to a FeatureCollection. Returns null if unrecognised. */
function normalizeToFeatureCollection(json: unknown): FeatureCollection | null {
  if (!json || typeof json !== "object") return null;
  const obj = json as { type?: string; features?: unknown };
  if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
    return json as FeatureCollection;
  }
  if (obj.type === "Feature") {
    return { type: "FeatureCollection", features: [json as Feature] };
  }
  if (typeof obj.type === "string" && BARE_GEOMETRY_TYPES.has(obj.type)) {
    return {
      type: "FeatureCollection",
      features: [
        { type: "Feature", properties: {}, geometry: json as Geometry },
      ],
    };
  }
  return null;
}

/** Read + validate a dropped/picked file as GeoJSON. Throws a user-facing
 *  Error message on any failure. */
export async function parseGeoJSONFile(file: File): Promise<FeatureCollection> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    throw new Error(`Couldn't read ${file.name}.`);
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${file.name} isn't valid JSON.`);
  }
  const fc = normalizeToFeatureCollection(json);
  if (!fc) {
    throw new Error(`${file.name} isn't a GeoJSON feature collection.`);
  }
  const presence = inspectGeoJSON(fc);
  if (!presence.lines && !presence.areas && !presence.points) {
    throw new Error(`${file.name} has no points, lines or areas.`);
  }
  return fc;
}

const GEOJSON_EXT = /\.(geojson|json)$/i;

/** True for files we should route to the overlay feature. */
export function isGeoJSONFile(file: File): boolean {
  return GEOJSON_EXT.test(file.name) || file.type === "application/geo+json";
}
