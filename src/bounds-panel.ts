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

const CHEVRON_SVG = '<path d="M2 4l3 3 3-3" />';
/** Padlock glyph — closed shackle (locked) or open shackle (unlocked). */
function lockGlyph(closed: boolean): string {
  const shackle = closed
    ? '<path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" />'
    : '<path d="M4 5.5V4a2 2 0 0 1 3.7-1.05" />';
  return `<svg class="bounds-lock-glyph" viewBox="0 0 12 12" fill="none"
    stroke="currentColor" stroke-width="1.4" stroke-linecap="round"
    stroke-linejoin="round"><rect x="2.5" y="5.5" width="7" height="5" rx="1" />${shackle}</svg>`;
}

/** Inline W/S/E/N bounds editor with a Lock button.
 *
 *  Locked = map-only lock: the bbox is anchored to geo coordinates and follows
 *  the map on screen. The inputs stay editable when locked — edits flow into
 *  the locked bounds directly. */
export class BoundsPanel {
  readonly el: HTMLDivElement;
  private toggleBtn: HTMLButtonElement;
  private iconEl: HTMLSpanElement;
  private labelEl: HTMLSpanElement;
  private summaryEl: HTMLSpanElement;
  private contentEl: HTMLDivElement;
  private lockBtn: HTMLButtonElement;
  private fields: Record<Side, BoundField> = {} as Record<Side, BoundField>;
  private opts: BoundsPanelOptions;
  private geo: GeoBbox | null = null;
  private isOpen = false;
  private locked = false;

  constructor(opts: BoundsPanelOptions) {
    this.opts = opts;

    this.el = document.createElement("div");
    this.el.className = "bounds-panel";

    this.toggleBtn = document.createElement("button");
    this.toggleBtn.type = "button";
    this.toggleBtn.className = "bounds-toggle";
    this.toggleBtn.addEventListener("click", () => this.toggle());

    this.iconEl = document.createElement("span");
    this.iconEl.className = "bounds-toggle-icon";
    this.toggleBtn.appendChild(this.iconEl);

    this.labelEl = document.createElement("span");
    this.labelEl.className = "bounds-label";
    this.toggleBtn.appendChild(this.labelEl);

    this.summaryEl = document.createElement("span");
    this.summaryEl.className = "bounds-summary";
    this.toggleBtn.appendChild(this.summaryEl);
    this.el.appendChild(this.toggleBtn);

    this.contentEl = document.createElement("div");
    this.contentEl.className = "bounds-content";
    this.contentEl.style.display = "none";
    this.el.appendChild(this.contentEl);

    const grid = document.createElement("div");
    grid.className = "bounds-row-grid";
    this.contentEl.appendChild(grid);
    // Inline row: W S E N.
    for (const [side, label, axis] of [
      ["west", "W", "lon"],
      ["south", "S", "lat"],
      ["east", "E", "lon"],
      ["north", "N", "lat"],
    ] as [Side, string, "lat" | "lon"][]) {
      const field = new BoundField(label, axis, (raw) =>
        this.commit(side, raw),
      );
      this.fields[side] = field;
      grid.appendChild(field.el);
    }

    const lockRow = document.createElement("div");
    lockRow.className = "bounds-lock-row";
    this.lockBtn = document.createElement("button");
    this.lockBtn.type = "button";
    this.lockBtn.className = "bounds-lock-btn";
    this.lockBtn.addEventListener("click", () => {
      if (this.locked) this.opts.onUnlock();
      else this.opts.onLock();
    });
    lockRow.appendChild(this.lockBtn);
    this.contentEl.appendChild(lockRow);

    this.renderHeader();
    this.renderLockBtn();
  }

  setGeoBbox(geo: GeoBbox | null) {
    this.geo = geo;
    for (const side of ["west", "south", "east", "north"] as Side[]) {
      this.fields[side].setValue(geo ? geo[side] : null);
    }
    this.renderHeader();
  }

  /** Reflect the lock state — swaps the header glyph and the Lock button. */
  setLocked(locked: boolean) {
    this.locked = locked;
    this.renderHeader();
    this.renderLockBtn();
  }

  /** Collapse the panel (used after Unlock). */
  collapse() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.applyOpenState();
  }

  private toggle() {
    this.isOpen = !this.isOpen;
    this.applyOpenState();
  }

  private applyOpenState() {
    this.contentEl.style.display = this.isOpen ? "block" : "none";
    this.renderHeader();
  }

  private renderHeader() {
    this.iconEl.innerHTML = this.locked
      ? lockGlyph(true)
      : `<svg class="bounds-chevron" viewBox="0 0 10 10" fill="none"
           stroke="currentColor" stroke-width="1.6"
           style="transform:rotate(${this.isOpen ? 0 : -90}deg)">${CHEVRON_SVG}</svg>`;
    this.labelEl.textContent = this.locked ? "Bounds locked" : "Bounds";
    this.toggleBtn.classList.toggle("bounds-toggle-locked", this.locked);
    // The comma-joined summary duplicates the inputs — only show it collapsed.
    const g = this.geo;
    this.summaryEl.textContent = g
      ? [g.west, g.south, g.east, g.north]
          .map((n) => n.toFixed(4))
          .join(", ")
      : "—";
    this.summaryEl.style.display = this.isOpen ? "none" : "inline";
  }

  private renderLockBtn() {
    this.lockBtn.classList.toggle("bounds-lock-btn-active", this.locked);
    this.lockBtn.innerHTML = this.locked
      ? `${lockGlyph(false)}<span>Unlock</span>`
      : `${lockGlyph(true)}<span>Lock bounds</span>`;
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

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** A single edge input: a cardinal label + number field. Holds a local draft
 *  string while editing; commits on blur / Enter, reverts on Escape. */
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
