// Maki-inspired, SDF-friendly point icons.
//
// Each glyph is redrawn from scratch as a single-colour silhouette so MapLibre
// can tint it via `icon-color` once registered as an SDF image. Glyphs are
// drawn in a 32×32 coordinate space. Built in the spirit of the Maki icon set
// (https://github.com/mapbox/maki — CC0, public domain).

import type { Map as MaplibreMap } from "maplibre-gl";

export type MakiId =
  | "cafe"
  | "restaurant"
  | "bar"
  | "lodging"
  | "fuel"
  | "parking"
  | "hospital"
  | "school"
  | "shop"
  | "monument"
  | "viewpoint"
  | "park"
  | "museum"
  | "theatre"
  | "water"
  | "flag"
  | "star"
  | "heart"
  | "pin"
  | "bike";

/** Built-in (non-Maki) point shapes drawn as SDF images. */
export const BUILTIN_SHAPES = ["square", "triangle"] as const;

/** [id, label] pairs for the icon-library picker. */
export const OVERLAY_ICON_SET: [MakiId, string][] = [
  ["cafe", "Café"],
  ["restaurant", "Restaurant"],
  ["bar", "Bar"],
  ["lodging", "Lodging"],
  ["fuel", "Fuel"],
  ["parking", "Parking"],
  ["hospital", "Hospital"],
  ["school", "School"],
  ["shop", "Shop"],
  ["monument", "Monument"],
  ["viewpoint", "Viewpoint"],
  ["park", "Park"],
  ["museum", "Museum"],
  ["theatre", "Theatre"],
  ["water", "Water"],
  ["flag", "Flag"],
  ["star", "Star"],
  ["heart", "Heart"],
  ["pin", "Pin"],
  ["bike", "Bike"],
];

const MAKI_IDS = new Set<string>(OVERLAY_ICON_SET.map(([id]) => id));

/** True when a point shape token refers to a Maki icon (vs. a built-in shape). */
export function isMakiShape(shape: string): boolean {
  return MAKI_IDS.has(shape);
}

type Drawer = (ctx: CanvasRenderingContext2D) => void;

/** Each drawer fills `ctx.fillStyle`, preset by the caller. 0..32 grid. */
export const OVERLAY_ICON_DRAWERS: Record<MakiId, Drawer> = {
  cafe(ctx) {
    ctx.beginPath();
    ctx.moveTo(8, 14);
    ctx.lineTo(22, 14);
    ctx.lineTo(20.5, 24);
    ctx.quadraticCurveTo(20, 26, 18, 26);
    ctx.lineTo(12, 26);
    ctx.quadraticCurveTo(10, 26, 9.5, 24);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(22, 16);
    ctx.quadraticCurveTo(26, 17, 26, 20);
    ctx.quadraticCurveTo(26, 23, 22, 22);
    ctx.lineTo(22, 20.5);
    ctx.quadraticCurveTo(24, 21, 24, 20);
    ctx.quadraticCurveTo(24, 18.5, 22, 18);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(14, 9, 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(17, 7, 1.2, 0, Math.PI * 2);
    ctx.fill();
  },
  restaurant(ctx) {
    ctx.fillRect(9, 6, 1.6, 20);
    ctx.fillRect(11, 6, 1.6, 6);
    ctx.fillRect(13, 6, 1.6, 6);
    ctx.fillRect(7, 6, 1.6, 6);
    ctx.beginPath();
    ctx.moveTo(22, 6);
    ctx.quadraticCurveTo(26, 10, 24, 16);
    ctx.lineTo(22, 16);
    ctx.lineTo(22, 26);
    ctx.lineTo(20.5, 26);
    ctx.lineTo(20.5, 6);
    ctx.closePath();
    ctx.fill();
  },
  bar(ctx) {
    ctx.beginPath();
    ctx.moveTo(6, 8);
    ctx.lineTo(26, 8);
    ctx.lineTo(17.2, 18);
    ctx.lineTo(17.2, 25);
    ctx.lineTo(22, 26);
    ctx.lineTo(10, 26);
    ctx.lineTo(14.8, 25);
    ctx.lineTo(14.8, 18);
    ctx.closePath();
    ctx.fill();
  },
  lodging(ctx) {
    ctx.fillRect(5, 14, 4, 5);
    ctx.fillRect(5, 19, 22, 4);
    ctx.fillRect(4, 23, 2, 4);
    ctx.fillRect(26, 23, 2, 4);
    ctx.fillRect(4, 10, 2, 14);
  },
  fuel(ctx) {
    ctx.beginPath();
    ctx.moveTo(8, 7);
    ctx.lineTo(18, 7);
    ctx.quadraticCurveTo(20, 7, 20, 9);
    ctx.lineTo(20, 26);
    ctx.lineTo(8, 26);
    ctx.lineTo(8, 9);
    ctx.quadraticCurveTo(8, 7, 10, 7);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(20, 12);
    ctx.lineTo(23, 12);
    ctx.quadraticCurveTo(25, 12, 25, 14);
    ctx.lineTo(25, 22);
    ctx.lineTo(23, 22);
    ctx.lineTo(23, 15);
    ctx.lineTo(20, 15);
    ctx.closePath();
    ctx.fill();
  },
  parking(ctx) {
    ctx.beginPath();
    const r = 4;
    const x = 5;
    const y = 5;
    const w = 22;
    const h = 22;
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.font = "bold 18px sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("P", 16, 17);
    ctx.restore();
  },
  hospital(ctx) {
    ctx.fillRect(13, 6, 6, 20);
    ctx.fillRect(6, 13, 20, 6);
  },
  school(ctx) {
    ctx.beginPath();
    ctx.moveTo(16, 8);
    ctx.lineTo(28, 13);
    ctx.lineTo(16, 18);
    ctx.lineTo(4, 13);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(10, 17, 12, 5);
    ctx.fillRect(25, 13, 1.4, 8);
    ctx.beginPath();
    ctx.arc(25.7, 22, 1.5, 0, Math.PI * 2);
    ctx.fill();
  },
  shop(ctx) {
    ctx.beginPath();
    ctx.moveTo(8, 12);
    ctx.lineTo(24, 12);
    ctx.lineTo(25.5, 26);
    ctx.lineTo(6.5, 26);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    ctx.moveTo(12, 12);
    ctx.quadraticCurveTo(12, 6, 16, 6);
    ctx.quadraticCurveTo(20, 6, 20, 12);
    ctx.stroke();
  },
  monument(ctx) {
    ctx.beginPath();
    ctx.moveTo(16, 5);
    ctx.lineTo(20, 22);
    ctx.lineTo(12, 22);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(9, 22, 14, 3);
    ctx.fillRect(7, 25, 18, 2);
  },
  viewpoint(ctx) {
    ctx.beginPath();
    ctx.moveTo(4, 25);
    ctx.lineTo(12, 11);
    ctx.lineTo(17, 19);
    ctx.lineTo(20, 14);
    ctx.lineTo(28, 25);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.arc(22, 9, 2.2, 0, Math.PI * 2);
    ctx.fill();
  },
  park(ctx) {
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.lineTo(24, 18);
    ctx.lineTo(20, 18);
    ctx.lineTo(26, 24);
    ctx.lineTo(6, 24);
    ctx.lineTo(12, 18);
    ctx.lineTo(8, 18);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(14.5, 24, 3, 4);
  },
  museum(ctx) {
    ctx.beginPath();
    ctx.moveTo(4, 11);
    ctx.lineTo(16, 5);
    ctx.lineTo(28, 11);
    ctx.lineTo(28, 13);
    ctx.lineTo(4, 13);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(6, 13, 3, 11);
    ctx.fillRect(12, 13, 3, 11);
    ctx.fillRect(17, 13, 3, 11);
    ctx.fillRect(23, 13, 3, 11);
    ctx.fillRect(3, 24, 26, 3);
  },
  theatre(ctx) {
    ctx.beginPath();
    ctx.ellipse(16, 16, 10, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.ellipse(12, 14, 1.8, 2.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(20, 14, 1.8, 2.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(11, 19);
    ctx.quadraticCurveTo(16, 24, 21, 19);
    ctx.quadraticCurveTo(16, 22, 11, 19);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
  water(ctx) {
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.quadraticCurveTo(26, 16, 22, 23);
    ctx.quadraticCurveTo(18, 28, 16, 28);
    ctx.quadraticCurveTo(14, 28, 10, 23);
    ctx.quadraticCurveTo(6, 16, 16, 4);
    ctx.closePath();
    ctx.fill();
  },
  flag(ctx) {
    ctx.fillRect(7, 4, 1.8, 24);
    ctx.beginPath();
    ctx.moveTo(8.8, 5);
    ctx.lineTo(24, 8);
    ctx.lineTo(18, 12);
    ctx.lineTo(24, 16);
    ctx.lineTo(8.8, 16);
    ctx.closePath();
    ctx.fill();
  },
  star(ctx) {
    const cx = 16;
    const cy = 16;
    const outer = 11;
    const inner = 4.5;
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? outer : inner;
      const x = cx + rad * Math.cos(angle);
      const y = cy + rad * Math.sin(angle);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  },
  heart(ctx) {
    ctx.beginPath();
    ctx.moveTo(16, 26);
    ctx.bezierCurveTo(3, 17, 7, 5, 16, 11);
    ctx.bezierCurveTo(25, 5, 29, 17, 16, 26);
    ctx.closePath();
    ctx.fill();
  },
  pin(ctx) {
    ctx.beginPath();
    ctx.moveTo(16, 4);
    ctx.bezierCurveTo(22, 4, 26, 9, 26, 14);
    ctx.bezierCurveTo(26, 21, 16, 28, 16, 28);
    ctx.bezierCurveTo(16, 28, 6, 21, 6, 14);
    ctx.bezierCurveTo(6, 9, 10, 4, 16, 4);
    ctx.closePath();
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(16, 14, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  },
  bike(ctx) {
    ctx.lineWidth = 1.6;
    ctx.strokeStyle = ctx.fillStyle;
    ctx.beginPath();
    ctx.arc(8, 21, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(24, 21, 5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(8, 21, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(24, 21, 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(8, 21);
    ctx.lineTo(15, 11);
    ctx.lineTo(20, 21);
    ctx.lineTo(24, 21);
    ctx.lineTo(20, 11);
    ctx.lineTo(13, 11);
    ctx.stroke();
  },
};

/** Draw a built-in shape silhouette into a 0..32 grid. */
function drawShape(ctx: CanvasRenderingContext2D, shape: string): void {
  const c = 16;
  const r = 32 * 0.42;
  ctx.beginPath();
  if (shape === "square") {
    ctx.rect(c - r, c - r, r * 2, r * 2);
  } else if (shape === "triangle") {
    ctx.moveTo(c, c - r);
    ctx.lineTo(c + r * 0.95, c + r * 0.7);
    ctx.lineTo(c - r * 0.95, c + r * 0.7);
    ctx.closePath();
  }
  ctx.fill();
}

/** Render a glyph (Maki or built-in shape) to a canvas, tinted `color`. Used
 *  by the picker UI so swatches match what the map draws. */
export function drawGlyphToCanvas(
  canvas: HTMLCanvasElement,
  shape: string,
  color: string,
  cssSize: number,
): void {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(cssSize * dpr);
  canvas.height = Math.round(cssSize * dpr);
  canvas.style.width = `${cssSize}px`;
  canvas.style.height = `${cssSize}px`;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = color;
  ctx.scale((cssSize * dpr) / 32, (cssSize * dpr) / 32);
  const drawer = OVERLAY_ICON_DRAWERS[shape as MakiId];
  if (drawer) drawer(ctx);
  else if (shape === "square" || shape === "triangle") drawShape(ctx, shape);
}

/** Build white-filled SDF ImageData for a glyph (for map.addImage). */
function glyphImageData(shape: string): ImageData | null {
  const size = 32;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = "#fff";
  const drawer = OVERLAY_ICON_DRAWERS[shape as MakiId];
  if (drawer) drawer(ctx);
  else drawShape(ctx, shape);
  return ctx.getImageData(0, 0, size, size);
}

/** Image name for a point shape. Circles use a `circle` layer, not an image. */
export function iconImageName(shape: string): string {
  return isMakiShape(shape) ? `ovl-maki-${shape}` : `ovl-shape-${shape}`;
}

/** Register every overlay SDF image on the map. Idempotent — safe to call on
 *  each style swap (a `setStyle` wipes registered images). */
export function ensureOverlayIcons(map: MaplibreMap): void {
  for (const shape of BUILTIN_SHAPES) {
    const id = `ovl-shape-${shape}`;
    if (map.hasImage(id)) continue;
    const data = glyphImageData(shape);
    if (data) {
      try {
        map.addImage(id, data, { sdf: true });
      } catch {
        /* image already present */
      }
    }
  }
  for (const [makiId] of OVERLAY_ICON_SET) {
    const id = `ovl-maki-${makiId}`;
    if (map.hasImage(id)) continue;
    const data = glyphImageData(makiId);
    if (data) {
      try {
        map.addImage(id, data, { sdf: true });
      } catch {
        /* image already present */
      }
    }
  }
}
