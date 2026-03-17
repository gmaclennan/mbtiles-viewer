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
