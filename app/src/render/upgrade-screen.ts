import { el } from "../shared/dom";

// The screen that replaces every view when the dropped workbook follows a
// format older than the one the tool can read. There is only one possible
// action, and it is stated before it is offered: the upgrade rebuilds the
// workbook, it does not patch it.
export function buildUpgradeScreen(
  workbookVersion: number,
  expectedVersion: number,
  onUpgrade: () => void
): HTMLElement {
  // The mismatch reads both ways, and it does not call for the same answer.
  // Behind, the tool knows how to rebuild the workbook. Ahead, it can do
  // nothing at all: offering an upgrade would amount to offering a downgrade,
  // which would lose whatever this parser does not read.
  if (workbookVersion > expectedVersion) {
    return el("div", { class: "drop-target" }, [
      el("p", { class: "drop-target-title" }, [
        `This workbook follows model v${workbookVersion}; the tool only reads v${expectedVersion}.`,
      ]),
      el("p", { class: "drop-target-text" }, [
        "It was written by a newer version of the tool. Anything it holds that this version does not know would be dropped without a word, so no view is available.",
      ]),
      el("p", { class: "drop-target-text" }, [
        "Open it with an up-to-date copy of the tool. Downgrading the file is not offered: it would quietly impoverish it.",
      ]),
    ]);
  }

  const button = el("button", { class: "export-button" }, ["Download the upgraded workbook"]);
  button.addEventListener("click", onUpgrade);

  return el("div", { class: "drop-target" }, [
    el("p", { class: "drop-target-title" }, [
      `This workbook follows model v${workbookVersion}; the tool expects v${expectedVersion}.`,
    ]),
    // The cause is no longer named: it changes from one step to the next. v0 was
    // missing columns; v1 has them all and only has faulty formulas. Claiming one
    // when it is the other misleads whoever reads it.
    el("p", { class: "drop-target-text" }, [
      "It follows an older format than the one the tool reads. Rather than show a workbook the tool may be reading wrong without saying so, no view is available until it is upgraded.",
    ]),
    el("p", { class: "drop-target-text" }, [
      "The upgraded workbook keeps the actors, groups, types, interfaces and consumptions, and creates every sheet an interface expects. Columns you added yourself, formatting and personal sheets are not carried over.",
    ]),
    button,
  ]);
}
