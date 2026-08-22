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
  libellé: string;
  rappel: keyof BannerCallbacks;
  // `dessinDisponible` dit qu'un schéma est à l'écran et prêt à être rendu.
  actif: (state: AppState, dessinDisponible: boolean) => boolean;
}

const surUnSchéma = (state: AppState, dessinDisponible: boolean) =>
  state.fichier !== null && state.vue !== "matrice" && state.vue !== "controles" && dessinDisponible;

// Ces trois-là emportent TOUT le classeur -- draw.io une planche par onglet,
// les DSL une vue par planche -- donc aucun ne dépend de la vue ouverte.
const surTout = (state: AppState) => state.fichier !== null && state.vue !== "mise-a-niveau";

export const EXPORTS: FormatExport[] = [
  { libellé: "SVG", rappel: "onExportSvg", actif: surUnSchéma },
  { libellé: "PNG", rappel: "onExportPng", actif: surUnSchéma },
  // La matrice n'est pas un dessin : ce qu'on veut en emporter, c'est le
  // tableau, dans l'outil où on le trie et le filtre.
  { libellé: "Excel", rappel: "onExportXlsx", actif: (s) => s.fichier !== null && s.vue === "matrice" },
  // Le rapport n'est ni un dessin ni un tableau : c'est une liste de lignes à
  // corriger, chacune avec son adresse. Emportée en Markdown, elle se colle
  // dans un ticket et se traite sans rouvrir l'outil.
  { libellé: "Markdown", rappel: "onExportMarkdown", actif: (s) => s.fichier !== null && s.vue === "controles" },
  // draw.io est un dessin : il suit le mode de lecture.
  { libellé: "draw.io", rappel: "onExportDrawio", actif: surTout },
  // Ces deux-là étaient fermés en lecture fonctionnelle, au motif qu'un schéma
  // fonctionnel n'est pas une architecture C4. Le motif ne tient pas : un
  // système qui rend un service à un autre est le cas d'usage central d'un
  // systemLandscape. Ce qu'on s'interdit, c'est de livrer un fichier qui
  // raconte autre chose que l'écran -- il suffit donc que le fichier DISE ce
  // qu'il est, ce qu'il fait maintenant.
  { libellé: "Structurizr", rappel: "onExportStructurizr", actif: surTout },
  { libellé: "LikeC4", rappel: "onExportLikeC4", actif: surTout },
];

export function renderBanner(
  root: HTMLElement,
  state: AppState,
  exportDisponible: boolean,
  callbacks: BannerCallbacks
): void {
  clear(root);

  const titre = el("span", { class: "bandeau-titre" }, ["Interface Map"]);
  root.appendChild(titre);

  const etat = el("span", { class: "bandeau-etat" });
  if (state.messageBandeau) {
    etat.classList.add("bandeau-erreur");
    etat.textContent = state.messageBandeau;
  } else if (state.fichier) {
    // Un classeur fraîchement produit n'a pas encore de date d'enregistrement :
    // le dire plutôt que d'afficher « saved » suivi d'un vide.
    const date = state.fichier.dateModification
      ? `saved ${state.fichier.dateModification.toLocaleString("en-GB")}`
      : "save date unknown";
    etat.appendChild(el("strong", {}, [state.fichier.nom]));
    etat.appendChild(
      document.createTextNode(
        ` — ${state.fichier.model.acteurs.length} actors, ${state.fichier.model.interfaces.length} interfaces, ${state.fichier.model.consommations.length} consumptions — ${date}`
      )
    );
  } else {
    etat.textContent = "No workbook loaded.";
  }
  root.appendChild(etat);

  for (const format of EXPORTS) {
    const bouton = el("button", { class: "bouton-export" }, [format.libellé]);
    bouton.disabled = !format.actif(state, exportDisponible);
    bouton.addEventListener("click", callbacks[format.rappel]);
    root.appendChild(bouton);
  }
}
