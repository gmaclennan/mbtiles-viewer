import { html, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { LightElement } from "./lit-base.ts";
import type { GeoBbox } from "./bbox-map.ts";

type Side = "north" | "south" | "east" | "west";

export interface BoundsPanelOptions {
  /** Called when the user commits a new bound. The handler is expected to clamp
   *  and propagate; the returned GeoBbox is what the panel re-displays. */
  onApply: (next: GeoBbox) => GeoBbox | null;
  /** Used to compute the smallest valid span at the current zoom. */
  getMinGeoSpan: () => { lat: number; lon: number };
  /** Lock the bbox to its current geo extent. */
  onLock: () => void;
  /** Release the lock (and refit the map). */
  onUnlock: () => void;
}

/** Padlock glyph — closed shackle (locked) or open shackle (unlocked). */
function lockGlyph(closed: boolean): TemplateResult {
  const shackle = closed
    ? html`<path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />`
    : html`<path d="M4 5.5V4a2 2 0 0 1 3.7-1.05" />`;
  return html`<svg class="bounds-lock-glyph" viewBox="0 0 12 12" fill="none"
    stroke="currentColor" stroke-width="1.4" stroke-linecap="round"
    stroke-linejoin="round">
    <rect x="2.5" y="5.5" width="7" height="5" rx="1" />${shackle}
  </svg>`;
}

/** Inline W/S/E/N bounds editor with a Lock button.
 *
 *  Locked = map-only lock: the bbox is anchored to geo coordinates and follows
 *  the map on screen. The inputs stay editable when locked — edits flow into
 *  the locked bounds directly. */
export class BoundsPanel extends LightElement {
  static properties = {
    geo: { state: true },
    isOpen: { state: true },
    locked: { state: true },
  };

  declare geo: GeoBbox | null;
  declare isOpen: boolean;
  declare locked: boolean;

  private opts!: BoundsPanelOptions;
  /** The four edge inputs — plain widgets whose `.el` nodes are interpolated
   *  into the template (so Lit reuses them and never clobbers an in-flight
   *  edit). Created once, in the constructor. */
  private fields!: Record<Side, BoundField>;

  constructor() {
    super();
    this.geo = null;
    this.isOpen = false;
    this.locked = false;
    this.fields = {
      west: new BoundField("W", "lon", (raw) => this.commit("west", raw)),
      south: new BoundField("S", "lat", (raw) => this.commit("south", raw)),
      east: new BoundField("E", "lon", (raw) => this.commit("east", raw)),
      north: new BoundField("N", "lat", (raw) => this.commit("north", raw)),
    };
  }

  /** Inject runtime options. Custom-element constructors take no arguments. */
  init(opts: BoundsPanelOptions): this {
    this.opts = opts;
    return this;
  }

  get el(): this {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("bounds-panel");
  }

  setGeoBbox(geo: GeoBbox | null) {
    this.geo = geo;
    for (const side of ["west", "south", "east", "north"] as Side[]) {
      this.fields[side].setValue(geo ? geo[side] : null);
    }
  }

  /** Reflect the lock state — swaps the header glyph and the Lock button. */
  setLocked(locked: boolean) {
    this.locked = locked;
  }

  /** Collapse the panel (used after Unlock). */
  collapse() {
    this.isOpen = false;
  }

  private toggle() {
    this.isOpen = !this.isOpen;
  }

  /** Header icon — padlock when locked, otherwise a chevron that points down
   *  when open and right when collapsed. */
  private headerIcon(): TemplateResult {
    if (this.locked) return lockGlyph(true);
    return html`<svg class="bounds-chevron" viewBox="0 0 10 10" fill="none"
      stroke="currentColor" stroke-width="1.6"
      style="transform:rotate(${this.isOpen ? 0 : -90}deg)">
      <path d="M2 4l3 3 3-3" />
    </svg>`;
  }

  /** Comma-joined summary — duplicates the inputs, so only shown collapsed. */
  private summaryText(): string {
    const g = this.geo;
    return g
      ? [g.west, g.south, g.east, g.north].map((n) => n.toFixed(4)).join(", ")
      : "—";
  }

  render() {
    return html`
      <button
        type="button"
        class=${classMap({
          "bounds-toggle": true,
          "bounds-toggle-locked": this.locked,
        })}
        @click=${() => this.toggle()}
      >
        <span class="bounds-toggle-icon">${this.headerIcon()}</span>
        <span class="bounds-label"
          >${this.locked ? "Bounds locked" : "Bounds"}</span
        >
        <span
          class="bounds-summary"
          style=${this.isOpen ? "display:none" : "display:inline"}
          >${this.summaryText()}</span
        >
      </button>
      <div
        class="bounds-content"
        style=${this.isOpen ? "display:block" : "display:none"}
      >
        <div class="bounds-row-grid">
          ${this.fields.west.el} ${this.fields.south.el}
          ${this.fields.east.el} ${this.fields.north.el}
        </div>
        <div class="bounds-lock-row">
          <button
            type="button"
            class=${classMap({
              "bounds-lock-btn": true,
              "bounds-lock-btn-active": this.locked,
            })}
            @click=${() =>
              this.locked ? this.opts.onUnlock() : this.opts.onLock()}
          >
            ${this.locked
              ? html`${lockGlyph(false)}<span>Unlock</span>`
              : html`${lockGlyph(true)}<span>Lock bounds</span>`}
          </button>
        </div>
      </div>
    `;
  }

  /** Apply a single committed edge value, smart-adjusting the opposite edge so
   *  the bbox keeps at least the current min-screen-size span. */
  private commit(side: Side, raw: string) {
    if (!this.geo) return;
    const v = Number(raw);
    if (!Number.isFinite(v)) return;
    const next: GeoBbox = { ...this.geo };
    const min = this.opts.getMinGeoSpan();
    if (side === "north") {
      next.north = clamp(v, -90, 90);
      if (next.north - next.south < min.lat) next.south = next.north - min.lat;
    } else if (side === "south") {
      next.south = clamp(v, -90, 90);
      if (next.north - next.south < min.lat) next.north = next.south + min.lat;
    } else if (side === "east") {
      next.east = clamp(v, -180, 180);
      if (next.east - next.west < min.lon) next.west = next.east - min.lon;
    } else if (side === "west") {
      next.west = clamp(v, -180, 180);
      if (next.east - next.west < min.lon) next.east = next.west + min.lon;
    }
    const result = this.opts.onApply(next);
    if (result) this.setGeoBbox(result);
  }
}

if (!customElements.get("bounds-panel")) {
  customElements.define("bounds-panel", BoundsPanel);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A single edge input: a cardinal label + number field. Holds a local draft
 *  string while editing; commits on blur / Enter, reverts on Escape. Kept as a
 *  plain widget — BoundsPanel interpolates its `.el` node into the template. */
class BoundField {
  readonly el: HTMLLabelElement;
  private input: HTMLInputElement;
  private axis: "lat" | "lon";
  private value: number | null = null;
  private onCommit: (raw: string) => void;

  constructor(
    label: string,
    axis: "lat" | "lon",
    onCommit: (raw: string) => void,
  ) {
    this.axis = axis;
    this.onCommit = onCommit;

    this.el = document.createElement("label");
    this.el.className = "bounds-field";

    const labelEl = document.createElement("span");
    labelEl.className = "bounds-field-label";
    labelEl.textContent = label;
    this.el.appendChild(labelEl);

    this.input = document.createElement("input");
    this.input.type = "number";
    this.input.step = "0.0001";
    this.input.className = "bounds-input";
    this.input.addEventListener("blur", () => this.commit());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.input.blur();
      if (e.key === "Escape") {
        this.input.value = fmt(this.value);
        this.input.classList.remove("bounds-input-error");
        this.input.blur();
      }
    });
    this.el.appendChild(this.input);
  }

  setValue(v: number | null) {
    this.value = v;
    // Don't clobber an in-progress edit.
    if (document.activeElement !== this.input) {
      this.input.value = fmt(v);
      this.input.classList.remove("bounds-input-error");
    }
  }

  private commit() {
    const raw = this.input.value.trim();
    const n = Number(raw);
    const range: [number, number] =
      this.axis === "lat" ? [-90, 90] : [-180, 180];
    if (
      raw === "" ||
      raw === "-" ||
      !Number.isFinite(n) ||
      n < range[0] ||
      n > range[1]
    ) {
      this.input.classList.add("bounds-input-error");
      return;
    }
    this.input.classList.remove("bounds-input-error");
    if (n !== this.value) this.onCommit(raw);
  }
}

function fmt(n: number | null): string {
  return n != null && Number.isFinite(n) ? n.toFixed(4) : "";
}
