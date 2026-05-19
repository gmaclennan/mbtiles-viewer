import type { CustomStyle } from "./preset-styles.ts";

export interface RecentEntry {
  /** Stable id for the recent — derived from the URL so the same URL doesn't
   *  appear twice. */
  id: string;
  /** Friendly title shown on the card (the URL's hostname). */
  name: string;
  /** The URL exactly as the user entered it (sans token). */
  url: string;
  /** kind/spec/access-token are stashed verbatim from the validated style so
   *  we can reuse without re-validating. */
  kind: CustomStyle["kind"];
  spec?: CustomStyle["spec"];
  accessToken?: string;
  /** TileJSON's maxzoom (when the validated source supplied one) — used so
   *  the download modal's slider cap is set instantly without a second fetch. */
  maxZoom?: number;
  /** A raster {z}/{x}/{y} URL to use as the preview thumbnail when possible.
   *  For style URLs we follow source.tiles[0]; if that's vector pbf we leave
   *  this unset and the card falls back to a solid swatch. */
  previewTileUrl?: string;
  /** Set to "raster" only when previewTileUrl points at an image-format tile;
   *  vector pbf can't be rendered into an <img>. */
  previewKind?: "raster";
  addedAt: number;
}

const KEY = "mbtiles-viewer:recents:v1";
const MAX = 10;

export function loadRecents(): RecentEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (e): e is RecentEntry =>
        e && typeof e.id === "string" && typeof e.url === "string",
    );
  } catch {
    return [];
  }
}

export function saveRecent(entry: RecentEntry) {
  const existing = loadRecents().filter((e) => e.id !== entry.id);
  const next = [entry, ...existing].slice(0, MAX);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* storage full / disabled — silently drop */
  }
}

export function removeRecent(id: string) {
  const next = loadRecents().filter((e) => e.id !== id);
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

export function recentIdForUrl(url: string): string {
  // Hash-ish but readable; collisions don't matter beyond shadowing the older
  // entry with the same URL (which is what we want).
  return url.toLowerCase();
}

// ─── Selected-style persistence ────────────────────────────────────────────
// We store either a preset id ("positron", "satellite", ...) OR a recent id
// (a lowercased URL). mbtiles-loaded styles are deliberately not persisted —
// the underlying file is OPFS-scoped and gone after a refresh.
const SELECTED_KEY = "mbtiles-viewer:selected:v1";

export interface SelectedRef {
  kind: "preset" | "recent";
  id: string;
}

export function loadSelected(): SelectedRef | null {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      (parsed.kind === "preset" || parsed.kind === "recent") &&
      typeof parsed.id === "string"
    ) {
      return parsed as SelectedRef;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function saveSelected(ref: SelectedRef | null) {
  try {
    if (ref) localStorage.setItem(SELECTED_KEY, JSON.stringify(ref));
    else localStorage.removeItem(SELECTED_KEY);
  } catch {
    /* ignore */
  }
}
