import { el, clear } from "./dom";
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

  const exportable = state.fichier !== null && state.vue !== "matrice" && state.vue !== "controles" && exportDisponible;

  const boutonSvg = el("button", { class: "bouton-export" }, ["SVG"]);
  boutonSvg.disabled = !exportable;
  boutonSvg.addEventListener("click", callbacks.onExportSvg);
  root.appendChild(boutonSvg);

  const boutonPng = el("button", { class: "bouton-export" }, ["PNG"]);
  boutonPng.disabled = !exportable;
  boutonPng.addEventListener("click", callbacks.onExportPng);
  root.appendChild(boutonPng);

  // La matrice n'est pas un dessin : ce qu'on veut en emporter, c'est le
  // tableau, dans l'outil où on le trie et le filtre.
  const boutonXlsx = el("button", { class: "bouton-export" }, ["Excel"]);
  boutonXlsx.disabled = state.fichier === null || state.vue !== "matrice";
  boutonXlsx.addEventListener("click", callbacks.onExportXlsx);
  root.appendChild(boutonXlsx);

  // Le rapport n'est ni un dessin ni un tableau : c'est une liste de lignes à
  // corriger, chacune avec son adresse. Emportée en Markdown, elle se colle
  // dans un ticket et se traite sans rouvrir l'outil.
  const boutonMarkdown = el("button", { class: "bouton-export" }, ["Markdown"]);
  boutonMarkdown.disabled = state.fichier === null || state.vue !== "controles";
  boutonMarkdown.addEventListener("click", callbacks.onExportMarkdown);
  root.appendChild(boutonMarkdown);

  // Ces trois-là emportent TOUT le classeur -- draw.io une planche par onglet,
  // les DSL une vue par planche. Aucun ne dépend donc de la vue ouverte,
  // seulement du classeur et du palier affiché.
  //
  // draw.io est un dessin : il suit le mode. Structurizr et LikeC4 décrivent un
  // modèle C4, c'est-à-dire une ARCHITECTURE ; un schéma fonctionnel n'en est
  // pas un, et livrer un fichier qui raconte autre chose que l'écran est
  // précisément ce qu'on s'interdit ailleurs.
  const architectureSeule = state.mode === "fonctionnel";
  for (const [libellé, action] of [
    ["draw.io", callbacks.onExportDrawio],
    ["Structurizr", callbacks.onExportStructurizr],
    ["LikeC4", callbacks.onExportLikeC4],
  ] as const) {
    const bouton = el("button", { class: "bouton-export" }, [libellé]);
    bouton.disabled =
      state.fichier === null || state.vue === "mise-a-niveau" || (libellé !== "draw.io" && architectureSeule);
    bouton.addEventListener("click", action);
    root.appendChild(bouton);
  }
}
