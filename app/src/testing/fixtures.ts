import type { MatrixResult, MatrixRow, MatrixCell } from "../aggregation/views";
import type {
  Actor,
  Consumption,
  Group,
  InterfaceCatalogue,
  Milestone,
  ParsedModel,
  ActorType,
  FlowType,
} from "../parsing/model";
import { SCHEMA_VERSION } from "../parsing/build-model";

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
    actorType: "Application",
    owner: "",
    description: "",
    comments: "",
    introducedAt: "",
    retiredAt: "",
    sheet: "Actors",
    row: 0,
    ...o,
  };
}

export function group(o: Partial<Group> = {}): Group {
  return { name: "G", perimeter: "Platform", sheet: "Groups", row: 0, ...o };
}

export function actorType(o: Partial<ActorType> = {}): ActorType {
  return { type: "Application", icon: "app-window", nature: "", sheet: "ActorTypes", row: 0, ...o };
}

export function typeFlux(o: Partial<FlowType> = {}): FlowType {
  return {
    type: "HTTP",
    direction: "consumer-to-provider",
    rawDirection: "consumer → provider",
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
    status: "Delivered",
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
    legacyState: "",
    providerName: "A",
    flowType: "HTTP",
    description: "",
    contractLink: "",
    contractReference: "",
    comments: "",
    toConfirm: false,
    legacyRelays: "",
    expectedSheet: "FX_A_HTTP",
    introducedAt: "",
    retiredAt: "",
    sheet: "Interfaces",
    row: 0,
    ...o,
  };
}

export function consumption(o: Partial<Consumption> = {}): Consumption {
  return {
    flowName: "F",
    version: "",
    consumerName: "B",
    usage: "",
    criticality: "",
    legacyStatus: "",
    decision: "",
    comments: "",
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
    groupsSheetMissing: false,
    actorTypes: [],
    flowTypes: [],
    milestones: [],
    interfaces: [],
    consumptions: [],
    fxSheetNames: [],
    missingOptionalColumns: [],
    schemaVersion: SCHEMA_VERSION,
    savedAt: null,
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
