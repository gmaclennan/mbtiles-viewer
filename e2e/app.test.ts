import path from "path";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserType,
  type Page,
} from "playwright";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

const fixturePath = path.resolve("e2e/fixtures/plain_1.mbtiles");
const baseUrl = "http://localhost:4174";

const chromiumArgs =
  process.platform === "darwin"
    ? ["--use-gl=angle", "--use-angle=metal"]
    : ["--use-gl=angle", "--use-angle=swiftshader"];

/** Open the picker to the .mbtiles tab and load a fixture. */
async function loadMbtilesFixture(page: Page) {
  await page.goto(baseUrl);
  await page.locator("#style-chip").waitFor({ state: "visible" });
  await page.locator("#style-chip").click();
  await page.locator('.sp-tab[data-tab="mbtiles"]').click();

  const dropTarget = page.locator(".sp-mbtiles-drop, .sp-mbtiles-btn").first();
  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    dropTarget.click(),
  ]);
  await fileChooser.setFiles(fixturePath);

  await page.waitForFunction(
    (name) =>
      document
        .querySelector("#style-chip .va-style-name")
        ?.textContent?.includes(name),
    "plain_1.mbtiles",
    { timeout: 30_000 },
  );
}

/** Wait until the map has produced a bbox (bounds summary stops showing "—"),
 *  which means the download flow has a region to work with. */
async function waitForMapReady(page: Page) {
  await page.waitForFunction(() => {
    const s = document.querySelector(".bounds-summary");
    return !!s && s.textContent !== "—" && s.textContent !== "";
  });
}

function appTests(
  browserType: BrowserType,
  launchOptions?: Record<string, unknown>,
  opts?: { skipDownloadTest?: boolean },
) {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await browserType.launch({ headless: true, ...launchOptions });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  test("renders the map downloader UI on load", async () => {
    await page.goto(baseUrl);
    await page.locator("#style-chip").waitFor({ state: "visible" });
    await page.locator("#download-button").waitFor({ state: "visible" });
    await page.locator(".va-brand").waitFor({ state: "visible" });
    expect(await page.locator(".bbox-handle").count()).toBe(8);
  });

  test("style picker lists presets and closes on selection", async () => {
    await page.goto(baseUrl);
    await page.locator("#style-chip").waitFor({ state: "visible" });
    await page.locator("#style-chip").click();
    await page.locator(".sp-preset-card").first().waitFor({ state: "visible" });
    expect(await page.locator(".sp-preset-card").count()).toBeGreaterThan(0);
    await page.locator(".sp-close").click();
    await page.locator(".sp-backdrop").waitFor({ state: "hidden" });
  });

  test("bounds panel exposes the four cardinal inputs", async () => {
    await page.goto(baseUrl);
    await page.locator(".bounds-toggle").waitFor({ state: "visible" });
    await page.locator(".bounds-toggle").click();
    expect(await page.locator(".bounds-input").count()).toBe(4);
  });

  test("help popover opens and closes", async () => {
    await page.goto(baseUrl);
    await page.locator(".help-btn").waitFor({ state: "visible" });
    await page.locator(".help-btn").click();
    await page.locator(".help-popover").waitFor({ state: "visible" });
    await page.locator(".help-popover-close").click();
    await page.locator(".help-popover").waitFor({ state: "hidden" });
  });

  test("attribution popover shows the active style", async () => {
    await page.goto(baseUrl);
    await page.locator(".attrib-btn").waitFor({ state: "visible" });
    await page.locator(".attrib-btn").click();
    await page.locator(".attrib-popover").waitFor({ state: "visible" });
    expect(await page.locator(".attrib-pill").count()).toBe(1);
    await page.locator(".attrib-popover-close").click();
    await page.locator(".attrib-popover").waitFor({ state: "hidden" });
  });

  test("bounds panel lock / unlock toggles the locked state", async () => {
    await page.goto(baseUrl);
    await waitForMapReady(page);
    await page.locator(".bounds-toggle").click();
    const lockBtn = page.locator(".bounds-lock-btn");
    await lockBtn.waitFor({ state: "visible" });
    expect((await lockBtn.textContent())?.includes("Lock bounds")).toBe(true);

    await lockBtn.click();
    expect((await lockBtn.textContent())?.includes("Unlock")).toBe(true);
    expect(
      await page.locator(".bbox-map-overlay.bbox-locked").count(),
    ).toBe(1);
    // Resize handles are disabled while locked.
    expect(await page.locator(".bbox-handle").first().isVisible()).toBe(false);

    await lockBtn.click();
    expect(
      await page.locator(".bbox-map-overlay.bbox-locked").count(),
    ).toBe(0);
    expect(await page.locator(".bbox-handle").first().isVisible()).toBe(true);
  });

  test("restrictive style gates download behind licence acknowledgement", async () => {
    await page.goto(baseUrl);
    await page.locator("#style-chip").waitFor({ state: "visible" });
    await waitForMapReady(page);
    await page.locator("#style-chip").click();
    await page
      .locator(".sp-preset-card", { hasText: "Esri Satellite" })
      .first()
      .click();
    await page.locator(".sp-backdrop").waitFor({ state: "hidden" });

    await page.locator("#download-button").click();
    await page.locator(".dm-primary").waitFor({ state: "visible" });
    // Restrictive licence ⇒ banner shown, primary disabled until acknowledged.
    await page.locator(".dm-licence").waitFor({ state: "visible" });
    expect(await page.locator(".dm-primary").isDisabled()).toBe(true);

    await page.locator(".dm-licence-checkbox").check();
    await page
      .locator(".dm-primary:not([disabled])")
      .waitFor({ state: "visible" });
    expect(await page.locator(".dm-primary").isEnabled()).toBe(true);
  });

  test("huge download requires a typed-size confirmation", async () => {
    await page.goto(baseUrl);
    // Start from a clean slate — a prior test may have persisted a restrictive
    // style, which would gate the download behind the licence checkbox.
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.locator("#style-chip").waitFor({ state: "visible" });
    await waitForMapReady(page);
    // Zoom right out so the bbox covers a huge area → huge tile estimate.
    await page.evaluate(() => (window as any).maplibreMap?.setZoom(1));
    await page.waitForTimeout(600);

    await page.locator("#download-button").click();
    await page.locator(".dm-primary").waitFor({ state: "visible" });
    // Give the async max-zoom resolve a moment to settle.
    await page.waitForTimeout(1200);
    const primary = page.locator(".dm-primary");
    expect((await primary.textContent())?.includes("Review & download")).toBe(
      true,
    );

    await primary.click();
    await page.locator(".dm-huge-modal").waitFor({ state: "visible" });
    expect(await page.locator(".dm-huge-confirm").isDisabled()).toBe(true);

    // Typing the displayed size in MB enables the override button.
    const sizeText =
      (await page.locator(".dm-huge-stat-size").textContent()) ?? "";
    const mb = sizeText.replace(/[^0-9]/g, "");
    expect(mb.length).toBeGreaterThan(0);
    await page.locator(".dm-huge-input").fill(mb);
    await page
      .locator(".dm-huge-confirm:not([disabled])")
      .waitFor({ state: "visible" });
    expect(await page.locator(".dm-huge-confirm").isEnabled()).toBe(true);

    // Cancel backs out without starting the download.
    await page.locator(".dm-huge-cancel").click();
    await page.locator(".dm-huge-modal").waitFor({ state: "hidden" });
  });

  test("opens an mbtiles file via the style picker", async () => {
    await loadMbtilesFixture(page);
    const canvas = page.locator("#map canvas").first();
    expect(await canvas.count()).toBeGreaterThan(0);
  });

  test("opens an mbtiles file via drag and drop", async () => {
    await page.goto(baseUrl);
    await page.locator("#style-chip").waitFor({ state: "visible" });

    const buffer = await import("fs").then((fs) =>
      fs.readFileSync(fixturePath),
    );
    await page.evaluate(
      async ({ bytes, fileName }) => {
        const uint8 = new Uint8Array(bytes);
        const file = new File([uint8], fileName);
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        document.dispatchEvent(
          new DragEvent("dragenter", { dataTransfer, bubbles: true }),
        );
        document.dispatchEvent(
          new DragEvent("drop", { dataTransfer, bubbles: true }),
        );
      },
      { bytes: Array.from(buffer), fileName: "plain_1.mbtiles" },
    );
    await page.waitForFunction(
      (name) =>
        document
          .querySelector("#style-chip .va-style-name")
          ?.textContent?.includes(name),
      "plain_1.mbtiles",
      { timeout: 30_000 },
    );
  });

  test("can pan the map by dragging", async () => {
    await loadMbtilesFixture(page);
    const canvas = page.locator("#map canvas").first();
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    const centerBefore = await page.evaluate(
      () => (window as any).maplibreMap?.getCenter(),
    );
    const startX = box!.x + box!.width / 2;
    const startY = box!.y + box!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX - 100, startY, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(500);
    const centerAfter = await page.evaluate(
      () => (window as any).maplibreMap?.getCenter(),
    );
    expect(centerAfter.lng).not.toBeCloseTo(centerBefore.lng, 1);
  });

  const testDownload = opts?.skipDownloadTest ? test.skip : test;
  testDownload("can download mbtiles as smp file", { timeout: 90_000 }, async () => {
    await loadMbtilesFixture(page);

    // Force the service-worker streaming path so the test captures the download.
    await page.evaluate(async () => {
      delete (window as any).showSaveFilePicker;
      await navigator.serviceWorker.ready;
    });

    await page.locator("#download-button").click();
    await page.locator(".dm-primary").waitFor({ state: "visible" });

    // Pull the slider down to a small zoom so the tile-count estimate stays
    // below the hard warning threshold for the global default bbox.
    await page.evaluate(() => {
      const slider = document.querySelector(
        ".dm-zoom-slider",
      ) as HTMLInputElement;
      slider.value = "2";
      slider.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(300);

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      page.locator(".dm-primary").click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/\.smp$/);

    const readable = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(Buffer.from(chunk));
    }
    const fileContents = Buffer.concat(chunks);
    // SMP files are zip archives — verify the zip magic number (PK\x03\x04)
    expect(fileContents[0]).toBe(0x50);
    expect(fileContents[1]).toBe(0x4b);
    expect(fileContents.length).toBeGreaterThan(100);
  });
}

describe("chromium", () => {
  appTests(chromium, {
    args: ["--ignore-gpu-blocklist", "--enable-webgl", ...chromiumArgs],
  });
});

const describeFirefox = process.env.CI ? describe.skip : describe;
describeFirefox("firefox", () => {
  appTests(firefox, undefined, { skipDownloadTest: true });
});

// Playwright's WebKit uses ephemeral (non-persistent) browser contexts which
// do not support OPFS. This app requires OPFS, so WebKit e2e tests are skipped.
// OPFS works in real Safari — this is a Playwright limitation, not a Safari bug.
describe.skip("webkit", () => {
  appTests(webkit);
});
