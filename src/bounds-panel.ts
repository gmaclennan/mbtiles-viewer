import type { GeoBbox } from "./bbox-map.ts";

type Side = "north" | "south" | "east" | "west";

export interface BoundsPanelOptions {
  /** Called when the user commits a new bound. The handler is expected to clamp
   *  and propagate; the returned GeoBbox is what the panel re-displays. */
  onApply: (next: GeoBbox) => GeoBbox | null;
  /** Used to compute the smallest valid span at the current zoom. */
  getMinGeoSpan: () => { lat: number; lon: number };
}

export class BoundsPanel {
  readonly el: HTMLDivElement;
  private toggleBtn: HTMLButtonElement;
  private contentEl: HTMLDivElement;
  private summaryEl: HTMLSpanElement;
  private chevronEl: SVGSVGElement;
  private inputs: Record<Side, HTMLInputElement> = {} as any;
  private opts: BoundsPanelOptions;
  private geo: GeoBbox | null = null;
  private open = false;

  constructor(opts: BoundsPanelOptions) {
    this.opts = opts;

    this.el = document.createElement("div");
    this.el.className = "bounds-panel";

    this.toggleBtn = document.createElement("button");
    this.toggleBtn.type = "button";
    this.toggleBtn.className = "bounds-toggle";
    this.toggleBtn.addEventListener("click", () => this.toggle());

    this.chevronEl = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "svg",
    );
    this.chevronEl.setAttribute("viewBox", "0 0 10 10");
    this.chevronEl.setAttribute("class", "bounds-chevron");
    this.chevronEl.innerHTML = '<path d="M2 4l3 3 3-3" />';
    this.toggleBtn.appendChild(this.chevronEl);

    const labelEl = document.createElement("span");
    labelEl.className = "bounds-label";
    labelEl.textContent = "Bounds";
    this.toggleBtn.appendChild(labelEl);

    this.summaryEl = document.createElement("span");
    this.summaryEl.className = "bounds-summary";
    this.summaryEl.textContent = "—";
    this.toggleBtn.appendChild(this.summaryEl);

    this.el.appendChild(this.toggleBtn);

    this.contentEl = document.createElement("div");
    this.contentEl.className = "bounds-content";
    this.contentEl.style.display = "none";
    this.el.appendChild(this.contentEl);

    const grid = document.createElement("div");
    grid.className = "bounds-grid";
    this.contentEl.appendChild(grid);

    // Cross layout: row 1 [_,N,_], row 2 [W, indicator, E], row 3 [_,S,_]
    grid.appendChild(this.spacer());
    grid.appendChild(this.makeField("north", "N", "lat"));
    grid.appendChild(this.spacer());

    grid.appendChild(this.makeField("west", "W", "lon"));
    grid.appendChild(this.spacer());
    grid.appendChild(this.makeField("east", "E", "lon"));

    grid.appendChild(this.spacer());
    grid.appendChild(this.makeField("south", "S", "lat"));
    grid.appendChild(this.spacer());
  }

  setGeoBbox(geo: GeoBbox | null) {
    this.geo = geo;
    this.render();
  }

  private spacer() {
    const d = document.createElement("div");
    return d;
  }

  private makeField(side: Side, label: string, axis: "lat" | "lon") {
    const wrap = document.createElement("label");
    wrap.className = "bounds-field";

    const labelEl = document.createElement("span");
    labelEl.className = "bounds-field-label";
    labelEl.textContent = label;
    wrap.appendChild(labelEl);

    const input = document.createElement("input");
    input.type = "number";
    input.step = "0.0001";
    input.className = "bounds-input";
    input.addEventListener("blur", () => this.commit(side, axis, input));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
      if (e.key === "Escape") {
        input.value = this.geo ? formatBound(this.geo[side]) : "";
        input.blur();
      }
    });
    wrap.appendChild(input);
    this.inputs[side] = input;
    return wrap;
  }

  private commit(side: Side, axis: "lat" | "lon", input: HTMLInputElement) {
    if (!this.geo) return;
    const raw = input.value.trim();
    const v = Number(raw);
    if (raw === "" || raw === "-" || !Number.isFinite(v)) {
      input.classList.add("bounds-input-error");
      return;
    }
    const range: [number, number] = axis === "lat" ? [-90, 90] : [-180, 180];
    if (v < range[0] || v > range[1]) {
      input.classList.add("bounds-input-error");
      return;
    }
    input.classList.remove("bounds-input-error");

    const next: GeoBbox = { ...this.geo };
    const min = this.opts.getMinGeoSpan();
    if (side === "north") {
      next.north = v;
      if (next.north - next.south < min.lat) next.south = next.north - min.lat;
    } else if (side === "south") {
      next.south = v;
      if (next.north - next.south < min.lat) next.north = next.south + min.lat;
    } else if (side === "east") {
      next.east = v;
      if (next.east - next.west < min.lon) next.west = next.east - min.lon;
    } else if (side === "west") {
      next.west = v;
      if (next.east - next.west < min.lon) next.east = next.west + min.lon;
    }
    const result = this.opts.onApply(next);
    if (result) this.setGeoBbox(result);
  }

  private toggle() {
    this.open = !this.open;
    this.contentEl.style.display = this.open ? "grid" : "none";
    // Hide the comma-separated readout when expanded — it duplicates the inputs.
    this.summaryEl.style.display = this.open ? "none" : "inline";
    this.chevronEl.style.transform = this.open
      ? "rotate(0deg)"
      : "rotate(-90deg)";
  }

  private render() {
    const g = this.geo;
    this.summaryEl.textContent = g
      ? [g.west, g.south, g.east, g.north]
          .map((n) => n.toFixed(4))
          .join(", ")
      : "—";

    if (!g) {
      for (const side of ["north", "south", "east", "west"] as Side[]) {
        this.inputs[side].value = "";
      }
      return;
    }
    if (document.activeElement !== this.inputs.north)
      this.inputs.north.value = formatBound(g.north);
    if (document.activeElement !== this.inputs.south)
      this.inputs.south.value = formatBound(g.south);
    if (document.activeElement !== this.inputs.east)
      this.inputs.east.value = formatBound(g.east);
    if (document.activeElement !== this.inputs.west)
      this.inputs.west.value = formatBound(g.west);
  }
}

function formatBound(n: number): string {
  return Number.isFinite(n) ? n.toFixed(4) : "";
}
