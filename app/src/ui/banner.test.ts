import { describe, it, expect, vi } from "vitest";
import { EXPORTS, renderBanner, type BannerActions } from "./banner";
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
  withLoadedFile(initialState(), { name: "c.xlsx", model: base.template(), report: report, modifiedAt: null });

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

const callbacks = (): BannerActions =>
  Object.fromEntries(
    ["onExportSvg", "onExportPng", "onExportXlsx", "onExportMarkdown", "onExportDrawio", "onExportPdf", "onExportStructurizr", "onExportLikeC4", "onExportFossflow", "onDownloadRefreshed"].map((k) => [k, vi.fn()])
  ) as unknown as BannerActions;

const labelsIn = (root: ParentNode, selector: string) =>
  [...root.querySelectorAll<HTMLButtonElement>(selector)].map((b) => b.textContent);

// A refusal used to rewrite the banner in silence: a screen reader never learnt
// the drop had failed.
describe("renderBanner — the state is a live region", () => {
  it("announces a refusal as an alert, and the ordinary state as a status", () => {
    const root = document.createElement("header");
    renderBanner(root, { ...initialState(), bannerMessage: "That is not an Excel workbook." }, false, callbacks());
    expect(root.querySelector(".banner-state")?.getAttribute("role")).toBe("alert");
    renderBanner(root, initialState(), false, callbacks());
    expect(root.querySelector(".banner-state")?.getAttribute("role")).toBe("status");
  });
});

// The banner is one line, shared with the exports: the name of the workbook is
// all it says of it. The counts and the save date wait in the tooltip.
describe("renderBanner — the workbook, by its name only", () => {
  it("shows the name, and keeps the counts and the date for the tooltip", () => {
    const root = document.createElement("header");
    renderBanner(root, withView(loaded(), "matrix"), false, callbacks());
    const state = root.querySelector<HTMLElement>(".banner-state")!;
    expect(state.textContent).toBe("c.xlsx");
    expect(state.title).toMatch(/^\d+ actors, \d+ interfaces, \d+ consumptions — save date unknown$/);
  });
});

// Nine buttons on one line left no room for anything else. The two images stay
// in sight; the seven other formats are one click further, under "Export".
describe("renderBanner — the export menu", () => {
  const rendered = (state: AppState = withView(loaded(), "matrix"), drawing = false) => {
    const root = document.createElement("header");
    const actions = callbacks();
    renderBanner(root, state, drawing, actions);
    return { root, actions, menu: root.querySelector<HTMLDetailsElement>(".banner-menu")! };
  };

  it("keeps the images as buttons and files the rest under the menu", () => {
    const { root, menu } = rendered();
    expect(labelsIn(root, ".banner-exports > .export-button")).toEqual(["SVG", "PNG"]);
    expect(labelsIn(menu, ".banner-menu-item")).toEqual(EXPORTS.filter((e) => e.place === "menu").map((e) => e.label));
    expect(menu.querySelector("summary")?.textContent).toContain("Export");
  });

  it("applies the same rule to a menu item as to a button, hint included", () => {
    const { menu } = rendered();
    const excel = [...menu.querySelectorAll<HTMLButtonElement>(".banner-menu-item")].find((b) => b.textContent === "Excel")!;
    const markdown = [...menu.querySelectorAll<HTMLButtonElement>(".banner-menu-item")].find((b) => b.textContent === "Markdown")!;
    expect(excel.disabled).toBe(false);
    expect(markdown.disabled).toBe(true);
    expect(markdown.title).toBe("Markdown: not available on this view");
  });

  it("runs the export and closes once a format is picked", () => {
    const { menu, actions } = rendered();
    menu.open = true;
    [...menu.querySelectorAll<HTMLButtonElement>(".banner-menu-item")].find((b) => b.textContent === "Excel")!.click();
    expect(actions.onExportXlsx).toHaveBeenCalledTimes(1);
    expect(menu.open).toBe(false);
  });

  it("closes on a click elsewhere and on Escape, and only while open", () => {
    const { root, menu } = rendered();
    document.body.appendChild(root);
    try {
      menu.open = true;
      menu.dispatchEvent(new Event("toggle"));
      document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      expect(menu.open).toBe(false);

      menu.open = true;
      menu.dispatchEvent(new Event("toggle"));
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      expect(menu.open).toBe(false);

      // A click inside the menu is not a click elsewhere.
      menu.open = true;
      menu.dispatchEvent(new Event("toggle"));
      menu.querySelector(".banner-menu-list")!.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      expect(menu.open).toBe(true);
    } finally {
      root.remove();
    }
  });

  it("does not open on a promise it cannot keep", () => {
    const { menu } = rendered(initialState());
    expect(menu.classList.contains("banner-menu-disabled")).toBe(true);
    const summary = menu.querySelector("summary")!;
    expect(summary.getAttribute("aria-disabled")).toBe("true");
    expect(summary.title).toBe("Export: not available on this view");
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    summary.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(true);
  });
});
