import { test, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { buildSync } from "esbuild";
import type * as Fixtures from "./fixtures";

// The referential dropped beside the cartography, in a real browser. What
// jsdom cannot exercise is exactly what this feature is made of: a drop
// carrying TWO files at once, a file picker set to several, and a download
// that must not fire until the button is clicked.

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const APP = resolve(ROOT, "dist/interface-map.html");

// The fixtures, bundled the way the app is (see fixtures.ts for why), then
// required as CommonJS.
function loadFixtures(): typeof Fixtures {
  const outfile = resolve(ROOT, "test-results/e2e-fixtures.cjs");
  buildSync({ entryPoints: [resolve(HERE, "fixtures.ts")], bundle: true, platform: "node", format: "cjs", outfile, logLevel: "silent" });
  return createRequire(import.meta.url)(outfile);
}
const { referentialFile, driftedCartography, currentCartography } = loadFixtures();
type Dropped = Fixtures.Dropped;

// A real drop: a DragEvent whose DataTransfer carries the files, dispatched on
// the page as the browser would. Playwright's setInputFiles goes through the
// picker; this goes through the other door, the one the feature is named for.
async function dropFiles(page: Page, files: Dropped[]): Promise<void> {
  const payload = files.map((f) => ({ name: f.name, base64: Buffer.from(f.bytes).toString("base64") }));
  await page.evaluate((dropped) => {
    const transfer = new DataTransfer();
    for (const d of dropped) {
      const bytes = Uint8Array.from(atob(d.base64), (c) => c.charCodeAt(0));
      transfer.items.add(new File([bytes], d.name, { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    }
    document.getElementById("app")!.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  }, payload);
}

test.beforeAll(() => {
  if (!existsSync(APP)) execSync("node esbuild.build.mjs", { cwd: ROOT, stdio: "inherit" });
});

test.beforeEach(async ({ page }) => {
  await page.goto(`file://${APP}`);
  await expect(page.locator(".drop-target-title")).toBeVisible();
});

test("a drifted copy is rebuilt, shown, and offered back on request only", async ({ page }) => {
  await dropFiles(page, [referentialFile(), driftedCartography()]);

  const banner = page.locator(".banner");
  await expect(banner).toContainText("Referential ref.xlsx");
  await expect(banner).toContainText("had drifted");
  const button = page.getByRole("button", { name: "Download the updated workbook" });
  await expect(button).toBeVisible();
  // The rebuilt workbook is on screen: the rail offers its views.
  await expect(page.locator(".rail-view-item").first()).toBeVisible();
  await page.screenshot({ path: "test-results/referential-drifted.png", fullPage: true });

  const download = page.waitForEvent("download");
  await button.click();
  expect((await download).suggestedFilename()).toBe("carto.xlsx");
});

test("an up-to-date copy is said so, with nothing to download", async ({ page }) => {
  // Through the picker this time, set to several files.
  const field = page.locator(".drop-target input[type=file]");
  await expect(field).toHaveAttribute("multiple", "");
  await field.setInputFiles(
    [currentCartography(), referentialFile()].map((f) => ({
      name: f.name,
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buffer: Buffer.from(f.bytes),
    }))
  );

  await expect(page.locator(".banner")).toContainText("the workbook's copy is up to date");
  await expect(page.getByRole("button", { name: "Download the updated workbook" })).toHaveCount(0);
});

test("a referential dropped afterwards applies to the workbook on screen", async ({ page }) => {
  await dropFiles(page, [driftedCartography()]);
  await expect(page.locator(".rail-view-item").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Download the updated workbook" })).toHaveCount(0);

  await dropFiles(page, [referentialFile()]);
  await expect(page.getByRole("button", { name: "Download the updated workbook" })).toBeVisible();
});

test("a referential with nothing to apply it to is refused, and named", async ({ page }) => {
  await dropFiles(page, [referentialFile()]);
  await expect(page.locator(".banner-error")).toContainText("ref.xlsx is a referential");
  await expect(page.locator(".drop-target-title")).toBeVisible();
});
