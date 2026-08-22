import { el, clear } from "../shared/dom";
import { optionsFiltreActeur, optionsFiltreTechnologie, optionsFiltreMatrice } from "../aggregation/views";
import type { GranulariteMatrice } from "../aggregation/views";
import type { Mode, LibelléArête } from "../aggregation/core";
import type { OrdreMatrice } from "../aggregation/seriation";

// L'ordre de lecture va du plus court au plus complet.
const LIBELLES_ARETE: [LibelléArête, string][] = [
  ["technology", "technology"],
  ["exchanges", "what flows"],
  ["both", "both"],
];
import type { Lecture } from "../aggregation/fonctionnel";
import type { AppState, Vue } from "./state";
import { VUES_SANS_OBJET_EN_FONCTIONNEL, LIBELLE_VUE } from "./state";

// L'ordre du rail, et lui seul : les libellés viennent de LIBELLE_VUE, qui est
// la seule table. « mise-a-niveau » n'y figure pas -- on n'y navigue pas, on y
// est envoyé.
const ORDRE_DES_VUES: Vue[] = [
  "groupe-a-groupe",
  "plateforme-detaillee",
  "plateforme-seule",
  "par-acteur",
  "par-technologie",
  "matrice",
  "ecarts",
  "controles",
  "aide",
];

export const VUES: { id: Vue; label: string }[] = ORDRE_DES_VUES.map((id) => ({ id, label: LIBELLE_VUE[id] }));

// Les trois échelles de lecture de la matrice, avec le titre du bloc de cases
// qui les accompagne : ce qu'on décoche, ce sont les lignes réellement dessinées.
const GRANULARITES_MATRICE: { id: GranulariteMatrice; label: string; titreFiltre: string }[] = [
  { id: "acteur", label: "Actor to actor", titreFiltre: "Actors" },
  { id: "groupe", label: "Group to group", titreFiltre: "Groups" },
  { id: "plateforme", label: "Platform to group", titreFiltre: "Actors and groups" },
];

// Les quatre ordres proposés, du plus neutre au plus interprétatif.
const ORDRES_MATRICE: { id: OrdreMatrice; label: string }[] = [
  { id: "alphabetique", label: "Order: alphabetical" },
  { id: "groupe", label: "Order: by group" },
  { id: "degre", label: "Order: by degree" },
  { id: "blocs", label: "Order: blocks" },
];

export interface RailCallbacks {
  onMode: (mode: Mode) => void;
  onVue: (vue: Vue) => void;
  onSelectionActeur: (nom: string) => void;
  onSelectionTechnologie: (type: string) => void;
  onPalierAffiche: (palier: string) => void;
  onPalierCompare: (palier: string) => void;
  onOptionCompteurs: (value: boolean) => void;
  onLibelléArête: (value: LibelléArête) => void;
  onOrdreMatrice: (value: OrdreMatrice) => void;
  onEchellePng: (value: 1 | 2 | 4) => void;
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
  // Les deux lectures sont justes et n'empruntaient pas le vocabulaire que
  // leurs lecteurs possèdent déjà : ce sont les viewpoints ArchiMate
  // « Application Cooperation » et « Application Usage ».
  for (const [valeur, libellé] of [
    ["architecture", "Architecture — application interfaces (how it travels)"],
    ["fonctionnel", "Functional — application services (who feeds whom)"],
  ] as const) {
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
  // La MÊME lecture que les vues, et non le modèle entier : le rail proposait
  // des acteurs que le palier affiché avait retirés, et en sélectionnait un
  // tout seul faute de mieux -- l'utilisateur obtenait alors une boîte fantôme
  // sans un mot d'explication.
  lecture: Lecture,
  technologiesCourantes: string[],
  callbacks: RailCallbacks
): void {
  const flux = lecture.flux;
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
    // Le sélecteur ne propose que ce que la lecture courante retient : les
    // acteurs techniques disparaissent en fonctionnel (§5.2), les retirés
    // disparaissent au palier où ils le sont.
    const acteursDisponibles = lecture.acteurs;
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

    // L'ordre : c'est le levier de lecture le plus fort de la matrice, et il
    // était inutilisé. L'alphabétique reste le défaut -- une seriation ne doit
    // jamais s'imposer en silence.
    const ordre = el("select", { class: "rail-selecteur rail-ordre-matrice" });
    for (const o of ORDRES_MATRICE) {
      const option = el("option", { value: o.id }, [o.label]);
      if (o.id === state.filtresMatrice.ordre) option.selected = true;
      ordre.appendChild(option);
    }
    ordre.addEventListener("change", () => callbacks.onOrdreMatrice(ordre.value as OrdreMatrice));
    root.appendChild(ordre);

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

    // Nommer le seul protocole fait une carte des TUYAUX ; nommer l'échange en
    // fait une carte de ce qui CIRCULE. Les deux se valent selon la question
    // qu'on pose au schéma, d'où le choix plutôt qu'un défaut imposé.
    const libelléLabel = el("label", { class: "rail-option-libelle" }, ["Label "]);
    const libelléSelect = el("select", { class: "rail-selecteur" });
    for (const [valeur, texte] of LIBELLES_ARETE) {
      const option = el("option", { value: valeur }, [texte]);
      if (valeur === state.options.libelléArête) option.selected = true;
      libelléSelect.appendChild(option);
    }
    libelléSelect.addEventListener("change", () => callbacks.onLibelléArête(libelléSelect.value as LibelléArête));
    libelléLabel.appendChild(libelléSelect);
    options.appendChild(libelléLabel);

    // L'échelle du PNG, à côté de ce qu'elle sert : un schéma d'architecture
    // est du trait fin, c'est le cas où une haute résolution paie encore.
    const echelleLabel = el("label", { class: "rail-option-png" }, ["PNG "]);
    const echelleSelect = el("select", { class: "rail-selecteur" });
    for (const facteur of [1, 2, 4] as const) {
      const option = el("option", { value: String(facteur) }, [`${facteur}×`]);
      if (facteur === state.options.echellePng) option.selected = true;
      echelleSelect.appendChild(option);
    }
    echelleSelect.addEventListener("change", () => callbacks.onEchellePng(Number(echelleSelect.value) as 1 | 2 | 4));
    echelleLabel.appendChild(echelleSelect);
    options.appendChild(echelleLabel);

    root.appendChild(options);
  }

  renderPiedDeRail(root, callbacks);

  // La légende n'est plus ici : elle est dessinée DANS le SVG, pour voyager
  // avec le schéma exporté. La dupliquer dans le rail ne ferait que deux
  // sources à tenir à jour.
}
