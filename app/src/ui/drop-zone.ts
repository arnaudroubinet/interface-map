import { el } from "../shared/dom";

// The only message the tool allows itself when a workbook cannot be read at
// all: it then knows nothing of the real cause (truncated bytes, corrupt zip,
// unknown format...), so it claims nothing more precise. It is the exact
// wording the main drop target (app.ts) uses for the same failure; named here
// so that the migration dialog takes it up rather than inventing a second one.
//
export const UNREADABLE_WORKBOOK_MESSAGE = "Workbook unreadable or corrupted.";

export interface DropTargetCallbacks {
  // The same reading as a drop: what the picker hands over and what a drop
  // hands over must be read, or refused, in exactly the same words. Several
  // files at once, because the referential travels beside the cartography: one
  // gesture for the two, whichever way they were picked.
  onFiles: (files: File[]) => void;
  onOpenSample: () => void;
  onHelp: () => void;
}

export function buildDropTarget(callbacks: DropTargetCallbacks): HTMLElement {
  const button = el("button", { class: "export-button" }, ["Open a sample workbook"]);
  button.addEventListener("click", callbacks.onOpenSample);
  const helpButton = el("button", { class: "export-button" }, ["How it works"]);
  helpButton.addEventListener("click", callbacks.onHelp);

  // A phone knows no drag and drop: without this picker the landing screen
  // offers the reader a gesture they cannot make, and the tool is unusable
  // there. The input itself stays hidden -- an unlabelled native control
  // beside two buttons reads as nothing at all -- and a button opens it.
  const field = el("input", { type: "file", accept: ".xlsx,.xlsm", multiple: "", hidden: "" }) as HTMLInputElement;
  field.addEventListener("change", () => {
    const files = [...(field.files ?? [])];
    if (files.length > 0) callbacks.onFiles(files);
    // Cleared so that picking the SAME file again still fires a change: a
    // reader who corrected their workbook and picked it back would otherwise
    // get nothing at all.
    field.value = "";
  });
  const chooseButton = el("button", { class: "export-button" }, ["Choose a workbook"]);
  chooseButton.addEventListener("click", () => field.click());

  return el("div", { class: "drop-target" }, [
    el("p", { class: "drop-target-title" }, ["Drop an .xlsx or .xlsm workbook, or choose one"]),
    el("p", { class: "drop-target-text" }, [
      "The workbook is never uploaded or stored: everything happens in this browser.",
    ]),
    // The referential is a file too, and it is read HERE, in the same gesture:
    // dropped with the cartography, it is compared to the copy the cartography
    // carries, and an out-of-date copy is refreshed on the spot.
    el("p", { class: "drop-target-text" }, [
      "Drop the referential workbook alongside, or afterwards: if the cartography's copy of it has drifted, the tool refreshes it and hands the updated workbook back.",
    ]),
    // With no workbook at hand, the most useful thing is to try a filled one: the
    // empty template stays available at the rail's foot.
    el("div", { class: "drop-target-actions" }, [chooseButton, button, helpButton]),
    field,
  ]);
}

export function wireDropZone(
  root: HTMLElement,
  onFiles: (files: File[]) => void
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
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length > 0) onFiles(files);
  });
}
