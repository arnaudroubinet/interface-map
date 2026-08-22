import type { ParsedModel } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";
import type { GranulariteMatrice } from "../aggregation/views";
import type { OrdreMatrice } from "../aggregation/seriation";
import type { Mode, LibelléArête } from "../aggregation/core";
import { VERSION_MODELE } from "../parsing/build-model";
import { palierCourant, rangDuPalier } from "../aggregation/paliers";
import { acteursDuMode } from "../aggregation/fonctionnel";

export type Vue =
  | "groupe-a-groupe"
  | "plateforme-detaillee"
  | "plateforme-seule"
  | "par-acteur"
  | "par-technologie"
  | "matrice"
  | "ecarts"
  | "controles"
  // Pas une vue du classeur non plus : la page qui explique l'outil, consultable
  // avec ou sans classeur chargé.
  | "aide"
  // Pas une vue du classeur : l'écran qui bloque tant qu'il n'est pas au format
  // que l'outil sait lire.
  | "mise-a-niveau";

// Le nom d'une vue, en un seul endroit. Le rail l'affichait sur ses boutons et
// les exports le mettaient dans leurs noms de fichier, chacun depuis sa propre
// table : deux listes des mêmes dix libellés, qui pouvaient se contredire sans
// que rien ne le dise -- un bouton « Changes » et un fichier « carto-ecarts ».
//
// `Record<Vue, string>` oblige à compléter la table dès qu'une vue s'ajoute :
// c'est le type qui tient l'exhaustivité, pas la vigilance.
export const LIBELLE_VUE: Record<Vue, string> = {
  "groupe-a-groupe": "Group to group",
  "plateforme-detaillee": "Platform detail",
  "plateforme-seule": "Platform only",
  "par-acteur": "By actor",
  "par-technologie": "By technology",
  matrice: "Matrix",
  ecarts: "Changes",
  controles: "Integrity checks",
  aide: "How it works",
  // Pas dans le rail : on n'y navigue pas, on y est envoyé. Mais l'export en a
  // besoin, un classeur périmé pouvant être exporté avant sa mise à niveau.
  "mise-a-niveau": "Upgrade",
};

export interface FichierCharge {
  nom: string;
  model: ParsedModel;
  report: IntegrityReport;
  dateModification: Date | null;
}

export interface AppOptions {
  compteurs: boolean;
  // Ce que l'étiquette d'un trait NOMME : le tuyau, ce qui y circule, ou les
  // deux. Le défaut reste le tuyau -- c'est le comportement historique, et il
  // tient dans la largeur d'une boîte.
  libelléArête: LibelléArête;
  // Un schéma d'architecture est du trait fin avec de petits caractères :
  // c'est le cas où 600 dpi paie encore. Le bon réflexe reste le SVG, qui est
  // vectoriel et n'a pas de résolution.
  echellePng: 1 | 2 | 4;
}

// Ce que l'utilisateur a décoché dans la vue par acteur. Remis à zéro dès qu'on
// change d'acteur : un masquage n'a de sens que relativement à celui qu'on
// regarde, et le traîner d'un acteur à l'autre cacherait des flux sans raison
// visible.
export interface FiltresVueActeur {
  technosMasquees: string[];
  acteursMasques: string[];
}

// Idem pour la vue par technologie : masquer d'un bloc tout ce qui est hors
// plateforme, et/ou décocher acteur par acteur.
export interface FiltresVueTechnologie {
  masquerExternes: boolean;
  acteursMasques: string[];
}

// La matrice se filtre comme la vue par technologie, plus l'échelle de lecture
// : acteur par acteur, replié sur les groupes, ou plateforme détaillée.
export interface FiltresVueMatrice extends FiltresVueTechnologie {
  granularite: GranulariteMatrice;
  // L'ordre des lignes et des colonnes. Alphabétique par défaut : une
  // seriation ne doit jamais être le défaut silencieux -- la revue de
  // référence prévient que RCM produit volontiers une bande diagonale qui
  // n'apprend rien, et il faut pouvoir y revenir d'un clic.
  ordre: OrdreMatrice;
}

export interface AppState {
  fichier: FichierCharge | null;
  vue: Vue;
  mode: Mode;
  // Le palier regardé, par son nom. Ce n'est pas une option d'affichage mais
  // un réglage d'application : il traverse les vues, les filtres, les exports
  // et le rapport. `null` quand le classeur ne déclare aucun palier.
  palierAffiche: string | null;
  // Les deux paliers comparés par la vue Écarts. Le second est celui qu'on
  // regarde ; le premier est la référence dont on mesure l'écart.
  palierCompare: string | null;
  options: AppOptions;
  filtresActeur: FiltresVueActeur;
  filtresTechnologie: FiltresVueTechnologie;
  filtresMatrice: FiltresVueMatrice;
  selectionActeur: string | null;
  selectionTechnologie: string | null;
  messageBandeau: string | null;
}

export function initialState(): AppState {
  return {
    fichier: null,
    vue: "groupe-a-groupe",
    mode: "architecture",
    palierAffiche: null,
    palierCompare: null,
    options: { compteurs: true, libelléArête: "technology", echellePng: 2 },
    filtresActeur: { technosMasquees: [], acteursMasques: [] },
    filtresTechnologie: { masquerExternes: false, acteursMasques: [] },
    filtresMatrice: { masquerExternes: false, acteursMasques: [], granularite: "acteur", ordre: "alphabetique" },
    selectionActeur: null,
    selectionTechnologie: null,
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
  if (fichier.model.versionModele !== VERSION_MODELE) return "mise-a-niveau";
  return fichier.report.totalAnomalies > 0 ? "controles" : "groupe-a-groupe";
}

export function withFichierCharge(state: AppState, fichier: FichierCharge): AppState {
  // On ouvre sur le dernier palier livré, et on compare par défaut au
  // précédent : c'est l'écart qu'on vient de franchir, celui dont on parle.
  const courant = palierCourant(fichier.model);
  const précédent = [...fichier.model.paliers]
    .filter((p) => courant !== undefined && p.rang < courant.rang)
    .sort((a, b) => b.rang - a.rang)[0];

  return {
    ...state,
    fichier,
    vue: vueAuChargement(fichier),
    mode: "architecture",
    palierAffiche: courant?.nom ?? null,
    palierCompare: précédent?.nom ?? null,
    filtresActeur: { technosMasquees: [], acteursMasques: [] },
    filtresTechnologie: { masquerExternes: false, acteursMasques: [] },
    filtresMatrice: { masquerExternes: false, acteursMasques: [], granularite: "acteur", ordre: "alphabetique" },
    selectionActeur: null,
    selectionTechnologie: null,
    messageBandeau: null,
  };
}

// Le sélecteur par acteur ne propose que les acteurs de la lecture courante :
// les techniques sortent en fonctionnel (§5.2), les retirés sortent au palier
// où ils le sont. Une sélection qui vise un acteur sorti de la liste ne
// désigne plus rien -- le schéma n'affiche qu'une boîte fantôme, sans un mot
// pour dire pourquoi. Mode et palier partagent la même règle : les séparer,
// c'est n'en corriger qu'une moitié.
function selectionRetenue(state: AppState, mode: Mode, palier: string | null): string | null {
  if (!state.fichier || !state.selectionActeur) return state.selectionActeur;
  const model = state.fichier.model;
  const rang = palier === null ? null : rangDuPalier(model, palier) ?? null;
  const proposés = new Set(acteursDuMode(model, rang, mode).map((a) => a.nom));
  return proposés.has(state.selectionActeur) ? state.selectionActeur : null;
}

export function withPalierAffiche(state: AppState, palier: string | null): AppState {
  return { ...state, palierAffiche: palier, selectionActeur: selectionRetenue(state, state.mode, palier) };
}

export function withPalierCompare(state: AppState, palier: string | null): AppState {
  return { ...state, palierCompare: palier };
}

export function withVue(state: AppState, vue: Vue): AppState {
  return { ...state, vue };
}

// Deux vues n'ont pas d'objet en lecture fonctionnelle. « Par technologie »,
// parce que la technologie y est justement ce qu'on retire. « Groupe à
// groupe », parce qu'agréger des groupes par-dessus une chaîne déjà rabattue
// ne dit plus rien de qui alimente qui : à cette maille-là, on présente
// l'architecture. Y laisser l'utilisateur lui montrerait une vue sans contenu
// sans rien lui expliquer.
export const VUES_SANS_OBJET_EN_FONCTIONNEL: Vue[] = ["par-technologie", "groupe-a-groupe"];

export function withMode(state: AppState, mode: Mode): AppState {
  const vue =
    mode === "fonctionnel" && VUES_SANS_OBJET_EN_FONCTIONNEL.includes(state.vue)
      ? "plateforme-detaillee"
      : state.vue;
  return { ...state, mode, vue, selectionActeur: selectionRetenue(state, mode, state.palierAffiche) };
}

export function withOptions(state: AppState, patch: Partial<AppOptions>): AppState {
  return { ...state, options: { ...state.options, ...patch } };
}

export function withSelectionActeur(state: AppState, acteur: string | null): AppState {
  if (acteur === state.selectionActeur) return { ...state, selectionActeur: acteur };
  return { ...state, selectionActeur: acteur, filtresActeur: { technosMasquees: [], acteursMasques: [] } };
}

function basculer(liste: string[], valeur: string, masqué: boolean): string[] {
  const sans = liste.filter((v) => v !== valeur);
  return masqué ? [...sans, valeur] : sans;
}

export function withTechnoMasquee(state: AppState, techno: string, masquée: boolean): AppState {
  return {
    ...state,
    filtresActeur: { ...state.filtresActeur, technosMasquees: basculer(state.filtresActeur.technosMasquees, techno, masquée) },
  };
}

export function withActeurMasque(state: AppState, acteur: string, masqué: boolean): AppState {
  return {
    ...state,
    filtresActeur: { ...state.filtresActeur, acteursMasques: basculer(state.filtresActeur.acteursMasques, acteur, masqué) },
  };
}

export function withSelectionTechnologie(state: AppState, technologie: string | null): AppState {
  if (technologie === state.selectionTechnologie) return { ...state, selectionTechnologie: technologie };
  return {
    ...state,
    selectionTechnologie: technologie,
    filtresTechnologie: { ...state.filtresTechnologie, acteursMasques: [] },
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
  return { ...state, filtresMatrice: { ...state.filtresMatrice, granularite, acteursMasques: [] } };
}

// L'ordre ne touche pas aux filtres : changer d'ordre ne cache ni ne révèle
// personne, contrairement à un changement de granularité.
export function withOrdreMatrice(state: AppState, ordre: OrdreMatrice): AppState {
  return { ...state, filtresMatrice: { ...state.filtresMatrice, ordre } };
}

export function withActeurMasqueMatrice(state: AppState, acteur: string, masqué: boolean): AppState {
  return {
    ...state,
    filtresMatrice: {
      ...state.filtresMatrice,
      acteursMasques: basculer(state.filtresMatrice.acteursMasques, acteur, masqué),
    },
  };
}

export function withActeurMasqueTechnologie(state: AppState, acteur: string, masqué: boolean): AppState {
  return {
    ...state,
    filtresTechnologie: {
      ...state.filtresTechnologie,
      acteursMasques: basculer(state.filtresTechnologie.acteursMasques, acteur, masqué),
    },
  };
}

export function withMessageBandeau(state: AppState, message: string | null): AppState {
  return { ...state, messageBandeau: message };
}
