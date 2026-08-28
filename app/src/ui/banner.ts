import { el, clear } from "../shared/dom";
import type { AppState } from "./state";

export interface BannerCallbacks {
  onExportSvg: () => void;
  onExportPng: () => void;
  onExportXlsx: () => void;
  onExportMarkdown: () => void;
  onExportDrawio: () => void;
  onExportPdf: () => void;
  onExportStructurizr: () => void;
  onExportLikeC4: () => void;
  onExportFossflow: () => void;
}

// The exports table. Nine today, and a tenth should not force anyone to
// hunt, through eighty lines of buttons, for which of the four disabling rules
// resembles it. They are here, side by side, in one column: the question
// "which one applies to me" is answered by reading its neighbours.
//
// The test in render.test.ts compares this list with what the help page
// documents, exactly as it already does for the rail's views: an eighth format
// therefore cannot arrive without its line of explanation.
export interface FormatExport {
  label: string;
  callback: keyof BannerCallbacks;
  // `drawingAvailable` says a diagram is on screen and ready to be rendered.
  active: (state: AppState, drawingAvailable: boolean) => boolean;
}

const onADiagram = (state: AppState, drawingAvailable: boolean) =>
  state.file !== null && state.view !== "matrix" && state.view !== "checks" && drawingAvailable;

// These three carry away the WHOLE workbook -- draw.io one board per tab, the
// DSLs one view per board -- so none depends on the view that is open.
const always = (state: AppState) => state.file !== null && state.view !== "upgrade";

export const EXPORTS: FormatExport[] = [
  { label: "SVG", callback: "onExportSvg", active: onADiagram },
  { label: "PNG", callback: "onExportPng", active: onADiagram },
  // The matrix is not a drawing: what one wants to take away is the table, in
  // the tool where it gets sorted and filtered.
  { label: "Excel", callback: "onExportXlsx", active: (s) => s.file !== null && s.view === "matrix" },
  // The report is neither a drawing nor a table: it is a list of rows to fix,
  // each with its address. Taken away as Markdown, it pastes into a ticket and
  // gets handled without reopening the tool.
  { label: "Markdown", callback: "onExportMarkdown", active: (s) => s.file !== null && s.view === "checks" },
  // draw.io is a drawing: it follows the reading mode.
  { label: "draw.io", callback: "onExportDrawio", active: always },
  // These two were closed in the functional reading, on the grounds that a
  // functional diagram is not a C4 architecture. The reason does not hold: a
  // system rendering a service to another is a systemLandscape's central use
  // case. What is forbidden is delivering a file that tells something other than
  // the screen -- so it is enough for the file to SAY what it is, which it now
  // does.
  // The PDF carries every board and the report, like draw.io: it does not
  // depend on the view that is open either.
  { label: "PDF", callback: "onExportPdf", active: always },
  { label: "Structurizr", callback: "onExportStructurizr", active: always },
  { label: "LikeC4", callback: "onExportLikeC4", active: always },
  // Every board as a FossFLOW document, one view per board, like draw.io: a
  // drawing that follows the reading mode, reworkable in the isometric tool.
  { label: "FossFLOW", callback: "onExportFossflow", active: always },
];

export function renderBanner(
  root: HTMLElement,
  state: AppState,
  exportAvailable: boolean,
  callbacks: BannerCallbacks
): void {
  clear(root);

  const title = el("span", { class: "banner-title" }, ["Interface Map"]);
  root.appendChild(title);

  const legacyState = el("span", { class: "banner-state" });
  if (state.bannerMessage) {
    legacyState.classList.add("banner-error");
    legacyState.textContent = state.bannerMessage;
  } else if (state.file) {
    // A freshly produced workbook has no save date yet: say so rather than show
    // "saved" followed by a blank.
    const date = state.file.modifiedAt
      ? `saved ${state.file.modifiedAt.toLocaleString("en-GB")}`
      : "save date unknown";
    legacyState.appendChild(el("strong", {}, [state.file.name]));
    legacyState.appendChild(
      document.createTextNode(
        ` — ${state.file.model.actors.length} actors, ${state.file.model.interfaces.length} interfaces, ${state.file.model.consumptions.length} consumptions — ${date}`
      )
    );
  } else {
    legacyState.textContent = "No workbook loaded.";
  }
  root.appendChild(legacyState);

  // One container for the buttons. On a desktop it does not exist for the
  // layout (display: contents); on a phone it becomes the one row that
  // scrolls sideways, instead of nine buttons wrapping over half the screen.
  const exportsRow = el("div", { class: "banner-exports" });
  for (const format of EXPORTS) {
    const button = el("button", { class: "export-button" }, [format.label]);
    button.disabled = !format.active(state, exportAvailable);
    button.addEventListener("click", callbacks[format.callback]);
    exportsRow.appendChild(button);
  }
  root.appendChild(exportsRow);
}
