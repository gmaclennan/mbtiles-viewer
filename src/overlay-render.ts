// Reconciles the overlay layer list onto a MapLibre map: one GeoJSON source
// per layer, plus the fill/line/circle/symbol layers each geometry needs.

import type {
  AddLayerObject,
  Map as MaplibreMap,
  GeoJSONSource,
} from "maplibre-gl";
import {
  LABEL_PX,
  POINT_PX,
  STROKE_PX,
  type AreaStyle,
  type LineStyle,
  type OverlayLayer,
  type PointStyle,
} from "./overlay-model.ts";
import { ensureOverlayIcons, iconImageName } from "./overlay-icons.ts";

const SOURCE_PREFIX = "ovl-";

/** True when the style *spec* is loaded and mutable. `map.isStyleLoaded()` is
 *  too strict — it also goes false whenever source tiles are in flight, which
 *  is the normal state — so it can't gate `addSource`/`addLayer`. The `_loaded`
 *  flag on the internal Style is the precise signal; fall back to the public
 *  check if the internal shape ever changes. */
function canMutateStyle(map: MaplibreMap): boolean {
  const style = (map as unknown as { style?: { _loaded?: boolean } }).style;
  if (style && typeof style._loaded === "boolean") return style._loaded;
  return Boolean(map.isStyleLoaded());
}

function dashArray(dash: string): number[] | null {
  if (dash === "dashed") return [3, 2];
  if (dash === "dotted") return [0.1, 2.2];
  return null;
}

/** A plain font stack used by the basemap's own symbol layers. Reused for our
 *  label layers so glyphs resolve — the MapLibre default (`Open Sans Regular`)
 *  isn't served by every glyph endpoint. Returns null if none is found, in
 *  which case the label layer falls back to the spec default. */
function basemapTextFont(map: MaplibreMap): string[] | null {
  for (const lyr of map.getStyle()?.layers ?? []) {
    if (lyr.type !== "symbol") continue;
    const font = (lyr.layout as { "text-font"?: unknown } | undefined)?.[
      "text-font"
    ];
    if (
      Array.isArray(font) &&
      font.length > 0 &&
      font.every((f) => typeof f === "string")
    ) {
      return font as string[];
    }
  }
  return null;
}

/** MapLibre layer definitions for a single overlay layer. `hasGlyphs` is false
 *  for basemaps with no font source (most raster styles) — text layers are
 *  skipped there since MapLibre can't render labels without glyphs. */
function layerDefsFor(
  layer: OverlayLayer,
  srcId: string,
  hasGlyphs: boolean,
  textFont: string[] | null = null,
): AddLayerObject[] {
  const visibility: "visible" | "none" = layer.visible ? "visible" : "none";
  const s = layer.style;
  const defs: AddLayerObject[] = [];

  if (layer.geomType === "areas") {
    const a = s as AreaStyle;
    const dash = dashArray(a.dash);
    // Opacity 0 ("None") → outline-only: skip the fill layer entirely.
    if (a.opacity > 0) {
      defs.push({
        id: `${srcId}-fill`,
        type: "fill",
        source: srcId,
        layout: { visibility },
        paint: { "fill-color": a.color, "fill-opacity": a.opacity },
      });
    }
    defs.push({
      id: `${srcId}-stroke`,
      type: "line",
      source: srcId,
      layout: {
        visibility,
        "line-join": "round",
        "line-cap": a.dash === "dotted" ? "round" : "butt",
      },
      paint: {
        "line-color": a.color,
        "line-width": STROKE_PX[a.strokeWidth],
        ...(dash ? { "line-dasharray": dash } : {}),
      },
    } as AddLayerObject);
  } else if (layer.geomType === "lines") {
    const l = s as LineStyle;
    const dash = dashArray(l.dash);
    defs.push({
      id: `${srcId}-line`,
      type: "line",
      source: srcId,
      layout: {
        visibility,
        "line-join": "round",
        "line-cap": l.dash === "dotted" ? "round" : "butt",
      },
      paint: {
        "line-color": l.color,
        "line-width": STROKE_PX[l.width],
        ...(dash ? { "line-dasharray": dash } : {}),
      },
    } as AddLayerObject);
  } else {
    const p = s as PointStyle;
    const px = POINT_PX[p.size];
    if (p.shape === "circle") {
      defs.push({
        id: `${srcId}-circle`,
        type: "circle",
        source: srcId,
        layout: { visibility },
        paint: {
          "circle-radius": px,
          "circle-color": p.color,
          "circle-stroke-color": "#fff",
          "circle-stroke-width": 1.5,
        },
      });
    } else {
      defs.push({
        id: `${srcId}-symbol`,
        type: "symbol",
        source: srcId,
        layout: {
          visibility,
          "icon-image": iconImageName(p.shape),
          "icon-size": (px * 2) / 28,
          "icon-allow-overlap": true,
          "icon-ignore-placement": true,
        },
        paint: { "icon-color": p.color },
      });
    }
  }

  if (s.showLabels && hasGlyphs) {
    defs.push({
      id: `${srcId}-label`,
      type: "symbol",
      source: srcId,
      layout: {
        visibility,
        "text-field": ["coalesce", ["get", s.labelField || "name"], ""],
        "text-size": LABEL_PX[s.labelSize],
        "text-offset": [0, 1.2],
        "text-anchor": "top",
        "text-allow-overlap": false,
        "text-optional": true,
        ...(textFont ? { "text-font": textFont } : {}),
      },
      paint: {
        "text-color": s.labelColor || "#1a1d24",
        "text-halo-color": "#fff",
        "text-halo-width": 1.6,
      },
    } as AddLayerObject);
  }

  return defs;
}

/** Reconcile the layer list onto the map. Idempotent: adds missing sources/
 *  layers, updates changed paint/layout, restacks, and garbage-collects
 *  anything whose state was removed. */
export function syncOverlaysToMap(
  map: MaplibreMap,
  layers: OverlayLayer[],
): void {
  if (!canMutateStyle(map)) return;
  ensureOverlayIcons(map);

  const hasGlyphs = Boolean(map.getStyle()?.glyphs);
  const textFont = hasGlyphs ? basemapTextFont(map) : null;
  const wantIds = new Set<string>();
  // Walk bottom→top so each `addLayer`/`moveLayer` lands above the previous,
  // leaving the array's first element on top of the render stack.
  for (const layer of [...layers].reverse()) {
    const srcId = `${SOURCE_PREFIX}${layer.id}`;
    wantIds.add(layer.id);

    const existing = map.getSource(srcId) as GeoJSONSource | undefined;
    if (!existing) {
      try {
        map.addSource(srcId, { type: "geojson", data: layer.geojson });
      } catch (err) {
        console.warn("overlay addSource failed", srcId, err);
        continue;
      }
    } else {
      existing.setData(layer.geojson);
    }

    for (const def of layerDefsFor(layer, srcId, hasGlyphs, textFont)) {
      if (map.getLayer(def.id)) {
        const paint = (def as { paint?: Record<string, unknown> }).paint ?? {};
        const layout =
          (def as { layout?: Record<string, unknown> }).layout ?? {};
        for (const [k, v] of Object.entries(paint)) {
          try {
            map.setPaintProperty(def.id, k, v);
          } catch {
            /* property not applicable after a geometry/shape switch */
          }
        }
        for (const [k, v] of Object.entries(layout)) {
          try {
            map.setLayoutProperty(def.id, k, v);
          } catch {
            /* property not applicable */
          }
        }
        try {
          map.moveLayer(def.id);
        } catch {
          /* layer briefly absent during a restyle */
        }
      } else {
        try {
          map.addLayer(def);
        } catch (err) {
          console.warn("overlay addLayer failed", def.id, err);
        }
      }
    }
  }

  // Drop layers + sources whose overlay was removed (or whose shape switched,
  // e.g. a `-circle` left behind after picking an icon).
  const style = map.getStyle();
  const liveIds = currentLayerIds(layers, hasGlyphs);
  for (const lyr of style.layers ?? []) {
    if (!lyr.id.startsWith(SOURCE_PREFIX)) continue;
    const ovlId = lyr.id.split("-")[1];
    const stillWanted = wantIds.has(ovlId) && liveIds.has(lyr.id);
    if (!stillWanted) {
      try {
        map.removeLayer(lyr.id);
      } catch {
        /* already gone */
      }
    }
  }
  for (const srcId of Object.keys(style.sources ?? {})) {
    if (!srcId.startsWith(SOURCE_PREFIX)) continue;
    if (!wantIds.has(srcId.slice(SOURCE_PREFIX.length))) {
      try {
        map.removeSource(srcId);
      } catch {
        /* still referenced */
      }
    }
  }
}

/** Every map-layer id the current layer list expects to exist. */
function currentLayerIds(
  layers: OverlayLayer[],
  hasGlyphs: boolean,
): Set<string> {
  const ids = new Set<string>();
  for (const layer of layers) {
    const srcId = `${SOURCE_PREFIX}${layer.id}`;
    for (const def of layerDefsFor(layer, srcId, hasGlyphs)) ids.add(def.id);
  }
  return ids;
}

/** True when the map is missing sources the layer list expects — the signal
 *  that a `setStyle` wiped the overlays and they need re-adding. */
export function overlaysNeedReadd(
  map: MaplibreMap,
  layers: OverlayLayer[],
): boolean {
  return layers.some(
    (layer) => !map.getSource(`${SOURCE_PREFIX}${layer.id}`),
  );
}
