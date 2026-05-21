import { html, nothing, type TemplateResult } from "lit";
import { classMap } from "lit/directives/class-map.js";
import type { Map as MaplibreMap } from "maplibre-gl";
import type { FeatureCollection } from "geojson";
import { LightElement } from "./lit-base.ts";
import {
  buildLayerStyle,
  filterByGeomType,
  formatLayerName,
  isGeoJSONFile,
  OPACITY_PRESETS,
  OVERLAY_SWATCH_PALETTE,
  parseGeoJSONFile,
  SIZE_TOKENS,
  type AreaStyle,
  type DashToken,
  type GeomType,
  type LineStyle,
  type OverlayLayer,
  type PointStyle,
  type SizeToken,
  type StylePatch,
} from "./overlay-model.ts";
import { drawGlyphToCanvas, OVERLAY_ICON_SET } from "./overlay-icons.ts";
import { overlaysNeedReadd, syncOverlaysToMap } from "./overlay-render.ts";

const ACCENT = "#1854f6";
const BUILTIN_SHAPES = ["circle", "square", "triangle"];

export interface OverlayPanelOptions {
  map: MaplibreMap;
  isMobile: () => boolean;
}

/** The overlay feature — a top-left chip that morphs into a panel of GeoJSON
 *  overlay layers, each independently styled, named, reordered and removed.
 *  Desktop only; renders nothing when `mobile` is set. */
export class OverlayPanel extends LightElement {
  static properties = {
    mobile: { state: true },
    open: { state: true },
    layers: { state: true },
    expandedId: { state: true },
    dragOverIndex: { state: true },
    draggingId: { state: true },
    renamingId: { state: true },
    errorText: { state: true },
    openMenu: { state: true },
  };

  declare mobile: boolean;
  declare open: boolean;
  declare layers: OverlayLayer[];
  declare expandedId: string | null;
  declare dragOverIndex: number | null;
  declare draggingId: string | null;
  declare renamingId: string | null;
  declare errorText: string | null;
  /** Identifies the single open popover/menu, e.g. `kebab:ov3`,
   *  `color:ov3:color`, `icon:ov3`. Only one is open at a time. */
  declare openMenu: string | null;

  private opts!: OverlayPanelOptions;
  private idCounter = 1;
  private colorCounter = 0;
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private renameCancelled = false;
  private focusedRenameId: string | null = null;
  private readdScheduled = false;
  /** A `setStyle` (basemap swap) wipes every overlay source/layer. Re-add them
   *  — but deferred to a clean macrotask: mutating the style synchronously
   *  inside `styledata` (which can fire mid-render) corrupts MapLibre's symbol
   *  placement and crashes its render loop. */
  private onStyleData = () => {
    if (this.readdScheduled || this.layers.length === 0 || !this.opts?.map) {
      return;
    }
    if (!overlaysNeedReadd(this.opts.map, this.layers)) return;
    this.readdScheduled = true;
    setTimeout(() => {
      this.readdScheduled = false;
      const map = this.opts?.map;
      if (!map || this.layers.length === 0) return;
      if (overlaysNeedReadd(map, this.layers)) {
        syncOverlaysToMap(map, this.layers);
      }
    }, 0);
  };
  private onDocPointerDown = (e: PointerEvent) => {
    if (!this.openMenu) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest(".ovl-menu-host")) return;
    this.openMenu = null;
  };

  constructor() {
    super();
    this.mobile = false;
    this.open = false;
    this.layers = [];
    this.expandedId = null;
    this.dragOverIndex = null;
    this.draggingId = null;
    this.renamingId = null;
    this.errorText = null;
    this.openMenu = null;
  }

  /** Inject runtime options. Custom-element constructors take no arguments. */
  init(opts: OverlayPanelOptions): this {
    this.opts = opts;
    this.mobile = opts.isMobile();
    opts.map.on("styledata", this.onStyleData);
    return this;
  }

  get el(): this {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("ovl-root");
    document.addEventListener("pointerdown", this.onDocPointerDown, true);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("pointerdown", this.onDocPointerDown, true);
    this.opts?.map.off("styledata", this.onStyleData);
  }

  /** Re-evaluated by the host on viewport resize. The feature is desktop-only. */
  setMobile(mobile: boolean) {
    this.mobile = mobile;
  }

  // ── Ingestion ───────────────────────────────────────────────────────────

  /** Parse + add one or more GeoJSON files. Non-GeoJSON files are ignored;
   *  parse failures surface as an inline error in the panel header. */
  async addFiles(files: FileList | File[]) {
    const geojson = Array.from(files).filter(isGeoJSONFile);
    if (geojson.length === 0) return;
    let next = this.layers;
    let firstNewId: string | null = null;
    const errors: string[] = [];
    for (const file of geojson) {
      try {
        const fc = await parseGeoJSONFile(file);
        const created = this.fanOut(file.name, fc);
        if (!firstNewId && created[0]) firstNewId = created[0].id;
        next = [...created, ...next];
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    if (next !== this.layers) {
      this.commit(next);
      this.open = true;
      if (firstNewId) this.expandedId = firstNewId;
    }
    this.setError(errors.length ? errors.join(" ") : null);
  }

  /** One file → one layer per geometry family present. Newest layers are
   *  inserted at the top of the stack by the caller. */
  private fanOut(fileName: string, fc: FeatureCollection): OverlayLayer[] {
    const created: OverlayLayer[] = [];
    // points on top, lines middle, areas bottom (within a single file).
    for (const gt of ["points", "lines", "areas"] as GeomType[]) {
      const filtered = filterByGeomType(fc, gt);
      if (filtered.features.length === 0) continue;
      created.push({
        id: `ov${this.idCounter++}`,
        fileName,
        name: formatLayerName(fileName, gt),
        geomType: gt,
        geojson: filtered,
        featureCount: filtered.features.length,
        visible: true,
        style: buildLayerStyle(gt, this.colorCounter),
      });
    }
    if (created.length) this.colorCounter++;
    return created;
  }

  private setError(msg: string | null) {
    this.errorText = msg;
    if (this.errorTimer) clearTimeout(this.errorTimer);
    if (msg) {
      this.errorTimer = setTimeout(() => {
        this.errorText = null;
      }, 7000);
    }
  }

  // ── Layer mutations ─────────────────────────────────────────────────────

  private commit(next: OverlayLayer[]) {
    this.layers = next;
    // `syncOverlaysToMap` self-gates on style readiness; if the style isn't
    // mutable yet the persistent `styledata` handler re-runs the sync once
    // it is. Either way the reconcile is idempotent.
    if (this.opts?.map) syncOverlaysToMap(this.opts.map, this.layers);
  }

  private removeLayer(id: string) {
    if (this.expandedId === id) this.expandedId = null;
    if (this.renamingId === id) this.renamingId = null;
    this.openMenu = null;
    this.commit(this.layers.filter((l) => l.id !== id));
  }

  private setVisible(id: string, visible: boolean) {
    this.commit(
      this.layers.map((l) => (l.id === id ? { ...l, visible } : l)),
    );
  }

  private renameLayer(id: string, name: string) {
    this.commit(this.layers.map((l) => (l.id === id ? { ...l, name } : l)));
  }

  private patchStyle(id: string, patch: StylePatch) {
    this.commit(
      this.layers.map((l) =>
        l.id === id
          ? ({ ...l, style: { ...l.style, ...patch } } as OverlayLayer)
          : l,
      ),
    );
  }

  private moveTo(id: string, toIndex: number) {
    const from = this.layers.findIndex((l) => l.id === id);
    if (from < 0) return;
    const next = this.layers.slice();
    const [moved] = next.splice(from, 1);
    next.splice(Math.max(0, Math.min(next.length, toIndex)), 0, moved);
    this.commit(next);
  }

  private toggleExpand(id: string) {
    this.expandedId = this.expandedId === id ? null : id;
    this.openMenu = null;
  }

  private toggleMenu(key: string) {
    this.openMenu = this.openMenu === key ? null : key;
  }

  // ── Drag-to-reorder ─────────────────────────────────────────────────────

  private beginDrag(e: PointerEvent, id: string, index: number) {
    e.preventDefault();
    this.draggingId = id;
    this.dragOverIndex = index;

    const onMove = (ev: PointerEvent) => {
      const rows = Array.from(this.querySelectorAll<HTMLElement>(".ovl-row"));
      let target = rows.length;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        if (ev.clientY < r.top + r.height / 2) {
          target = i;
          break;
        }
      }
      this.dragOverIndex = target;
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      const to = this.dragOverIndex;
      this.draggingId = null;
      this.dragOverIndex = null;
      if (to == null) return;
      // The source row vacates its slot, so a downward move shifts by one.
      let dst = to;
      if (dst > index) dst -= 1;
      if (dst !== index) this.moveTo(id, dst);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  // ── Rename ──────────────────────────────────────────────────────────────

  private onRenameKey(e: KeyboardEvent) {
    const input = e.target as HTMLInputElement;
    if (e.key === "Enter") {
      input.blur();
    } else if (e.key === "Escape") {
      this.renameCancelled = true;
      input.blur();
    }
  }

  private commitRename(id: string, value: string) {
    const cancelled = this.renameCancelled;
    this.renameCancelled = false;
    this.renamingId = null;
    if (cancelled) return;
    const next = value.trim();
    if (next) this.renameLayer(id, next);
  }

  private openFilePicker() {
    this.querySelector<HTMLInputElement>(".ovl-file-input")?.click();
  }

  private onFileInput(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) void this.addFiles(input.files);
    input.value = "";
  }

  // ── Render ──────────────────────────────────────────────────────────────

  render() {
    if (this.mobile) return nothing;
    return this.open ? this.renderPanel() : this.renderChip();
  }

  updated() {
    // Glyph swatches are canvas-drawn so they match the SDF icons on the map.
    for (const canvas of this.querySelectorAll<HTMLCanvasElement>(
      "canvas.ovl-glyph",
    )) {
      drawGlyphToCanvas(
        canvas,
        canvas.dataset.shape ?? "circle",
        canvas.dataset.color ?? "#000",
        Number(canvas.dataset.size) || 14,
      );
    }
    if (this.renamingId && this.focusedRenameId !== this.renamingId) {
      const input = this.querySelector<HTMLInputElement>(".ovl-name-input");
      input?.focus();
      input?.select();
    }
    this.focusedRenameId = this.renamingId;
    this.positionPopover();
  }

  /** Pickers (advanced colour, icon library, kebab) are `position: fixed` so
   *  they escape the scrolling panel body. Anchor each to its trigger row,
   *  flipping above / clamping to the viewport as needed. */
  private positionPopover() {
    const popover = this.querySelector<HTMLElement>(".ovl-popover");
    if (!popover) return;
    const host = popover.closest<HTMLElement>(".ovl-menu-host");
    if (!host) return;
    const anchor = host.getBoundingClientRect();
    const pw = popover.offsetWidth;
    const ph = popover.offsetHeight;
    const margin = 8;
    let top = anchor.bottom + 4;
    if (top + ph > window.innerHeight - margin) {
      const above = anchor.top - ph - 4;
      top =
        above >= margin
          ? above
          : Math.max(margin, window.innerHeight - margin - ph);
    }
    const left = Math.max(
      margin,
      Math.min(anchor.right - pw, window.innerWidth - pw - margin),
    );
    popover.style.top = `${top}px`;
    popover.style.left = `${left}px`;
  }

  private renderChip(): TemplateResult {
    const count = this.layers.length;
    return html`
      <button class="ovl-chip" @click=${() => (this.open = true)}>
        ${stackIcon(16)}
        <span>Overlays</span>
        ${count > 0
          ? html`<span class="ovl-count">${count}</span>`
          : nothing}
      </button>
    `;
  }

  private renderPanel(): TemplateResult {
    const body: (TemplateResult | typeof nothing)[] = [];
    if (this.layers.length === 0) {
      body.push(this.renderEmpty());
    } else {
      this.layers.forEach((layer, i) => {
        if (this.draggingId && this.dragOverIndex === i) {
          body.push(html`<div class="ovl-drop-line"></div>`);
        }
        body.push(this.renderRow(layer, i));
      });
      if (this.draggingId && this.dragOverIndex === this.layers.length) {
        body.push(html`<div class="ovl-drop-line"></div>`);
      }
    }
    return html`
      <div class="ovl-panel">
        ${this.renderHeader()}
        ${this.errorText
          ? html`<div class="ovl-error">
              <span>${this.errorText}</span>
              <button
                class="ovl-error-close"
                aria-label="Dismiss"
                @click=${() => this.setError(null)}
              >×</button>
            </div>`
          : nothing}
        <div
          class="ovl-body"
          @scroll=${() => {
            if (this.openMenu) this.openMenu = null;
          }}
        >
          ${body}
        </div>
        <input
          class="ovl-file-input"
          type="file"
          accept=".geojson,.json,application/geo+json"
          multiple
          hidden
          @change=${(e: Event) => this.onFileInput(e)}
        />
      </div>
    `;
  }

  private renderHeader(): TemplateResult {
    const count = this.layers.length;
    return html`
      <div class="ovl-panel-header">
        <button
          class="ovl-panel-icon"
          aria-label="Close overlays"
          title="Close"
          @click=${() => (this.open = false)}
        >
          ${closeIcon}
        </button>
        <span
          class="ovl-panel-title"
          title="Close"
          @click=${() => (this.open = false)}
        >
          Overlays
          ${count > 0
            ? html`<span class="ovl-count">${count}</span>`
            : nothing}
        </span>
        <button class="ovl-add-btn" @click=${() => this.openFilePicker()}>
          ${plusIcon} Add
        </button>
      </div>
    `;
  }

  private renderEmpty(): TemplateResult {
    return html`
      <div class="ovl-empty">
        <div class="ovl-empty-icon">${stackIcon(22)}</div>
        <div class="ovl-empty-title">Add your own data</div>
        <div class="ovl-empty-text">
          Drop a <code>.geojson</code> file anywhere on the map to overlay
          trails, regions or points of interest on the basemap.
        </div>
      </div>
    `;
  }

  private renderRow(layer: OverlayLayer, index: number): TemplateResult {
    const expanded = this.expandedId === layer.id;
    const dragging = this.draggingId === layer.id;
    return html`
      <div
        class="ovl-row ${classMap({ expanded, dragging })}"
        data-index=${index}
      >
        <div class="ovl-row-head">
          <button
            class="ovl-drag-handle"
            aria-label="Drag to reorder"
            title="Drag to reorder"
            @pointerdown=${(e: PointerEvent) =>
              this.beginDrag(e, layer.id, index)}
          >
            ${dragDots}
          </button>
          ${this.renderGeomIcon(layer)}
          <div class="ovl-name-wrap">${this.renderName(layer)}</div>
          <button
            class="ovl-icon-btn"
            title=${layer.visible ? "Hide" : "Show"}
            @click=${() => this.setVisible(layer.id, !layer.visible)}
          >
            ${layer.visible ? eyeOpenIcon : eyeClosedIcon}
          </button>
          ${expanded ? this.renderKebab(layer) : nothing}
          <button
            class="ovl-icon-btn"
            title="Style"
            @click=${() => this.toggleExpand(layer.id)}
          >
            ${chevronIcon(expanded)}
          </button>
        </div>
        ${expanded
          ? html`<div class="ovl-row-editor">
              ${this.renderStyleEditor(layer)}
            </div>`
          : nothing}
      </div>
    `;
  }

  private renderGeomIcon(layer: OverlayLayer): TemplateResult {
    const c = layer.style.color;
    return html`
      <span
        class="ovl-geom-icon"
        style="background:${c}1f;color:${c};opacity:${layer.visible
          ? 1
          : 0.4}"
      >
        ${geomGlyph(layer.geomType)}
      </span>
    `;
  }

  private renderName(layer: OverlayLayer): TemplateResult {
    if (this.renamingId === layer.id) {
      return html`
        <input
          class="ovl-name-input"
          .value=${layer.name}
          @keydown=${(e: KeyboardEvent) => this.onRenameKey(e)}
          @blur=${(e: Event) =>
            this.commitRename(
              layer.id,
              (e.target as HTMLInputElement).value,
            )}
        />
      `;
    }
    return html`
      <button
        class="ovl-name ${classMap({ dim: !layer.visible })}"
        @click=${() => (this.renamingId = layer.id)}
      >
        ${layer.name}
      </button>
    `;
  }

  private renderKebab(layer: OverlayLayer): TemplateResult {
    const key = `kebab:${layer.id}`;
    return html`
      <span class="ovl-menu-host">
        <button
          class="ovl-icon-btn"
          title="More"
          @click=${() => this.toggleMenu(key)}
        >
          ${kebabIcon}
        </button>
        ${this.openMenu === key
          ? html`<div class="ovl-kebab-menu ovl-popover">
              <button
                class="ovl-kebab-remove"
                @click=${() => this.removeLayer(layer.id)}
              >
                ${trashIcon} Remove layer
              </button>
            </div>`
          : nothing}
      </span>
    `;
  }

  // ── Style editor ────────────────────────────────────────────────────────

  private renderStyleEditor(layer: OverlayLayer): TemplateResult {
    return html`
      <div class="ovl-style-editor">
        ${layer.geomType === "lines"
          ? this.renderLineControls(layer)
          : nothing}
        ${layer.geomType === "areas"
          ? this.renderAreaControls(layer)
          : nothing}
        ${layer.geomType === "points"
          ? this.renderPointControls(layer)
          : nothing}
        <div class="ovl-editor-sep"></div>
        ${this.renderLabelControls(layer)}
      </div>
    `;
  }

  private renderLineControls(layer: OverlayLayer): TemplateResult {
    return html`
      ${frame("Color", this.renderSwatch(layer, "color"))}
      ${frame(
        "Thickness",
        this.renderSizePicker(layer, "width", "stroke"),
      )}
      ${frame("Style", this.renderDash(layer))}
    `;
  }

  private renderAreaControls(layer: OverlayLayer): TemplateResult {
    return html`
      ${frame("Color", this.renderSwatch(layer, "color"))}
      ${frame("Fill", this.renderOpacity(layer))}
      ${frame(
        "Outline",
        this.renderSizePicker(layer, "strokeWidth", "stroke"),
      )}
      ${frame("Style", this.renderDash(layer))}
    `;
  }

  private renderPointControls(layer: OverlayLayer): TemplateResult {
    return html`
      ${frame("Color", this.renderSwatch(layer, "color"))}
      ${frame("Size", this.renderSizePicker(layer, "size", "point"))}
      ${frame("Icon", this.renderShapePicker(layer))}
    `;
  }

  private renderLabelControls(layer: OverlayLayer): TemplateResult {
    const s = layer.style;
    const sample = layer.geojson.features[0]?.properties ?? {};
    let fields = Object.keys(sample).slice(0, 8);
    if (!fields.includes(s.labelField)) fields = [s.labelField, ...fields];
    return html`
      ${frame("Labels", this.renderSwitch(layer))}
      ${s.showLabels
        ? html`
            ${frame("Field", this.renderFieldPicker(layer, fields))}
            ${frame(
              "Size",
              this.renderSizePicker(layer, "labelSize", "label"),
            )}
            ${frame("Color", this.renderSwatch(layer, "labelColor"))}
          `
        : nothing}
    `;
  }

  // ── Pickers ─────────────────────────────────────────────────────────────

  private renderSwatch(
    layer: OverlayLayer,
    field: "color" | "labelColor",
  ): TemplateResult {
    const value = (layer.style as unknown as Record<string, unknown>)[field] as string;
    const key = `color:${layer.id}:${field}`;
    const isCustom = !OVERLAY_SWATCH_PALETTE.some(
      (c) => c.toLowerCase() === value.toLowerCase(),
    );
    return html`
      <span class="ovl-menu-host ovl-swatch-row">
        ${OVERLAY_SWATCH_PALETTE.map((c) => {
          const active = c.toLowerCase() === value.toLowerCase();
          return html`<button
            class="ovl-swatch"
            aria-label=${`Colour ${c}`}
            style=${swatchStyle(c, active)}
            @click=${() => this.patchStyle(layer.id, { [field]: c })}
          ></button>`;
        })}
        <button
          class="ovl-swatch ovl-swatch-adv ${classMap({ custom: isCustom })}"
          aria-label="More colours"
          style=${isCustom ? swatchStyle(value, true) : ""}
          @click=${() => this.toggleMenu(key)}
        >
          ${isCustom ? nothing : html`<span class="ovl-swatch-plus">+</span>`}
        </button>
        ${this.openMenu === key
          ? this.renderAdvColor(layer, field, value)
          : nothing}
      </span>
    `;
  }

  private renderAdvColor(
    layer: OverlayLayer,
    field: "color" | "labelColor",
    value: string,
  ): TemplateResult {
    const hues = [0, 20, 40, 60, 110, 150, 180, 200, 220, 260, 290, 330];
    const lights = [88, 75, 60, 45, 30];
    const neutrals = [
      "#ffffff",
      "#e6e3dc",
      "#bdbab2",
      "#6b6862",
      "#3a3833",
      "#1a1d24",
    ];
    const cell = (color: string) => {
      const active = color.toLowerCase() === value.toLowerCase();
      return html`<button
        class="ovl-adv-cell ${classMap({ active })}"
        style="background:${color}"
        aria-label=${color}
        @click=${() => this.patchStyle(layer.id, { [field]: color })}
      ></button>`;
    };
    return html`
      <div class="ovl-adv-popover ovl-popover">
        <div class="ovl-adv-title">Pick a colour</div>
        <div class="ovl-adv-grid">
          ${lights.map((l) =>
            hues.map((h) => cell(hslToHex(h, l > 60 ? 70 : 65, l))),
          )}
        </div>
        <div class="ovl-adv-sep"></div>
        <div class="ovl-adv-foot">
          <div class="ovl-adv-neutrals">${neutrals.map(cell)}</div>
          ${this.renderHexInput(layer, field, value)}
        </div>
      </div>
    `;
  }

  private renderHexInput(
    layer: OverlayLayer,
    field: "color" | "labelColor",
    value: string,
  ): TemplateResult {
    const commit = (raw: string) => {
      let v = raw.trim();
      if (!v.startsWith("#")) v = `#${v}`;
      if (/^#[0-9a-f]{3}$/i.test(v)) {
        v = `#${v
          .slice(1)
          .split("")
          .map((c) => c + c)
          .join("")}`;
      }
      if (/^#[0-9a-f]{6}$/i.test(v)) {
        this.patchStyle(layer.id, { [field]: v.toLowerCase() });
      }
    };
    return html`
      <span class="ovl-hex">
        <span class="ovl-hex-hash">#</span>
        <input
          class="ovl-hex-input"
          .value=${value.replace(/^#/, "")}
          maxlength="6"
          @keydown=${(e: KeyboardEvent) => {
            const input = e.target as HTMLInputElement;
            if (e.key === "Enter") input.blur();
            if (e.key === "Escape") {
              input.value = value.replace(/^#/, "");
              input.blur();
            }
          }}
          @blur=${(e: Event) =>
            commit((e.target as HTMLInputElement).value)}
        />
      </span>
    `;
  }

  private renderSizePicker(
    layer: OverlayLayer,
    field: "width" | "strokeWidth" | "size" | "labelSize",
    kind: "stroke" | "point" | "label",
  ): TemplateResult {
    const value = (layer.style as unknown as Record<string, unknown>)[
      field
    ] as SizeToken;
    const color =
      kind === "label" ? layer.style.labelColor : layer.style.color;
    const shape = (layer.style as PointStyle).shape;
    return html`
      <div class="ovl-pill-row">
        ${SIZE_TOKENS.map(
          (tok) => html`<button
            class="ovl-pill ${classMap({ active: tok === value })}"
            aria-label=${tok}
            @click=${() => this.patchStyle(layer.id, { [field]: tok })}
          >
            ${sizeGlyph(kind, tok, color, shape)}
          </button>`,
        )}
      </div>
    `;
  }

  private renderDash(layer: OverlayLayer): TemplateResult {
    const s = layer.style as LineStyle | AreaStyle;
    const opts: { id: DashToken; dash: string }[] = [
      { id: "solid", dash: "" },
      { id: "dashed", dash: "4 3" },
      { id: "dotted", dash: "1 3" },
    ];
    return html`
      <div class="ovl-pill-row">
        ${opts.map(
          (o) => html`<button
            class="ovl-pill ovl-pill-wide ${classMap({
              active: o.id === s.dash,
            })}"
            aria-label=${o.id}
            @click=${() => this.patchStyle(layer.id, { dash: o.id })}
          >
            ${html`<svg width="22" height="2" viewBox="0 0 22 2">
              <line x1="0" y1="1" x2="22" y2="1" stroke=${s.color}
                stroke-width="1.6" stroke-dasharray=${o.dash}
                stroke-linecap=${o.id === "dotted" ? "round" : "butt"} />
            </svg>`}
          </button>`,
        )}
      </div>
    `;
  }

  private renderOpacity(layer: OverlayLayer): TemplateResult {
    const s = layer.style as AreaStyle;
    let nearest = OPACITY_PRESETS[0];
    for (const o of OPACITY_PRESETS) {
      if (
        Math.abs(o.value - s.opacity) <
        Math.abs(nearest.value - s.opacity)
      ) {
        nearest = o;
      }
    }
    return html`
      <div class="ovl-pill-row">
        ${OPACITY_PRESETS.map((o) => {
          const active = o === nearest;
          return html`<button
            class="ovl-pill ovl-pill-text ${classMap({ active })}"
            style=${active ? `color:${s.color}` : ""}
            @click=${() => this.patchStyle(layer.id, { opacity: o.value })}
          >
            ${o.label}
          </button>`;
        })}
      </div>
    `;
  }

  private renderShapePicker(layer: OverlayLayer): TemplateResult {
    const s = layer.style as PointStyle;
    const key = `icon:${layer.id}`;
    const isBuiltin = BUILTIN_SHAPES.includes(s.shape);
    return html`
      <span class="ovl-menu-host ovl-pill-row">
        ${BUILTIN_SHAPES.map(
          (sh) => html`<button
            class="ovl-pill ${classMap({ active: sh === s.shape })}"
            aria-label=${sh}
            @click=${() => this.patchStyle(layer.id, { shape: sh })}
          >
            ${glyphHtml(sh, s.color, 10)}
          </button>`,
        )}
        <button
          class="ovl-pill ${classMap({ active: !isBuiltin })}"
          aria-label="More icons"
          @click=${() => this.toggleMenu(key)}
        >
          ${isBuiltin ? gridIcon : glyphHtml(s.shape, s.color, 14)}
        </button>
        ${this.openMenu === key ? this.renderIconLib(layer) : nothing}
      </span>
    `;
  }

  private renderIconLib(layer: OverlayLayer): TemplateResult {
    const s = layer.style as PointStyle;
    return html`
      <div class="ovl-icon-lib ovl-popover">
        <div class="ovl-icon-lib-head">
          <span>Map icons</span>
          <a
            class="ovl-icon-lib-credit"
            href="https://github.com/mapbox/maki"
            target="_blank"
            rel="noopener noreferrer"
          >Derived from Maki</a>
        </div>
        <div class="ovl-icon-lib-grid">
          ${OVERLAY_ICON_SET.map(([id, label]) => {
            const active = id === s.shape;
            return html`<button
              class="ovl-icon-cell ${classMap({ active })}"
              title=${label}
              style=${active
                ? `background:${s.color}1f;box-shadow:0 0 0 1.5px ${s.color} inset`
                : ""}
              @click=${() => {
                this.patchStyle(layer.id, { shape: id });
                this.openMenu = null;
              }}
            >
              ${glyphHtml(id, s.color, 20)}
            </button>`;
          })}
        </div>
      </div>
    `;
  }

  private renderSwitch(layer: OverlayLayer): TemplateResult {
    const on = layer.style.showLabels;
    return html`
      <button
        class="ovl-switch ${classMap({ on })}"
        style=${on ? `background:${ACCENT}` : ""}
        aria-label=${on ? "Hide labels" : "Show labels"}
        @click=${() => this.patchStyle(layer.id, { showLabels: !on })}
      >
        <span class="ovl-switch-knob"></span>
      </button>
    `;
  }

  private renderFieldPicker(
    layer: OverlayLayer,
    fields: string[],
  ): TemplateResult {
    const s = layer.style;
    return html`
      <select
        class="ovl-field-select"
        @change=${(e: Event) =>
          this.patchStyle(layer.id, {
            labelField: (e.target as HTMLSelectElement).value,
          })}
      >
        ${fields.map(
          (f) =>
            html`<option value=${f} ?selected=${f === s.labelField}>
              ${f}
            </option>`,
        )}
      </select>
    `;
  }
}

// ── Stateless render helpers ──────────────────────────────────────────────

function frame(label: string, control: TemplateResult): TemplateResult {
  return html`
    <div class="ovl-frame">
      <span class="ovl-frame-label">${label}</span>
      <div class="ovl-frame-ctrl">${control}</div>
    </div>
  `;
}

function swatchStyle(color: string, active: boolean): string {
  return active
    ? `background:${color};box-shadow:0 0 0 1.5px #fff inset,0 0 0 2px ${color}`
    : `background:${color}`;
}

/** A point-shape glyph: inline SVG for the built-ins, a tinted canvas for
 *  Maki icons (so it matches the SDF image on the map). */
function glyphHtml(
  shape: string,
  color: string,
  size: number,
): TemplateResult {
  if (shape === "circle") {
    return html`${html`<svg width=${size} height=${size} viewBox="0 0 10 10">
      <circle cx="5" cy="5" r="3.5" fill=${color} /></svg>`}`;
  }
  if (shape === "square") {
    return html`${html`<svg width=${size} height=${size} viewBox="0 0 10 10">
      <rect x="1.5" y="1.5" width="7" height="7" fill=${color} /></svg>`}`;
  }
  if (shape === "triangle") {
    return html`${html`<svg width=${size} height=${size} viewBox="0 0 10 10">
      <polygon points="5,1.5 9,8.5 1,8.5" fill=${color} /></svg>`}`;
  }
  return html`<canvas
    class="ovl-glyph"
    data-shape=${shape}
    data-color=${color}
    data-size=${size}
  ></canvas>`;
}

function sizeGlyph(
  kind: "stroke" | "point" | "label",
  token: SizeToken,
  color: string,
  shape: string,
): TemplateResult {
  if (kind === "stroke") {
    const h = { xs: 1.2, s: 2, m: 3, l: 4.5 }[token];
    return html`<span
      class="ovl-stroke-glyph"
      style="height:${h}px;background:${color}"
    ></span>`;
  }
  if (kind === "point") {
    const d = { xs: 5, s: 7, m: 10, l: 13 }[token];
    return glyphHtml(shape, color, d);
  }
  const fs = { xs: 9, s: 10.5, m: 12, l: 14 }[token];
  return html`<span
    class="ovl-label-glyph"
    style="font-size:${fs}px;color:${color}"
  >Aa</span>`;
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * v)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

// ── Static icons ──────────────────────────────────────────────────────────

function stackIcon(size: number): TemplateResult {
  return html`${html`<svg width=${size} height=${size} viewBox="0 0 16 16"
    fill="none" stroke="currentColor" stroke-width="1.5"
    stroke-linecap="round" stroke-linejoin="round">
    <path d="M8 2 L13.5 5 L8 8 L2.5 5 Z" />
    <path d="M2.5 8 L8 11 L13.5 8" />
  </svg>`}`;
}

function geomGlyph(kind: GeomType): TemplateResult {
  if (kind === "lines") {
    return html`${html`<svg width="17" height="17" viewBox="0 0 18 18"
      fill="none" stroke="currentColor" stroke-width="2"
      stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 14 L7 6 L11 11 L15 4" /></svg>`}`;
  }
  if (kind === "areas") {
    return html`${html`<svg width="17" height="17" viewBox="0 0 18 18" fill="none">
      <path d="M3.5 5 L8 3 L15 6 L13 14 L5 14 Z" fill="currentColor"
        opacity="0.35" />
      <path d="M3.5 5 L8 3 L15 6 L13 14 L5 14 Z" stroke="currentColor"
        stroke-width="1.6" stroke-linejoin="round" fill="none" /></svg>`}`;
  }
  return html`${html`<svg width="17" height="17" viewBox="0 0 18 18" fill="none">
    <circle cx="5" cy="13" r="2" fill="currentColor" />
    <circle cx="10" cy="6" r="2.5" fill="currentColor" />
    <circle cx="14" cy="11" r="1.8" fill="currentColor" /></svg>`}`;
}

function chevronIcon(expanded: boolean): TemplateResult {
  return html`${html`<svg width="10" height="10" viewBox="0 0 10 10"
    fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"
    style=${`transform:rotate(${expanded ? 180 : 0}deg)`}>
    <path d="M2 4l3 3 3-3" /></svg>`}`;
}

const plusIcon = html`${html`<svg width="11" height="11" viewBox="0 0 12 12"
  fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
  <path d="M6 2v8M2 6h8" /></svg>`}`;

const closeIcon = html`${html`<svg width="16" height="16" viewBox="0 0 16 16"
  fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
  <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>`}`;

const kebabIcon = html`${html`<svg width="13" height="13" viewBox="0 0 16 16"
  fill="currentColor">
  <circle cx="3.5" cy="8" r="1.3" />
  <circle cx="8" cy="8" r="1.3" />
  <circle cx="12.5" cy="8" r="1.3" /></svg>`}`;

const dragDots = html`${html`<svg width="4" height="16" viewBox="0 0 4 16"
  fill="currentColor">
  <circle cx="2" cy="2" r="1.3" />
  <circle cx="2" cy="6" r="1.3" />
  <circle cx="2" cy="10" r="1.3" />
  <circle cx="2" cy="14" r="1.3" /></svg>`}`;

const trashIcon = html`${html`<svg width="13" height="13" viewBox="0 0 16 16"
  fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round">
  <path d="M3.5 4h9M6.5 4V2.7h3V4M5 4l.5 9h5L11 4" /></svg>`}`;

const gridIcon = html`${html`<svg width="11" height="11" viewBox="0 0 12 12"
  fill="none" stroke="#8a8a86" stroke-width="1.6" stroke-linecap="round">
  <circle cx="2.5" cy="2.5" r="1" />
  <circle cx="9.5" cy="2.5" r="1" />
  <circle cx="2.5" cy="9.5" r="1" />
  <circle cx="9.5" cy="9.5" r="1" />
  <circle cx="6" cy="6" r="1" /></svg>`}`;

const eyeOpenIcon = html`${html`<svg width="14" height="14" viewBox="0 0 16 16"
  fill="none" stroke="currentColor" stroke-width="1.4"
  stroke-linecap="round" stroke-linejoin="round">
  <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8s-2.5 4.5-6.5 4.5S1.5 8 1.5 8z" />
  <circle cx="8" cy="8" r="2" /></svg>`}`;

const eyeClosedIcon = html`${html`<svg width="14" height="14" viewBox="0 0 16 16"
  fill="none" stroke="currentColor" stroke-width="1.4"
  stroke-linecap="round" stroke-linejoin="round">
  <path d="M2 2l12 12" />
  <path d="M6 4.5C6.6 4.3 7.3 4.2 8 4.2c4 0 6.5 3.8 6.5 3.8s-.7 1-1.9 2" />
  <path d="M9.9 9.9a2 2 0 1 1-2.8-2.8" />
  <path d="M4 5.6C2.5 6.8 1.5 8 1.5 8S4 12.5 8 12.5c1 0 1.9-.2 2.7-.6" /></svg>`}`;

if (!customElements.get("overlay-panel")) {
  customElements.define("overlay-panel", OverlayPanel);
}
