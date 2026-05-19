import {
  PRESET_STYLES,
  fillTileUrl,
  isTileUrlTemplate,
  lngLatToTile,
  rasterStyleForTileUrl,
  styleForTileJson,
  type AppStyle,
  type CustomStyle,
  type PresetStyle,
} from "./preset-styles.ts";
import {
  loadRecents,
  recentIdForUrl,
  removeRecent,
  saveRecent,
  type RecentEntry,
} from "./recents-store.ts";

/** Zoom used for the preset card preview tile (city-level detail). */
const PREVIEW_ZOOM = 12;

type Tab = "presets" | "recents" | "custom" | "mbtiles";

export interface StylePickerOptions {
  /** Selected when user picks a preset or validated custom URL. */
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

export class StylePicker {
  readonly el: HTMLDivElement;
  private opts: StylePickerOptions;
  private currentStyleId: string | null = null;
  private tab: Tab = "presets";
  private customUrl = "";
  private token = "";
  private validating = false;
  private validateMsg: { ok: boolean; text: string } | null = null;
  private bodyEl: HTMLDivElement;
  private tabsEl: HTMLDivElement;
  private isOpen = false;
  /** Map center used to pick a preview tile per preset card. */
  private previewCenter: [number, number] = [0, 51.5];
  private recents: RecentEntry[] = [];

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
    // Don't strand the user on the Recents tab if it's no longer available
    // (last entry deleted, etc.).
    if (this.tab === "recents" && this.recents.length === 0) {
      this.tab = "presets";
    }
    this.isOpen = true;
    this.el.classList.toggle("sp-mobile", this.opts.isMobile());
    this.el.classList.remove("hidden");
    this.renderTabs();
    this.render();
  }

  /** (Re)build the tab strip based on whether any recents exist. */
  private renderTabs() {
    this.tabsEl.replaceChildren();
    const tabs: Tab[] =
      this.recents.length > 0
        ? ["presets", "recents", "custom", "mbtiles"]
        : ["presets", "custom", "mbtiles"];
    for (const t of tabs) {
      const btn = document.createElement("button");
      btn.className = "sp-tab";
      btn.dataset.tab = t;
      btn.textContent =
        t === "presets"
          ? "Presets"
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
    // Mark active tab
    Array.from(this.tabsEl.children).forEach((c) => {
      const btn = c as HTMLButtonElement;
      btn.classList.toggle("sp-tab-active", btn.dataset.tab === this.tab);
    });
    this.bodyEl.innerHTML = "";
    if (this.tab === "presets") this.renderPresets();
    else if (this.tab === "recents") this.renderRecents();
    else if (this.tab === "custom") this.renderCustom();
    else this.renderMbtiles();
  }

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
      const url = fillTileUrl(r.previewTileUrl, PREVIEW_ZOOM, x, y);
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
          this.tab = "presets";
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
    };
  }

  private renderPresets() {
    const grid = document.createElement("div");
    grid.className = "sp-preset-grid";
    grid.classList.toggle("sp-preset-grid-mobile", this.opts.isMobile());
    for (const s of PRESET_STYLES) {
      const card = document.createElement("button");
      card.className = "sp-preset-card";
      if (this.currentStyleId === s.id) card.classList.add("sp-preset-active");
      card.appendChild(this.thumb(s));
      const meta = document.createElement("div");
      meta.className = "sp-preset-meta";
      meta.innerHTML = `
        <div class="sp-preset-name"></div>
        <div class="sp-preset-desc"></div>
        <div class="sp-preset-tag"></div>`;
      meta.querySelector(".sp-preset-name")!.textContent = s.name;
      meta.querySelector(".sp-preset-desc")!.textContent = s.desc;
      meta.querySelector(".sp-preset-tag")!.textContent = `${s.kind} · ${s.tone}`;
      card.appendChild(meta);
      card.addEventListener("click", () => {
        this.opts.onSelectStyle(s);
        this.close();
      });
      grid.appendChild(card);
    }
    this.bodyEl.appendChild(grid);
  }

  private thumb(s: PresetStyle) {
    const wrap = document.createElement("div");
    wrap.className = "sp-thumb";
    // Solid background matches the style's tone so the card looks reasonable
    // even before the tile image loads (or if it fails).
    const fallbackBg: Record<string, string> = {
      positron: "#dadad4",
      liberty: "#cfe2c8",
      bright: "#ffd560",
      dark: "#2a2f3a",
      satellite: "#1a3b5c",
      topo: "#a8c890",
      "esri-topo": "#cdb98c",
      "esri-hillshade": "#bfbfbf",
      "esri-imagery-clarity": "#1a3b5c",
      cyclosm: "#f3eee0",
      hot: "#f6d7c1",
      sentinel2: "#1f2c3a",
    };
    wrap.style.background = fallbackBg[s.id] ?? "#ccc";

    const [lng, lat] = this.previewCenter;
    const { x, y } = lngLatToTile(lng, lat, PREVIEW_ZOOM);
    const url = fillTileUrl(s.previewTileUrl, PREVIEW_ZOOM, x, y);

    const img = document.createElement("img");
    img.className = "sp-thumb-img";
    img.alt = "";
    img.referrerPolicy = "no-referrer";
    img.loading = "lazy";
    img.decoding = "async";
    img.src = url;
    img.addEventListener("error", () => {
      // CORS/COEP/network failure — leave the solid fallback background.
      img.remove();
    });
    wrap.appendChild(img);
    return wrap;
  }

  private renderCustom() {
    const wrap = document.createElement("div");
    wrap.className = "sp-custom";
    wrap.innerHTML = `
      <p class="sp-prose">
        Paste a link to a Mapbox/MapLibre <code>style.json</code>, a TileJSON,
        or a tile URL template containing <code>{z}/{x}/{y}</code>.
      </p>
      <input type="url" class="sp-input sp-url" placeholder="https://example.com/style.json" />
      <div class="sp-token-wrap"></div>
      <div class="sp-validate-msg"></div>
      <button class="sp-validate-btn" type="button">Validate &amp; use</button>
    `;
    const urlInput = wrap.querySelector<HTMLInputElement>(".sp-url")!;
    urlInput.value = this.customUrl;
    urlInput.addEventListener("input", () => {
      this.customUrl = urlInput.value;
      this.renderTokenSection(wrap);
      this.renderValidateMsg(wrap);
      this.updateValidateBtn(wrap);
    });

    this.renderTokenSection(wrap);
    this.renderValidateMsg(wrap);

    const btn = wrap.querySelector<HTMLButtonElement>(".sp-validate-btn")!;
    btn.addEventListener("click", () => this.validateAndSelect(wrap));
    this.updateValidateBtn(wrap);
    this.bodyEl.appendChild(wrap);
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

      const resolved = await resolveCustomStyle(finalUrl);
      const accessToken = tokenInfo.required ? this.token : undefined;

      this.validateMsg = { ok: true, text: "Validated. Loading…" };
      this.renderValidateMsg(wrap);
      const styleWithToken: CustomStyle = {
        ...resolved.style,
        accessToken,
      };
      // Persist before notifying — that way the picker has a "Recents" tab
      // ready the next time it's opened.
      saveRecent({
        id: recentIdForUrl(this.customUrl),
        // Store the user-entered URL (no token), but carry the resolved spec
        // and the access token separately so re-selecting the recent works
        // without a re-prompt for the token.
        url: this.customUrl,
        name: this.customUrl,
        kind: resolved.style.kind,
        spec: resolved.style.spec,
        accessToken,
        maxZoom: resolved.style.maxZoom,
        previewTileUrl: resolved.previewTileUrl,
        previewKind: resolved.previewTileUrl ? "raster" : undefined,
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

interface ResolvedCustom {
  style: CustomStyle;
  /** Raster {z}/{x}/{y} URL we can use as a thumbnail. Unset when the source
   *  is vector pbf or we couldn't derive one. */
  previewTileUrl?: string;
}

/** Probe a custom URL and return an AppStyle plus a thumbnail tile URL when
 *  derivable. Handles three cases: tile URL template, TileJSON, full style. */
async function resolveCustomStyle(url: string): Promise<ResolvedCustom> {
  if (isTileUrlTemplate(url)) {
    const probe = url
      .replace("{z}", "0")
      .replace("{x}", "0")
      .replace("{y}", "0");
    const r = await fetch(probe, { method: "GET" });
    if (!r.ok) throw new Error(`Tile probe failed: ${r.status}`);
    return {
      style: {
        id: "custom",
        name: "Custom tile URL",
        desc: url,
        url,
        kind: "raster",
        spec: rasterStyleForTileUrl(url),
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
      },
      // Style.json entries reference vector sources by URL, so we can't
      // synthesize a raster thumbnail without another roundtrip. Skip.
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
      },
      previewTileUrl: kind === "raster" ? tiles[0] : undefined,
    };
  }
  throw new Error("Not a valid style or TileJSON");
}
