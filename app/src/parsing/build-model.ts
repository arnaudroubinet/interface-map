import type {
  RawSheet,
  ParsedWorkbook,
  Actor,
  Group,
  ActorType,
  FlowType,
  Milestone,
  Validity,
  InterfaceCatalogue,
  Consumption,
  BuildModelResult,
  BlockingError,
} from "./model";
import { matchesSheetName, hasPrefix, findHeader } from "./headers";
import { normalizeText } from "../shared/text";

const CARACTERES_INTERDITS = /[:\\/?*[\]]/;
// Les mêmes, un par un : la formule Excel des tables d'appoint doit refaire cet
// assainissement à l'identique, et une expression régulière ne s'y écrit pas.
export const CARACTERES_INTERDITS_ONGLET = [":", "\\", "/", "?", "*", "[", "]"];
export const REMPLACEMENT_ONGLET = "-";
export const LONGUEUR_MAX_ONGLET = 31;

// L'état appartient au FLUX, pas au composant : un acteur n'a plus de statut.
// Le porter des deux côtés faisait qu'un acteur marqué décommissionné éteignait
// silencieusement des flux pourtant déclarés actifs.
export const MILESTONE_COLUMNS = ["Milestone", "Rank", "Label", "Status", "Date", "Description"];
// Les deux bornes de validité, ajoutées telles quelles à chaque feuille qui
// porte des objets datables. Déclarées une fois : elles doivent rester
// identiques d'une feuille à l'autre, sinon les contrôles temporels liraient
// des colonnes différentes selon l'objet.
export const VALIDITY_COLUMNS = ["Introduced at", "Retired at"];

// Colonnes du format d'origine que le format actuel ne produit plus : l'axe des
// paliers dit la même chose, en mieux. Elles restent LUES, et seulement lues,
// pour que la mise à niveau sache quoi convertir. Elles ne figurent dans aucun
// COLONNES_*, donc ni le modèle vierge ni aucun classeur produit ne les porte,
// et leur absence n'est jamais signalée.
export const COLONNE_HERITEE_ETAT = "État";
export const COLONNE_HERITEE_STATUT = "Statut";

export const ACTOR_COLUMNS = ["Name", "Group", "Actor type", "Owner", "Description", "Comments", ...VALIDITY_COLUMNS];

export const GROUP_COLUMNS = ["Group", "Perimeter"];
// « Aperçu » est une colonne calculée du classeur, pas une donnée : le modèle y
// met une formule qui affiche l'icône choisie. Le parseur l'ignore.
export const ACTOR_TYPE_COLUMNS = ["Actor type", "Icon", "Nature"];
export const ICON_PREVIEW_COLUMN = "Preview";
export const FLOW_TYPE_COLUMNS = ["Flow type", "Direction", "Description"];
export const INTERFACE_COLUMNS = ["Flow name", "Version", "Provider", "Flow type", "Description", "Contract link", "Contract reference", "Comments", "To confirm", ...VALIDITY_COLUMNS];
// « Republished as » porte la lecture fonctionnelle du côté où l'information
// existe déjà. Un acteur technique consomme un flux et le republie sous l'une de
// SES interfaces : c'est cette ligne de consommation qui sait de quel
// fournisseur et de quelle version il s'agit. Une valeur par ligne -- donc une
// liste déroulante ordinaire, là où la colonne Relays de la v3, qui nommait
// plusieurs sources dans une seule case, n'en admettait aucune.
export const REPUBLICATION_COLUMN = "Republished as";
// Portait la lecture fonctionnelle en v3, sur la ligne d'interface.
const LEGACY_RELAY_COLUMN = "Relays";
// La couleur des technologies vient du référentiel externe. La colonne n'est
// pas au schéma : lue si elle est là, ignorée sinon -- un classeur qui ne l'a
// pas n'est pas en défaut, il s'en remet à la palette.
const FLOW_COLOUR_COLUMNS = ["Colour", "Color", "Couleur"];
export const FX_COLUMNS = ["Flow name", "Version", "Consumer", "Usage", "Criticality for this consumer", "Decision", "Comments", REPUBLICATION_COLUMN, ...VALIDITY_COLUMNS];

// Numéro de schéma du classeur, écrit dans un onglet masqué. Un entier
// monotone, pas un semver : il ne sert qu'à savoir quelles transformations
// appliquer, et dans quel ordre.
export const SCHEMA_VERSION = 4;
export const FEUILLE_VERSION = "Version";
export const SCHEMA_VERSION_COLUMN = "Model version";

// Absence d'onglet, onglet vide ou valeur illisible : version 0, c'est-à-dire
// « antérieur au versionnement ». On ne devine rien de plus -- la mise à
// niveau saura quoi faire, et se tromper vers le haut ferait lire un classeur
// avec des colonnes qu'il n'a pas.
function readSchemaVersion(sheets: RawSheet[]): number {
  const sheet = sheets.find((s) => matchesSheetName(s.name, FEUILLE_VERSION));
  if (!sheet) return 0;
  const header = findHeader(sheet.headers, SCHEMA_VERSION_COLUMN);
  if (!header) return 0;
  const brut = (sheet.rows[0]?.values[header] ?? "").toString().trim();
  const value = Number.parseInt(brut, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function findSheet(sheets: RawSheet[], name: string): RawSheet | undefined {
  return sheets.find((s) => matchesSheetName(s.name, name));
}

function buildHeaderMap(actualHeaders: string[], attendus: string[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const attendu of attendus) {
    const found = findHeader(actualHeaders, attendu);
    if (found) map.set(attendu, found);
  }
  return map;
}

function get(row: Record<string, string>, headerMap: Map<string, string>, canonique: string): string {
  const actual = headerMap.get(canonique);
  return actual ? (row[actual] ?? "").toString().trim() : "";
}

function rowHasContent(row: Record<string, string>, headerMap: Map<string, string>, columns: string[]): boolean {
  return columns.some((c) => get(row, headerMap, c) !== "");
}

// Les deux normalisations acceptent encore l'écriture de la v2 : un classeur
// v2 doit se lire correctement pour se convertir, et ces deux valeurs sont
// interprétées dès la lecture, pas au moment de la conversion.
function normSens(raw: string): "provider-to-consumer" | "consumer-to-provider" {
  const v = normalizeText(raw);
  const toConsumer = v.startsWith(normalizeText("provider")) || v.startsWith(normalizeText("exposant"));
  return toConsumer ? "provider-to-consumer" : "consumer-to-provider";
}

function normOui(raw: string): boolean {
  const v = normalizeText(raw);
  return v === normalizeText("yes") || v === normalizeText("oui");
}

function validity(row: Record<string, string>, headerMap: Map<string, string>): Validity {
  return {
    introducedAt: get(row, headerMap, "Introduced at"),
    retiredAt: get(row, headerMap, "Retired at"),
  };
}

// Ce qu'Excel accepte comme nom d'onglet, pas une règle à nous : au plus 31
// caractères, aucun des sept caractères interdits. Exportée pour que
// migration-legacy.ts la consomme aussi -- sans elle, le parseur et la
// migration pourraient un jour juger différemment le même nom, et produire un
// classeur dont l'onglet manquant n'aurait jamais pu être créé.
export function isValidTabName(name: string): boolean {
  return name.length <= 31 && !CARACTERES_INTERDITS.test(name);
}

// La convention qui lie une consommation à son interface (§3.3) : reconstruite
// ici, dans la formule Excel des tables d'appoint (template-export.ts) et dans
// la migration legacy (migration-legacy.ts). Un seul endroit, pour que les
// trois ne puissent pas s'écarter l'un de l'autre.
export const PREFIXE_FEUILLE_FX = "FX_";
export const FX_SHEET_SEPARATOR = "_";

// Excel refuse un nom de plus de 31 caractères ou portant l'un de : \ / ? * [ ].
// Le nom étant DÉRIVÉ, un acteur au nom un peu long produisait un onglet
// impossible -- que l'écriture écartait en silence, emportant ses
// consommations avec lui. On assainit donc ici, au seul endroit où le nom se
// fabrique, plutôt que de laisser le problème atteindre le classeur.
//
// Deux couples (exposant, type) peuvent désormais tomber sur le même nom une
// fois coupés : un contrôle d'intégrité le signale plutôt que de les fondre.
export function sanitiseTabName(name: string): string {
  const sansInterdits = CARACTERES_INTERDITS_ONGLET.reduce(
    (current, interdit) => current.split(interdit).join(REMPLACEMENT_ONGLET),
    name
  );
  return sansInterdits.slice(0, LONGUEUR_MAX_ONGLET);
}

export function expectedFxSheet(providerName: string, flowType: string): string {
  return sanitiseTabName(`${PREFIXE_FEUILLE_FX}${providerName}${FX_SHEET_SEPARATOR}${flowType}`);
}

export function buildModel(workbook: ParsedWorkbook): BuildModelResult {
  const errors: BlockingError[] = [];

  const actorsSheet = findSheet(workbook.sheets, "Actors");
  const feuilleTypesFlux = findSheet(workbook.sheets, "FlowTypes");
  const feuilleInterfaces = findSheet(workbook.sheets, "Interfaces");

  if (!actorsSheet) errors.push({ message: 'Sheet "Actors" missing from the workbook.' });
  if (!feuilleTypesFlux) errors.push({ message: 'Sheet "FlowTypes" missing from the workbook.' });
  if (!feuilleInterfaces) errors.push({ message: 'Sheet "Interfaces" missing from the workbook.' });

  if (actorsSheet && !findHeader(actorsSheet.headers, "Name")) {
    errors.push({ message: 'Key column "Name" missing from sheet "Actors".' });
  }
  if (feuilleTypesFlux && !findHeader(feuilleTypesFlux.headers, "Flow type")) {
    errors.push({ message: 'Key column "Flow type" missing from sheet "FlowTypes".' });
  }
  if (feuilleInterfaces && !findHeader(feuilleInterfaces.headers, "Flow name")) {
    errors.push({ message: 'Key column "Flow name" missing from sheet "Interfaces".' });
  }

  if (!actorsSheet || !feuilleTypesFlux || !feuilleInterfaces || errors.length > 0) {
    return { ok: false, errors };
  }

  const headersActeurs = actorsSheet.headers;
  const headersTypesFlux = feuilleTypesFlux.headers;
  const headersInterfaces = feuilleInterfaces.headers;

  const missingOptionalColumns: { sheet: string; column: string }[] = [];
  function noterColonnesAbsentes(sheet: string, actualHeaders: string[], attendues: string[]) {
    for (const attendue of attendues) {
      if (!findHeader(actualHeaders, attendue)) {
        missingOptionalColumns.push({ sheet, column: attendue });
      }
    }
  }

  noterColonnesAbsentes("Actors", headersActeurs, ACTOR_COLUMNS.filter((c) => c !== "Name"));
  noterColonnesAbsentes("FlowTypes", headersTypesFlux, FLOW_TYPE_COLUMNS.filter((c) => c !== "Flow type"));
  noterColonnesAbsentes("Interfaces", headersInterfaces, INTERFACE_COLUMNS.filter((c) => c !== "Flow name"));

  const headerMapActors = buildHeaderMap(headersActeurs, ACTOR_COLUMNS);
  const actors: Actor[] = actorsSheet.rows
    .filter(({ values: r }) => rowHasContent(r, headerMapActors, ACTOR_COLUMNS))
    .map(({ row, values: r }) => ({
      sheet: actorsSheet.name,
      row,
      name: get(r, headerMapActors, "Name"),
      group: get(r, headerMapActors, "Group"),
      actorType: get(r, headerMapActors, "Actor type"),
      owner: get(r, headerMapActors, "Owner"),
      description: get(r, headerMapActors, "Description"),
      comments: get(r, headerMapActors, "Comments"),
      ...validity(r, headerMapActors),
    }))
    .filter((a) => a.name !== "");

  // Onglet « Groupes » : la SEULE source du périmètre. Son absence n'est pas
  // rattrapée -- deviner le périmètre à partir des acteurs redonnerait deux
  // vérités concurrentes sur la même question. Un contrôle d'intégrité réclame
  // l'onglet, et sans lui aucun acteur n'est situé.
  const feuilleGroupes = findSheet(workbook.sheets, "Groups");
  let groups: Group[] = [];
  let groupsSheetMissing = true;
  if (feuilleGroupes && findHeader(feuilleGroupes.headers, "Group")) {
    groupsSheetMissing = false;
    noterColonnesAbsentes("Groups", feuilleGroupes.headers, GROUP_COLUMNS.filter((c) => c !== "Group"));
    const headerMapGroupes = buildHeaderMap(feuilleGroupes.headers, GROUP_COLUMNS);
    groups = feuilleGroupes.rows
      .filter(({ values: r }) => rowHasContent(r, headerMapGroupes, GROUP_COLUMNS))
      .map(({ row, values: r }) => ({
        sheet: feuilleGroupes.name,
        row,
        name: get(r, headerMapGroupes, "Group"),
        perimeter: get(r, headerMapGroupes, "Perimeter"),
      }))
      .filter((g) => g.name !== "");
  }

  // Onglet « TypesActeur » : quelle icône porte quel type. La liste des types
  // est propre à chaque référentiel, donc c'est le classeur qui la désigne.
  // Optionnel, comme « Groupes » : sans lui, les nœuds portent le jeton neutre
  // et un contrôle d'intégrité le signale.
  const actorTypesSheet = findSheet(workbook.sheets, "ActorTypes");
  let actorTypes: ActorType[] = [];
  if (actorTypesSheet && findHeader(actorTypesSheet.headers, "Actor type")) {
    noterColonnesAbsentes("ActorTypes", actorTypesSheet.headers, ACTOR_TYPE_COLUMNS.filter((c) => c !== "Actor type"));
    const headerMapActorTypes = buildHeaderMap(actorTypesSheet.headers, ACTOR_TYPE_COLUMNS);
    actorTypes = actorTypesSheet.rows
      .filter(({ values: r }) => rowHasContent(r, headerMapActorTypes, ACTOR_TYPE_COLUMNS))
      .map(({ row, values: r }) => ({
        sheet: actorTypesSheet.name,
        row,
        type: get(r, headerMapActorTypes, "Actor type"),
        icon: get(r, headerMapActorTypes, "Icon"),
        nature: get(r, headerMapActorTypes, "Nature"),
      }))
      .filter((t) => t.type !== "");
  }

  const headerMapTypesFlux = buildHeaderMap(headersTypesFlux, FLOW_TYPE_COLUMNS);
  const colourHeader = FLOW_COLOUR_COLUMNS.map((c) => findHeader(headersTypesFlux, c)).find(Boolean);
  const flowTypes: FlowType[] = feuilleTypesFlux.rows
    .filter(({ values: r }) => rowHasContent(r, headerMapTypesFlux, FLOW_TYPE_COLUMNS))
    .map(({ row, values: r }) => ({
      sheet: feuilleTypesFlux.name,
      row,
      type: get(r, headerMapTypesFlux, "Flow type"),
      direction: normSens(get(r, headerMapTypesFlux, "Direction")),
      rawDirection: get(r, headerMapTypesFlux, "Direction"),
      colour: colourHeader ? (r[colourHeader] ?? "").toString().trim() : "",
      description: get(r, headerMapTypesFlux, "Description"),
    }))
    .filter((t) => t.type !== "");

  const milestonesSheet = findSheet(workbook.sheets, "Milestones");
  const milestones: Milestone[] = [];
  if (milestonesSheet) {
    noterColonnesAbsentes("Milestones", milestonesSheet.headers, MILESTONE_COLUMNS.filter((c) => c !== "Milestone"));
    const headerMapMilestones = buildHeaderMap(milestonesSheet.headers, MILESTONE_COLUMNS);
    for (const { row, values: r } of milestonesSheet.rows) {
      if (!rowHasContent(r, headerMapMilestones, MILESTONE_COLUMNS)) continue;
      const name = get(r, headerMapMilestones, "Milestone");
      if (name === "") continue;
      // Un rang illisible vaut 0 : la ligne reste lue et un contrôle réclame
      // le rang, plutôt que de la faire disparaître en silence.
      const rank = Number.parseInt(get(r, headerMapMilestones, "Rank"), 10);
      milestones.push({
        sheet: milestonesSheet.name,
        row,
        name,
        rank: Number.isFinite(rank) ? rank : 0,
        label: get(r, headerMapMilestones, "Label"),
        status: get(r, headerMapMilestones, "Status"),
        date: get(r, headerMapMilestones, "Date"),
        description: get(r, headerMapMilestones, "Description"),
      });
    }
    milestones.sort((a, b) => a.rank - b.rank);
  }

  const headerMapInterfaces = buildHeaderMap(headersInterfaces, [...INTERFACE_COLUMNS, COLONNE_HERITEE_ETAT]);
  const interfaces: InterfaceCatalogue[] = feuilleInterfaces.rows
    .filter(({ values: r }) => rowHasContent(r, headerMapInterfaces, INTERFACE_COLUMNS))
    .map(({ row, values: r }) => {
      const flowName = get(r, headerMapInterfaces, "Flow name");
      const providerName = get(r, headerMapInterfaces, "Provider");
      const flowType = get(r, headerMapInterfaces, "Flow type");
      const expectedSheet = expectedFxSheet(providerName, flowType);
      return {
        sheet: feuilleInterfaces.name,
        row,
        flowName,
        version: get(r, headerMapInterfaces, "Version"),
        legacyState: get(r, headerMapInterfaces, COLONNE_HERITEE_ETAT),
        providerName,
        flowType,
        description: get(r, headerMapInterfaces, "Description"),
        contractLink: get(r, headerMapInterfaces, "Contract link"),
        contractReference: get(r, headerMapInterfaces, "Contract reference"),
        comments: get(r, headerMapInterfaces, "Comments"),
        toConfirm: normOui(get(r, headerMapInterfaces, "To confirm")),
        expectedSheet,
        // Colonne de la v3, remplacée par « Republished as » sur la consommation.
        // On la lit encore -- et seulement ici -- pour que la mise à niveau puisse
        // déplacer l'information ; plus rien d'autre ne la consulte.
        legacyRelays: (() => {
          const header = findHeader(feuilleInterfaces.headers, LEGACY_RELAY_COLUMN);
          return header ? (r[header] ?? "").toString().trim() : "";
        })(),
        ...validity(r, headerMapInterfaces),
      };
    })
    .filter((i) => i.flowName !== "");

  const fxSheets = workbook.sheets.filter(
    // FX_Modèle était le gabarit que recopiait la macro. Elle n'existe plus, et
    // les classeurs produits n'en portent plus ; on continue de l'écarter pour
    // les classeurs antérieurs, où l'onglet traîne encore.
    (s) => hasPrefix(s.name, PREFIXE_FEUILLE_FX) && !matchesSheetName(s.name, "FX_Modèle")
  );
  const fxSheetNames = fxSheets.map((s) => s.name);

  const consumptions: Consumption[] = [];
  for (const sheet of fxSheets) {
    const headersFx = sheet.headers;
    noterColonnesAbsentes(sheet.name, headersFx, FX_COLUMNS);
    const headerMapFx = buildHeaderMap(headersFx, [...FX_COLUMNS, COLONNE_HERITEE_STATUT]);
    for (const { row, values: r } of sheet.rows) {
      if (!rowHasContent(r, headerMapFx, FX_COLUMNS)) continue;
      const flowName = get(r, headerMapFx, "Flow name");
      if (flowName === "") continue;
      consumptions.push({
        row,
        flowName,
        version: get(r, headerMapFx, "Version"),
        consumerName: get(r, headerMapFx, "Consumer"),
        usage: get(r, headerMapFx, "Usage"),
        criticality: get(r, headerMapFx, "Criticality for this consumer"),
        legacyStatus: get(r, headerMapFx, COLONNE_HERITEE_STATUT),
        decision: get(r, headerMapFx, "Decision"),
        republishedAs: get(r, headerMapFx, REPUBLICATION_COLUMN),
        comments: get(r, headerMapFx, "Comments"),
        sheet: sheet.name,
        ...validity(r, headerMapFx),
      });
    }
  }

  return {
    ok: true,
    model: {
      actors,
      groups,
      groupsSheetMissing,
      actorTypes,
      flowTypes,
      milestones,
      interfaces,
      consumptions,
      fxSheetNames,
      missingOptionalColumns,
      schemaVersion: readSchemaVersion(workbook.sheets),
      savedAt: workbook.savedAt,
    },
  };
}
