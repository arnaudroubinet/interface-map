import { el } from "../shared/dom";
import type { ReferentialCheck } from "./state";

// The panel that says the workbook was rebuilt from a dropped referential, and
// hands it back. It sits in the MIDDLE of the screen, over the view: the
// banner is one line, and a sentence plus a button there pushed the exports
// out of sight. The verdict is the news of the moment; it is shown as such,
// once, and can be dismissed -- the banner then keeps the button, and nothing
// but the button.
export interface RefreshPanelCallbacks {
  onDownload: () => void;
  onLater: () => void;
}

export function buildRefreshPanel(check: ReferentialCheck & { drifted: true }, callbacks: RefreshPanelCallbacks): HTMLElement {
  const download = el("button", { class: "export-button refresh-download", type: "button" }, ["Download the updated workbook"]);
  download.addEventListener("click", callbacks.onDownload);
  const later = el("button", { class: "export-button", type: "button" }, ["Not now"]);
  later.addEventListener("click", callbacks.onLater);

  const overlay = el("div", { class: "migration-overlay refresh-overlay" });
  const box = el("div", { class: "migration-box refresh-panel", role: "dialog", "aria-modal": "true", "aria-labelledby": "refresh-title" }, [
    el("h2", { class: "migration-title", id: "refresh-title" }, ["Referential copy refreshed"]),
    el("p", { class: "drop-target-text" }, [
      `The copy this workbook carried had drifted from ${check.referential}. It was rebuilt with the referential's rows, and that is the workbook on screen now.`,
    ]),
    el("p", { class: "drop-target-text" }, [
      `Download it as ${check.filename} to replace the file on disk. Rebuilt like an upgrade: columns you added yourself, formatting and personal sheets are not carried over.`,
    ]),
    el("div", { class: "drop-target-actions" }, [download, later]),
  ]);
  overlay.appendChild(box);
  // The veil closes like "Not now": the offer stays in the banner.
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) callbacks.onLater();
  });
  return overlay;
}
