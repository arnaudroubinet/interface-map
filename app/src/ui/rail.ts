import { el, clear } from "../shared/dom";
import { optionsFiltreActeur, optionsFiltreTechnologie, optionsFiltreMatrice } from "../aggregation/views";
import type { GranulariteMatrice } from "../aggregation/views";
import type { Mode, EdgeLabelMode } from "../aggregation/core";
import type { MatrixOrder } from "../aggregation/seriation";
import { availableChains } from "../aggregation/chain";
import type { Neighbourhood } from "../aggregation/impact";
import type { RoadmapSubject } from "../aggregation/roadmap";
import { rankOfMilestone } from "../aggregation/milestones";

// L'ordre de lecture va du plus court au plus complet.
const LIBELLES_ARETE: [EdgeLabelMode, string][] = [
  ["technology", "technology"],
  ["exchanges", "what flows"],
  ["both", "both"],
];
import type { Lecture } from "../aggregation/reading";
import type { AppState, Vue } from "./state";
import { VUES_SANS_OBJET_EN_FONCTIONNEL, LIBELLE_VUE } from "./state";

// L'ordre du rail, et lui seul : les libellés viennent de LIBELLE_VUE, qui est
// la seule table. « mise-a-niveau » n'y figure pas -- on n'y navigue pas, on y
// est envoyé.
const ORDRE_DES_VUES: Vue[] = [
  "group-to-group",
  "platform-detail",
  "platform-only",
  "by-actor",
  "by-technology",
  "chain",
  "roadmap",
  "matrix",
  "changes",
  "checks",
  "help",
];

export const VUES: { id: Vue; label: string }[] = ORDRE_DES_VUES.map((id) => ({ id, label: LIBELLE_VUE[id] }));

// Les trois échelles de lecture de la matrix, avec le titre du bloc de cases
// qui les accompagne : ce qu'on décoche, ce sont les lignes réellement dessinées.
const GRANULARITES_MATRICE: { id: GranulariteMatrice; label: string; titreFiltre: string }[] = [
  { id: "actor", label: "Actor to actor", titreFiltre: "Actors" },
  { id: "group", label: "Group to group", titreFiltre: "Groups" },
  { id: "platform", label: "Platform to group", titreFiltre: "Actors and groups" },
];

// Les quatre ordres proposés, du plus neutre au plus interprétatif.
const ORDRES_MATRICE: { id: MatrixOrder; label: string }[] = [
  { id: "alphabetical", label: "Order: alphabetical" },
  { id: "group", label: "Order: by group" },
  { id: "degree", label: "Order: by degree" },
  { id: "blocks", label: "Order: blocks" },
];

// Jusqu'où la planche par acteur porte le regard.
const VOISINAGES: { id: Neighbourhood; label: string }[] = [
  { id: "direct", label: "Neighbours: direct" },
  { id: "upstream", label: "Neighbours: what it depends on" },
  { id: "downstream", label: "Neighbours: what depends on it" },
];

export interface RailCallbacks {
  onMode: (mode: Mode) => void;
  onVue: (view: Vue) => void;
  onSelectionActeur: (name: string) => void;
  onSelectionTechnologie: (type: string) => void;
  onSelectionChaine: (chain: string) => void;
  onVoisinage: (value: Neighbourhood) => void;
  onSujetFrise: (value: RoadmapSubject) => void;
  onGraisseParCriticite: (value: boolean) => void;
  onPalierAffiche: (milestone: string) => void;
  onPalierCompare: (milestone: string) => void;
  onOptionCompteurs: (value: boolean) => void;
  onLibelléArête: (value: EdgeLabelMode) => void;
  onOrdreMatrice: (value: MatrixOrder) => void;
  onEchellePng: (value: 1 | 2 | 4) => void;
  onTechnoMasquee: (techno: string, hidden: boolean) => void;
  onActeurMasque: (actor: string, hidden: boolean) => void;
  onMasquerExternes: (value: boolean) => void;
  onActeurMasqueTechnologie: (actor: string, hidden: boolean) => void;
  onMasquerExternesMatrice: (value: boolean) => void;
  onActeurMasqueMatrice: (actor: string, hidden: boolean) => void;
  onGranulariteMatrice: (granularite: GranulariteMatrice) => void;
  onTelechargerModele: () => void;
  onTelechargerExemple: () => void;
  onMigrationLegacy: () => void;
}

// Un palier se choisit dans une liste, jamais ne se tape : son libellé et son
// statut sont affichés en regard, pour qu'on sache si l'on regarde du livré ou
// du planifié.
function milestoneSelect(
  title: string,
  milestones: readonly { name: string; label: string; status: string }[],
  choisi: string | null,
  onChange: (milestone: string) => void
): HTMLElement {
  const block = el("label", { class: "rail-milestone" });
  block.appendChild(el("span", { class: "rail-milestone-title" }, [title]));
  const select = el("select", { class: "rail-select" });
  for (const p of milestones) {
    const suffixe = p.label.trim() ? ` — ${p.label.trim()}` : "";
    const option = el("option", { value: p.name }, [`${p.name}${suffixe} (${p.status || "?"})`]);
    if (p.name === choisi) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  block.appendChild(select);
  return block;
}

// Le mode se choisit avant la vue, parce qu'il décide lesquelles ont un sens.
// Toujours offert, même sur un classeur sans aucune nature renseignée : le mode
// fonctionnel y fusionne déjà les médias, et c'est ce qui le rend découvrable
// -- caché, personne ne saurait qu'il faut remplir la colonne.
function renderMode(root: HTMLElement, state: AppState, onMode: (mode: Mode) => void): void {
  const block = el("label", { class: "rail-milestone" });
  block.appendChild(el("span", { class: "rail-milestone-title" }, ["Reading"]));
  const select = el("select", { class: "rail-select" });
  // Les deux lectures sont justes et n'empruntaient pas le vocabulaire que
  // leurs lecteurs possèdent déjà : ce sont les viewpoints ArchiMate
  // « Application Cooperation » et « Application Usage ».
  for (const [value, label] of [
    ["architecture", "Architecture — application interfaces (how it travels)"],
    ["functional", "Functional — application services (who feeds whom)"],
  ] as const) {
    const option = el("option", { value: value }, [label]);
    option.selected = state.mode === value;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onMode(select.value as Mode));
  block.appendChild(select);
  root.appendChild(block);
}

// Interrupteur « masquer les externes », identique d'une vue à l'autre.
function basculeExternes(coché: boolean, onChange: (value: boolean) => void): HTMLElement {
  const label = el("label", { class: "rail-toggle" });
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
  title: string,
  values: string[],
  hidden: readonly string[],
  onChange: (value: string, hidden: boolean) => void
): HTMLElement | null {
  if (values.length === 0) return null;
  const block = el("details", { class: "rail-filter", open: "" });
  const visibles = values.length - values.filter((v) => hidden.includes(v)).length;
  block.appendChild(el("summary", {}, [`${title} (${visibles}/${values.length})`]));
  for (const value of values) {
    const row = el("label", {});
    const case_ = el("input", { type: "checkbox" });
    case_.checked = !hidden.includes(value);
    case_.addEventListener("change", () => onChange(value, !case_.checked));
    row.appendChild(case_);
    row.appendChild(document.createTextNode(` ${value}`));
    block.appendChild(row);
  }
  return block;
}

// Pied de rail : de quoi partir. Il s'affiche même sans classeur chargé --
// c'est précisément là qu'on cherche un modèle ou un exemple.
export function renderPiedDeRail(
  root: HTMLElement,
  callbacks: Pick<RailCallbacks, "onTelechargerModele" | "onTelechargerExemple" | "onMigrationLegacy">
): void {
  const starts = el("div", { class: "rail-starts" });
  const exemple = el("button", { class: "rail-button" }, ["Sample workbook"]);
  exemple.title = "A complete fictional repository, to see the tool at work";
  exemple.addEventListener("click", callbacks.onTelechargerExemple);
  starts.appendChild(exemple);
  const template = el("button", { class: "rail-button" }, ["Blank template"]);
  template.title = "An empty workbook, ready to fill in";
  template.addEventListener("click", callbacks.onTelechargerModele);
  starts.appendChild(template);
  const migration = el("button", { class: "rail-button" }, ["Repair or upgrade a workbook"]);
  migration.title = "Bring any workbook up to the current format and create the sheets it is missing";
  migration.addEventListener("click", callbacks.onMigrationLegacy);
  starts.appendChild(migration);
  root.appendChild(starts);
  root.appendChild(el("p", { class: "rail-copyright" }, ["© Arnaud Roubinet 2026"]));
}

export function renderRail(
  root: HTMLElement,
  state: AppState,
  // La MÊME lecture que les vues, et non le modèle entier : le rail proposait
  // des acteurs que le palier affiché avait retirés, et en sélectionnait un
  // tout seul faute de mieux -- l'utilisateur obtenait alors une boîte fantôme
  // sans un mot d'explication.
  reading: Lecture,
  technologiesCourantes: string[],
  callbacks: RailCallbacks
): void {
  const flows = reading.flows;
  clear(root);
  if (!state.fichier) {
    renderPiedDeRail(root, callbacks);
    return;
  }

  // Sur l'écran de mise à niveau, les vues restent visibles mais inertes : les
  // rendre cliquables pour les voir refuser serait pire que de les griser.
  const blocked = state.view === "upgrade";

  renderMode(root, state, callbacks.onMode);

  const nav = el("nav", { class: "rail-views" });
  const views = state.mode === "functional" ? VUES.filter((v) => !VUES_SANS_OBJET_EN_FONCTIONNEL.includes(v.id)) : VUES;
  for (const v of views) {
    const bouton = el("button", { class: "rail-view-item" }, [v.label]);
    if (blocked) bouton.disabled = true;
    if (v.id === state.view) bouton.setAttribute("aria-current", "true");
    // Trois compteurs, trois natures : les anomalies invalident les schémas
    // (rouge), les actions attendent une décision (bleu), les avertissements
    // signalent une saisie incomplète (jaune). Seul le rouge détourne
    // l'utilisateur de sa vue.
    // Sur l'écran de mise à niveau, le rapport porte sur un classeur mal lu
    // (§ vueAuChargement) : ses comptes ne veulent rien dire, les montrer
    // laisserait croire à un diagnostic qu'on n'a pas.
    if (v.id === "checks" && !blocked) {
      const { totalAnomalies, totalActions, totalAvertissements } = state.fichier.report;
      if (totalAnomalies > 0) {
        bouton.appendChild(
          el("span", { class: "count-anomalies", title: "Blocking anomalies" }, [String(totalAnomalies)])
        );
      }
      if (totalActions > 0) {
        bouton.appendChild(
          el("span", { class: "count-actions", title: "Pending decisions" }, [String(totalActions)])
        );
      }
      if (totalAvertissements > 0) {
        bouton.appendChild(
          el("span", { class: "count-warnings", title: "Points to confirm" }, [String(totalAvertissements)])
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
  const milestones = state.fichier.model.milestones;
  if (milestones.length > 0 && !blocked) {
    const block = el("div", { class: "rail-milestones" });
    block.appendChild(milestoneSelect("Milestone", milestones, state.shownMilestone, callbacks.onPalierAffiche));
    if (state.view === "changes") {
      block.appendChild(milestoneSelect("Compared to", milestones, state.comparedMilestone, callbacks.onPalierCompare));
    }
    root.appendChild(block);
  }

  if (state.view === "by-actor") {
    const select = el("select", { class: "rail-select" });
    // Le sélecteur ne propose que ce que la lecture courante retient : les
    // acteurs techniques disparaissent en fonctionnel (§5.2), les retirés
    // disparaissent au palier où ils le sont.
    const availableActors = reading.actors;
    for (const actor of [...availableActors].sort((a, b) => a.name.localeCompare(b.name, "fr"))) {
      const option = el("option", { value: actor.name }, [actor.name]);
      if (actor.name === state.selectionActeur) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onSelectionActeur(select.value));
    root.appendChild(select);

    // Jusqu'où porter le regard. « Ce qui dépend de lui » répond à la question
    // qu'on pose le jour où il faut arbitrer une migration : si cet acteur
    // tombe, qui est touché ?
    const neighbourhood = el("select", { class: "rail-select rail-neighbourhood" });
    for (const v of VOISINAGES) {
      const option = el("option", { value: v.id }, [v.label]);
      if (v.id === state.filtresActeur.neighbourhood) option.selected = true;
      neighbourhood.appendChild(option);
    }
    neighbourhood.addEventListener("change", () => callbacks.onVoisinage(neighbourhood.value as Neighbourhood));
    root.appendChild(neighbourhood);
  }

  if (state.view === "by-technology") {
    const select = el("select", { class: "rail-select" });
    for (const type of [...state.fichier.model.flowTypes].sort((a, b) => a.type.localeCompare(b.type, "fr"))) {
      const option = el("option", { value: type.type }, [type.type]);
      if (type.type === state.selectionTechnologie) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onSelectionTechnologie(select.value));
    root.appendChild(select);
  }

  // Filtres de la vue par acteur : l'acteur regardé n'est pas décochable, sans
  // quoi la vue perdrait son sujet.
  if (state.view === "by-actor" && state.selectionActeur) {
    const dispo = optionsFiltreActeur(flows, state.selectionActeur);
    const technos = blocFiltre("Technologies", dispo.technologies, state.filtresActeur.hiddenTechnologies, callbacks.onTechnoMasquee);
    if (technos) root.appendChild(technos);
    const actors = blocFiltre("Related actors", dispo.actors, state.filtresActeur.hiddenActors, callbacks.onActeurMasque);
    if (actors) root.appendChild(actors);
  }

  if (state.view === "by-technology" && state.selectionTechnologie) {
    root.appendChild(basculeExternes(state.filtresTechnologie.masquerExternes, callbacks.onMasquerExternes));

    const dispo = optionsFiltreTechnologie(state.fichier.model, flows, state.selectionTechnologie, {
      masquerExternes: state.filtresTechnologie.masquerExternes,
    });
    const actors = blocFiltre("Actors", dispo, state.filtresTechnologie.hiddenActors, callbacks.onActeurMasqueTechnologie);
    if (actors) root.appendChild(actors);
  }

  if (state.view === "chain") {
    // Le sélecteur de chaîne. Une chaîne n'a de sens qu'en lecture
    // fonctionnelle : c'est là que la plomberie est traversée, et la vue montre
    // justement ce que cette traversée efface.
    const chains = availableChains(state.fichier.model, rankOfMilestone(state.fichier.model, state.shownMilestone ?? "") ?? null);
    const select = el("select", { class: "rail-select rail-chain" });
    for (const c of chains) {
      const option = el("option", { value: c.id }, [c.label]);
      if (c.id === state.selectionChaine) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onSelectionChaine(select.value));
    root.appendChild(select);
    if (chains.length === 0) {
      root.appendChild(el("p", { class: "rail-empty" }, ["No chain in this workbook: no flow crosses a technical actor."]));
    }
  }

  if (state.view === "roadmap") {
    const select = el("select", { class: "rail-select rail-roadmap" });
    for (const [value, label] of [["interfaces", "Interfaces"], ["actors", "Actors"]] as const) {
      const option = el("option", { value: value }, [label]);
      if (value === state.sujetFrise) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onSujetFrise(select.value as RoadmapSubject));
    root.appendChild(select);
  }

  if (state.view === "matrix") {
    const granularite = state.filtresMatrice.granularite;
    const select = el("select", { class: "rail-select" });
    for (const g of GRANULARITES_MATRICE) {
      const option = el("option", { value: g.id }, [g.label]);
      if (g.id === granularite) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onGranulariteMatrice(select.value as GranulariteMatrice));
    root.appendChild(select);

    // L'ordre : c'est le levier de lecture le plus fort de la matrix, et il
    // était inutilisé. L'alphabétique reste le défaut -- une seriation ne doit
    // jamais s'imposer en silence.
    const order = el("select", { class: "rail-select rail-matrix-order" });
    for (const o of ORDRES_MATRICE) {
      const option = el("option", { value: o.id }, [o.label]);
      if (o.id === state.filtresMatrice.order) option.selected = true;
      order.appendChild(option);
    }
    order.addEventListener("change", () => callbacks.onOrdreMatrice(order.value as MatrixOrder));
    root.appendChild(order);

    root.appendChild(basculeExternes(state.filtresMatrice.masquerExternes, callbacks.onMasquerExternesMatrice));
    const dispo = optionsFiltreMatrice(state.fichier.model, flows, {
      granularite,
      masquerExternes: state.filtresMatrice.masquerExternes,
    });
    const title = GRANULARITES_MATRICE.find((g) => g.id === granularite)!.titreFiltre;
    const actors = blocFiltre(title, dispo, state.filtresMatrice.hiddenActors, callbacks.onActeurMasqueMatrice);
    if (actors) root.appendChild(actors);
  }

  if (state.view !== "checks" && !blocked) {
    const options = el("fieldset", { class: "rail-options" });

    const compteursLabel = el("label", {});
    const compteursInput = el("input", { type: "checkbox" });
    compteursInput.checked = state.options.counters;
    compteursInput.addEventListener("change", () => callbacks.onOptionCompteurs(compteursInput.checked));
    compteursLabel.appendChild(compteursInput);
    compteursLabel.appendChild(document.createTextNode(" counters"));
    options.appendChild(compteursLabel);

    // Nommer le seul protocole fait une carte des TUYAUX ; nommer l'échange en
    // fait une carte de ce qui CIRCULE. Les deux se valent selon la question
    // qu'on pose au schéma, d'où le choix plutôt qu'un défaut imposé.
    const labelField = el("label", { class: "rail-option-label" }, ["Label "]);
    const labelSelect = el("select", { class: "rail-select" });
    for (const [value, text] of LIBELLES_ARETE) {
      const option = el("option", { value: value }, [text]);
      if (value === state.options.edgeLabelMode) option.selected = true;
      labelSelect.appendChild(option);
    }
    labelSelect.addEventListener("change", () => callbacks.onLibelléArête(labelSelect.value as EdgeLabelMode));
    labelField.appendChild(labelSelect);
    options.appendChild(labelField);

    // L'échelle du PNG, à côté de ce qu'elle sert : un schéma d'architecture
    // est du trait fin, c'est le cas où une haute résolution paie encore.
    const echelleLabel = el("label", { class: "rail-option-png" }, ["PNG "]);
    const echelleSelect = el("select", { class: "rail-select" });
    for (const facteur of [1, 2, 4] as const) {
      const option = el("option", { value: String(facteur) }, [`${facteur}×`]);
      if (facteur === state.options.echellePng) option.selected = true;
      echelleSelect.appendChild(option);
    }
    echelleSelect.addEventListener("change", () => callbacks.onEchellePng(Number(echelleSelect.value) as 1 | 2 | 4));
    echelleLabel.appendChild(echelleSelect);
    options.appendChild(echelleLabel);

    // La criticité est saisie, contrôlée et exportée depuis toujours, et
    // n'était jamais dessinée. C'est la donnée la plus décisionnelle du
    // classeur.
    const critLabel = el("label", { class: "rail-option-criticality" });
    const critInput = el("input", { type: "checkbox" });
    critInput.checked = state.options.graisseParCriticite;
    critInput.addEventListener("change", () => callbacks.onGraisseParCriticite(critInput.checked));
    critLabel.appendChild(critInput);
    critLabel.appendChild(document.createTextNode(" thickness by criticality"));
    options.appendChild(critLabel);

    root.appendChild(options);
  }

  renderPiedDeRail(root, callbacks);

  // La légende n'est plus ici : elle est dessinée DANS le SVG, pour voyager
  // avec le schéma exporté. La dupliquer dans le rail ne ferait que deux
  // sources à tenir à jour.
}
