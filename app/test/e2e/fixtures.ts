import { writeTemplate, type WorkbookData } from "../../src/export/template-export";
import { writeReferential, type ReferentialData } from "../../src/export/referential-template";
import { readReferentialWorkbook } from "../../src/parsing/referential-workbook";
import { parseWorkbook } from "../../src/parsing/workbook";
import { REF_ACTORS_SHEET } from "../../src/parsing/build-model";

// The two files the browser tests drop, written by the tool's own writers.
//
// This module is BUNDLED by esbuild before the tests run, rather than imported
// by them: the browser test runner loads TypeScript as ES modules, under which
// SheetJS -- a CommonJS package -- exposes nothing but a default export, and
// XLSX.CFB is undefined. The app itself never meets the problem because it is
// bundled the same way; the tests borrow the same door.

const cartography: WorkbookData = {
  flowTypes: [["HTTP", "consumer → provider", ""]],
  actorTypes: [],
  milestones: [],
  groups: [["Core", "Platform"]],
  actors: [
    ["Tatooine", "Core", "Application", "", "", "", "", ""],
    ["Mygeeto", "Core", "Application", "", "", "", "", ""],
  ],
  interfaces: [["Authent", "", "Tatooine", "HTTP", "", "", "", "", "No", "", ""]],
  fx: [{ name: "FX_Tatooine_HTTP", rows: [["Authent", "", "Mygeeto", "", "", "Keep", "", "", "", ""]] }],
};

const published: ReferentialData = {
  actors: [
    ["Tatooine", "Core", "Application", "Leia", ""],
    ["Mygeeto", "Core", "Application", "", ""],
  ],
  groups: [["Core", ""]],
  actorTypes: [],
  flowTypes: [["HTTP", "consumer → provider", "", ""]],
};

export type Dropped = { name: string; bytes: ArrayBuffer };

export const referentialFile = (): Dropped => ({ name: "ref.xlsx", bytes: writeReferential(published) });

// A copy one actor short of what the referential publishes.
export const driftedCartography = (): Dropped => ({
  name: "carto.xlsx",
  bytes: writeTemplate({ ...cartography, referentialRows: { [REF_ACTORS_SHEET]: [["Tatooine", "Core", "Application", "", ""]] } }),
});

// A copy taken from the referential itself.
export const currentCartography = (): Dropped => ({
  name: "carto.xlsx",
  bytes: writeTemplate({ ...cartography, referentialRows: readReferentialWorkbook(parseWorkbook(writeReferential(published)))! }),
});
