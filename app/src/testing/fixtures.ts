import type { MatrixResult, MatrixRow, MatrixCell } from "../aggregation/views";
import type {
  Actor,
  Consommation,
  Groupe,
  InterfaceCatalogue,
  Milestone,
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

export function actor(o: Partial<Actor> = {}): Actor {
  return {
    name: "A",
    group: "G",
    typeActeur: "Application",
    responsable: "",
    description: "",
    commentaires: "",
    introducedAt: "",
    retiredAt: "",
    sheet: "Actors",
    row: 0,
    ...o,
  };
}

export function group(o: Partial<Groupe> = {}): Groupe {
  return { name: "G", perimeter: "Platform", sheet: "Groups", row: 0, ...o };
}

export function typeActeur(o: Partial<TypeActeur> = {}): TypeActeur {
  return { type: "Application", icone: "app-window", nature: "", sheet: "ActorTypes", row: 0, ...o };
}

export function typeFlux(o: Partial<TypeFlux> = {}): TypeFlux {
  return {
    type: "HTTP",
    sensRepresentation: "consumer-to-provider",
    sensRepresentationBrut: "consumer → provider",
    description: "",
    colour: "",
    sheet: "FlowTypes",
    row: 0,
    ...o,
  };
}

export function milestone(o: Partial<Milestone> = {}): Milestone {
  return {
    name: "v1",
    rank: 1,
    label: "",
    statut: "Delivered",
    date: "",
    description: "",
    sheet: "Milestones",
    row: 0,
    ...o,
  };
}

export function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return {
    flowName: "F",
    version: "",
    etat: "",
    providerName: "A",
    flowType: "HTTP",
    description: "",
    lienContrat: "",
    referenceContrat: "",
    commentaires: "",
    aConfirmer: false,
    relais: "",
    expectedSheet: "FX_A_HTTP",
    introducedAt: "",
    retiredAt: "",
    sheet: "Interfaces",
    row: 0,
    ...o,
  };
}

export function conso(o: Partial<Consommation> = {}): Consommation {
  return {
    flowName: "F",
    version: "",
    consumerName: "B",
    usage: "",
    criticality: "",
    statut: "",
    decision: "",
    commentaires: "",
    republishedAs: "",
    sheet: "FX_A_HTTP",
    introducedAt: "",
    retiredAt: "",
    row: 0,
    ...o,
  };
}

// Le modèle vide, sur lequel tout se construit par surcharge. Vide et non
// « minimal viable » : un test qui a besoin d'un acteur le dit, et le lecteur
// voit alors dans le test tout ce qui compte pour lui.
export function template(o: Partial<ParsedModel> = {}): ParsedModel {
  return {
    actors: [],
    groups: [],
    groupesAbsents: false,
    typesActeur: [],
    flowTypes: [],
    milestones: [],
    interfaces: [],
    consumptions: [],
    fxSheetNames: [],
    colonnesOptionnellesAbsentes: [],
    versionModele: VERSION_MODELE,
    fichierModifie: null,
    ...o,
  };
}

// Une matrix de test, ses marges calculées comme le fait buildMatrixView : un
// test qui poserait des totaux à la main pourrait affirmer n'importe quoi.
export function matrix(o: { columns: string[]; rows: MatrixRow[] }): MatrixResult {
  const total = (cellules: MatrixCell[]) => cellules.reduce((n, c) => n + c.count, 0);
  return {
    ...o,
    totauxLigne: new Map(o.rows.map((l) => [l.actor, total([...l.cellules.values()].flat())])),
    totauxColonne: new Map(o.columns.map((c) => [c, total(o.rows.flatMap((l) => l.cellules.get(c) ?? []))])),
  };
}
