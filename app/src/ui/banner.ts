import { el, clear } from "../shared/dom";
import type { AppState } from "./state";

export interface BannerCallbacks {
  onExportSvg: () => void;
  onExportPng: () => void;
  onExportXlsx: () => void;
  onExportMarkdown: () => void;
  onExportDrawio: () => void;
  onExportStructurizr: () => void;
  onExportLikeC4: () => void;
}

// La table des exports. Sept aujourd'hui, et un huitième ne devrait pas obliger
// à retrouver, dans quatre-vingts lignes de boutons, laquelle des quatre règles
// de désactivation lui ressemble. Elles sont ici, côte à côte, en une colonne :
// la question « laquelle s'applique à moi » se répond en lisant les voisines.
//
// Le test de render.test.ts compare cette liste à ce que la page d'aide
// documente, exactement comme il le fait déjà pour les vues du rail : un
// huitième format ne peut donc pas arriver sans sa ligne d'explication.
export interface FormatExport {
  label: string;
  rappel: keyof BannerCallbacks;
  // `dessinDisponible` dit qu'un schéma est à l'écran et prêt à être rendu.
  active: (state: AppState, dessinDisponible: boolean) => boolean;
}

const onADiagram = (state: AppState, dessinDisponible: boolean) =>
  state.file !== null && state.view !== "matrix" && state.view !== "checks" && dessinDisponible;

// Ces trois-là emportent TOUT le classeur -- draw.io une planche par onglet,
// les DSL une vue par planche -- donc aucun ne dépend de la vue ouverte.
const surTout = (state: AppState) => state.file !== null && state.view !== "upgrade";

export const EXPORTS: FormatExport[] = [
  { label: "SVG", rappel: "onExportSvg", active: onADiagram },
  { label: "PNG", rappel: "onExportPng", active: onADiagram },
  // La matrix n'est pas un dessin : ce qu'on veut en emporter, c'est le
  // tableau, dans l'outil où on le trie et le filtre.
  { label: "Excel", rappel: "onExportXlsx", active: (s) => s.file !== null && s.view === "matrix" },
  // Le rapport n'est ni un dessin ni un tableau : c'est une liste de lignes à
  // corriger, chacune avec son adresse. Emportée en Markdown, elle se colle
  // dans un ticket et se traite sans rouvrir l'outil.
  { label: "Markdown", rappel: "onExportMarkdown", active: (s) => s.file !== null && s.view === "checks" },
  // draw.io est un dessin : il suit le mode de lecture.
  { label: "draw.io", rappel: "onExportDrawio", active: surTout },
  // Ces deux-là étaient fermés en lecture fonctionnelle, au motif qu'un schéma
  // fonctionnel n'est pas une architecture C4. Le motif ne tient pas : un
  // système qui rend un service à un autre est le cas d'usage central d'un
  // systemLandscape. Ce qu'on s'interdit, c'est de livrer un fichier qui
  // raconte autre chose que l'écran -- il suffit donc que le fichier DISE ce
  // qu'il est, ce qu'il fait maintenant.
  { label: "Structurizr", rappel: "onExportStructurizr", active: surTout },
  { label: "LikeC4", rappel: "onExportLikeC4", active: surTout },
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
  if (state.messageBandeau) {
    legacyState.classList.add("banner-error");
    legacyState.textContent = state.messageBandeau;
  } else if (state.file) {
    // Un classeur fraîchement produit n'a pas encore de date d'enregistrement :
    // le dire plutôt que d'afficher « saved » suivi d'un vide.
    const date = state.file.dateModification
      ? `saved ${state.file.dateModification.toLocaleString("en-GB")}`
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

  for (const format of EXPORTS) {
    const button = el("button", { class: "export-button" }, [format.label]);
    button.disabled = !format.active(state, exportAvailable);
    button.addEventListener("click", callbacks[format.rappel]);
    root.appendChild(button);
  }
}
