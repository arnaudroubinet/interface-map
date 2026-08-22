import type { ParsedModel } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";
import type { GranulariteMatrice } from "../aggregation/views";
import type { OrdreMatrice } from "../aggregation/seriation";
import type { Voisinage } from "../aggregation/impact";
import type { SujetDeFrise } from "../aggregation/roadmap";
import type { Mode, LibelléArête } from "../aggregation/core";
import { VERSION_MODELE } from "../parsing/build-model";
import { currentMilestone, rankOfMilestone } from "../aggregation/milestones";
import { actorsForReading } from "../aggregation/reading";

export type Vue =
  | "group-to-group"
  | "platform-detail"
  | "platform-only"
  | "by-actor"
  | "by-technology"
  | "chain"
  | "roadmap"
  | "matrix"
  | "changes"
  | "checks"
  // Pas une vue du classeur non plus : la page qui explique l'outil, consultable
  // avec ou sans classeur chargé.
  | "help"
  // Pas une vue du classeur : l'écran qui bloque tant qu'il n'est pas au format
  // que l'outil sait lire.
  | "upgrade";

// Le nom d'une vue, en un seul endroit. Le rail l'affichait sur ses boutons et
// les exports le mettaient dans leurs noms de fichier, chacun depuis sa propre
// table : deux listes des mêmes dix libellés, qui pouvaient se contredire sans
// que rien ne le dise -- un bouton « Changes » et un fichier « carto-ecarts ».
//
// `Record<Vue, string>` oblige à compléter la table dès qu'une vue s'ajoute :
// c'est le type qui tient l'exhaustivité, pas la vigilance.
export const LIBELLE_VUE: Record<Vue, string> = {
  "group-to-group": "Group to group",
  "platform-detail": "Platform detail",
  "platform-only": "Platform only",
  "by-actor": "By actor",
  "by-technology": "By technology",
  chain: "Chain",
  roadmap: "Roadmap",
  matrix: "Matrix",
  changes: "Changes",
  checks: "Integrity checks",
  help: "How it works",
  // Pas dans le rail : on n'y navigue pas, on y est envoyé. Mais l'export en a
  // besoin, un classeur périmé pouvant être exporté avant sa mise à niveau.
  "upgrade": "Upgrade",
};

export interface FichierCharge {
  name: string;
  model: ParsedModel;
  report: IntegrityReport;
  dateModification: Date | null;
}

export interface AppOptions {
  counters: boolean;
  // Ce que l'étiquette d'un trait NOMME : le tuyau, ce qui y circule, ou les
  // deux. Le défaut reste le tuyau -- c'est le comportement historique, et il
  // tient dans la largeur d'une boîte.
  libelléArête: LibelléArête;
  // Un schéma d'architecture est du trait fin avec de petits caractères :
  // c'est le cas où 600 dpi paie encore. Le bon réflexe reste le SVG, qui est
  // vectoriel et n'a pas de résolution.
  echellePng: 1 | 2 | 4;
  // La graisse du trait suit la criticité de la consommation. Désactivé par
  // défaut : la graisse sert ailleurs à ne RIEN dire, et les deux usages ne se
  // mélangent pas.
  graisseParCriticite: boolean;
}

// Ce que l'utilisateur a décoché dans la vue par acteur. Remis à zéro dès qu'on
// change d'acteur : un masquage n'a de sens que relativement à celui qu'on
// regarde, et le traîner d'un acteur à l'autre cacherait des flux sans raison
// visible.
export interface FiltresVueActeur {
  hiddenTechnologies: string[];
  hiddenActors: string[];
  // Jusqu'où la planche porte : les voisins immédiats, l'amont, ou l'aval --
  // « si cet acteur tombe, qui est touché ? ».
  neighbourhood: Voisinage;
}

// Idem pour la vue par technologie : masquer d'un bloc tout ce qui est hors
// plateforme, et/ou décocher acteur par acteur.
export interface FiltresVueTechnologie {
  masquerExternes: boolean;
  hiddenActors: string[];
}

// La matrix se filtre comme la vue par technologie, plus l'échelle de lecture
// : acteur par acteur, replié sur les groupes, ou plateforme détaillée.
export interface FiltresVueMatrice extends FiltresVueTechnologie {
  granularite: GranulariteMatrice;
  // L'ordre des lignes et des colonnes. Alphabétique par défaut : une
  // seriation ne doit jamais être le défaut silencieux -- la revue de
  // référence prévient que RCM produit volontiers une bande diagonale qui
  // n'apprend rien, et il faut pouvoir y revenir d'un clic.
  order: OrdreMatrice;
}

export interface AppState {
  fichier: FichierCharge | null;
  view: Vue;
  mode: Mode;
  // Le palier regardé, par son nom. Ce n'est pas une option d'affichage mais
  // un réglage d'application : il traverse les vues, les filtres, les exports
  // et le rapport. `null` quand le classeur ne déclare aucun palier.
  shownMilestone: string | null;
  // Les deux paliers comparés par la vue Écarts. Le second est celui qu'on
  // regarde ; le premier est la référence dont on mesure l'écart.
  comparedMilestone: string | null;
  options: AppOptions;
  filtresActeur: FiltresVueActeur;
  filtresTechnologie: FiltresVueTechnologie;
  filtresMatrice: FiltresVueMatrice;
  selectionActeur: string | null;
  selectionTechnologie: string | null;
  // La chaîne suivie, par son libellé. Une chaîne n'existe qu'en lecture
  // fonctionnelle, où la plomberie est justement ce qu'on traverse.
  selectionChaine: string | null;
  // Ce que la frise met en ligne : les acteurs ou les interfaces.
  sujetFrise: SujetDeFrise;
  messageBandeau: string | null;
}

export function initialState(): AppState {
  return {
    fichier: null,
    view: "group-to-group",
    mode: "architecture",
    shownMilestone: null,
    comparedMilestone: null,
    options: { counters: true, libelléArête: "technology", echellePng: 2, graisseParCriticite: false },
    filtresActeur: { hiddenTechnologies: [], hiddenActors: [], neighbourhood: "direct" },
    filtresTechnologie: { masquerExternes: false, hiddenActors: [] },
    filtresMatrice: { masquerExternes: false, hiddenActors: [], granularite: "actor", order: "alphabetical" },
    selectionActeur: null,
    selectionTechnologie: null,
    selectionChaine: null,
    sujetFrise: "interfaces",
    messageBandeau: null,
  };
}

// Un classeur qui viole les règles produit des schémas trompeurs : mieux vaut
// mettre l'utilisateur devant les anomalies que devant un dessin qui a l'air
// juste. On n'ouvre donc sur une vue de schéma que si le fichier est sain.
//
// Et avant même cela : un classeur dont le schéma ne correspond pas à celui de
// l'outil n'est pas seulement incomplet, il est mal compris -- ses anomalies ne
// sont donc pas fiables, et l'écran de désaccord passe devant.
//
// Le désaccord se lit dans les DEUX sens. En retard, il manque des colonnes ;
// en avance, l'outil ignore celles qu'il ne connaît pas encore et dessinerait
// une image amputée sans le dire -- le cas du jour où une nouvelle version
// circule pendant qu'une ancienne page reste ouverte.
export function vueAuChargement(fichier: FichierCharge): Vue {
  if (fichier.model.versionModele !== VERSION_MODELE) return "upgrade";
  return fichier.report.totalAnomalies > 0 ? "checks" : "group-to-group";
}

export function withFichierCharge(state: AppState, fichier: FichierCharge): AppState {
  // On ouvre sur le dernier palier livré, et on compare par défaut au
  // précédent : c'est l'écart qu'on vient de franchir, celui dont on parle.
  const courant = currentMilestone(fichier.model);
  const précédent = [...fichier.model.milestones]
    .filter((p) => courant !== undefined && p.rank < courant.rank)
    .sort((a, b) => b.rank - a.rank)[0];

  return {
    ...state,
    fichier,
    view: vueAuChargement(fichier),
    mode: "architecture",
    shownMilestone: courant?.name ?? null,
    comparedMilestone: précédent?.name ?? null,
    filtresActeur: { hiddenTechnologies: [], hiddenActors: [], neighbourhood: "direct" },
    filtresTechnologie: { masquerExternes: false, hiddenActors: [] },
    filtresMatrice: { masquerExternes: false, hiddenActors: [], granularite: "actor", order: "alphabetical" },
    selectionActeur: null,
    selectionTechnologie: null,
    selectionChaine: null,
    sujetFrise: "interfaces",
    messageBandeau: null,
  };
}

// Le sélecteur par acteur ne propose que les acteurs de la lecture courante :
// les techniques sortent en fonctionnel (§5.2), les retirés sortent au palier
// où ils le sont. Une sélection qui vise un acteur sorti de la liste ne
// désigne plus rien -- le schéma n'affiche qu'une boîte fantôme, sans un mot
// pour dire pourquoi. Mode et palier partagent la même règle : les séparer,
// c'est n'en corriger qu'une moitié.
function selectionRetenue(state: AppState, mode: Mode, milestone: string | null): string | null {
  if (!state.fichier || !state.selectionActeur) return state.selectionActeur;
  const model = state.fichier.model;
  const rank = milestone === null ? null : rankOfMilestone(model, milestone) ?? null;
  const proposés = new Set(actorsForReading(model, rank, mode).map((a) => a.name));
  return proposés.has(state.selectionActeur) ? state.selectionActeur : null;
}

export function withPalierAffiche(state: AppState, milestone: string | null): AppState {
  return { ...state, shownMilestone: milestone, selectionActeur: selectionRetenue(state, state.mode, milestone) };
}

export function withPalierCompare(state: AppState, milestone: string | null): AppState {
  return { ...state, comparedMilestone: milestone };
}

export function withVue(state: AppState, view: Vue): AppState {
  return { ...state, view };
}

// Une seule vue n'a pas d'objet en lecture fonctionnelle : « Par technologie »,
// parce que la technologie y est justement ce qu'on retire. Y laisser
// l'utilisateur lui montrerait une vue sans contenu sans rien lui expliquer.
//
// « Groupe à groupe » y était aussi, au motif qu'agréger des groupes par-dessus
// une chaîne rabattue ne dirait plus qui alimente qui. Le motif ne tient pas :
// « quelle direction alimente quelle direction » est précisément la question
// d'un comité de direction, et c'est la seule vue qui y réponde. La chaîne
// rabattue relie deux acteurs MÉTIER, qui ont chacun leur groupe.
export const VUES_SANS_OBJET_EN_FONCTIONNEL: Vue[] = ["by-technology"];

export function withMode(state: AppState, mode: Mode): AppState {
  const view =
    mode === "functional" && VUES_SANS_OBJET_EN_FONCTIONNEL.includes(state.view)
      ? "platform-detail"
      : state.view;
  return { ...state, mode, view, selectionActeur: selectionRetenue(state, mode, state.shownMilestone) };
}

export function withOptions(state: AppState, patch: Partial<AppOptions>): AppState {
  return { ...state, options: { ...state.options, ...patch } };
}

export function withSelectionActeur(state: AppState, actor: string | null): AppState {
  if (actor === state.selectionActeur) return { ...state, selectionActeur: actor };
  return { ...state, selectionActeur: actor, filtresActeur: { ...state.filtresActeur, hiddenTechnologies: [], hiddenActors: [] } };
}

function basculer(list: string[], value: string, hidden: boolean): string[] {
  const sans = list.filter((v) => v !== value);
  return hidden ? [...sans, value] : sans;
}

export function withTechnoMasquee(state: AppState, techno: string, hidden: boolean): AppState {
  return {
    ...state,
    filtresActeur: { ...state.filtresActeur, hiddenTechnologies: basculer(state.filtresActeur.hiddenTechnologies, techno, hidden) },
  };
}

export function withActeurMasque(state: AppState, actor: string, hidden: boolean): AppState {
  return {
    ...state,
    filtresActeur: { ...state.filtresActeur, hiddenActors: basculer(state.filtresActeur.hiddenActors, actor, hidden) },
  };
}

// Le voisinage ne touche pas aux masquages : élargir le regard ne révèle ni ne
// cache personne de plus que ce que le rayon apporte.
export function withSujetFrise(state: AppState, subject: SujetDeFrise): AppState {
  return { ...state, sujetFrise: subject };
}

export function withVoisinage(state: AppState, neighbourhood: Voisinage): AppState {
  return { ...state, filtresActeur: { ...state.filtresActeur, neighbourhood } };
}

export function withSelectionChaine(state: AppState, chain: string | null): AppState {
  return { ...state, selectionChaine: chain };
}

export function withSelectionTechnologie(state: AppState, technology: string | null): AppState {
  if (technology === state.selectionTechnologie) return { ...state, selectionTechnologie: technology };
  return {
    ...state,
    selectionTechnologie: technology,
    filtresTechnologie: { ...state.filtresTechnologie, hiddenActors: [] },
  };
}

export function withMasquerExternes(state: AppState, masquer: boolean): AppState {
  return { ...state, filtresTechnologie: { ...state.filtresTechnologie, masquerExternes: masquer } };
}

export function withMasquerExternesMatrice(state: AppState, masquer: boolean): AppState {
  return { ...state, filtresMatrice: { ...state.filtresMatrice, masquerExternes: masquer } };
}

// Changer d'échelle change la nature des lignes : garder les anciens noms
// masquerait des lignes sans laisser de case pour les rétablir.
export function withGranulariteMatrice(state: AppState, granularite: GranulariteMatrice): AppState {
  if (granularite === state.filtresMatrice.granularite) return state;
  return { ...state, filtresMatrice: { ...state.filtresMatrice, granularite, hiddenActors: [] } };
}

// L'ordre ne touche pas aux filtres : changer d'ordre ne cache ni ne révèle
// personne, contrairement à un changement de granularité.
export function withOrdreMatrice(state: AppState, order: OrdreMatrice): AppState {
  return { ...state, filtresMatrice: { ...state.filtresMatrice, order } };
}

export function withActeurMasqueMatrice(state: AppState, actor: string, hidden: boolean): AppState {
  return {
    ...state,
    filtresMatrice: {
      ...state.filtresMatrice,
      hiddenActors: basculer(state.filtresMatrice.hiddenActors, actor, hidden),
    },
  };
}

export function withActeurMasqueTechnologie(state: AppState, actor: string, hidden: boolean): AppState {
  return {
    ...state,
    filtresTechnologie: {
      ...state.filtresTechnologie,
      hiddenActors: basculer(state.filtresTechnologie.hiddenActors, actor, hidden),
    },
  };
}

export function withMessageBandeau(state: AppState, message: string | null): AppState {
  return { ...state, messageBandeau: message };
}
