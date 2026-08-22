import { el } from "../shared/dom";
import { buildGraphSvg } from "../render/svg-builder";
import { reportSections } from "../render/integrity-report";
import type { LayoutResult } from "../layout/graph-layout";
import type { DiagramContext } from "../render/title-block";
import type { IntegrityReport } from "../integrity/checks";

// The deliverable one attaches to an architecture folder: every board, one per
// page, and the integrity report in appendix.
//
// No dependency. A PDF library would weigh more than the whole application, in
// a deliverable that must stay one file -- and the browser already knows how to
// make a PDF out of a page. So this assembles the page, and window.print() does
// the rest.
export interface PrintableBoard {
  layout: LayoutResult;
  // Each board carries its own title block: a page torn from the folder must
  // still say which board it is, at which milestone, under which reading.
  context: DiagramContext;
}

function appendix(report: IntegrityReport, context: DiagramContext): HTMLElement {
  const page = el("section", { class: "print-page print-appendix" });
  page.appendChild(el("h1", {}, [`Integrity report — ${context.source}`]));

  // The report reads AT the displayed milestone for half its checks: a folder
  // that does not say which moment it judges lets the reader attribute to the
  // milestone a fault that does not depend on it.
  const scope = context.milestone
    ? `Milestone ${context.milestone}. Structure, references, vocabularies and consistency are checked on the whole workbook; completeness and the information blocks are read at this milestone.`
    : "Structure, references, vocabularies and consistency are checked on the whole workbook.";
  page.appendChild(el("p", { class: "print-scope" }, [scope]));

  // The same rule as the Markdown report: what has nothing to report has no
  // place on paper. A tick reassures on screen; printed, it costs a page and
  // says nothing.
  const sections = reportSections(report).filter((s) => s.items.length > 0);
  if (sections.length === 0) {
    page.appendChild(el("p", {}, ["Nothing to report."]));
    return page;
  }

  for (const section of sections) {
    page.appendChild(el("h2", {}, [`${section.title} (${section.items.length})`]));
    const list = el("ul", {});
    for (const item of section.items) list.appendChild(el("li", {}, [item]));
    page.appendChild(list);
  }
  return page;
}

export function buildPrintableDocument(
  boards: readonly PrintableBoard[],
  report: IntegrityReport,
  context: DiagramContext,
  colourFor: (technology: string) => string
): HTMLElement {
  const doc = el("div", { class: "print-document" });

  for (const board of boards) {
    const page = el("section", { class: "print-page" });
    page.appendChild(buildGraphSvg(board.layout, colourFor, board.context));
    doc.appendChild(page);
  }

  // A workbook can produce no board at all -- everything retired at the
  // displayed milestone. The report is then the only thing left to print, and a
  // document of zero pages would be a silent failure.
  doc.appendChild(appendix(report, context));

  // Every page breaks after it EXCEPT the last: a break on the last one sends
  // the PDF out with a blank final page. Marked in the DOM rather than left to
  // `:last-child`, so that what the document promises is what a test can read.
  const pages = [...doc.children];
  for (const page of pages.slice(0, -1)) page.classList.add("print-break");

  return doc;
}
