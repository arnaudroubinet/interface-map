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
  // Where the banner offers it. The two images are what one takes away most
  // often, and they stay as buttons, in sight; the seven others are one click
  // further, under a single "Export" menu -- nine buttons on one line left no
  // room for anything else.
  place: ExportPlace;
  // `drawingAvailable` says a diagram is on screen and ready to be rendered.
  active: (state: AppState, drawingAvailable: boolean) => boolean;
}
export type ExportPlace = "button" | "menu";

const onADiagram = (state: AppState, drawingAvailable: boolean) =>
  state.file !== null && state.view !== "matrix" && state.view !== "checks" && drawingAvailable;

// These three carry away the WHOLE workbook -- draw.io one board per tab, the
// DSLs one view per board -- so none depends on the view that is open.
const always = (state: AppState) => state.file !== null && state.view !== "upgrade";

export const EXPORTS: FormatExport[] = [
  { label: "SVG", callback: "onExportSvg", place: "button", active: onADiagram },
  { label: "PNG", callback: "onExportPng", place: "button", active: onADiagram },
  // The matrix is not a drawing: what one wants to take away is the table, in
  // the tool where it gets sorted and filtered.
  { label: "Excel", callback: "onExportXlsx", place: "menu", active: (s) => s.file !== null && s.view === "matrix" },
  // The report is neither a drawing nor a table: it is a list of rows to fix,
  // each with its address. Taken away as Markdown, it pastes into a ticket and
  // gets handled without reopening the tool.
  { label: "Markdown", callback: "onExportMarkdown", place: "menu", active: (s) => s.file !== null && s.view === "checks" },
  // draw.io is a drawing: it follows the reading mode.
  { label: "draw.io", callback: "onExportDrawio", place: "menu", active: always },
  // These two were closed in the functional reading, on the grounds that a
  // functional diagram is not a C4 architecture. The reason does not hold: a
  // system rendering a service to another is a systemLandscape's central use
  // case. What is forbidden is delivering a file that tells something other than
  // the screen -- so it is enough for the file to SAY what it is, which it now
  // does.
  // The PDF carries every board and the report, like draw.io: it does not
  // depend on the view that is open either.
  { label: "PDF", callback: "onExportPdf", place: "menu", active: always },
  { label: "Structurizr", callback: "onExportStructurizr", place: "menu", active: always },
  { label: "LikeC4", callback: "onExportLikeC4", place: "menu", active: always },
  // Every board as a FossFLOW document, one view per board, like draw.io: a
  // drawing that follows the reading mode, reworkable in the isometric tool.
  { label: "FossFLOW", callback: "onExportFossflow", place: "menu", active: always },
];

// What the banner can do beyond exporting: hand back the workbook the tool
// rebuilt from a dropped referential. Not an export -- nothing on screen is
// converted, the FILE itself is returned -- so it is not in the EXPORTS table
// either, and the help page has nothing to document about a format.
export interface BannerActions extends BannerCallbacks {
  onDownloadRefreshed: () => void;
}

// The verdict of the last referential dropped, in a few words: the banner is
// one line, and a sentence with a button in it pushed the exports out of sight.
// The news of a rebuild is told in the middle of the screen (refresh-panel.ts);
// here stays what must remain reachable afterwards -- the file to download, as
// a button and nothing else.
export function referentialNote(state: AppState, onDownload: () => void): HTMLElement | null {
  const check = state.referentialCheck;
  if (!check) return null;
  const note = el("span", { class: "banner-referential" });
  if (!check.drifted) {
    note.textContent = "Referential: up to date";
    note.title = `${check.referential}: the workbook's copy matches it.`;
    return note;
  }
  note.classList.add("banner-referential-drifted");
  // While the panel is up, the button is there, in the middle of the screen:
  // a second one here would be two buttons for one file.
  if (!check.acknowledged) {
    note.textContent = "Referential: copy refreshed";
    return note;
  }
  const button = el(
    "button",
    {
      class: "export-button",
      title: `Rebuilt from ${check.referential}. Columns you added yourself, formatting and personal sheets are not carried over.`,
    },
    ["Download the updated workbook"]
  );
  button.addEventListener("click", onDownload);
  note.appendChild(button);
  return note;
}

export function renderBanner(
  root: HTMLElement,
  state: AppState,
  exportAvailable: boolean,
  callbacks: BannerActions
): void {
  clear(root);

  const title = el("span", { class: "banner-title" }, ["Interface Map"]);
  root.appendChild(title);

  // A live region: a refusal rewrote this span in silence, and a screen reader
  // never learnt the drop had failed. An error is announced at once; the
  // ordinary state waits its turn.
  const legacyState = el("span", { class: "banner-state", role: state.bannerMessage ? "alert" : "status" });
  if (state.bannerMessage) {
    legacyState.classList.add("banner-error");
    legacyState.textContent = state.bannerMessage;
  } else if (state.file) {
    // The name, and the name only: the counts and the save date were a
    // sentence long, and the banner is one line shared with the exports. They
    // wait in the tooltip, for whoever hovers the name.
    // A freshly produced workbook has no save date yet: say so rather than show
    // "saved" followed by a blank.
    const date = state.file.modifiedAt
      ? `saved ${state.file.modifiedAt.toLocaleString("en-GB")}`
      : "save date unknown";
    const { actors, interfaces, consumptions } = state.file.model;
    legacyState.appendChild(el("strong", {}, [state.file.name]));
    legacyState.title = `${actors.length} actors, ${interfaces.length} interfaces, ${consumptions.length} consumptions — ${date}`;
  } else {
    legacyState.textContent = "No workbook loaded.";
  }
  root.appendChild(legacyState);

  const note = referentialNote(state, callbacks.onDownloadRefreshed);
  if (note) root.appendChild(note);

  // One container for the exports: the two image buttons, then the menu that
  // holds the seven others. On a desktop it does not exist for the layout
  // (display: contents); on a phone it becomes the one row under the name.
  const exportsRow = el("div", { class: "banner-exports" });
  for (const format of EXPORTS.filter((f) => f.place === "button")) {
    exportsRow.appendChild(exportButton(format, "export-button", state, exportAvailable, callbacks));
  }
  exportsRow.appendChild(exportMenu(state, exportAvailable, callbacks));
  root.appendChild(exportsRow);
}

function exportButton(
  format: FormatExport,
  className: string,
  state: AppState,
  exportAvailable: boolean,
  callbacks: BannerCallbacks
): HTMLButtonElement {
  const button = el("button", { class: className }, [format.label]);
  button.disabled = !format.active(state, exportAvailable);
  // Greyed without a word, a button reads as broken. The rule is in the help
  // page; the hint puts it where the question is asked.
  if (button.disabled) button.title = `${format.label}: not available on this view`;
  button.addEventListener("click", callbacks[format.callback]);
  return button;
}

// The "Export" menu: a <details>, so that open and closed are the browser's
// business and need no state of ours. What is ours: it closes once a format is
// picked, on Escape, and on a click anywhere else -- a menu left open over the
// diagram is a menu one has to go back and shut.
function exportMenu(state: AppState, exportAvailable: boolean, callbacks: BannerCallbacks): HTMLElement {
  const formats = EXPORTS.filter((f) => f.place === "menu");
  const menu = el("details", { class: "banner-menu" });
  const summary = el("summary", { class: "export-button banner-menu-summary" }, ["Export ▾"]);
  const list = el("div", { class: "banner-menu-list", role: "menu" });
  menu.appendChild(summary);
  menu.appendChild(list);

  // The listeners live on the document only while the menu is open. The banner
  // is rebuilt on every render, and a menu rebuilt while open is gone without
  // a toggle: closing detaches them itself rather than trusting the event.
  const onOutside = (event: Event) => {
    if (!menu.isConnected || !menu.contains(event.target as Node)) close();
  };
  const onEscape = (event: KeyboardEvent) => {
    if (event.key === "Escape") close();
  };
  const detach = () => {
    document.removeEventListener("pointerdown", onOutside);
    document.removeEventListener("keydown", onEscape);
  };
  const close = () => {
    menu.open = false;
    detach();
  };
  menu.addEventListener("toggle", () => {
    if (menu.open) {
      document.addEventListener("pointerdown", onOutside);
      document.addEventListener("keydown", onEscape);
    } else {
      detach();
    }
  });

  for (const format of formats) {
    const item = exportButton(format, "banner-menu-item", state, exportAvailable, callbacks);
    item.setAttribute("role", "menuitem");
    item.addEventListener("click", close);
    list.appendChild(item);
  }

  // Nothing to export: the menu would open on an empty promise. Say so where
  // the buttons say it, and do not open.
  if (!formats.some((f) => f.active(state, exportAvailable))) {
    menu.classList.add("banner-menu-disabled");
    summary.title = "Export: not available on this view";
    summary.setAttribute("aria-disabled", "true");
    summary.addEventListener("click", (event) => event.preventDefault());
  }
  return menu;
}
