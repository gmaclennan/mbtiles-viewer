import {
  LICENSE_COLORS,
  LICENSE_LABELS,
  type AppStyle,
} from "./preset-styles.ts";

export interface AttributionButtonOptions {
  /** Fired when the popover opens — lets the host close sibling popovers. */
  onOpen?: () => void;
}

/** Circular "i" button with a licence-bucket dot. Clicking opens a popover
 *  showing the active style's name, licence pill and attribution HTML. */
export class AttributionButton {
  readonly el: HTMLDivElement;
  private btn: HTMLButtonElement;
  private dot: HTMLSpanElement;
  private popoverWrap: HTMLDivElement | null = null;
  private open = false;
  private style: AppStyle | null = null;
  private opts: AttributionButtonOptions;

  constructor(opts: AttributionButtonOptions = {}) {
    this.opts = opts;

    this.el = document.createElement("div");
    this.el.className = "attrib-root";

    this.btn = document.createElement("button");
    this.btn.className = "attrib-btn";
    this.btn.setAttribute("aria-label", "Attribution");
    this.btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M8 7.5v3.5" />
        <circle cx="8" cy="5.2" r=".55" fill="currentColor" stroke="none" />
      </svg>`;
    this.dot = document.createElement("span");
    this.dot.className = "attrib-dot";
    this.btn.appendChild(this.dot);
    this.btn.addEventListener("click", () => this.toggle());
    this.el.appendChild(this.btn);
  }

  /** Update the active style — refreshes the dot colour (and the popover if open). */
  setStyle(style: AppStyle) {
    this.style = style;
    this.dot.style.background = LICENSE_COLORS[style.license];
    if (this.open) {
      this.close();
      this.show();
    }
  }

  close() {
    this.open = false;
    this.btn.classList.remove("attrib-btn-active");
    this.popoverWrap?.remove();
    this.popoverWrap = null;
  }

  private toggle() {
    if (this.open) {
      this.close();
    } else {
      this.opts.onOpen?.();
      this.show();
    }
  }

  private show() {
    if (!this.style) return;
    this.open = true;
    this.btn.classList.add("attrib-btn-active");

    const s = this.style;
    const license = s.license;
    const color = LICENSE_COLORS[license];

    this.popoverWrap = document.createElement("div");
    this.popoverWrap.className = "attrib-popover-wrap";
    this.popoverWrap.addEventListener("click", () => this.close());

    const popover = document.createElement("div");
    popover.className = "attrib-popover";
    popover.addEventListener("click", (e) => e.stopPropagation());

    const header = document.createElement("div");
    header.className = "attrib-popover-header";
    const titleWrap = document.createElement("div");
    titleWrap.className = "attrib-popover-title-wrap";
    const title = document.createElement("div");
    title.className = "attrib-popover-title";
    title.textContent = "Attribution";
    titleWrap.appendChild(title);
    const pill = document.createElement("span");
    pill.className = "attrib-pill";
    pill.textContent = LICENSE_LABELS[license];
    pill.style.color = color;
    pill.style.background = hexAlpha(color, 0.12);
    titleWrap.appendChild(pill);
    header.appendChild(titleWrap);
    const closeBtn = document.createElement("button");
    closeBtn.className = "attrib-popover-close";
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.textContent = "×";
    closeBtn.addEventListener("click", () => this.close());
    header.appendChild(closeBtn);
    popover.appendChild(header);

    const nameEl = document.createElement("div");
    nameEl.className = "attrib-popover-name";
    nameEl.textContent = s.name;
    popover.appendChild(nameEl);

    const box = document.createElement("div");
    box.className = "attrib-popover-box";
    // Attribution is curated HTML from our preset/QMS data (or a plain string
    // for custom URLs) — rendering it lets sources show their logos/links.
    box.innerHTML = s.attribution || "No attribution provided.";
    popover.appendChild(box);

    if (s.termsUrl) {
      const terms = document.createElement("a");
      terms.className = "attrib-terms";
      terms.href = s.termsUrl;
      terms.target = "_blank";
      terms.rel = "noopener noreferrer";
      terms.textContent = "Terms of use ↗";
      popover.appendChild(terms);
    }

    if (license === "attribution" || license === "restrictive") {
      const footer = document.createElement("div");
      footer.className = "attrib-popover-footer";
      footer.textContent =
        "When downloading, you'll need to acknowledge this source's terms before continuing.";
      popover.appendChild(footer);
    }

    this.popoverWrap.appendChild(popover);
    this.el.appendChild(this.popoverWrap);
  }
}

/** `#rrggbb` + alpha → `rgba(...)`. */
function hexAlpha(hex: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}
