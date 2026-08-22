import type { MatrixResult, MatrixRow, MatrixCell } from "../aggregation/views";
import type {
  Acteur,
  Consommation,
  Groupe,
  InterfaceCatalogue,
  Palier,
  ParsedModel,
  TypeActeur,
  TypeFlux,
} from "../parsing/model";
import { VERSION_MODELE } from "../parsing/build-model";

// Les fabriques des tests, en un seul endroit.
//
// Ce ne sont pas des jeux d'essai : ce sont les littéraux EXHAUSTIFS des types
// du modèle. Chaque fichier de tests en portait sa copie -- douze fichiers,
// quatorze copies -- si bien qu'ajouter un champ à Consommation coûtait
// quarante-cinq erreurs de compilation, dont quarante-deux dans des tests qui
// ne s'intéressaient pas à ce champ. Ici, cela en coûte une.
//
// Les défauts sont NEUTRES, et volontairement pauvres : un fichier qui a besoin
// d'autre chose -- un groupe nommé « Socle », un palier d'arrivée -- enveloppe
// la fabrique plutôt que de la modifier. Changer un défaut ici changerait le
// sens de tests écrits ailleurs, ce qui est exactement le piège qu'on fuit.
//
// N'est jamais embarquée dans le livrable : le point d'entrée est src/main.ts,
// et rien de ce qui en dépend n'importe ce fichier.

export function acteur(o: Partial<Acteur> = {}): Acteur {
  return {
    nom: "A",
    groupe: "G",
    typeActeur: "Application",
    responsable: "",
    description: "",
    commentaires: "",
    palierIntroduction: "",
    palierRetrait: "",
    feuille: "Actors",
    ligne: 0,
    ...o,
  };
}

export function groupe(o: Partial<Groupe> = {}): Groupe {
  return { nom: "G", perimetre: "Platform", feuille: "Groups", ligne: 0, ...o };
}

export function typeActeur(o: Partial<TypeActeur> = {}): TypeActeur {
  return { type: "Application", icone: "app-window", nature: "", feuille: "ActorTypes", ligne: 0, ...o };
}

export function typeFlux(o: Partial<TypeFlux> = {}): TypeFlux {
  return {
    type: "HTTP",
    sensRepresentation: "consommateur-exposant",
    sensRepresentationBrut: "consumer → provider",
    description: "",
    couleur: "",
    feuille: "FlowTypes",
    ligne: 0,
    ...o,
  };
}

export function palier(o: Partial<Palier> = {}): Palier {
  return {
    nom: "v1",
    rang: 1,
    libelle: "",
    statut: "Delivered",
    date: "",
    description: "",
    feuille: "Milestones",
    ligne: 0,
    ...o,
  };
}

export function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return {
    nomDuFlux: "F",
    version: "",
    etat: "",
    acteurExposant: "A",
    typeDeFlux: "HTTP",
    description: "",
    lienContrat: "",
    referenceContrat: "",
    commentaires: "",
    aConfirmer: false,
    relais: "",
    feuilleAttendue: "FX_A_HTTP",
    palierIntroduction: "",
    palierRetrait: "",
    feuille: "Interfaces",
    ligne: 0,
    ...o,
  };
}

export function conso(o: Partial<Consommation> = {}): Consommation {
  return {
    nomDuFlux: "F",
    version: "",
    acteurConsommateur: "B",
    usage: "",
    criticite: "",
    statut: "",
    decision: "",
    commentaires: "",
    republiePar: "",
    feuille: "FX_A_HTTP",
    palierIntroduction: "",
    palierRetrait: "",
    ligne: 0,
    ...o,
  };
}

// Le modèle vide, sur lequel tout se construit par surcharge. Vide et non
// « minimal viable » : un test qui a besoin d'un acteur le dit, et le lecteur
// voit alors dans le test tout ce qui compte pour lui.
export function modele(o: Partial<ParsedModel> = {}): ParsedModel {
  return {
    acteurs: [],
    groupes: [],
    groupesAbsents: false,
    typesActeur: [],
    typesFlux: [],
    paliers: [],
    interfaces: [],
    consommations: [],
    fxSheetNames: [],
    colonnesOptionnellesAbsentes: [],
    versionModele: VERSION_MODELE,
    fichierModifie: null,
    ...o,
  };
}

// Une matrice de test, ses marges calculées comme le fait buildMatrixView : un
// test qui poserait des totaux à la main pourrait affirmer n'importe quoi.
export function matrice(o: { colonnes: string[]; lignes: MatrixRow[] }): MatrixResult {
  const total = (cellules: MatrixCell[]) => cellules.reduce((n, c) => n + c.count, 0);
  return {
    ...o,
    totauxLigne: new Map(o.lignes.map((l) => [l.acteur, total([...l.cellules.values()].flat())])),
    totauxColonne: new Map(o.colonnes.map((c) => [c, total(o.lignes.flatMap((l) => l.cellules.get(c) ?? []))])),
  };
}
