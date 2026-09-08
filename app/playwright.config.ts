import { defineConfig } from "@playwright/test";

// The browser tests. Few, and slow next to vitest's: they exist for what jsdom
// cannot say -- a real drop with several files, a real download -- and run on
// the built page, the one file the tool ships.
//
// `*.e2e.ts`, not `*.spec.ts`: vitest picks up every spec by default, and
// would try to run these under jsdom.
//
// CHROMIUM_PATH points at a Chromium already on the machine when Playwright's
// own download is not wanted -- a sandbox with a pinned browser, a CI without
// network. Unset, Playwright uses the browser it installed.
export default defineConfig({
  testDir: "test/e2e",
  testMatch: /.*\.e2e\.ts/,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    browserName: "chromium",
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
});
