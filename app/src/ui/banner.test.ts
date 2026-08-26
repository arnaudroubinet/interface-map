import { describe, it, expect } from "vitest";
import { EXPORTS } from "./banner";
import { initialState, withLoadedFile, withView, withMode } from "./state";
import type { AppState } from "./state";
import * as base from "../testing/fixtures";
import type { IntegrityReport } from "../integrity/checks";

// The button-disabling rules are LOGIC, not plumbing: they decide whether an
// export is offered, and they went quietly wrong when they lived scattered
// through eighty lines of buttons. Now a table, they are verified without
// mounting the DOM.

const report: IntegrityReport = {
  families: [],
  infoBlocks: [],
  totalAnomalies: 0,
  totalActions: 0,
  totalWarnings: 0,
};

const loaded = (): AppState =>
  withLoadedFile(initialState(), { name: "c.xlsx", model: base.template(), report: report, modifiedAt: null, referential: "" });

const active = (label: string, state: AppState, drawing = true) =>
  EXPORTS.find((e) => e.label === label)!.active(state, drawing);

describe("EXPORTS — when a format is offered", () => {
  it("offers nothing while no workbook is loaded", () => {
    for (const format of EXPORTS) {
      expect(format.active(initialState(), true)).toBe(false);
    }
  });

  it("offers the images on a diagram, and only there", () => {
    const s = withView(loaded(), "platform-detail");
    expect(active("SVG", s)).toBe(true);
    expect(active("PNG", s)).toBe(true);
    expect(active("SVG", withView(s, "matrix"))).toBe(false);
    expect(active("SVG", withView(s, "checks"))).toBe(false);
  });

  // A diagram not yet rendered is not exportable: the button would wait on a
  // drawing that does not exist.
  it("does not offer an image while the drawing is not ready", () => {
    expect(active("SVG", withView(loaded(), "platform-detail"), false)).toBe(false);
  });

  it("reserves Excel for the matrix and Markdown for the report", () => {
    expect(active("Excel", withView(loaded(), "matrix"))).toBe(true);
    expect(active("Excel", withView(loaded(), "checks"))).toBe(false);
    expect(active("Markdown", withView(loaded(), "checks"))).toBe(true);
    expect(active("Markdown", withView(loaded(), "matrix"))).toBe(false);
  });

  // The three that carry away the whole workbook do not depend on the view --
  // but the two C4 DSLs describe an architecture, not a business reading.
  // Both DSLs are REOPENED in the functional reading: a system rendering a
  // service to another is a systemLandscape's central use case. The file now
  // says which reading it carries, which was the real requirement.
  it("offers the three model formats in both readings", () => {
    const fonctionnel = withMode(withView(loaded(), "matrix"), "functional");
    expect(active("draw.io", fonctionnel)).toBe(true);
    expect(active("Structurizr", fonctionnel)).toBe(true);
    expect(active("LikeC4", fonctionnel)).toBe(true);
  });

  it("offers none of the three on the upgrade screen", () => {
    const blocked = withView(loaded(), "upgrade");
    for (const label of ["draw.io", "Structurizr", "LikeC4"]) {
      expect(active(label, blocked)).toBe(false);
    }
  });
});
