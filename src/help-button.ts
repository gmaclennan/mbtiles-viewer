/** Browser-fired beforeinstallprompt event (Chromium-only). The DOM lib types
 *  don't include it, so we model the bits we touch. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator && (navigator as { standalone?: boolean }).standalone === true);

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(window as unknown as { MSStream?: unknown }).MSStream;

export interface HelpButtonOptions {
  /** Fired when the popover opens — lets the host close sibling popovers. */
  onOpen?: () => void;
}

export class HelpButton {
  readonly el: HTMLDivElement;
  private btn: HTMLButtonElement;
  private popoverWrap: HTMLDivElement | null = null;
  private open = false;
  private opts: HelpButtonOptions;
  /** Stashed beforeinstallprompt event so the user can install on demand. */
  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor(opts: HelpButtonOptions = {}) {
    this.opts = opts;
    this.el = document.createElement("div");
    this.el.className = "help-root";

    this.btn = document.createElement("button");
    this.btn.className = "help-btn";
    this.btn.setAttribute("aria-label", "Help");
    this.btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none"
        stroke="currentColor" stroke-width="1.7" stroke-linecap="round">
        <circle cx="8" cy="8" r="6.5" />
        <path d="M6.2 6.2c0-1 .8-1.8 1.8-1.8s1.8.8 1.8 1.8c0 .9-1.8 1.3-1.8 2.4" />
        <circle cx="8" cy="11.2" r=".5" fill="currentColor" />
      </svg>`;
    this.btn.addEventListener("click", () => this.toggle());
    this.el.appendChild(this.btn);

    // Capture the install prompt for Chromium so the help-popover Install
    // button can surface it on-demand. iOS doesn't fire this event — there
    // we fall back to the visual Add-to-Home-Screen instructions.
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
    });
    // After a successful install, drop the prompt so we stop offering it.
    window.addEventListener("appinstalled", () => {
      this.deferredPrompt = null;
    });
  }

  private toggle() {
    if (this.open) {
      this.close();
    } else {
      this.show();
    }
  }

  private show() {
    this.opts.onOpen?.();
    this.open = true;
    this.btn.classList.add("help-btn-active");
    this.popoverWrap = document.createElement("div");
    this.popoverWrap.className = "help-popover-wrap";
    this.popoverWrap.addEventListener("click", () => this.close());

    const popover = document.createElement("div");
    popover.className = "help-popover";
    popover.addEventListener("click", (e) => e.stopPropagation());
    popover.innerHTML = `
      <div class="help-popover-header">
        <div class="help-popover-title">About this tool</div>
        <button class="help-popover-close" aria-label="Close">×</button>
      </div>
      <p>
        Pick a region of the world and download its map tiles for
        <b>offline use</b> — useful for fieldwork, hiking, or low-bandwidth
        environments.
      </p>
      <ol>
        <li>Pan and zoom the map to the area you want.</li>
        <li>Drag the bbox handles to fine-tune the region, or type bounds directly.</li>
        <li>Click <b>Download</b> to choose a max zoom and save the package.</li>
      </ol>
      <div class="help-popover-tip">
        Tip: smaller area + lower max zoom = smaller download.
      </div>
      <div class="help-popover-version">${
        (window as unknown as { __APP_VERSION__?: string })
          .__APP_VERSION__ ?? `build ${__BUILD_VERSION__}`
      }</div>
    `;
    popover
      .querySelector(".help-popover-close")
      ?.addEventListener("click", () => this.close());

    const installSection = this.buildInstallSection();
    if (installSection) popover.appendChild(installSection);

    this.popoverWrap.appendChild(popover);
    this.el.appendChild(this.popoverWrap);
  }

  /** Returns the install section, or null if installation isn't applicable
   *  (already in standalone mode, or on a desktop browser without a deferred
   *  install prompt). */
  private buildInstallSection(): HTMLElement | null {
    if (isStandalone()) return null;
    const ios = isIos();
    if (!ios && !this.deferredPrompt) return null;

    const wrap = document.createElement("div");
    wrap.className = "help-install";
    if (ios) {
      wrap.innerHTML = `
        <div class="help-install-title">Install to home screen</div>
        <p>
          Tap
          <svg class="help-install-icon" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          in Safari then <b>Add to Home Screen</b> for full-screen, offline-ready use.
        </p>`;
    } else {
      wrap.innerHTML = `
        <div class="help-install-title">Install as an app</div>
        <p>
          Add this tool to your device for full-screen, offline-ready use.
        </p>
        <button class="help-install-btn" type="button">Install</button>`;
      const btn = wrap.querySelector<HTMLButtonElement>(".help-install-btn");
      btn?.addEventListener("click", async () => {
        const dp = this.deferredPrompt;
        if (!dp) return;
        await dp.prompt();
        const { outcome } = await dp.userChoice;
        if (outcome === "accepted") this.deferredPrompt = null;
        this.close();
      });
    }
    return wrap;
  }

  close() {
    this.open = false;
    this.btn.classList.remove("help-btn-active");
    this.popoverWrap?.remove();
    this.popoverWrap = null;
  }
}

/** Dumps every viewport-y measurement we know about. Both the help popover
 *  and main.ts boot-time logger use this so the data on a remote device is
 *  consistent across the on-screen display and the JS console. */
export function viewportDiagnostics(): string {
  const screen = window.screen;
  const dpr = window.devicePixelRatio;
  const app = document.getElementById("app");
  const canvas = document.querySelector<HTMLCanvasElement>("#map canvas");
  const root = document.documentElement;
  const appRect = app?.getBoundingClientRect();
  const canvasRect = canvas?.getBoundingClientRect();
  const lines = [
    `screen ${screen.width}×${screen.height} @${dpr}x`,
    `window.inner ${window.innerWidth}×${window.innerHeight}`,
    `window.outer ${window.outerWidth}×${window.outerHeight}`,
    `docEl.client ${root.clientWidth}×${root.clientHeight}`,
    `100vh=${probeUnit("100vh")} 100lvh=${probeUnit("100lvh")} 100svh=${probeUnit("100svh")} 100dvh=${probeUnit("100dvh")}`,
    `safe inset T=${getSafeInset("top")} R=${getSafeInset("right")} B=${getSafeInset("bottom")} L=${getSafeInset("left")}`,
    `#app rect ${appRect ? `${appRect.left.toFixed(0)},${appRect.top.toFixed(0)} ${appRect.width.toFixed(0)}×${appRect.height.toFixed(0)}` : "?"}`,
    `canvas rect ${canvasRect ? `${canvasRect.left.toFixed(0)},${canvasRect.top.toFixed(0)} ${canvasRect.width.toFixed(0)}×${canvasRect.height.toFixed(0)}` : "?"}`,
    `standalone=${isStandalone()}`,
  ];
  return lines.join("\n");
}

function probeUnit(unit: string): number {
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "0";
  el.style.height = unit;
  el.style.width = "1px";
  document.body.appendChild(el);
  const h = el.offsetHeight;
  el.remove();
  return h;
}

/** Read a CSS env() value as a pixel number (or 0 if unsupported). */
function getSafeInset(side: "top" | "right" | "bottom" | "left"): number {
  const el = document.createElement("div");
  el.style.position = "fixed";
  el.style.left = "-9999px";
  el.style.top = "0";
  el.style.height = `env(safe-area-inset-${side})`;
  el.style.width = "1px";
  document.body.appendChild(el);
  const h = el.offsetHeight;
  el.remove();
  return h;
}
