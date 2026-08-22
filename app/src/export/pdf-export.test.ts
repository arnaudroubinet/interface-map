import { describe, it, expect } from "vitest";
import { buildPrintableDocument, type PrintableBoard } from "./pdf-export";
import { reportSections } from "../render/integrity-report";
import type { IntegrityReport } from "../integrity/checks";
import type { DiagramContext } from "../render/title-block";
import type { LayoutResult } from "../layout/graph-layout";

const ctx = (o: Partial<DiagramContext> = {}): DiagramContext => ({
  title: "Group to group",
  reading: "architecture",
  milestone: "v2",
  source: "carto.xlsx",
  date: "2026-08-22",
  components: 3,
  flows: 2,
  technologies: 1,
  ...o,
});

// One box and one line: enough for buildGraphSvg to produce a real drawing,
// which is what a page must hold.
function layout(): LayoutResult {
  return {
    nodes: [
      { id: "A", label: "A", kind: "actor", x: 100, y: 60, width: 200, height: 60 },
      { id: "B", label: "B", kind: "actor", x: 500, y: 60, width: 200, height: 60 },
    ],
    edges: [
      {
        from: "A",
        to: "B",
        technology: "HTTP",
        count: 1,
        label: "HTTP",
        attenuated: false,
        points: [
          { x: 200, y: 60 },
          { x: 400, y: 60 },
        ],
      },
    ],
    width: 700,
    height: 200,
  };
}

const boards = (titles: string[]): PrintableBoard[] =>
  titles.map((title) => ({ layout: layout(), context: ctx({ title }) }));

const emptyReport: IntegrityReport = {
  families: [],
  infoBlocks: [],
  totalAnomalies: 0,
  totalActions: 0,
  totalWarnings: 0,
};

const reportWithTwoSections: IntegrityReport = {
  families: [
    { id: "refs", title: "References", description: "d", anomalies: [{ message: "m1" }, { message: "m2" }] },
  ],
  infoBlocks: [{ id: "mig", title: "Migrations under way", description: "d", items: ["i1"], level: "action" }],
  totalAnomalies: 2,
  totalActions: 1,
  totalWarnings: 0,
};

const pages = (doc: HTMLElement) => [...doc.querySelectorAll(".print-page")];

describe("buildPrintableDocument", () => {
  it("lays one board per page, each with its own title block", () => {
    const doc = buildPrintableDocument(boards(["A", "B", "C"]), emptyReport, ctx(), () => "#111111");
    // Three boards plus the report in appendix.
    expect(pages(doc)).toHaveLength(4);
    for (const page of pages(doc).slice(0, 3)) {
      expect(page.querySelector("svg > title")).not.toBeNull();
    }
  });

  // The report in appendix: an architecture folder that shows the diagrams
  // without saying what the workbook holds that is inconsistent asserts more
  // than it knows.
  it("puts the integrity report in appendix, in the same order as on screen", () => {
    const doc = buildPrintableDocument(boards(["A"]), reportWithTwoSections, ctx(), () => "#111111");
    const titles = [...doc.querySelectorAll(".print-appendix h2")].map((h) => h.textContent);
    expect(titles).toEqual(
      reportSections(reportWithTwoSections)
        .filter((s) => s.items.length > 0)
        .map((s) => `${s.title} (${s.items.length})`)
    );
  });

  it("prints every item of every section it keeps", () => {
    const doc = buildPrintableDocument(boards(["A"]), reportWithTwoSections, ctx(), () => "#111111");
    const items = [...doc.querySelectorAll(".print-appendix li")].map((l) => l.textContent);
    expect(items).toEqual(["m1", "m2", "i1"]);
  });

  // A section with nothing to report reassures on screen; on paper it costs a
  // page and says nothing -- the same rule the Markdown report already applies.
  it("leaves out the sections that have nothing to report", () => {
    const doc = buildPrintableDocument(boards(["A"]), emptyReport, ctx(), () => "#111111");
    expect(doc.querySelectorAll(".print-appendix h2")).toHaveLength(0);
    expect((doc.querySelector(".print-appendix")?.textContent ?? "")).toContain("Nothing to report");
  });

  // Every page breaks after it EXCEPT the last: with a break on the last one,
  // the PDF comes out with a blank final page, which is exactly the kind of
  // defect nobody reports and everybody notices.
  it("breaks after every page but the last", () => {
    const all = pages(buildPrintableDocument(boards(["A", "B"]), emptyReport, ctx(), () => "#111111"));
    for (const page of all.slice(0, -1)) expect(page.classList.contains("print-break")).toBe(true);
    expect(all[all.length - 1].classList.contains("print-break")).toBe(false);
  });

  // The appendix names the workbook it judges: a page torn from the folder must
  // still say which file it is about.
  it("names the workbook and the milestone in the appendix", () => {
    const doc = buildPrintableDocument(boards(["A"]), emptyReport, ctx(), () => "#111111");
    const text = doc.querySelector(".print-appendix")?.textContent ?? "";
    expect(text).toContain("carto.xlsx");
    expect(text).toContain("v2");
  });

  // A workbook can produce no board at all -- everything retired at the
  // displayed milestone. The report is then the only thing left to print, and a
  // document of zero pages would be a silent failure.
  it("still prints the appendix when there is no board to draw", () => {
    const doc = buildPrintableDocument([], reportWithTwoSections, ctx(), () => "#111111");
    expect(pages(doc)).toHaveLength(1);
    expect(doc.querySelector(".print-appendix")).not.toBeNull();
  });
});
