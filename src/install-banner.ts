import { html, nothing, type TemplateResult } from "lit";
import { LightElement } from "./lit-base.ts";

/** Browser-fired beforeinstallprompt event (Chromium-only). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Persisted across sessions. We never re-show the banner once the user has
 *  dismissed it — the help popover covers the "I changed my mind" case. */
const DISMISSED_KEY = "mbtiles-viewer:install-hint-dismissed:v1";

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  ("standalone" in navigator &&
    (navigator as { standalone?: boolean }).standalone === true);

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) &&
  !(window as unknown as { MSStream?: unknown }).MSStream;

/** Returns true if the user has previously dismissed the banner OR the app is
 *  running standalone (so installation is moot). */
function alreadyHandled(): boolean {
  if (isStandalone()) return true;
  try {
    return localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberDismissed() {
  try {
    localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    /* ignore — quota or disabled storage */
  }
}

/** Down-arrow-into-device glyph shared by both banner variants. */
function bannerIcon(): TemplateResult {
  return html`<div class="install-banner-icon" aria-hidden="true">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <rect x="4" y="3" width="16" height="18" rx="3" />
      <path d="M12 8v6m0 0l-2.5-2.5M12 14l2.5-2.5" />
    </svg>
  </div>`;
}

/** Mounts a one-time install hint at the bottom of the screen. The banner
 *  occupies the same layout slot as the action card (so it sits *over* the
 *  card on first visit, making the install affordance unmissable on iOS).
 *  Dismissing collapses it for good. */
export class InstallBanner extends LightElement {
  static properties = {
    mode: { state: true },
  };

  /** Which banner variant to show — `null` means the banner is hidden. */
  declare mode: "ios" | "chromium" | null;

  private deferredPrompt: BeforeInstallPromptEvent | null = null;

  constructor() {
    super();
    this.mode = null;

    if (alreadyHandled()) return;

    if (isIos()) {
      // iOS has no programmatic install path — show right away.
      this.mode = "ios";
      return;
    }

    // Chromium fires beforeinstallprompt asynchronously, sometimes seconds
    // after load. Wait for it and surface the banner once we have a prompt.
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      this.deferredPrompt = e as BeforeInstallPromptEvent;
      if (!alreadyHandled()) this.mode = "chromium";
    });
    window.addEventListener("appinstalled", () => {
      this.deferredPrompt = null;
      this.dismiss({ persist: false });
    });
  }

  get el(): this {
    return this;
  }

  connectedCallback() {
    super.connectedCallback();
    this.classList.add("install-banner");
    if (this.mode === null) this.classList.add("hidden");
  }

  protected updated() {
    this.classList.toggle("hidden", this.mode === null);
  }

  private async runChromiumPrompt() {
    const dp = this.deferredPrompt;
    if (!dp) return;
    await dp.prompt();
    const { outcome } = await dp.userChoice;
    if (outcome === "accepted") this.deferredPrompt = null;
    // Either way, take the banner down — the user has answered.
    this.dismiss({ persist: true });
  }

  private dismiss({ persist }: { persist: boolean }) {
    if (persist) rememberDismissed();
    this.mode = null;
  }

  render() {
    if (this.mode === null) return nothing;
    return this.mode === "ios"
      ? this.iosTemplate()
      : this.chromiumTemplate();
  }

  private chromiumTemplate(): TemplateResult {
    return html`
      ${bannerIcon()}
      <div class="install-banner-body">
        <div class="install-banner-title">Install Map Downloader</div>
        <div class="install-banner-text">
          Add this app to your device for full-screen, offline-ready use.
        </div>
      </div>
      <button
        class="install-banner-cta"
        type="button"
        @click=${() => this.runChromiumPrompt()}
      >
        Install
      </button>
      <button
        class="install-banner-dismiss"
        type="button"
        aria-label="Dismiss"
        @click=${() => this.dismiss({ persist: true })}
      >×</button>
    `;
  }

  private iosTemplate(): TemplateResult {
    return html`
      ${bannerIcon()}
      <div class="install-banner-body">
        <div class="install-banner-title">Add to Home Screen</div>
        <div class="install-banner-text">
          Tap
          <svg class="install-banner-share" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
          in Safari, then <b>Add to Home Screen</b> for offline use.
        </div>
      </div>
      <button
        class="install-banner-dismiss"
        type="button"
        aria-label="Dismiss"
        @click=${() => this.dismiss({ persist: true })}
      >×</button>
    `;
  }
}

if (!customElements.get("install-banner")) {
  customElements.define("install-banner", InstallBanner);
}
