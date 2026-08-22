import { el } from "../shared/dom";

// The only message the tool allows itself when a workbook cannot be read at
// all: it then knows nothing of the real cause (truncated bytes, corrupt zip,
// unknown format...), so it claims nothing more precise. It is the exact
// wording the main drop target (app.ts) uses for the same failure; named here
// so that the migration dialog takes it up rather than inventing a second one.
//
export const UNREADABLE_WORKBOOK_MESSAGE = "Workbook unreadable or corrupted.";

export function buildDropTarget(onDownloadSample: () => void, onAide: () => void): HTMLElement {
  const button = el("button", { class: "export-button" }, ["Open a sample workbook"]);
  button.addEventListener("click", onDownloadSample);
  const aide = el("button", { class: "export-button" }, ["How it works"]);
  aide.addEventListener("click", onAide);
  return el("div", { class: "drop-target" }, [
    el("p", { class: "drop-target-title" }, ["Drop an .xlsx or .xlsm workbook"]),
    el("p", { class: "drop-target-text" }, [
      "The workbook is never uploaded or stored: everything happens in this browser.",
    ]),
    // With no workbook at hand, the most useful thing is to try a filled one: the
    // empty template stays available at the rail's foot.
    el("div", { class: "drop-target-actions" }, [button, aide]),
  ]);
}

export function wireDropZone(
  root: HTMLElement,
  onFile: (file: File) => void
): void {
  root.addEventListener("dragover", (e) => {
    e.preventDefault();
    root.classList.add("hover");
  });
  root.addEventListener("dragleave", () => {
    root.classList.remove("hover");
  });
  root.addEventListener("drop", (e) => {
    e.preventDefault();
    root.classList.remove("hover");
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}
