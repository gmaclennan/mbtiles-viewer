import {
  PRESET_STYLES,
  PRESET_CATEGORIES,
  CATEGORY_LABELS,
  LICENSE_COLORS,
  LICENSE_LABELS,
  CUSTOM_URL_ATTRIBUTION,
  fillTileUrl,
  hasSubdomainPlaceholder,
  isTileUrlTemplate,
  lngLatToTile,
  rasterStyleForTileUrl,
  styleForTileJson,
  type AppStyle,
  type CustomStyle,
  type PresetStyle,
  type StyleCategory,
  type StyleKind,
  type TileScheme,
} from "./preset-styles.ts";
import {
  QMS_CATALOGUE,
  qmsToStyle,
  type QmsCatalogueEntry,
} from "./qms-catalogue.ts";
import {
  loadRecents,
  recentIdForUrl,
  removeRecent,
  saveRecent,
  type RecentEntry,
} from "./recents-store.ts";

/** Zoom used for the card preview tile (city-level detail). */
const PREVIEW_ZOOM = 12;

type Tab = "browse" | "recents" | "custom" | "mbtiles";

/** A row in the Browse grid — a curated preset or a QMS catalogue entry. */
type BrowseEntry =
  | { source: "preset"; preset: PresetStyle }
  | { source: "qms"; qms: QmsCatalogueEntry };

interface FilterState {
  curated: boolean;
  categories: Set<StyleCategory>;
  kinds: Set<StyleKind>;
}

export interface StylePickerOptions {
  /** Selected when user picks a preset, QMS entry or validated custom URL. */
  onSelectStyle: (style: AppStyle) => void;
  /** Triggered when the user picks an .mbtiles file. */
  onSelectMbtiles: (file: File) => void;
  /** True on small viewports — picker becomes full-screen, no drag-drop on mbtiles. */
  isMobile: () => boolean;
}

interface TokenInfo {
  required: boolean;
  providerLabel?: string;
  paramName?: string;
  placeholder?: string;
}

function detectToken(url: string): TokenInfo {
  if (!url) return { required: false };
  const lower = url.toLowerCase();
  const has = (param: string) =>
    new RegExp("[?&]" + param + "=", "i").test(url);
  if (lower.includes("api.mapbox.com")) {
    return has("access_token")
      ? { required: false }
      : {
          required: true,
          providerLabel: "Mapbox",
          paramName: "access_token",
          placeholder: "pk.eyJ1IjoieW91c…",
        };
  }
  if (lower.includes("api.maptiler.com")) {
    return has("key")
      ? { required: false }
      : {
          required: true,
          providerLabel: "MapTiler",
          paramName: "key",
          placeholder: "your MapTiler key",
        };
  }
  if (lower.includes("api.thunderforest.com")) {
    return has("apikey")
      ? { required: false }
      : {
          required: true,
          providerLabel: "Thunderforest",
          paramName: "apikey",
          placeholder: "your Thunderforest API key",
        };
  }
  if (lower.includes("api.stadiamaps.com")) {
    return has("api_key")
      ? { required: false }
      : {
          required: true,
          providerLabel: "Stadia Maps",
          paramName: "api_key",
          placeholder: "your Stadia Maps API key",
        };
  }
  return { required: false };
}

function injectToken(url: string, paramName: string, token: string): string {
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}${paramName}=${encodeURIComponent(token)}`;
}

const DEFAULT_SUBDOMAIN_TEXT = "a, b, c";

/** Split a comma/space-separated subdomain list into trimmed, non-empty parts. */
function parseSubdomains(text: string): string[] {
  return text
    .split(/[,\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Solid card backdrop shown before (or instead of) the tile thumbnail. */
const FALLBACK_BG: Record<string, string> = {
  "street-light": "#e6e5df",
  "street-dark": "#2a2f3a",
  "satellite-light": "#3d5f6e",
  "satellite-dark": "#1a3b5c",
  "terrain-light": "#cdb98c",
  "terrain-dark": "#26331f",
  "activity-light": "#f1ede2",
  "activity-dark": "#2a2433",
};
function fallbackBg(category: StyleCategory, tone: string): string {
  return FALLBACK_BG[`${category}-${tone}`] ?? "#ccc";
}

export class StylePicker {
  readonly el: HTMLDivElement;
  private opts: StylePickerOptions;
  private currentStyleId: string | null = null;
  private tab: Tab = "browse";
  private customUrl = "";
  private token = "";
  /** Comma-separated subdomain list for `{subdomain}`/`{s}` templates. */
  private subdomainText = "";
  /** Tile scheme chosen in the Custom URL panel for tile-template sources. */
  private scheme: TileScheme = "xyz";
  private validating = false;
  private validateMsg: { ok: boolean; text: string } | null = null;
  private bodyEl: HTMLDivElement;
  private tabsEl: HTMLDivElement;
  private isOpen = false;
  /** Map center used to pick a preview tile per card. */
  private previewCenter: [number, number] = [0, 51.5];
  private recents: RecentEntry[] = [];
  private filter: FilterState = {
    curated: true,
    categories: new Set(),
    kinds: new Set(),
  };
  /** Vendored QMS catalogue — no network request. */
  private qmsEntries: QmsCatalogueEntry[] = QMS_CATALOGUE;

  constructor(options: StylePickerOptions) {
    this.opts = options;
    this.el = document.createElement("div");
    this.el.className = "sp-backdrop hidden";
    this.el.addEventListener("click", (e) => {
      if (e.target === this.el && !this.opts.isMobile()) this.close();
    });

    const inner = document.createElement("div");
    inner.className = "sp-inner";
    inner.addEventListener("click", (e) => e.stopPropagation());
    this.el.appendChild(inner);

    const header = document.createElement("div");
    header.className = "sp-header";
    header.innerHTML = `
      <div class="sp-title">Map style</div>
      <button class="sp-close" aria-label="Close">×</button>
    `;
    header
      .querySelector(".sp-close")
      ?.addEventListener("click", () => this.close());
    inner.appendChild(header);

    this.tabsEl = document.createElement("div");
    this.tabsEl.className = "sp-tabs";
    inner.appendChild(this.tabsEl);

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "sp-body";
    inner.appendChild(this.bodyEl);
  }

  open(
    currentStyleId: string | null,
    mapCenter: [number, number] = [0, 51.5],
  ) {
    this.currentStyleId = currentStyleId;
    this.previewCenter = mapCenter;
    this.recents = loadRecents();
    // "Curated" is selected by default every time the modal opens.
    this.filter = {
      curated: true,
      categories: new Set(),
      kinds: new Set(),
    };
    // Don't strand the user on the Recents tab if it's no longer available.
    if (this.tab === "recents" && this.recents.length === 0) {
      this.tab = "browse";
    }
    this.isOpen = true;
    this.el.classList.toggle("sp-mobile", this.opts.isMobile());
    this.el.classList.remove("hidden");
    this.renderTabs();
    this.render();
  }

  /** (Re)build the tab strip. Recents only appears when there are recents. */
  private renderTabs() {
    this.tabsEl.replaceChildren();
    const tabs: Tab[] =
      this.recents.length > 0
        ? ["browse", "recents", "custom", "mbtiles"]
        : ["browse", "custom", "mbtiles"];
    for (const t of tabs) {
      const btn = document.createElement("button");
      btn.className = "sp-tab";
      btn.dataset.tab = t;
      btn.textContent =
        t === "browse"
          ? "Browse"
          : t === "recents"
            ? "Recents"
            : t === "custom"
              ? "Custom URL"
              : ".mbtiles file";
      btn.addEventListener("click", () => this.setTab(t));
      this.tabsEl.appendChild(btn);
    }
  }

  close() {
    this.isOpen = false;
    this.el.classList.add("hidden");
  }

  private setTab(t: Tab) {
    this.tab = t;
    this.validateMsg = null;
    this.render();
  }

  private render() {
    if (!this.isOpen) return;
    Array.from(this.tabsEl.children).forEach((c) => {
      const btn = c as HTMLButtonElement;
      btn.classList.toggle("sp-tab-active", btn.dataset.tab === this.tab);
    });
    this.bodyEl.innerHTML = "";
    if (this.tab === "browse") this.renderBrowse();
    else if (this.tab === "recents") this.renderRecents();
    else if (this.tab === "custom") this.renderCustom();
    else this.renderMbtiles();
  }

  // ─── Browse tab ─────────────────────────────────────────────────────────

  /** All Browse rows — presets always, QMS once loaded. */
  private allEntries(): BrowseEntry[] {
    const out: BrowseEntry[] = PRESET_STYLES.map((preset) => ({
      source: "preset" as const,
      preset,
    }));
    for (const qms of this.qmsEntries) {
      out.push({ source: "qms", qms });
    }
    return out;
  }

  private entryCategory(e: BrowseEntry): StyleCategory {
    return e.source === "preset" ? e.preset.category : e.qms.category;
  }
  private entryKind(e: BrowseEntry): StyleKind {
    return e.source === "preset" ? e.preset.kind : "raster";
  }

  /** Does an entry pass the filter, optionally ignoring one chip group so we
   *  can compute "how many would this chip add" counts. */
  private passes(e: BrowseEntry, ignore?: "curated" | "category" | "kind") {
    const f = this.filter;
    if (ignore !== "curated" && f.curated && e.source !== "preset") {
      return false;
    }
    if (
      ignore !== "category" &&
      f.categories.size &&
      !f.categories.has(this.entryCategory(e))
    ) {
      return false;
    }
    if (
      ignore !== "kind" &&
      f.kinds.size &&
      !f.kinds.has(this.entryKind(e))
    ) {
      return false;
    }
    return true;
  }

  private filteredEntries(): BrowseEntry[] {
    const list = this.allEntries().filter((e) => this.passes(e));
    // Presets (curated) first, then QMS by popularity descending.
    list.sort((a, b) => {
      const ap = a.source === "preset" ? 0 : 1;
      const bp = b.source === "preset" ? 0 : 1;
      if (ap !== bp) return ap - bp;
      if (a.source === "qms" && b.source === "qms") {
        return b.qms.popularity - a.qms.popularity;
      }
      return 0;
    });
    return list;
  }

  private renderBrowse() {
    const wrap = document.createElement("div");
    wrap.className = "sp-browse";

    wrap.appendChild(this.buildChipRow());

    const head = document.createElement("div");
    head.className = "sp-results-head";
    const results = this.filteredEntries();
    const countEl = document.createElement("span");
    countEl.className = "sp-results-count";
    countEl.textContent = `${results.length} ${
      results.length === 1 ? "result" : "results"
    }`;
    head.appendChild(countEl);
    if (this.filter.curated || this.filter.categories.size || this.filter.kinds.size) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "sp-clear-btn";
      clear.textContent = "Clear";
      clear.addEventListener("click", () => {
        this.filter = {
          curated: false,
          categories: new Set(),
          kinds: new Set(),
        };
        this.render();
      });
      head.appendChild(clear);
    }
    wrap.appendChild(head);

    if (results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "sp-empty";
      empty.innerHTML = `<div class="sp-empty-mark">∅</div>
        <div>Nothing matches those filters.</div>
        <div class="sp-empty-sub">Try clearing a filter.</div>`;
      wrap.appendChild(empty);
    } else {
      const grid = document.createElement("div");
      grid.className = "sp-preset-grid";
      grid.classList.toggle("sp-preset-grid-mobile", this.opts.isMobile());
      for (const e of results) grid.appendChild(this.browseCard(e));
      wrap.appendChild(grid);
    }

    this.bodyEl.appendChild(wrap);
  }

  private buildChipRow(): HTMLDivElement {
    const row = document.createElement("div");
    row.className = "sp-chip-row";

    interface ChipDef {
      label: string;
      active: boolean;
      count: number;
      star?: boolean;
      toggle: () => void;
    }
    const all = this.allEntries();
    const chips: ChipDef[] = [];
    chips.push({
      label: "Curated",
      star: true,
      active: this.filter.curated,
      count: all.filter(
        (e) => e.source === "preset" && this.passes(e, "curated"),
      ).length,
      toggle: () => {
        this.filter.curated = !this.filter.curated;
        this.render();
      },
    });
    for (const cat of PRESET_CATEGORIES) {
      chips.push({
        label: cat.label,
        active: this.filter.categories.has(cat.id),
        count: all.filter(
          (e) =>
            this.entryCategory(e) === cat.id && this.passes(e, "category"),
        ).length,
        toggle: () => {
          toggleSet(this.filter.categories, cat.id);
          this.render();
        },
      });
    }
    for (const kind of ["vector", "raster"] as StyleKind[]) {
      chips.push({
        label: kind === "vector" ? "Vector" : "Raster",
        active: this.filter.kinds.has(kind),
        count: all.filter(
          (e) => this.entryKind(e) === kind && this.passes(e, "kind"),
        ).length,
        toggle: () => {
          toggleSet(this.filter.kinds, kind);
          this.render();
        },
      });
    }

    for (const c of chips) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sp-chip";
      btn.classList.toggle("sp-chip-active", c.active);
      const dim = c.count === 0 && !c.active;
      btn.classList.toggle("sp-chip-dim", dim);
      btn.disabled = dim;
      btn.innerHTML = `${c.star ? STAR_SVG : ""}<span class="sp-chip-label"></span><span class="sp-chip-count">${c.count}</span>`;
      btn.querySelector(".sp-chip-label")!.textContent = c.label;
      if (!dim) btn.addEventListener("click", c.toggle);
      row.appendChild(btn);
    }
    return row;
  }

  private browseCard(e: BrowseEntry): HTMLButtonElement {
    const card = document.createElement("button");
    card.className = "sp-preset-card";
    card.type = "button";

    const isPreset = e.source === "preset";
    const id = isPreset ? e.preset.id : `qms-${e.qms.qmsId}`;
    const name = isPreset ? e.preset.name : e.qms.name;
    const desc = isPreset ? e.preset.desc : e.qms.desc;
    const category = this.entryCategory(e);
    const tone = isPreset ? e.preset.tone : e.qms.tone;
    const kind = this.entryKind(e);
    const license = isPreset ? e.preset.license : e.qms.license;
    const tileUrl = isPreset ? e.preset.previewTileUrl : e.qms.url;

    if (this.currentStyleId === id) card.classList.add("sp-preset-active");

    // ── Thumbnail ──
    const thumb = document.createElement("div");
    thumb.className = "sp-thumb";
    thumb.style.background = fallbackBg(category, tone);
    const scheme = isPreset ? e.preset.scheme : undefined;
    const pz = (isPreset && e.preset.previewZoom) || PREVIEW_ZOOM;
    const [lng, lat] = this.previewCenter;
    const { x, y } = lngLatToTile(lng, lat, pz);
    // TMS sources count y from the bottom — flip it for the preview tile.
    const ty = scheme === "tms" ? 2 ** pz - 1 - y : y;
    const img = document.createElement("img");
    img.className = "sp-thumb-img";
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = fillTileUrl(tileUrl, pz, x, ty);
    img.addEventListener("error", () => img.remove());
    thumb.appendChild(img);

    // Curated presets get a gold-star badge; QMS entries show their category
    // in the meta strip instead of a thumbnail overlay.
    if (isPreset) {
      const star = document.createElement("div");
      star.className = "sp-badge-star";
      star.title = "Curated pick";
      star.innerHTML = STAR_SVG;
      thumb.appendChild(star);
    }
    card.appendChild(thumb);

    // ── Meta strip ──
    const meta = document.createElement("div");
    meta.className = "sp-preset-meta";

    const nameRow = document.createElement("div");
    nameRow.className = "sp-preset-name-row";
    const nameEl = document.createElement("div");
    nameEl.className = "sp-preset-name";
    nameEl.textContent = name;
    nameRow.appendChild(nameEl);
    const dot = document.createElement("span");
    dot.className = "sp-license-dot";
    dot.style.background = LICENSE_COLORS[license];
    dot.title = LICENSE_LABELS[license];
    nameRow.appendChild(dot);
    meta.appendChild(nameRow);

    const descEl = document.createElement("div");
    descEl.className = "sp-preset-desc";
    descEl.textContent = desc;
    meta.appendChild(descEl);

    const tag = document.createElement("div");
    tag.className = "sp-preset-tag";
    tag.textContent = isPreset
      ? `${kind} · ${tone}`
      : `${kind} · ${CATEGORY_LABELS[category]}`;
    meta.appendChild(tag);
    card.appendChild(meta);

    card.addEventListener("click", () => {
      this.opts.onSelectStyle(
        isPreset ? e.preset : qmsToStyle(e.qms),
      );
      this.close();
    });
    return card;
  }

  // ─── Recents tab ────────────────────────────────────────────────────────

  private renderRecents() {
    const grid = document.createElement("div");
    grid.className = "sp-preset-grid";
    grid.classList.toggle("sp-preset-grid-mobile", this.opts.isMobile());
    for (const r of this.recents) {
      grid.appendChild(this.recentCard(r));
    }
    this.bodyEl.appendChild(grid);
  }

  private recentCard(r: RecentEntry) {
    const card = document.createElement("button");
    card.className = "sp-preset-card";
    if (this.currentStyleId === "custom") card.classList.add("sp-preset-active");

    const thumb = document.createElement("div");
    thumb.className = "sp-thumb";
    thumb.style.background = "#dcdad4";
    if (r.previewKind === "raster" && r.previewTileUrl) {
      const [lng, lat] = this.previewCenter;
      const { x, y } = lngLatToTile(lng, lat, PREVIEW_ZOOM);
      const url = fillTileUrl(
        r.previewTileUrl,
        PREVIEW_ZOOM,
        x,
        y,
        r.subdomains,
      );
      const img = document.createElement("img");
      img.className = "sp-thumb-img";
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.crossOrigin = "anonymous";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = url;
      img.addEventListener("error", () => img.remove());
      thumb.appendChild(img);
    }
    card.appendChild(thumb);

    const meta = document.createElement("div");
    meta.className = "sp-preset-meta";
    let host = r.url;
    try {
      host = new URL(r.url).hostname.replace(/^www\./, "");
    } catch {
      /* leave as-is */
    }
    meta.innerHTML = `
      <div class="sp-preset-name"></div>
      <div class="sp-preset-desc"></div>
      <div class="sp-recent-row">
        <span class="sp-preset-tag"></span>
        <button class="sp-recent-remove" type="button" aria-label="Remove from recents">×</button>
      </div>`;
    meta.querySelector(".sp-preset-name")!.textContent = host;
    meta.querySelector(".sp-preset-desc")!.textContent = r.url;
    meta.querySelector(".sp-preset-tag")!.textContent = `${r.kind} · custom`;
    card.appendChild(meta);

    card.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).classList.contains("sp-recent-remove")) {
        return;
      }
      this.opts.onSelectStyle(this.styleFromRecent(r));
      this.close();
    });
    meta
      .querySelector<HTMLButtonElement>(".sp-recent-remove")!
      .addEventListener("click", (e) => {
        e.stopPropagation();
        removeRecent(r.id);
        this.recents = loadRecents();
        this.renderTabs();
        if (this.recents.length === 0) {
          this.tab = "browse";
        }
        this.render();
      });
    return card;
  }

  private styleFromRecent(r: RecentEntry): CustomStyle {
    return {
      id: "custom",
      name: r.name,
      desc: r.url,
      url: r.url,
      kind: r.kind,
      spec: r.spec,
      accessToken: r.accessToken,
      maxZoom: r.maxZoom,
      // Custom sources carry no licence metadata — flag them restrictive.
      license: "restrictive",
      attribution: CUSTOM_URL_ATTRIBUTION,
    };
  }

  // ─── Custom URL tab ─────────────────────────────────────────────────────

  private renderCustom() {
    const wrap = document.createElement("div");
    wrap.className = "sp-custom";
    wrap.innerHTML = `
      <p class="sp-prose">
        Paste a link to a Mapbox/MapLibre <code>style.json</code>, a TileJSON,
        or a tile URL template containing <code>{z}/{x}/{y}</code> or
        <code>{quadkey}</code>.
      </p>
      <input type="url" class="sp-input sp-url" placeholder="https://example.com/style.json" />
      <div class="sp-scheme-wrap"></div>
      <div class="sp-token-wrap"></div>
      <div class="sp-subdomain-wrap"></div>
      <div class="sp-validate-msg"></div>
      <button class="sp-validate-btn" type="button">Validate &amp; use</button>
    `;
    const urlInput = wrap.querySelector<HTMLInputElement>(".sp-url")!;
    urlInput.value = this.customUrl;
    urlInput.addEventListener("input", () => {
      this.customUrl = urlInput.value;
      this.renderSchemeSection(wrap);
      this.renderTokenSection(wrap);
      this.renderSubdomainSection(wrap);
      this.renderValidateMsg(wrap);
      this.updateValidateBtn(wrap);
    });

    this.renderSchemeSection(wrap);
    this.renderTokenSection(wrap);
    this.renderSubdomainSection(wrap);
    this.renderValidateMsg(wrap);

    const btn = wrap.querySelector<HTMLButtonElement>(".sp-validate-btn")!;
    btn.addEventListener("click", () => this.validateAndSelect(wrap));
    this.updateValidateBtn(wrap);
    this.bodyEl.appendChild(wrap);
  }

  /** XYZ/TMS picker — only shown for tile-template URLs. */
  private renderSchemeSection(wrap: HTMLDivElement) {
    const host = wrap.querySelector<HTMLDivElement>(".sp-scheme-wrap")!;
    host.innerHTML = "";
    if (!isTileUrlTemplate(this.customUrl)) return;
    host.innerHTML = `
      <div class="sp-scheme-box">
        <div class="sp-scheme-title">Tile scheme</div>
        <div class="sp-scheme-options">
          <button type="button" class="sp-scheme-opt" data-scheme="xyz">
            <span class="sp-scheme-opt-name">XYZ</span>
            <span class="sp-scheme-opt-hint">Y axis grows downward (Google / OSM).</span>
          </button>
          <button type="button" class="sp-scheme-opt" data-scheme="tms">
            <span class="sp-scheme-opt-name">TMS</span>
            <span class="sp-scheme-opt-hint">Y axis grows upward (OGC TMS spec).</span>
          </button>
        </div>
        <div class="sp-scheme-hint">
          Tiles appear upside-down or mis-stacked? Toggle this.
        </div>
      </div>`;
    const opts = host.querySelectorAll<HTMLButtonElement>(".sp-scheme-opt");
    const paint = () => {
      opts.forEach((o) =>
        o.classList.toggle(
          "sp-scheme-opt-active",
          o.dataset.scheme === this.scheme,
        ),
      );
    };
    opts.forEach((o) =>
      o.addEventListener("click", () => {
        this.scheme = o.dataset.scheme as TileScheme;
        paint();
      }),
    );
    paint();
  }

  private renderTokenSection(wrap: HTMLDivElement) {
    const tokenWrap = wrap.querySelector<HTMLDivElement>(".sp-token-wrap")!;
    tokenWrap.innerHTML = "";
    const info = detectToken(this.customUrl);
    if (!info.required) return;
    tokenWrap.innerHTML = `
      <div class="sp-token-box">
        <div class="sp-token-header">
          <span class="sp-token-provider">${info.providerLabel} access token required</span>
          <span class="sp-token-param">?${info.paramName}=</span>
        </div>
        <input type="text" class="sp-input sp-token-input"
               placeholder="${info.placeholder}" autocomplete="off" spellcheck="false" />
        <div class="sp-token-hint">
          Appended to the URL at request time. Your token isn't stored or shared.
        </div>
      </div>`;
    const tokenInput = tokenWrap.querySelector<HTMLInputElement>(
      ".sp-token-input",
    )!;
    tokenInput.value = this.token;
    tokenInput.addEventListener("input", () => {
      this.token = tokenInput.value;
      this.updateValidateBtn(wrap);
    });
  }

  private renderSubdomainSection(wrap: HTMLDivElement) {
    const subWrap = wrap.querySelector<HTMLDivElement>(".sp-subdomain-wrap")!;
    subWrap.innerHTML = "";
    if (!hasSubdomainPlaceholder(this.customUrl)) return;
    subWrap.innerHTML = `
      <div class="sp-token-box">
        <div class="sp-token-header">
          <span class="sp-token-provider">Subdomains</span>
          <span class="sp-token-param">{subdomain}</span>
        </div>
        <input type="text" class="sp-input sp-token-input sp-subdomain-input"
               placeholder="${DEFAULT_SUBDOMAIN_TEXT}" autocomplete="off" spellcheck="false" />
        <div class="sp-token-hint">
          Comma-separated hosts to round-robin across (e.g.
          <code>t0, t1, t2, t3</code> for Bing). Defaults to
          <code>${DEFAULT_SUBDOMAIN_TEXT}</code>.
        </div>
      </div>`;
    const input = subWrap.querySelector<HTMLInputElement>(
      ".sp-subdomain-input",
    )!;
    input.value = this.subdomainText;
    input.addEventListener("input", () => {
      this.subdomainText = input.value;
    });
  }

  private updateValidateBtn(wrap: HTMLDivElement) {
    const btn = wrap.querySelector<HTMLButtonElement>(".sp-validate-btn")!;
    const tokenInfo = detectToken(this.customUrl);
    const disabled =
      !this.customUrl ||
      this.validating ||
      (tokenInfo.required && !this.token);
    btn.disabled = disabled;
    btn.classList.toggle("sp-btn-disabled", disabled);
    btn.textContent = this.validating ? "Validating…" : "Validate & use";
  }

  private renderValidateMsg(wrap: HTMLDivElement) {
    const el = wrap.querySelector<HTMLDivElement>(".sp-validate-msg")!;
    el.innerHTML = "";
    if (!this.validateMsg) return;
    const m = document.createElement("div");
    m.className = `sp-msg ${this.validateMsg.ok ? "sp-msg-ok" : "sp-msg-err"}`;
    m.textContent = this.validateMsg.text;
    el.appendChild(m);
  }

  private async validateAndSelect(wrap: HTMLDivElement) {
    if (!this.customUrl) return;
    const tokenInfo = detectToken(this.customUrl);
    if (tokenInfo.required && !this.token) {
      this.validateMsg = {
        ok: false,
        text: `${tokenInfo.providerLabel} requires an access token`,
      };
      this.renderValidateMsg(wrap);
      return;
    }
    this.validating = true;
    this.validateMsg = null;
    this.updateValidateBtn(wrap);

    try {
      const finalUrl =
        tokenInfo.required && this.token
          ? injectToken(this.customUrl, tokenInfo.paramName!, this.token)
          : this.customUrl;

      const subdomains = hasSubdomainPlaceholder(this.customUrl)
        ? parseSubdomains(this.subdomainText)
        : undefined;
      const scheme = isTileUrlTemplate(this.customUrl)
        ? this.scheme
        : undefined;

      const resolved = await resolveCustomStyle(finalUrl, subdomains, scheme);
      const accessToken = tokenInfo.required ? this.token : undefined;

      this.validateMsg = { ok: true, text: "Validated. Loading…" };
      this.renderValidateMsg(wrap);
      const styleWithToken: CustomStyle = {
        ...resolved.style,
        accessToken,
      };
      saveRecent({
        id: recentIdForUrl(this.customUrl),
        url: this.customUrl,
        name: this.customUrl,
        kind: resolved.style.kind,
        spec: resolved.style.spec,
        accessToken,
        maxZoom: resolved.style.maxZoom,
        previewTileUrl: resolved.previewTileUrl,
        previewKind: resolved.previewTileUrl ? "raster" : undefined,
        subdomains: subdomains?.length ? subdomains : undefined,
        addedAt: Date.now(),
      });
      this.opts.onSelectStyle(styleWithToken);
      setTimeout(() => this.close(), 400);
    } catch (e) {
      this.validateMsg = {
        ok: false,
        text: (e as Error).message ?? "Validation failed",
      };
      this.renderValidateMsg(wrap);
    } finally {
      this.validating = false;
      this.updateValidateBtn(wrap);
    }
  }

  // ─── mbtiles tab ────────────────────────────────────────────────────────

  private renderMbtiles() {
    const wrap = document.createElement("div");
    wrap.className = "sp-mbtiles";
    const isMobile = this.opts.isMobile();
    wrap.innerHTML = `
      <p class="sp-prose">
        Load a local <code>.mbtiles</code> file as the basemap.
        The map view will fit to the file's bounds.
      </p>
      ${
        isMobile
          ? `<button class="sp-mbtiles-btn" type="button">Choose .mbtiles file</button>`
          : `<div class="sp-mbtiles-drop"><div class="sp-mbtiles-drop-title">Drop a .mbtiles file</div><div class="sp-mbtiles-drop-sub">or click to choose</div></div>`
      }
      <input type="file" accept=".mbtiles,.sqlite,.sqlite3,.db" class="sp-mbtiles-input" hidden />
    `;
    const fileInput = wrap.querySelector<HTMLInputElement>(
      ".sp-mbtiles-input",
    )!;
    fileInput.addEventListener("change", () => {
      const f = fileInput.files?.[0];
      if (f) {
        this.opts.onSelectMbtiles(f);
        this.close();
      }
    });

    if (isMobile) {
      wrap
        .querySelector<HTMLButtonElement>(".sp-mbtiles-btn")!
        .addEventListener("click", () => fileInput.click());
    } else {
      const drop = wrap.querySelector<HTMLDivElement>(".sp-mbtiles-drop")!;
      drop.addEventListener("click", () => fileInput.click());
      drop.addEventListener("dragover", (e) => {
        e.preventDefault();
        drop.classList.add("sp-mbtiles-drop-hot");
      });
      drop.addEventListener("dragleave", () => {
        drop.classList.remove("sp-mbtiles-drop-hot");
      });
      drop.addEventListener("drop", (e) => {
        e.preventDefault();
        drop.classList.remove("sp-mbtiles-drop-hot");
        const f = e.dataTransfer?.files?.[0];
        if (f) {
          this.opts.onSelectMbtiles(f);
          this.close();
        }
      });
    }
    this.bodyEl.appendChild(wrap);
  }
}

function toggleSet<T>(set: Set<T>, value: T) {
  if (set.has(value)) set.delete(value);
  else set.add(value);
}

const STAR_SVG = `<svg class="sp-star" width="11" height="11" viewBox="0 0 12 12" fill="currentColor"><path d="M6 1l1.5 3.2 3.5.4-2.6 2.4.7 3.4L6 8.7 2.9 10.4l.7-3.4L1 4.6l3.5-.4L6 1z" /></svg>`;

interface ResolvedCustom {
  style: CustomStyle;
  /** Raster {z}/{x}/{y} URL we can use as a thumbnail. Unset when the source
   *  is vector pbf or we couldn't derive one. */
  previewTileUrl?: string;
}

/** Probe a custom URL and return an AppStyle plus a thumbnail tile URL when
 *  derivable. Handles three cases: tile URL template, TileJSON, full style. */
async function resolveCustomStyle(
  url: string,
  subdomains?: string[],
  scheme?: TileScheme,
): Promise<ResolvedCustom> {
  if (isTileUrlTemplate(url)) {
    // Probe at z=1 so `{quadkey}` resolves to a real tile ("0") — Bing-style
    // sources have no z=0 tile, where the quadkey would be empty.
    const probe = fillTileUrl(url, 1, 0, 0, subdomains);
    const r = await fetch(probe, { method: "GET" });
    if (!r.ok) throw new Error(`Tile probe failed: ${r.status}`);
    return {
      style: {
        id: "custom",
        name: "Custom tile URL",
        desc: url,
        url,
        kind: "raster",
        scheme,
        spec: rasterStyleForTileUrl(url, subdomains, scheme),
        license: "restrictive",
        attribution: CUSTOM_URL_ATTRIBUTION,
      },
      previewTileUrl: url,
    };
  }
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
  const json = (await r.json()) as Record<string, unknown>;
  // Maplibre style: has version 8 and sources
  if (json.version === 8 && typeof json.sources === "object") {
    return {
      style: {
        id: "custom",
        name: "Custom style",
        desc: url,
        url,
        kind: "vector",
        license: "restrictive",
        attribution: CUSTOM_URL_ATTRIBUTION,
      },
    };
  }
  // TileJSON: has tiles array (or tilejson key)
  if (Array.isArray(json.tiles) || typeof json.tilejson === "string") {
    const fmt = String(json.format ?? "").toLowerCase();
    const kind: "vector" | "raster" = fmt === "pbf" ? "vector" : "raster";
    const tiles = Array.isArray(json.tiles) ? (json.tiles as string[]) : [];
    const maxZoom =
      typeof json.maxzoom === "number" ? (json.maxzoom as number) : undefined;
    return {
      style: {
        id: "custom",
        name: "Custom TileJSON",
        desc: url,
        url,
        kind,
        maxZoom,
        spec: styleForTileJson(url, kind),
        license: "restrictive",
        attribution: CUSTOM_URL_ATTRIBUTION,
      },
      previewTileUrl: kind === "raster" ? tiles[0] : undefined,
    };
  }
  throw new Error("Not a valid style or TileJSON");
}
