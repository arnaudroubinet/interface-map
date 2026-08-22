import { el } from "../shared/dom";

// L'écran qui remplace toutes les vues quand le classeur déposé suit un format
// plus ancien que celui que l'outil sait lire. Il n'y a qu'une action possible,
// et elle est dite avant d'être proposée : la mise à niveau reconstruit le
// classeur, elle ne le retouche pas.
export function buildUpgradeScreen(
  workbookVersion: number,
  expectedVersion: number,
  onUpgrade: () => void
): HTMLElement {
  // Le désaccord se lit dans les deux sens, et il n'appelle pas la même
  // réponse. En retard, l'outil sait reconstruire le classeur. En avance, il
  // ne sait rien faire du tout : proposer une mise à niveau reviendrait à
  // proposer une rétrogradation, qui perdrait ce que ce parseur ne lit pas.
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
    // On ne nomme plus la cause : elle change d'un palier à l'autre. Le v0
    // manquait des colonnes ; le v1 les a toutes et n'a que des formules
    // fautives. Prétendre l'un quand c'est l'autre égare celui qui lit.
    el("p", { class: "drop-target-text" }, [
      "It follows an older format than the one the tool reads. Rather than show a workbook the tool may be reading wrong without saying so, no view is available until it is upgraded.",
    ]),
    el("p", { class: "drop-target-text" }, [
      "The upgraded workbook keeps the actors, groups, types, interfaces and consumptions, and creates every sheet an interface expects. Columns you added yourself, formatting and personal sheets are not carried over.",
    ]),
    button,
  ]);
}
