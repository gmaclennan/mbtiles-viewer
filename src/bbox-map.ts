import maplibregl, {
  Map as MaplibreMap,
  type LngLatBoundsLike,
  type StyleSpecification,
} from "maplibre-gl";
import { buildMapStyle, type AppStyle } from "./preset-styles.ts";

export interface GeoBbox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export interface BboxMapOptions {
  container: HTMLElement;
  initialStyle: AppStyle;
  initialCenter?: [number, number];
  initialZoom?: number;
  /** When true, disables resize handles (mobile). */
  enableResize?: boolean;
  /** Pixels reserved at the bottom for overlay UI when computing the inset bbox. */
  bottomInset?: number;
  /** When set, the bbox is locked to a fixed geo extent (download-modal preview). */
  lockedGeoBbox?: GeoBbox | null;
  /** Disable user zoom gestures (download-modal preview). */
  lockZoom?: boolean;
  /** Bbox color id; falls back to white. */
  bboxColor?: keyof typeof BBOX_COLORS;
  /** Notified whenever the geo bbox changes (drag, resize, map move). */
  onBboxChange?: (geo: GeoBbox) => void;
  /** Notified whenever the map view state changes (zoom/center). */
  onMapStateChange?: (state: { zoom: number; center: [number, number] }) => void;
}

/** Pixel margin around the bbox, equal on all four sides of the usable area.
 *  Picked from the smaller container axis so portrait/landscape both look right. */
const INSET_FRACTION = 0.1;
const INSET_MIN_PX = 40;
const INSET_MAX_PX = 120;

/** Minimum bbox edge length in screen px during a drag. */
const MIN_SIZE = 60;

export const BBOX_COLORS = {
  white: { fill: "rgba(255,255,255,.95)", outline: "rgba(0,0,0,.55)" },
  yellow: { fill: "#ffd400", outline: "rgba(0,0,0,.7)" },
  cyan: { fill: "#00e5ff", outline: "rgba(0,0,0,.55)" },
  magenta: { fill: "#ff2db5", outline: "rgba(0,0,0,.55)" },
  lime: { fill: "#a4ff00", outline: "rgba(0,0,0,.7)" },
  orange: { fill: "#ff8a1a", outline: "rgba(0,0,0,.55)" },
} as const;

interface ScreenBbox {
  l: number;
  t: number;
  r: number;
  b: number;
}

const HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"] as const;
type HandleKey = (typeof HANDLES)[number];

export class BboxMap {
  readonly map: MaplibreMap;
  readonly container: HTMLElement;
  private mapEl: HTMLDivElement;
  private overlayEl: HTMLDivElement;
  private dimEls: HTMLDivElement[] = [];
  private strokeEl: HTMLDivElement;
  private handleEls: Map<HandleKey, HTMLDivElement> = new Map();
  private resizeObserver: ResizeObserver;
  private bbox: ScreenBbox | null = null;
  private opts: Required<
    Pick<BboxMapOptions, "enableResize" | "bottomInset" | "bboxColor">
  > & { lockedGeoBbox: GeoBbox | null; lockZoom: boolean };
  private currentStyle: AppStyle;
  private mapReady = false;
  private onBboxChange?: (geo: GeoBbox) => void;
  private onMapStateChange?: (state: {
    zoom: number;
    center: [number, number];
  }) => void;
  private destroyed = false;
  /** Geo bbox we follow while a fitBounds animation is in flight (refit). */
  private trackingGeo: GeoBbox | null = null;

  constructor(options: BboxMapOptions) {
    this.container = options.container;
    this.currentStyle = options.initialStyle;
    this.onBboxChange = options.onBboxChange;
    this.onMapStateChange = options.onMapStateChange;
    this.opts = {
      enableResize: options.enableResize ?? true,
      bottomInset: options.bottomInset ?? 0,
      bboxColor: options.bboxColor ?? "white",
      lockedGeoBbox: options.lockedGeoBbox ?? null,
      lockZoom: options.lockZoom ?? false,
    };

    this.container.classList.add("bbox-map-root");
    this.mapEl = document.createElement("div");
    this.mapEl.className = "bbox-map-canvas";
    this.container.appendChild(this.mapEl);

    this.overlayEl = document.createElement("div");
    this.overlayEl.className = "bbox-map-overlay";
    this.container.appendChild(this.overlayEl);

    for (let i = 0; i < 4; i++) {
      const dim = document.createElement("div");
      dim.className = "bbox-dim";
      this.overlayEl.appendChild(dim);
      this.dimEls.push(dim);
    }

    this.strokeEl = document.createElement("div");
    this.strokeEl.className = "bbox-stroke";
    this.overlayEl.appendChild(this.strokeEl);

    if (this.opts.enableResize) {
      for (const k of HANDLES) {
        const h = document.createElement("div");
        h.className = `bbox-handle bbox-handle-${k}`;
        h.dataset.handle = k;
        h.addEventListener("pointerdown", (e) =>
          this.startHandleDrag(k, e),
        );
        this.overlayEl.appendChild(h);
        this.handleEls.set(k, h);
      }
    }

    this.map = new maplibregl.Map({
      container: this.mapEl,
      style: buildMapStyle(this.currentStyle) as
        | string
        | StyleSpecification,
      center: options.initialCenter ?? [-0.118, 51.509],
      zoom: options.initialZoom ?? 2,
      attributionControl: false,
      maxZoom: 18,
      dragRotate: false,
      pitchWithRotate: false,
    });

    if (this.opts.lockZoom) {
      this.map.scrollZoom.disable();
      this.map.doubleClickZoom.disable();
      this.map.touchZoomRotate.disable();
      this.map.boxZoom.disable();
      this.map.keyboard.disable();
    }

    this.map.on("load", () => {
      this.mapReady = true;
      // Resize once on load — guards against the case where the container had
      // not laid out yet when MapLibre first measured it.
      this.map.resize();
      requestAnimationFrame(() => {
        if (this.opts.lockedGeoBbox) {
          this.syncBboxFromGeo();
        } else {
          this.resetBboxToInset();
        }
      });
    });

    const reportMapState = () => {
      if (!this.onMapStateChange) return;
      const c = this.map.getCenter();
      this.onMapStateChange({ zoom: this.map.getZoom(), center: [c.lng, c.lat] });
    };
    this.map.on("move", () => {
      reportMapState();
      if (this.opts.lockedGeoBbox) {
        this.syncBboxFromGeo();
      } else if (this.trackingGeo) {
        // Animated refit in progress — reproject the released geo bbox each
        // frame so the screen bbox follows the map.
        this.bbox = this.projectGeo(this.trackingGeo);
        this.renderBbox();
        this.reportGeoBbox();
      } else {
        this.reportGeoBbox();
      }
    });
    this.map.on("zoom", () => {
      if (this.opts.lockedGeoBbox) this.syncBboxFromGeo();
    });

    this.resizeObserver = new ResizeObserver(() => {
      this.map.resize();
      if (this.opts.lockedGeoBbox) {
        this.syncBboxFromGeo();
      } else {
        this.reclampBbox();
        this.renderBbox();
      }
    });
    this.resizeObserver.observe(this.container);
  }

  destroy() {
    this.destroyed = true;
    this.resizeObserver.disconnect();
    this.map.remove();
    this.container.classList.remove("bbox-map-root");
    this.mapEl.remove();
    this.overlayEl.remove();
  }

  /** Replace the active style. */
  setStyle(style: AppStyle) {
    this.currentStyle = style;
    try {
      this.map.setStyle(buildMapStyle(style) as string | StyleSpecification);
    } catch (err) {
      console.warn("setStyle failed", err);
    }
  }

  /** Fit bounds and let the map settle, then re-inset the screen bbox. */
  fitBounds(bounds: LngLatBoundsLike, animate = true) {
    this.map.fitBounds(bounds, { padding: 40, animate });
    if (animate) {
      this.map.once("moveend", () => this.resetBboxToInset());
    } else {
      this.resetBboxToInset();
    }
  }

  /** Returns the current geo bbox, or null if not yet initialized. */
  getGeoBbox(): GeoBbox | null {
    if (!this.bbox) return null;
    return this.geoFromScreen(this.bbox);
  }

  /** Set the bbox in geo-space without changing the map view. */
  setGeoBboxExact(geo: GeoBbox): GeoBbox | null {
    if (!this.mapReady) return null;
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const nw = this.map.project([geo.west, geo.north]);
    const se = this.map.project([geo.east, geo.south]);
    let l = nw.x;
    let t = nw.y;
    let r = se.x;
    let b = se.y;
    l = Math.max(0, Math.min(cw - MIN_SIZE, l));
    r = Math.max(l + MIN_SIZE, Math.min(cw, r));
    t = Math.max(0, Math.min(ch - MIN_SIZE, t));
    b = Math.max(t + MIN_SIZE, Math.min(ch, b));
    this.bbox = { l, t, r, b };
    this.renderBbox();
    const result = this.geoFromScreen(this.bbox);
    this.onBboxChange?.(result);
    return result;
  }

  /** Smallest geo span that keeps the bbox at MIN_SIZE px in each axis at the current zoom. */
  getMinGeoSpan(): { lat: number; lon: number } {
    if (!this.bbox) return { lat: 0.001, lon: 0.001 };
    const w = Math.max(1, this.bbox.r - this.bbox.l);
    const h = Math.max(1, this.bbox.b - this.bbox.t);
    const nw = this.map.unproject([this.bbox.l, this.bbox.t]);
    const se = this.map.unproject([this.bbox.r, this.bbox.b]);
    return {
      lat: (Math.abs(nw.lat - se.lat) / h) * MIN_SIZE,
      lon: (Math.abs(se.lng - nw.lng) / w) * MIN_SIZE,
    };
  }

  /** Update bottom inset (e.g. when mobile card height changes). Re-runs the inset reset. */
  setBottomInset(px: number) {
    this.opts.bottomInset = px;
    if (!this.opts.lockedGeoBbox) this.resetBboxToInset();
  }

  /** True while the bbox is locked to a fixed geo extent. */
  isLocked(): boolean {
    return this.opts.lockedGeoBbox != null;
  }

  /** Lock the bbox to its current geo extent. While locked the bbox stays
   *  anchored to lat/lon and follows the map on screen; resize handles are
   *  disabled. Returns the captured geo bounds. */
  lockBounds(): GeoBbox | null {
    const geo = this.getGeoBbox();
    if (!geo) return null;
    this.opts.lockedGeoBbox = geo;
    this.overlayEl.classList.add("bbox-locked");
    this.syncBboxFromGeo();
    return geo;
  }

  /** Update the locked geo extent (e.g. from the bounds inputs) and re-project
   *  the on-screen bbox. No-op when the bbox isn't locked. */
  setLockedGeoBbox(geo: GeoBbox): GeoBbox | null {
    if (!this.opts.lockedGeoBbox) return null;
    this.opts.lockedGeoBbox = geo;
    this.syncBboxFromGeo();
    this.onBboxChange?.(geo);
    return geo;
  }

  /** Clear the lock, re-enable resize handles, and animate the map so the
   *  just-unlocked bounds fill the viewport at the standard inset margin —
   *  the same rule used after a manual resize-then-release. */
  unlockAndRefit() {
    const geo = this.opts.lockedGeoBbox;
    this.opts.lockedGeoBbox = null;
    this.overlayEl.classList.remove("bbox-locked");
    if (!geo) return;
    if (!this.mapReady) {
      this.resetBboxToInset();
      return;
    }
    const inset = this.computeInsetPx();
    const screen = this.projectGeo(geo);
    const bbW = Math.abs(screen.r - screen.l);
    const bbH = Math.abs(screen.b - screen.t);
    this.trackingGeo = geo;
    this.map.fitBounds(
      [
        [geo.west, geo.south],
        [geo.east, geo.north],
      ],
      {
        padding: {
          top: inset,
          left: inset,
          right: inset,
          bottom: inset + this.opts.bottomInset,
        },
        animate: true,
        duration: 600,
      },
    );
    this.map.once("moveend", () => {
      this.trackingGeo = null;
      this.resetBboxToInset({ w: bbW, h: bbH });
    });
  }

  /** Re-fit the map so the current bbox settles at the standard inset margin —
   *  the same animation the map does after a mouse resize. Used after the
   *  bounds inputs commit a new extent. */
  refitToBbox() {
    if (!this.mapReady) return;
    if (this.opts.lockedGeoBbox) {
      // Locked: pan/zoom so the locked extent fills the viewport at the inset.
      // The bbox follows the map automatically (the move handler re-syncs it).
      const geo = this.opts.lockedGeoBbox;
      const inset = this.computeInsetPx();
      this.map.fitBounds(
        [
          [geo.west, geo.south],
          [geo.east, geo.north],
        ],
        {
          padding: {
            top: inset,
            left: inset,
            right: inset,
            bottom: inset + this.opts.bottomInset,
          },
          animate: true,
          duration: 600,
        },
      );
    } else {
      this.maybeRefit();
    }
  }

  // ─── internals ──────────────────────────────────────────────────────────

  /** Equal pixel margin used on all four sides of the usable area. */
  private computeInsetPx(): number {
    const w = this.container.clientWidth;
    const usableH = Math.max(0, this.container.clientHeight - this.opts.bottomInset);
    const minDim = Math.max(0, Math.min(w, usableH));
    return Math.max(INSET_MIN_PX, Math.min(INSET_MAX_PX, minDim * INSET_FRACTION));
  }

  private projectGeo(geo: GeoBbox): ScreenBbox {
    const nw = this.map.project([geo.west, geo.north]);
    const se = this.map.project([geo.east, geo.south]);
    return { l: nw.x, t: nw.y, r: se.x, b: se.y };
  }

  private resetBboxToInset(aspect?: { w: number; h: number }) {
    if (this.destroyed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const usableH = h - this.opts.bottomInset;
    const inset = this.computeInsetPx();
    let bw: number;
    let bh: number;
    if (aspect && aspect.w && aspect.h) {
      const ratio = aspect.w / aspect.h;
      const maxW = Math.max(MIN_SIZE, w - 2 * inset);
      const maxH = Math.max(MIN_SIZE, usableH - 2 * inset);
      if (maxW / ratio <= maxH) {
        bw = maxW;
        bh = maxW / ratio;
      } else {
        bh = maxH;
        bw = maxH * ratio;
      }
    } else {
      bw = Math.max(MIN_SIZE, w - 2 * inset);
      bh = Math.max(MIN_SIZE, usableH - 2 * inset);
    }
    const cx = w / 2;
    const cy = usableH / 2;
    this.bbox = {
      l: cx - bw / 2,
      t: cy - bh / 2,
      r: cx + bw / 2,
      b: cy + bh / 2,
    };
    this.renderBbox();
    this.reportGeoBbox();
  }

  private syncBboxFromGeo() {
    const geo = this.opts.lockedGeoBbox;
    if (!geo || !this.mapReady) return;
    this.bbox = this.projectGeo(geo);
    this.renderBbox();
  }

  private reclampBbox() {
    if (!this.bbox) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.bbox.l = Math.max(0, Math.min(this.bbox.l, w - MIN_SIZE));
    this.bbox.r = Math.max(this.bbox.l + MIN_SIZE, Math.min(this.bbox.r, w));
    this.bbox.t = Math.max(0, Math.min(this.bbox.t, h - MIN_SIZE));
    this.bbox.b = Math.max(this.bbox.t + MIN_SIZE, Math.min(this.bbox.b, h));
  }

  private geoFromScreen(b: ScreenBbox): GeoBbox {
    const nw = this.map.unproject([b.l, b.t]);
    const se = this.map.unproject([b.r, b.b]);
    return {
      west: Math.min(nw.lng, se.lng),
      south: Math.min(nw.lat, se.lat),
      east: Math.max(nw.lng, se.lng),
      north: Math.max(nw.lat, se.lat),
    };
  }

  private reportGeoBbox() {
    if (!this.bbox || !this.mapReady) return;
    this.onBboxChange?.(this.geoFromScreen(this.bbox));
  }

  private renderBbox() {
    if (!this.bbox) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const { l, t, r, b } = this.bbox;
    const colors = BBOX_COLORS[this.opts.bboxColor];

    // Dim panels: top, bottom, left middle, right middle.
    const rects = [
      { left: 0, top: 0, width: w, height: Math.max(0, t) },
      { left: 0, top: b, width: w, height: Math.max(0, h - b) },
      { left: 0, top: t, width: Math.max(0, l), height: Math.max(0, b - t) },
      {
        left: r,
        top: t,
        width: Math.max(0, w - r),
        height: Math.max(0, b - t),
      },
    ];
    rects.forEach((rect, i) => {
      const el = this.dimEls[i];
      el.style.left = `${rect.left}px`;
      el.style.top = `${rect.top}px`;
      el.style.width = `${rect.width}px`;
      el.style.height = `${rect.height}px`;
    });

    this.strokeEl.style.left = `${l}px`;
    this.strokeEl.style.top = `${t}px`;
    this.strokeEl.style.width = `${r - l}px`;
    this.strokeEl.style.height = `${b - t}px`;
    this.strokeEl.style.boxShadow = `0 0 0 1px ${colors.outline}, 0 0 0 3px ${colors.fill}, 0 0 0 4px ${colors.outline}`;

    const cx = (l + r) / 2;
    const cy = (t + b) / 2;
    // The bbox stroke is rendered as an outset 4px box-shadow ring (1px outline +
    // 2px fill + 1px outline), so the visual center of the line is 2px _outside_
    // the box geometry. Offset handles by that amount so they sit centered on the
    // visible stroke instead of flush with its inner edge.
    const SO = 2;
    const positions: Record<HandleKey, { x: number; y: number }> = {
      n: { x: cx, y: t - SO },
      s: { x: cx, y: b + SO },
      e: { x: r + SO, y: cy },
      w: { x: l - SO, y: cy },
      ne: { x: r + SO, y: t - SO },
      nw: { x: l - SO, y: t - SO },
      se: { x: r + SO, y: b + SO },
      sw: { x: l - SO, y: b + SO },
    };
    for (const [k, hEl] of this.handleEls) {
      const p = positions[k];
      hEl.style.left = `${p.x}px`;
      hEl.style.top = `${p.y}px`;
    }
  }

  private startHandleDrag(handle: HandleKey, e: PointerEvent) {
    if (!this.opts.enableResize || this.opts.lockedGeoBbox || !this.bbox) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const start = { ...this.bbox };
    const cw = this.container.clientWidth;
    const ch = this.container.clientHeight;
    const cx = (start.l + start.r) / 2;
    const cy = (start.t + start.b) / 2;

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      let l = start.l;
      let t = start.t;
      let r = start.r;
      let b = start.b;
      // Symmetric resize from center
      if (handle.includes("e")) {
        r = start.r + dx;
        l = 2 * cx - r;
      }
      if (handle.includes("w")) {
        l = start.l + dx;
        r = 2 * cx - l;
      }
      if (handle.includes("s")) {
        b = start.b + dy;
        t = 2 * cy - b;
      }
      if (handle.includes("n")) {
        t = start.t + dy;
        b = 2 * cy - t;
      }
      // Clamp to container with min size
      l = Math.max(0, Math.min(cx - MIN_SIZE / 2, l));
      r = Math.min(cw, Math.max(cx + MIN_SIZE / 2, r));
      t = Math.max(0, Math.min(cy - MIN_SIZE / 2, t));
      b = Math.min(ch, Math.max(cy + MIN_SIZE / 2, b));
      // Re-symmetrize after clamp
      const halfW = Math.min(cx - l, r - cx);
      const halfH = Math.min(cy - t, b - cy);
      this.bbox = {
        l: cx - halfW,
        t: cy - halfH,
        r: cx + halfW,
        b: cy + halfH,
      };
      this.renderBbox();
      this.reportGeoBbox();
    };

    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      setTimeout(() => this.maybeRefit(), 60);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  /** After release, refit the map so the bbox sits at the inset margin again.
   *  Triggered when the bbox is shrunk on all sides OR expanded toward the
   *  window edge past the inset. The bbox tracks the map during the animation. */
  private maybeRefit() {
    if (!this.bbox || !this.mapReady) return;
    const inset = this.computeInsetPx();
    const tol = 2;

    // Symmetric resize keeps marginL≈marginR and marginT≈marginB, so we
    // only need to inspect one of each pair.
    const marginX = this.bbox.l;
    const marginY = this.bbox.t;
    const minMargin = Math.min(marginX, marginY);

    // The bbox already fills one axis at exactly the inset margin → no refit.
    if (Math.abs(minMargin - inset) <= tol) return;

    // Both axes already at the inset on all sides (square-fit) → no refit.
    if (Math.abs(marginX - inset) <= tol && Math.abs(marginY - inset) <= tol) {
      return;
    }

    const bbW = this.bbox.r - this.bbox.l;
    const bbH = this.bbox.b - this.bbox.t;
    const geo = this.geoFromScreen(this.bbox);

    // Track this geo bbox during the animation so the screen bbox follows.
    this.trackingGeo = geo;

    this.map.fitBounds(
      [
        [geo.west, geo.south],
        [geo.east, geo.north],
      ],
      {
        padding: {
          top: inset,
          left: inset,
          right: inset,
          bottom: inset + this.opts.bottomInset,
        },
        animate: true,
        duration: 600,
      },
    );
    this.map.once("moveend", () => {
      this.trackingGeo = null;
      this.resetBboxToInset({ w: bbW, h: bbH });
    });
  }
}
