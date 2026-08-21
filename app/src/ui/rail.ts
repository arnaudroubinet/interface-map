import { el, clear } from "../shared/dom";
import { optionsFiltreActeur, optionsFiltreTechnologie, optionsFiltreMatrice } from "../aggregation/views";
import type { GranulariteMatrice } from "../aggregation/views";
import type { Mode, FlowInstance } from "../aggregation/core";
import { acteursMetier } from "../aggregation/nature";
import type { AppState, Vue } from "./state";
import { VUES_SANS_OBJET_EN_FONCTIONNEL } from "./state";

export const VUES: { id: Vue; label: string }[] = [
  { id: "groupe-a-groupe", label: "Group to group" },
  { id: "plateforme-detaillee", label: "Platform detail" },
  { id: "plateforme-seule", label: "Platform only" },
  { id: "par-acteur", label: "By actor" },
  { id: "par-technologie", label: "By technology" },
  { id: "matrice", label: "Matrix" },
  { id: "ecarts", label: "Changes" },
  { id: "controles", label: "Integrity checks" },
  { id: "aide", label: "How it works" },
];

// Les trois échelles de lecture de la matrice, avec le titre du bloc de cases
// qui les accompagne : ce qu'on décoche, ce sont les lignes réellement dessinées.
const GRANULARITES_MATRICE: { id: GranulariteMatrice; label: string; titreFiltre: string }[] = [
  { id: "acteur", label: "Actor to actor", titreFiltre: "Actors" },
  { id: "groupe", label: "Group to group", titreFiltre: "Groups" },
  { id: "plateforme", label: "Platform to group", titreFiltre: "Actors and groups" },
];

export interface RailCallbacks {
  onMode: (mode: Mode) => void;
  onVue: (vue: Vue) => void;
  onSelectionActeur: (nom: string) => void;
  onSelectionTechnologie: (type: string) => void;
  onPalierAffiche: (palier: string) => void;
  onPalierCompare: (palier: string) => void;
  onOptionCompteurs: (value: boolean) => void;
  onTechnoMasquee: (techno: string, masquée: boolean) => void;
  onActeurMasque: (acteur: string, masqué: boolean) => void;
  onMasquerExternes: (value: boolean) => void;
  onActeurMasqueTechnologie: (acteur: string, masqué: boolean) => void;
  onMasquerExternesMatrice: (value: boolean) => void;
  onActeurMasqueMatrice: (acteur: string, masqué: boolean) => void;
  onGranulariteMatrice: (granularite: GranulariteMatrice) => void;
  onTelechargerModele: () => void;
  onTelechargerExemple: () => void;
  onMigrationLegacy: () => void;
}

// Un palier se choisit dans une liste, jamais ne se tape : son libellé et son
// statut sont affichés en regard, pour qu'on sache si l'on regarde du livré ou
// du planifié.
function sélecteurPalier(
  titre: string,
  paliers: readonly { nom: string; libelle: string; statut: string }[],
  choisi: string | null,
  onChange: (palier: string) => void
): HTMLElement {
  const bloc = el("label", { class: "rail-palier" });
  bloc.appendChild(el("span", { class: "rail-palier-titre" }, [titre]));
  const select = el("select", { class: "rail-selecteur" });
  for (const p of paliers) {
    const suffixe = p.libelle.trim() ? ` — ${p.libelle.trim()}` : "";
    const option = el("option", { value: p.nom }, [`${p.nom}${suffixe} (${p.statut || "?"})`]);
    if (p.nom === choisi) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  bloc.appendChild(select);
  return bloc;
}

// Le mode se choisit avant la vue, parce qu'il décide lesquelles ont un sens.
// Toujours offert, même sur un classeur sans aucune nature renseignée : le mode
// fonctionnel y fusionne déjà les médias, et c'est ce qui le rend découvrable
// -- caché, personne ne saurait qu'il faut remplir la colonne.
function renderMode(root: HTMLElement, state: AppState, onMode: (mode: Mode) => void): void {
  const bloc = el("label", { class: "rail-palier" });
  bloc.appendChild(el("span", { class: "rail-palier-titre" }, ["Reading"]));
  const select = el("select", { class: "rail-selecteur" });
  for (const [valeur, libellé] of [["architecture", "Architecture"], ["fonctionnel", "Functional"]] as const) {
    const option = el("option", { value: valeur }, [libellé]);
    option.selected = state.mode === valeur;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onMode(select.value as Mode));
  bloc.appendChild(select);
  root.appendChild(bloc);
}

// Interrupteur « masquer les externes », identique d'une vue à l'autre.
function basculeExternes(coché: boolean, onChange: (value: boolean) => void): HTMLElement {
  const label = el("label", { class: "rail-bascule" });
  const input = el("input", { type: "checkbox" });
  input.checked = coché;
  input.addEventListener("change", () => onChange(input.checked));
  label.appendChild(input);
  label.appendChild(document.createTextNode(" hide external"));
  return label;
}

// Un groupe de cases à cocher repliable. Coché = visible, décoché = masqué :
// on décrit ce qu'on voit, pas ce qu'on retire.
function blocFiltre(
  titre: string,
  valeurs: string[],
  masquées: readonly string[],
  onChange: (valeur: string, masquée: boolean) => void
): HTMLElement | null {
  if (valeurs.length === 0) return null;
  const bloc = el("details", { class: "rail-filtre", open: "" });
  const visibles = valeurs.length - valeurs.filter((v) => masquées.includes(v)).length;
  bloc.appendChild(el("summary", {}, [`${titre} (${visibles}/${valeurs.length})`]));
  for (const valeur of valeurs) {
    const ligne = el("label", {});
    const case_ = el("input", { type: "checkbox" });
    case_.checked = !masquées.includes(valeur);
    case_.addEventListener("change", () => onChange(valeur, !case_.checked));
    ligne.appendChild(case_);
    ligne.appendChild(document.createTextNode(` ${valeur}`));
    bloc.appendChild(ligne);
  }
  return bloc;
}

// Pied de rail : de quoi partir. Il s'affiche même sans classeur chargé --
// c'est précisément là qu'on cherche un modèle ou un exemple.
export function renderPiedDeRail(
  root: HTMLElement,
  callbacks: Pick<RailCallbacks, "onTelechargerModele" | "onTelechargerExemple" | "onMigrationLegacy">
): void {
  const départs = el("div", { class: "rail-departs" });
  const exemple = el("button", { class: "bouton-rail" }, ["Sample workbook"]);
  exemple.title = "A complete fictional repository, to see the tool at work";
  exemple.addEventListener("click", callbacks.onTelechargerExemple);
  départs.appendChild(exemple);
  const modele = el("button", { class: "bouton-rail" }, ["Blank template"]);
  modele.title = "An empty workbook, ready to fill in";
  modele.addEventListener("click", callbacks.onTelechargerModele);
  départs.appendChild(modele);
  const migration = el("button", { class: "bouton-rail" }, ["Repair or upgrade a workbook"]);
  migration.title = "Bring any workbook up to the current format and create the sheets it is missing";
  migration.addEventListener("click", callbacks.onMigrationLegacy);
  départs.appendChild(migration);
  root.appendChild(départs);
  root.appendChild(el("p", { class: "rail-copyright" }, ["© Arnaud Roubinet 2026"]));
}

export function renderRail(
  root: HTMLElement,
  state: AppState,
  flux: FlowInstance[],
  technologiesCourantes: string[],
  callbacks: RailCallbacks
): void {
  clear(root);
  if (!state.fichier) {
    renderPiedDeRail(root, callbacks);
    return;
  }

  // Sur l'écran de mise à niveau, les vues restent visibles mais inertes : les
  // rendre cliquables pour les voir refuser serait pire que de les griser.
  const bloqué = state.vue === "mise-a-niveau";

  renderMode(root, state, callbacks.onMode);

  const nav = el("nav", { class: "rail-vues" });
  const vues = state.mode === "fonctionnel" ? VUES.filter((v) => !VUES_SANS_OBJET_EN_FONCTIONNEL.includes(v.id)) : VUES;
  for (const v of vues) {
    const bouton = el("button", { class: "rail-vue-item" }, [v.label]);
    if (bloqué) bouton.disabled = true;
    if (v.id === state.vue) bouton.setAttribute("aria-current", "true");
    // Trois compteurs, trois natures : les anomalies invalident les schémas
    // (rouge), les actions attendent une décision (bleu), les avertissements
    // signalent une saisie incomplète (jaune). Seul le rouge détourne
    // l'utilisateur de sa vue.
    // Sur l'écran de mise à niveau, le rapport porte sur un classeur mal lu
    // (§ vueAuChargement) : ses comptes ne veulent rien dire, les montrer
    // laisserait croire à un diagnostic qu'on n'a pas.
    if (v.id === "controles" && !bloqué) {
      const { totalAnomalies, totalActions, totalAvertissements } = state.fichier.report;
      if (totalAnomalies > 0) {
        bouton.appendChild(
          el("span", { class: "compteur-anomalies", title: "Blocking anomalies" }, [String(totalAnomalies)])
        );
      }
      if (totalActions > 0) {
        bouton.appendChild(
          el("span", { class: "compteur-actions", title: "Pending decisions" }, [String(totalActions)])
        );
      }
      if (totalAvertissements > 0) {
        bouton.appendChild(
          el("span", { class: "compteur-avertissements", title: "Points to confirm" }, [String(totalAvertissements)])
        );
      }
    }
    bouton.addEventListener("click", () => callbacks.onVue(v.id));
    nav.appendChild(bouton);
  }
  root.appendChild(nav);

  // Le sélecteur de palier passe avant tout le reste : il vaut pour l'outil
  // entier, pas pour la vue courante. Absent quand le classeur ne déclare
  // aucun palier -- proposer un axe vide n'apprendrait rien.
  const paliers = state.fichier.model.paliers;
  if (paliers.length > 0 && !bloqué) {
    const bloc = el("div", { class: "rail-paliers" });
    bloc.appendChild(sélecteurPalier("Milestone", paliers, state.palierAffiche, callbacks.onPalierAffiche));
    if (state.vue === "ecarts") {
      bloc.appendChild(sélecteurPalier("Compared to", paliers, state.palierCompare, callbacks.onPalierCompare));
    }
    root.appendChild(bloc);
  }

  if (state.vue === "par-acteur") {
    const select = el("select", { class: "rail-selecteur" });
    // Le sélecteur ne propose que les acteurs métier en fonctionnel (§5.2) :
    // les techniques ont disparu des traits, les offrir n'aurait pas de sens.
    const acteursDisponibles = state.mode === "fonctionnel" ? acteursMetier(state.fichier.model) : state.fichier.model.acteurs;
    for (const acteur of [...acteursDisponibles].sort((a, b) => a.nom.localeCompare(b.nom, "fr"))) {
      const option = el("option", { value: acteur.nom }, [acteur.nom]);
      if (acteur.nom === state.selectionActeur) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onSelectionActeur(select.value));
    root.appendChild(select);
  }

  if (state.vue === "par-technologie") {
    const select = el("select", { class: "rail-selecteur" });
    for (const type of [...state.fichier.model.typesFlux].sort((a, b) => a.type.localeCompare(b.type, "fr"))) {
      const option = el("option", { value: type.type }, [type.type]);
      if (type.type === state.selectionTechnologie) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onSelectionTechnologie(select.value));
    root.appendChild(select);
  }

  // Filtres de la vue par acteur : l'acteur regardé n'est pas décochable, sans
  // quoi la vue perdrait son sujet.
  if (state.vue === "par-acteur" && state.selectionActeur) {
    const dispo = optionsFiltreActeur(flux, state.selectionActeur);
    const technos = blocFiltre("Technologies", dispo.technologies, state.filtresActeur.technosMasquees, callbacks.onTechnoMasquee);
    if (technos) root.appendChild(technos);
    const acteurs = blocFiltre("Related actors", dispo.acteurs, state.filtresActeur.acteursMasques, callbacks.onActeurMasque);
    if (acteurs) root.appendChild(acteurs);
  }

  if (state.vue === "par-technologie" && state.selectionTechnologie) {
    root.appendChild(basculeExternes(state.filtresTechnologie.masquerExternes, callbacks.onMasquerExternes));

    const dispo = optionsFiltreTechnologie(state.fichier.model, flux, state.selectionTechnologie, {
      masquerExternes: state.filtresTechnologie.masquerExternes,
    });
    const acteurs = blocFiltre("Actors", dispo, state.filtresTechnologie.acteursMasques, callbacks.onActeurMasqueTechnologie);
    if (acteurs) root.appendChild(acteurs);
  }

  if (state.vue === "matrice") {
    const granularite = state.filtresMatrice.granularite;
    const select = el("select", { class: "rail-selecteur" });
    for (const g of GRANULARITES_MATRICE) {
      const option = el("option", { value: g.id }, [g.label]);
      if (g.id === granularite) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onGranulariteMatrice(select.value as GranulariteMatrice));
    root.appendChild(select);

    root.appendChild(basculeExternes(state.filtresMatrice.masquerExternes, callbacks.onMasquerExternesMatrice));
    const dispo = optionsFiltreMatrice(state.fichier.model, flux, {
      granularite,
      masquerExternes: state.filtresMatrice.masquerExternes,
    });
    const titre = GRANULARITES_MATRICE.find((g) => g.id === granularite)!.titreFiltre;
    const acteurs = blocFiltre(titre, dispo, state.filtresMatrice.acteursMasques, callbacks.onActeurMasqueMatrice);
    if (acteurs) root.appendChild(acteurs);
  }

  if (state.vue !== "controles" && !bloqué) {
    const options = el("fieldset", { class: "rail-options" });

    const compteursLabel = el("label", {});
    const compteursInput = el("input", { type: "checkbox" });
    compteursInput.checked = state.options.compteurs;
    compteursInput.addEventListener("change", () => callbacks.onOptionCompteurs(compteursInput.checked));
    compteursLabel.appendChild(compteursInput);
    compteursLabel.appendChild(document.createTextNode(" counters"));
    options.appendChild(compteursLabel);

    root.appendChild(options);
  }

  renderPiedDeRail(root, callbacks);

  // La légende n'est plus ici : elle est dessinée DANS le SVG, pour voyager
  // avec le schéma exporté. La dupliquer dans le rail ne ferait que deux
  // sources à tenir à jour.
}
