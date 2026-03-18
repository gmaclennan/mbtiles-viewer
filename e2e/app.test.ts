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

/** Open an mbtiles file and wait for the map to render */
async function openMbtilesFile(page: Page) {
  await page.goto(baseUrl);
  await page.locator("#open-button").waitFor({ state: "visible" });

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.locator("#open-button").click(),
  ]);
  await fileChooser.setFiles(fixturePath);

  const map = page.locator("#map");
  await map.waitFor({ state: "visible", timeout: 30_000 });

  const canvas = map.locator("canvas");
  await canvas.waitFor({ state: "attached", timeout: 10_000 });
}

function appTests(
  browserType: BrowserType,
  launchOptions?: Record<string, unknown>,
  opts?: { skipDownloadTest?: boolean },
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
    await openMbtilesFile(page);
    const canvas = page.locator("#map canvas");
    expect(await canvas.count()).toBeGreaterThan(0);
  });

  const testDownload = opts?.skipDownloadTest ? test.skip : test;
  testDownload("can download mbtiles as smp file", async () => {
    await openMbtilesFile(page);

    const downloadBtn = page.locator("#download-smp");
    await downloadBtn.waitFor({ state: "visible", timeout: 10_000 });

    // Remove showSaveFilePicker so the code uses the service worker streaming
    // path (which triggers a download via Content-Disposition that Playwright
    // can capture).
    await page.evaluate(async () => {
      delete (window as any).showSaveFilePicker;
      // Ensure service worker is active before triggering download
      await navigator.serviceWorker.ready;
    });

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60_000 }),
      downloadBtn.click(),
    ]);

    expect(download.suggestedFilename()).toBe("plain_1.smp");

    const readable = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of readable) {
      chunks.push(Buffer.from(chunk));
    }
    const fileContents = Buffer.concat(chunks);

    // SMP files are zip archives — verify the zip magic number (PK\x03\x04)
    expect(fileContents[0]).toBe(0x50); // P
    expect(fileContents[1]).toBe(0x4b); // K
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
// See: https://github.com/microsoft/playwright/issues/18235
describe.skip("webkit", () => {
  appTests(webkit);
});
