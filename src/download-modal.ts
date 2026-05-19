import { BboxMap, type GeoBbox } from "./bbox-map.ts";
import {
  bboxToArr,
  countTiles,
  DEFAULT_AVG_TILE_BYTES,
  DEFAULT_MAX_ZOOM,
  HARD_TILES,
  MAX_ZOOM_LIMIT,
  MIN_ZOOM_LIMIT,
  WARN_MB,
  WARN_TILES,
} from "./estimate.ts";
import type { AppStyle } from "./preset-styles.ts";
import {
  getStyleMaxZoomAsync,
  getStyleMaxZoomSync,
  resolveDataTileUrls,
  sampleAvgTileBytes,
} from "./tile-sampler.ts";

type Status = "idle" | "downloading" | "error" | "success";

export interface DownloadRequest {
  style: AppStyle;
  bbox: GeoBbox;
  maxZoom: number;
  name: string;
  description: string;
}

export interface DownloadController {
  cancel(): void;
}

export interface DownloadModalOptions {
  /** Triggered when the user clicks Download. The handler is responsible for
   *  driving the streaming download and reporting progress via the returned
   *  controller. The modal stays open and shows progress until either
   *  `onProgress` is called with `done: true` or `onError` is called. */
  onDownload: (
    req: DownloadRequest,
    callbacks: {
      onProgress: (p: { fraction: number; done?: boolean }) => void;
      onError: (msg: string) => void;
    },
  ) => DownloadController;
  isMobile: () => boolean;
}

export class DownloadModal {
  readonly el: HTMLDivElement;
  private opts: DownloadModalOptions;
  private isOpen = false;
  private mobile = false;
  private step: 1 | 2 = 1;
  private status: Status = "idle";
  private progress = 0;
  private errorText: string | null = null;
  private maxZoom = DEFAULT_MAX_ZOOM;
  private name = "";
  private desc = "";
  private currentStyle: AppStyle | null = null;
  private currentGeoBbox: GeoBbox | null = null;
  private previewMap: BboxMap | null = null;
  private previewContainer: HTMLDivElement | null = null;
  private controller: DownloadController | null = null;
  // Size sampler state. Cache is per (style, maxZoom) and seeded fresh on each
  // open(). The abort controller cancels in-flight fetches when the user changes
  // the slider before a previous run completes.
  private resolvedTileUrls: string[] | null = null;
  private resolvedTileUrlsForStyleId: string | null = null;
  private avgTileBytes: number | null = null;
  private sampleByZoom = new Map<number, number>();
  private sampleAbort: AbortController | null = null;
  private sampleTimer: ReturnType<typeof setTimeout> | null = null;
  /** Effective slider cap. Starts at the global MAX_ZOOM_LIMIT, narrowed
   *  down when the source's actual maxzoom is known (preset.maxZoom, mbtiles
   *  metadata, or a fetched style.json/TileJSON). */
  private effectiveMaxZoom: number = MAX_ZOOM_LIMIT;
  private maxZoomResolveAbort: AbortController | null = null;

  constructor(options: DownloadModalOptions) {
    this.opts = options;
    this.el = document.createElement("div");
    this.el.className = "dm-backdrop hidden";
  }

  open(args: {
    style: AppStyle;
    geoBbox: GeoBbox | null;
    currentMapZoom: number;
  }) {
    this.currentStyle = args.style;
    this.currentGeoBbox = args.geoBbox;

    // Optimistic cap from sync data (mbtiles metadata, recents that persisted
    // a resolved max, or a raster wrapper spec with inline source.maxzoom).
    // The async resolver below will tighten this down once it walks the
    // actual style/TileJSON or probes a tile URL.
    const syncMax = getStyleMaxZoomSync(args.style);
    this.effectiveMaxZoom = Math.min(
      MAX_ZOOM_LIMIT,
      syncMax ?? MAX_ZOOM_LIMIT,
    );

    this.maxZoom = Math.max(
      Math.round(args.currentMapZoom + 2),
      DEFAULT_MAX_ZOOM,
    );
    this.maxZoom = Math.min(this.effectiveMaxZoom, this.maxZoom);
    this.name = "";
    this.desc = "";
    this.status = "idle";
    this.progress = 0;
    this.errorText = null;
    this.step = 1;
    this.mobile = this.opts.isMobile();
    this.isOpen = true;
    // Reset sampler state for the new style. Cache is keyed by maxZoom only —
    // the bbox is locked for the duration of the modal session.
    if (this.resolvedTileUrlsForStyleId !== args.style.id) {
      this.resolvedTileUrls = null;
      this.resolvedTileUrlsForStyleId = args.style.id;
    }
    this.avgTileBytes = null;
    this.sampleByZoom.clear();
    this.sampleAbort?.abort();
    this.sampleAbort = null;
    this.maxZoomResolveAbort?.abort();
    this.maxZoomResolveAbort = null;
    this.el.classList.toggle("dm-mobile", this.mobile);
    this.el.classList.remove("hidden");
    this.render();
    this.kickoffSample(0);

    // Always run the async resolver. It walks style.json → TileJSON, then
    // (for tile URL templates without metadata) probes the actual tile server
    // to find the highest zoom that returns content. The sync cap is just an
    // optimistic starting point.
    void this.resolveAsyncMaxZoom();
  }

  close() {
    if (this.status === "downloading") return;
    this.controller?.cancel();
    this.controller = null;
    this.previewMap?.destroy();
    this.previewMap = null;
    this.previewContainer = null;
    this.isOpen = false;
    this.sampleAbort?.abort();
    this.sampleAbort = null;
    this.maxZoomResolveAbort?.abort();
    this.maxZoomResolveAbort = null;
    if (this.sampleTimer) clearTimeout(this.sampleTimer);
    this.sampleTimer = null;
    this.el.classList.add("hidden");
    this.el.innerHTML = "";
  }

  private render() {
    if (!this.isOpen) return;
    // Preserve preview map across re-renders to avoid re-creating it.
    const existingPreview = this.previewContainer;
    this.el.innerHTML = "";
    if (this.mobile) this.renderMobile(existingPreview);
    else this.renderDesktop(existingPreview);
    // Update preview map zoom on each render
    if (this.previewMap) {
      this.previewMap.map.easeTo({ zoom: this.maxZoom, duration: 250 });
    }
  }

  private get tileCount() {
    if (!this.currentGeoBbox) return 0;
    return countTiles(bboxToArr(this.currentGeoBbox), this.maxZoom);
  }

  private get bytesPerTile() {
    return this.avgTileBytes ?? DEFAULT_AVG_TILE_BYTES;
  }

  private get sizeMB() {
    return (this.tileCount * this.bytesPerTile) / (1024 * 1024);
  }

  /** True while the size estimate is using the fallback constant. The UI
   *  prefixes "~" on the size already, but we use this to dim it slightly so
   *  the user sees the value is provisional. */
  private get sizeIsFromSample() {
    return this.avgTileBytes != null;
  }

  private get warnLevel(): "soft" | "hard" | null {
    if (this.tileCount >= HARD_TILES) return "hard";
    if (this.tileCount >= WARN_TILES || this.sizeMB >= WARN_MB) return "soft";
    return null;
  }

  private buildPreviewMap(host: HTMLDivElement) {
    if (this.previewMap || !this.currentStyle || !this.currentGeoBbox) return;
    this.previewContainer = host;
    this.previewMap = new BboxMap({
      container: host,
      initialStyle: this.currentStyle,
      initialCenter: [
        (this.currentGeoBbox.west + this.currentGeoBbox.east) / 2,
        (this.currentGeoBbox.south + this.currentGeoBbox.north) / 2,
      ],
      initialZoom: this.maxZoom,
      lockedGeoBbox: this.currentGeoBbox,
      lockZoom: true,
      enableResize: false,
      bboxColor: "yellow",
    });
  }

  private renderDesktop(existingPreview: HTMLDivElement | null) {
    const inner = document.createElement("div");
    inner.className = "dm-inner";
    inner.addEventListener("click", (e) => e.stopPropagation());
    this.el.addEventListener("click", (e) => {
      if (e.target === this.el && this.status !== "downloading") this.close();
    });

    const header = document.createElement("div");
    header.className = "dm-header";
    header.innerHTML = `
      <div>
        <div class="dm-title">Download map package</div>
        <div class="dm-subtitle">Set max zoom and metadata</div>
      </div>
      <button class="dm-close" aria-label="Close">×</button>`;
    header
      .querySelector(".dm-close")
      ?.addEventListener("click", () => this.close());
    inner.appendChild(header);

    const body = document.createElement("div");
    body.className = "dm-body";
    inner.appendChild(body);

    const previewCol = document.createElement("div");
    previewCol.className = "dm-preview-col";
    body.appendChild(previewCol);

    const previewHost =
      existingPreview ?? document.createElement("div");
    previewHost.className = "dm-preview-host";
    previewCol.appendChild(previewHost);
    if (!existingPreview) this.buildPreviewMap(previewHost);
    previewCol.appendChild(this.previewBadges());

    const formCol = document.createElement("div");
    formCol.className = "dm-form-col";
    body.appendChild(formCol);
    formCol.appendChild(this.buildZoomSlider());
    formCol.appendChild(this.buildNameDescFields());
    formCol.appendChild(this.buildBoundsRow());
    formCol.appendChild(this.buildEstimate());
    formCol.appendChild(this.buildWarningSlot());
    if (this.status === "error" && this.errorText) {
      formCol.appendChild(this.buildErrorBanner());
    }
    if (this.status === "downloading") {
      formCol.appendChild(this.buildProgress());
    }
    if (this.status === "success") {
      formCol.appendChild(this.buildSuccess());
    }
    formCol.appendChild(this.buildPrimaryButton());

    this.el.appendChild(inner);
  }

  private renderMobile(existingPreview: HTMLDivElement | null) {
    const inner = document.createElement("div");
    inner.className = "dm-mobile-inner";
    inner.addEventListener("click", (e) => e.stopPropagation());

    const header = document.createElement("div");
    header.className = "dm-mobile-header";
    const left = document.createElement("div");
    left.className = "dm-mobile-header-left";
    if (this.step === 2) {
      const back = document.createElement("button");
      back.className = "dm-mobile-back";
      back.setAttribute("aria-label", "Back");
      back.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round"><path d="M11 4l-5 5 5 5" /></svg>`;
      back.disabled = this.status === "downloading";
      back.addEventListener("click", () => {
        this.step = 1;
        this.render();
      });
      left.appendChild(back);
    }
    const title = document.createElement("div");
    title.innerHTML = `
      <div class="dm-mobile-title">${this.step === 1 ? "Set zoom level" : "Name &amp; download"}</div>
      <div class="dm-mobile-step">Step ${this.step} of 2</div>`;
    left.appendChild(title);
    header.appendChild(left);

    const close = document.createElement("button");
    close.className = "dm-mobile-close";
    close.setAttribute("aria-label", "Close");
    close.textContent = "×";
    close.disabled = this.status === "downloading";
    close.addEventListener("click", () => this.close());
    header.appendChild(close);
    inner.appendChild(header);

    const progBar = document.createElement("div");
    progBar.className = "dm-mobile-progress";
    progBar.innerHTML = `<div class="dm-mobile-progress-fill" style="width: ${this.step === 1 ? "50%" : "100%"}"></div>`;
    inner.appendChild(progBar);

    if (this.step === 1) {
      const previewHost =
        existingPreview ?? document.createElement("div");
      previewHost.className = "dm-preview-host";
      inner.appendChild(previewHost);
      if (!existingPreview) this.buildPreviewMap(previewHost);
      inner.appendChild(this.previewBadges());

      const form = document.createElement("div");
      form.className = "dm-mobile-form";
      form.appendChild(this.buildZoomSlider());
      form.appendChild(this.buildEstimate());
      form.appendChild(this.buildWarningSlot());
      const cont = document.createElement("button");
      cont.className = "dm-primary";
      cont.dataset.dmSection = "continue";
      cont.disabled = this.warnLevel === "hard";
      cont.classList.toggle("dm-primary-disabled", this.warnLevel === "hard");
      cont.innerHTML = `
        Continue
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor"
          stroke-width="2" stroke-linecap="round"><path d="M3 7h8M7 3l4 4-4 4" /></svg>`;
      cont.addEventListener("click", () => {
        if (this.warnLevel === "hard") return;
        this.step = 2;
        this.render();
      });
      form.appendChild(cont);
      inner.appendChild(form);
    } else {
      const form = document.createElement("div");
      form.className = "dm-mobile-form";
      form.appendChild(this.buildNameDescFields());
      form.appendChild(this.buildBoundsRow());
      form.appendChild(this.buildEstimate());
      form.appendChild(this.buildWarningSlot());
      if (this.status === "error" && this.errorText) {
        form.appendChild(this.buildErrorBanner());
      }
      if (this.status === "downloading") form.appendChild(this.buildProgress());
      if (this.status === "success") form.appendChild(this.buildSuccess());
      const primaryWrap = document.createElement("div");
      primaryWrap.className = "dm-mobile-primary-wrap";
      primaryWrap.appendChild(this.buildPrimaryButton());
      form.appendChild(primaryWrap);
      inner.appendChild(form);
    }

    this.el.appendChild(inner);
  }

  private previewBadges() {
    const wrap = document.createElement("div");
    wrap.className = "dm-preview-badges";
    wrap.innerHTML = `
      <div class="dm-preview-zoom">Preview · zoom ${this.maxZoom}</div>
      <div class="dm-preview-hint">Pan to inspect features at this zoom · zoom is locked</div>`;
    return wrap;
  }

  private buildZoomSlider() {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <label class="dm-label">Max zoom</label>
      <div class="dm-zoom-row">
        <input type="range" min="${MIN_ZOOM_LIMIT}" max="${this.effectiveMaxZoom}" step="1" class="dm-zoom-slider" />
        <span class="dm-zoom-num"></span>
      </div>
      <div class="dm-zoom-ticks">
        <span>City</span><span>Street</span><span>Building</span>
      </div>`;
    const input = wrap.querySelector<HTMLInputElement>(".dm-zoom-slider")!;
    const num = wrap.querySelector<HTMLSpanElement>(".dm-zoom-num")!;
    input.value = String(this.maxZoom);
    num.textContent = String(this.maxZoom);
    input.addEventListener("input", () => {
      this.maxZoom = Number(input.value);
      num.textContent = String(this.maxZoom);
      this.applyCachedSampleForZoom();
      this.softUpdate();
      // Debounced live sample for the new zoom; the cached value (if any)
      // shows immediately above so the user isn't staring at "—".
      this.kickoffSample(250);
    });
    return wrap;
  }

  /** Pull the cached avg-bytes for the current maxZoom (if any) into
   *  `this.avgTileBytes` so softUpdate paints with it. */
  private applyCachedSampleForZoom() {
    const cached = this.sampleByZoom.get(this.maxZoom);
    this.avgTileBytes = cached ?? null;
  }

  /** Kick off a tile-size sample for the current (style, maxZoom) after the
   *  given debounce. If a result is already cached we only update the UI. */
  private kickoffSample(debounceMs: number) {
    if (!this.currentStyle || !this.currentGeoBbox) return;
    if (this.sampleByZoom.has(this.maxZoom)) {
      this.applyCachedSampleForZoom();
      return;
    }
    if (this.sampleTimer) clearTimeout(this.sampleTimer);
    if (debounceMs === 0) {
      void this.runSample();
    } else {
      this.sampleTimer = setTimeout(() => {
        this.sampleTimer = null;
        void this.runSample();
      }, debounceMs);
    }
  }

  private async runSample() {
    if (!this.currentStyle || !this.currentGeoBbox) return;
    // Cancel any prior sample that might still be in flight.
    this.sampleAbort?.abort();
    const ctrl = new AbortController();
    this.sampleAbort = ctrl;

    const targetZoom = this.maxZoom;
    const style = this.currentStyle;
    const bbox = bboxToArr(this.currentGeoBbox);

    try {
      // Resolve once per style — TileJSON and style.json fetches are stable.
      if (this.resolvedTileUrls === null) {
        this.resolvedTileUrls = await resolveDataTileUrls(style, ctrl.signal);
      }
      if (ctrl.signal.aborted) return;

      const avg = await sampleAvgTileBytes({
        tileUrls: this.resolvedTileUrls,
        bounds: bbox,
        maxzoom: targetZoom,
        signal: ctrl.signal,
      });
      if (ctrl.signal.aborted) return;
      if (avg != null) {
        this.sampleByZoom.set(targetZoom, avg);
        if (this.maxZoom === targetZoom) {
          this.avgTileBytes = avg;
          this.softUpdate();
        }
      }
    } catch {
      // swallow — fall back to the default constant
    }
  }

  private async resolveAsyncMaxZoom() {
    if (!this.currentStyle || !this.currentGeoBbox) return;
    this.maxZoomResolveAbort?.abort();
    const ctrl = new AbortController();
    this.maxZoomResolveAbort = ctrl;
    const max = await getStyleMaxZoomAsync(
      this.currentStyle,
      bboxToArr(this.currentGeoBbox),
      ctrl.signal,
    );
    if (ctrl.signal.aborted) return;
    if (max == null) return;
    const next = Math.min(MAX_ZOOM_LIMIT, max);
    if (next === this.effectiveMaxZoom) return;
    this.effectiveMaxZoom = next;
    if (this.maxZoom > next) this.maxZoom = next;
    // Slider's `max` attribute is set inside buildZoomSlider() — re-render so
    // it picks up the tightened cap.
    this.render();
  }

  private buildNameDescFields() {
    const wrap = document.createElement("div");
    wrap.className = "dm-fields";
    wrap.innerHTML = `
      <div>
        <label class="dm-label">Name</label>
        <input type="text" class="dm-input dm-name" placeholder="e.g. London — Hyde Park & Mayfair" />
      </div>
      <div>
        <label class="dm-label">Description <span class="dm-label-aux">· optional</span></label>
        <textarea class="dm-input dm-desc" rows="2" placeholder="Notes about what this package contains."></textarea>
      </div>`;
    const nameEl = wrap.querySelector<HTMLInputElement>(".dm-name")!;
    const descEl = wrap.querySelector<HTMLTextAreaElement>(".dm-desc")!;
    nameEl.value = this.name;
    descEl.value = this.desc;
    nameEl.addEventListener("input", () => (this.name = nameEl.value));
    descEl.addEventListener("input", () => (this.desc = descEl.value));
    return wrap;
  }

  private buildBoundsRow() {
    const wrap = document.createElement("div");
    wrap.className = "dm-bounds-row";
    const g = this.currentGeoBbox;
    const wsen = g
      ? [g.west, g.south, g.east, g.north]
          .map((n) => n.toFixed(4))
          .join(", ")
      : "—";
    wrap.innerHTML = `<span class="dm-bounds-label">Bounds</span><span class="dm-bounds-val"></span>`;
    wrap.querySelector(".dm-bounds-val")!.textContent = wsen;
    return wrap;
  }

  private buildEstimate() {
    const wrap = document.createElement("div");
    wrap.className = "dm-estimate";
    wrap.dataset.dmSection = "estimate";
    wrap.innerHTML = `<span>Estimated</span><span class="dm-estimate-val"></span>`;
    wrap.querySelector(".dm-estimate-val")!.textContent = this.estimateText();
    return wrap;
  }

  private estimateText() {
    return `${this.tileCount.toLocaleString()} tiles · ~${formatBytes(this.tileCount * this.bytesPerTile)}`;
  }

  /** Wrapper slot for the warning banner so softUpdate can swap its contents
   *  in place without rebuilding the surrounding form. */
  private buildWarningSlot() {
    const slot = document.createElement("div");
    slot.dataset.dmSection = "warn-slot";
    const banner = this.buildWarning();
    if (banner) slot.appendChild(banner);
    return slot;
  }

  private buildWarning() {
    const lvl = this.warnLevel;
    if (!lvl) return null;
    const wrap = document.createElement("div");
    wrap.className = `dm-warn dm-warn-${lvl}`;
    const icon = lvl === "hard" ? "⛔" : "⚠";
    const sizeStr = formatBytes(this.tileCount * this.bytesPerTile);
    const msg =
      lvl === "hard"
        ? `This package is very large (<b>${this.tileCount.toLocaleString()} tiles · ~${sizeStr}</b>). Consider lowering max zoom or shrinking the area.`
        : `Heads up — this package is large (~<b>${sizeStr}</b>). Make sure you're on Wi-Fi.`;
    wrap.innerHTML = `<span class="dm-warn-icon">${icon}</span><span>${msg}</span>`;
    return wrap;
  }

  private buildErrorBanner() {
    const wrap = document.createElement("div");
    wrap.className = "dm-warn dm-warn-hard";
    wrap.innerHTML = `<span class="dm-warn-icon">⛔</span><span></span>`;
    wrap.querySelector("span:last-child")!.textContent = this.errorText ?? "";
    return wrap;
  }

  private buildProgress() {
    const wrap = document.createElement("div");
    wrap.className = "dm-progress";
    const pct = Math.round(this.progress * 100);
    wrap.innerHTML = `
      <div class="dm-progress-row">
        <span>Downloading…</span><span class="dm-progress-pct">${pct}%</span>
      </div>
      <div class="dm-progress-track"><div class="dm-progress-fill" style="width:${pct}%"></div></div>`;
    return wrap;
  }

  private buildSuccess() {
    const wrap = document.createElement("div");
    wrap.className = "dm-success";
    wrap.innerHTML = `<span>✓</span><span>Package saved.</span>`;
    return wrap;
  }

  private buildPrimaryButton() {
    const btn = document.createElement("button");
    btn.className = "dm-primary";
    btn.dataset.dmSection = "primary";
    const isDownloading = this.status === "downloading";
    btn.disabled = isDownloading || this.warnLevel === "hard";
    btn.classList.toggle("dm-primary-disabled", btn.disabled);
    btn.classList.toggle("dm-primary-error", this.status === "error");
    btn.classList.toggle("dm-primary-success", this.status === "success");

    let label: string;
    if (this.status === "idle") label = "Download package";
    else if (this.status === "downloading")
      label = `Downloading… ${Math.round(this.progress * 100)}%`;
    else if (this.status === "error") label = "Retry download";
    else label = "Done";

    if (isDownloading) {
      btn.innerHTML = `
        <svg class="dm-spin" width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="5" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2" />
          <path d="M12 7a5 5 0 0 0-5-5" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" />
        </svg>
        <span>${label}</span>`;
    } else {
      btn.textContent = label;
    }
    btn.addEventListener("click", () => {
      if (this.status === "success") this.close();
      else this.startDownload();
    });
    return btn;
  }

  /** Update only the parts of the form that depend on maxZoom. We deliberately
   *  do NOT call render() here — that would rebuild the slider element mid-drag
   *  and break native pointer capture (you'd only get one zoom-level per drag). */
  private softUpdate() {
    if (this.previewMap) {
      this.previewMap.map.easeTo({ zoom: this.maxZoom, duration: 250 });
    }
    const zoomBadge = this.el.querySelector(".dm-preview-zoom");
    if (zoomBadge) zoomBadge.textContent = `Preview · zoom ${this.maxZoom}`;

    const estimateVal = this.el.querySelector<HTMLElement>(".dm-estimate-val");
    if (estimateVal) {
      estimateVal.textContent = this.estimateText();
      estimateVal.classList.toggle(
        "dm-estimate-provisional",
        !this.sizeIsFromSample,
      );
    }

    // Swap the warning banner contents without touching the surrounding form.
    const warnSlots = this.el.querySelectorAll<HTMLDivElement>(
      '[data-dm-section="warn-slot"]',
    );
    warnSlots.forEach((slot) => {
      slot.replaceChildren();
      const banner = this.buildWarning();
      if (banner) slot.appendChild(banner);
    });

    // Reflect the warnLevel on the primary + Continue buttons.
    const hardBlock = this.warnLevel === "hard";
    this.el
      .querySelectorAll<HTMLButtonElement>(
        '[data-dm-section="primary"], [data-dm-section="continue"]',
      )
      .forEach((btn) => {
        const isDownloading =
          btn.dataset.dmSection === "primary" && this.status === "downloading";
        btn.disabled = isDownloading || hardBlock;
        btn.classList.toggle("dm-primary-disabled", btn.disabled);
      });
  }

  private startDownload() {
    if (!this.currentStyle || !this.currentGeoBbox) return;
    if (this.warnLevel === "hard") return;
    this.status = "downloading";
    this.progress = 0;
    this.errorText = null;
    this.render();

    this.controller = this.opts.onDownload(
      {
        style: this.currentStyle,
        bbox: this.currentGeoBbox,
        maxZoom: this.maxZoom,
        name: this.name.trim() || "map",
        description: this.desc.trim(),
      },
      {
        onProgress: ({ fraction, done }) => {
          this.progress = Math.max(0, Math.min(1, fraction));
          if (done) {
            this.status = "success";
            this.progress = 1;
          }
          this.render();
        },
        onError: (msg) => {
          this.status = "error";
          this.errorText = msg;
          this.render();
        },
      },
    );
  }
}

/** Format a byte count as KB / MB / GB. We avoid `0.0 MB` rounding for small
 *  but non-zero values (which the toFixed(1) approach used to produce). */
function formatBytes(bytes: number): string {
  if (bytes < 1) return "<1 KB";
  const KB = bytes / 1024;
  if (KB < 1024) {
    return KB < 10 ? `${KB.toFixed(1)} KB` : `${Math.round(KB)} KB`;
  }
  const MB = KB / 1024;
  if (MB < 1024) {
    return MB < 10 ? `${MB.toFixed(1)} MB` : `${Math.round(MB)} MB`;
  }
  const GB = MB / 1024;
  return GB < 10 ? `${GB.toFixed(2)} GB` : `${GB.toFixed(1)} GB`;
}
