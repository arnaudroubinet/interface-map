import { el } from "../shared/dom";

// Le seul message que l'outil se permet quand un classeur ne se laisse pas
// lire du tout : il ne sait alors rien de la cause réelle (bytes tronqués,
// zip corrompu, format inconnu...), donc il ne prétend rien de plus précis.
// C'est le mot exact que la cible de dépôt principale (app.ts) emploie pour
// le même échec ; nommé ici pour que la fenêtre de migration le reprenne au
// lieu d'en inventer un second.
export const MESSAGE_CLASSEUR_ILLISIBLE = "Workbook unreadable or corrupted.";

export function buildDropTarget(onTelechargerExemple: () => void, onAide: () => void): HTMLElement {
  const bouton = el("button", { class: "bouton-export" }, ["Open a sample workbook"]);
  bouton.addEventListener("click", onTelechargerExemple);
  const aide = el("button", { class: "bouton-export" }, ["How it works"]);
  aide.addEventListener("click", onAide);
  return el("div", { class: "cible-depot" }, [
    el("p", { class: "cible-depot-titre" }, ["Drop an .xlsx or .xlsm workbook"]),
    el("p", { class: "cible-depot-texte" }, [
      "The workbook is never uploaded or stored: everything happens in this browser.",
    ]),
    // Sans classeur sous la main, le plus utile est d'en essayer un rempli :
    // le modèle vide reste accessible en pied de rail.
    el("div", { class: "cible-depot-actions" }, [bouton, aide]),
  ]);
}

export function wireDropZone(
  root: HTMLElement,
  onFile: (file: File) => void
): void {
  root.addEventListener("dragover", (e) => {
    e.preventDefault();
    root.classList.add("survol");
  });
  root.addEventListener("dragleave", () => {
    root.classList.remove("survol");
  });
  root.addEventListener("drop", (e) => {
    e.preventDefault();
    root.classList.remove("survol");
    const file = e.dataTransfer?.files?.[0];
    if (file) onFile(file);
  });
}
