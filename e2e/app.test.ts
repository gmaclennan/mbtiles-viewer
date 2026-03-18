import path from "path";
import {
  chromium,
  firefox,
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

function appTests(
  browserType: BrowserType,
  launchOptions?: Record<string, unknown>,
) {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await browserType.launch({
      headless: true,
      ...launchOptions,
    });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser?.close();
  });

  test("shows the open button on load", async () => {
    await page.goto(baseUrl);
    const button = page.locator("#open-button");
    await button.waitFor({ state: "visible" });
    expect(await button.isEnabled()).toBe(true);
  });

  test("shows drag-and-drop hint text on load", async () => {
    await page.goto(baseUrl);
    const hint = page.locator("#drop-hint");
    await hint.waitFor({ state: "visible" });
    expect(await hint.textContent()).toContain("drag");
  });

  test("shows drop overlay on dragenter and hides on dragleave", async () => {
    await page.goto(baseUrl);
    await page.locator("#open-button").waitFor({ state: "visible" });

    const overlay = page.locator("#drop-overlay");
    expect(await overlay.isVisible()).toBe(false);

    // Simulate dragenter
    await page.dispatchEvent("body", "dragenter", {
      dataTransfer: {},
    });
    await overlay.waitFor({ state: "visible" });
    expect(await overlay.isVisible()).toBe(true);

    // Simulate dragleave
    await page.dispatchEvent("body", "dragleave", {
      dataTransfer: {},
    });
    expect(await overlay.isVisible()).toBe(false);
  });

  test("can open an mbtiles file via drag and drop", async () => {
    await page.goto(baseUrl);
    await page.locator("#open-button").waitFor({ state: "visible" });

    // Read the fixture file and create a DataTransfer-like drop event
    const buffer = await import("fs").then((fs) =>
      fs.readFileSync(fixturePath),
    );

    // Use Playwright's page.evaluate to simulate a drop with a real File
    await page.evaluate(
      async ({ bytes, fileName }) => {
        const uint8 = new Uint8Array(bytes);
        const file = new File([uint8], fileName);
        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);

        // Dispatch dragenter first so the overlay shows
        document.dispatchEvent(
          new DragEvent("dragenter", { dataTransfer, bubbles: true }),
        );
        // Then dispatch drop
        document.dispatchEvent(
          new DragEvent("drop", { dataTransfer, bubbles: true }),
        );
      },
      { bytes: Array.from(buffer), fileName: "plain_1.mbtiles" },
    );

    // Wait for map to become visible
    const map = page.locator("#map");
    await map.waitFor({ state: "visible", timeout: 30_000 });

    // Verify MapLibre has rendered a canvas
    const canvas = map.locator("canvas");
    await canvas.waitFor({ state: "attached", timeout: 10_000 });
    expect(await canvas.count()).toBeGreaterThan(0);
  });

  test("can open and view an mbtiles file", async () => {
    await page.goto(baseUrl);
    await page.locator("#open-button").waitFor({ state: "visible" });

    // Click button and handle file chooser
    const [fileChooser] = await Promise.all([
      page.waitForEvent("filechooser"),
      page.locator("#open-button").click(),
    ]);
    await fileChooser.setFiles(fixturePath);

    // Wait for map to become visible (sourcedata event fires after tiles load)
    const map = page.locator("#map");
    await map.waitFor({ state: "visible", timeout: 30_000 });

    // Verify MapLibre has rendered a canvas
    const canvas = map.locator("canvas");
    await canvas.waitFor({ state: "attached", timeout: 10_000 });
    expect(await canvas.count()).toBeGreaterThan(0);
  });
}

describe("chromium", () => {
  appTests(chromium, {
    args: ["--ignore-gpu-blocklist", "--enable-webgl", ...chromiumArgs],
  });
});

const describeFirefox = process.env.CI ? describe.skip : describe;
describeFirefox("firefox", () => {
  appTests(firefox);
});
