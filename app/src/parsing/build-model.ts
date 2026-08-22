import type {
  RawSheet,
  ParsedWorkbook,
  Actor,
  Groupe,
  TypeActeur,
  TypeFlux,
  Milestone,
  ValiditePalier,
  InterfaceCatalogue,
  Consommation,
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
export const COLONNES_PALIERS = ["Milestone", "Rank", "Label", "Status", "Date", "Description"];
// Les deux bornes de validité, ajoutées telles quelles à chaque feuille qui
// porte des objets datables. Déclarées une fois : elles doivent rester
// identiques d'une feuille à l'autre, sinon les contrôles temporels liraient
// des colonnes différentes selon l'objet.
export const COLONNES_VALIDITE = ["Introduced at", "Retired at"];

// Colonnes du format d'origine que le format actuel ne produit plus : l'axe des
// paliers dit la même chose, en mieux. Elles restent LUES, et seulement lues,
// pour que la mise à niveau sache quoi convertir. Elles ne figurent dans aucun
// COLONNES_*, donc ni le modèle vierge ni aucun classeur produit ne les porte,
// et leur absence n'est jamais signalée.
export const COLONNE_HERITEE_ETAT = "État";
export const COLONNE_HERITEE_STATUT = "Statut";

export const COLONNES_ACTEURS = ["Name", "Group", "Actor type", "Owner", "Description", "Comments", ...COLONNES_VALIDITE];

export const COLONNES_GROUPES = ["Group", "Perimeter"];
// « Aperçu » est une colonne calculée du classeur, pas une donnée : le modèle y
// met une formule qui affiche l'icône choisie. Le parseur l'ignore.
export const COLONNES_TYPESACTEUR = ["Actor type", "Icon", "Nature"];
export const COLONNE_APERCU_ICONE = "Preview";
export const COLONNES_TYPESFLUX = ["Flow type", "Direction", "Description"];
export const COLONNES_INTERFACES = ["Flow name", "Version", "Provider", "Flow type", "Description", "Contract link", "Contract reference", "Comments", "To confirm", ...COLONNES_VALIDITE];
// « Republished as » porte la lecture fonctionnelle du côté où l'information
// existe déjà. Un acteur technique consomme un flux et le republie sous l'une de
// SES interfaces : c'est cette ligne de consommation qui sait de quel
// fournisseur et de quelle version il s'agit. Une valeur par ligne -- donc une
// liste déroulante ordinaire, là où la colonne Relays de la v3, qui nommait
// plusieurs sources dans une seule case, n'en admettait aucune.
export const COLONNE_REPUBLICATION = "Republished as";
// Portait la lecture fonctionnelle en v3, sur la ligne d'interface.
const COLONNE_HERITEE_RELAIS = "Relays";
// La couleur des technologies vient du référentiel externe. La colonne n'est
// pas au schéma : lue si elle est là, ignorée sinon -- un classeur qui ne l'a
// pas n'est pas en défaut, il s'en remet à la palette.
const COLONNES_COULEUR_FLUX = ["Colour", "Color", "Couleur"];
export const COLONNES_FX = ["Flow name", "Version", "Consumer", "Usage", "Criticality for this consumer", "Decision", "Comments", COLONNE_REPUBLICATION, ...COLONNES_VALIDITE];

// Numéro de schéma du classeur, écrit dans un onglet masqué. Un entier
// monotone, pas un semver : il ne sert qu'à savoir quelles transformations
// appliquer, et dans quel ordre.
export const VERSION_MODELE = 4;
export const FEUILLE_VERSION = "Version";
export const COLONNE_VERSION_MODELE = "Model version";

// Absence d'onglet, onglet vide ou valeur illisible : version 0, c'est-à-dire
// « antérieur au versionnement ». On ne devine rien de plus -- la mise à
// niveau saura quoi faire, et se tromper vers le haut ferait lire un classeur
// avec des colonnes qu'il n'a pas.
function lireVersionModele(sheets: RawSheet[]): number {
  const sheet = sheets.find((s) => matchesSheetName(s.name, FEUILLE_VERSION));
  if (!sheet) return 0;
  const header = findHeader(sheet.headers, COLONNE_VERSION_MODELE);
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
  const versConsommateur = v.startsWith(normalizeText("provider")) || v.startsWith(normalizeText("exposant"));
  return versConsommateur ? "provider-to-consumer" : "consumer-to-provider";
}

function normOui(raw: string): boolean {
  const v = normalizeText(raw);
  return v === normalizeText("yes") || v === normalizeText("oui");
}

function validite(row: Record<string, string>, headerMap: Map<string, string>): ValiditePalier {
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
export function nomOngletValide(name: string): boolean {
  return name.length <= 31 && !CARACTERES_INTERDITS.test(name);
}

// La convention qui lie une consommation à son interface (§3.3) : reconstruite
// ici, dans la formule Excel des tables d'appoint (template-export.ts) et dans
// la migration legacy (migration-legacy.ts). Un seul endroit, pour que les
// trois ne puissent pas s'écarter l'un de l'autre.
export const PREFIXE_FEUILLE_FX = "FX_";
export const SEPARATEUR_FEUILLE_FX = "_";

// Excel refuse un nom de plus de 31 caractères ou portant l'un de : \ / ? * [ ].
// Le nom étant DÉRIVÉ, un acteur au nom un peu long produisait un onglet
// impossible -- que l'écriture écartait en silence, emportant ses
// consommations avec lui. On assainit donc ici, au seul endroit où le nom se
// fabrique, plutôt que de laisser le problème atteindre le classeur.
//
// Deux couples (exposant, type) peuvent désormais tomber sur le même nom une
// fois coupés : un contrôle d'intégrité le signale plutôt que de les fondre.
export function assainirNomOnglet(name: string): string {
  const sansInterdits = CARACTERES_INTERDITS_ONGLET.reduce(
    (courant, interdit) => courant.split(interdit).join(REMPLACEMENT_ONGLET),
    name
  );
  return sansInterdits.slice(0, LONGUEUR_MAX_ONGLET);
}

export function expectedFxSheet(providerName: string, flowType: string): string {
  return assainirNomOnglet(`${PREFIXE_FEUILLE_FX}${providerName}${SEPARATEUR_FEUILLE_FX}${flowType}`);
}

export function buildModel(workbook: ParsedWorkbook): BuildModelResult {
  const erreurs: BlockingError[] = [];

  const feuilleActeurs = findSheet(workbook.sheets, "Actors");
  const feuilleTypesFlux = findSheet(workbook.sheets, "FlowTypes");
  const feuilleInterfaces = findSheet(workbook.sheets, "Interfaces");

  if (!feuilleActeurs) erreurs.push({ message: 'Sheet "Actors" missing from the workbook.' });
  if (!feuilleTypesFlux) erreurs.push({ message: 'Sheet "FlowTypes" missing from the workbook.' });
  if (!feuilleInterfaces) erreurs.push({ message: 'Sheet "Interfaces" missing from the workbook.' });

  if (feuilleActeurs && !findHeader(feuilleActeurs.headers, "Name")) {
    erreurs.push({ message: 'Key column "Name" missing from sheet "Actors".' });
  }
  if (feuilleTypesFlux && !findHeader(feuilleTypesFlux.headers, "Flow type")) {
    erreurs.push({ message: 'Key column "Flow type" missing from sheet "FlowTypes".' });
  }
  if (feuilleInterfaces && !findHeader(feuilleInterfaces.headers, "Flow name")) {
    erreurs.push({ message: 'Key column "Flow name" missing from sheet "Interfaces".' });
  }

  if (!feuilleActeurs || !feuilleTypesFlux || !feuilleInterfaces || erreurs.length > 0) {
    return { ok: false, erreurs };
  }

  const headersActeurs = feuilleActeurs.headers;
  const headersTypesFlux = feuilleTypesFlux.headers;
  const headersInterfaces = feuilleInterfaces.headers;

  const colonnesOptionnellesAbsentes: { sheet: string; column: string }[] = [];
  function noterColonnesAbsentes(sheet: string, actualHeaders: string[], attendues: string[]) {
    for (const attendue of attendues) {
      if (!findHeader(actualHeaders, attendue)) {
        colonnesOptionnellesAbsentes.push({ sheet, column: attendue });
      }
    }
  }

  noterColonnesAbsentes("Actors", headersActeurs, COLONNES_ACTEURS.filter((c) => c !== "Name"));
  noterColonnesAbsentes("FlowTypes", headersTypesFlux, COLONNES_TYPESFLUX.filter((c) => c !== "Flow type"));
  noterColonnesAbsentes("Interfaces", headersInterfaces, COLONNES_INTERFACES.filter((c) => c !== "Flow name"));

  const headerMapActeurs = buildHeaderMap(headersActeurs, COLONNES_ACTEURS);
  const actors: Actor[] = feuilleActeurs.rows
    .filter(({ values: r }) => rowHasContent(r, headerMapActeurs, COLONNES_ACTEURS))
    .map(({ row, values: r }) => ({
      sheet: feuilleActeurs.name,
      row,
      name: get(r, headerMapActeurs, "Name"),
      group: get(r, headerMapActeurs, "Group"),
      typeActeur: get(r, headerMapActeurs, "Actor type"),
      responsable: get(r, headerMapActeurs, "Owner"),
      description: get(r, headerMapActeurs, "Description"),
      commentaires: get(r, headerMapActeurs, "Comments"),
      ...validite(r, headerMapActeurs),
    }))
    .filter((a) => a.name !== "");

  // Onglet « Groupes » : la SEULE source du périmètre. Son absence n'est pas
  // rattrapée -- deviner le périmètre à partir des acteurs redonnerait deux
  // vérités concurrentes sur la même question. Un contrôle d'intégrité réclame
  // l'onglet, et sans lui aucun acteur n'est situé.
  const feuilleGroupes = findSheet(workbook.sheets, "Groups");
  let groups: Groupe[] = [];
  let groupesAbsents = true;
  if (feuilleGroupes && findHeader(feuilleGroupes.headers, "Group")) {
    groupesAbsents = false;
    noterColonnesAbsentes("Groups", feuilleGroupes.headers, COLONNES_GROUPES.filter((c) => c !== "Group"));
    const headerMapGroupes = buildHeaderMap(feuilleGroupes.headers, COLONNES_GROUPES);
    groups = feuilleGroupes.rows
      .filter(({ values: r }) => rowHasContent(r, headerMapGroupes, COLONNES_GROUPES))
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
  const feuilleTypesActeur = findSheet(workbook.sheets, "ActorTypes");
  let typesActeur: TypeActeur[] = [];
  if (feuilleTypesActeur && findHeader(feuilleTypesActeur.headers, "Actor type")) {
    noterColonnesAbsentes("ActorTypes", feuilleTypesActeur.headers, COLONNES_TYPESACTEUR.filter((c) => c !== "Actor type"));
    const headerMapTypesActeur = buildHeaderMap(feuilleTypesActeur.headers, COLONNES_TYPESACTEUR);
    typesActeur = feuilleTypesActeur.rows
      .filter(({ values: r }) => rowHasContent(r, headerMapTypesActeur, COLONNES_TYPESACTEUR))
      .map(({ row, values: r }) => ({
        sheet: feuilleTypesActeur.name,
        row,
        type: get(r, headerMapTypesActeur, "Actor type"),
        icone: get(r, headerMapTypesActeur, "Icon"),
        nature: get(r, headerMapTypesActeur, "Nature"),
      }))
      .filter((t) => t.type !== "");
  }

  const headerMapTypesFlux = buildHeaderMap(headersTypesFlux, COLONNES_TYPESFLUX);
  const entêteCouleur = COLONNES_COULEUR_FLUX.map((c) => findHeader(headersTypesFlux, c)).find(Boolean);
  const flowTypes: TypeFlux[] = feuilleTypesFlux.rows
    .filter(({ values: r }) => rowHasContent(r, headerMapTypesFlux, COLONNES_TYPESFLUX))
    .map(({ row, values: r }) => ({
      sheet: feuilleTypesFlux.name,
      row,
      type: get(r, headerMapTypesFlux, "Flow type"),
      sensRepresentation: normSens(get(r, headerMapTypesFlux, "Direction")),
      sensRepresentationBrut: get(r, headerMapTypesFlux, "Direction"),
      colour: entêteCouleur ? (r[entêteCouleur] ?? "").toString().trim() : "",
      description: get(r, headerMapTypesFlux, "Description"),
    }))
    .filter((t) => t.type !== "");

  const feuillePaliers = findSheet(workbook.sheets, "Milestones");
  const milestones: Milestone[] = [];
  if (feuillePaliers) {
    noterColonnesAbsentes("Milestones", feuillePaliers.headers, COLONNES_PALIERS.filter((c) => c !== "Milestone"));
    const headerMapPaliers = buildHeaderMap(feuillePaliers.headers, COLONNES_PALIERS);
    for (const { row, values: r } of feuillePaliers.rows) {
      if (!rowHasContent(r, headerMapPaliers, COLONNES_PALIERS)) continue;
      const name = get(r, headerMapPaliers, "Milestone");
      if (name === "") continue;
      // Un rang illisible vaut 0 : la ligne reste lue et un contrôle réclame
      // le rang, plutôt que de la faire disparaître en silence.
      const rank = Number.parseInt(get(r, headerMapPaliers, "Rank"), 10);
      milestones.push({
        sheet: feuillePaliers.name,
        row,
        name,
        rank: Number.isFinite(rank) ? rank : 0,
        label: get(r, headerMapPaliers, "Label"),
        statut: get(r, headerMapPaliers, "Status"),
        date: get(r, headerMapPaliers, "Date"),
        description: get(r, headerMapPaliers, "Description"),
      });
    }
    milestones.sort((a, b) => a.rank - b.rank);
  }

  const headerMapInterfaces = buildHeaderMap(headersInterfaces, [...COLONNES_INTERFACES, COLONNE_HERITEE_ETAT]);
  const interfaces: InterfaceCatalogue[] = feuilleInterfaces.rows
    .filter(({ values: r }) => rowHasContent(r, headerMapInterfaces, COLONNES_INTERFACES))
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
        etat: get(r, headerMapInterfaces, COLONNE_HERITEE_ETAT),
        providerName,
        flowType,
        description: get(r, headerMapInterfaces, "Description"),
        lienContrat: get(r, headerMapInterfaces, "Contract link"),
        referenceContrat: get(r, headerMapInterfaces, "Contract reference"),
        commentaires: get(r, headerMapInterfaces, "Comments"),
        aConfirmer: normOui(get(r, headerMapInterfaces, "To confirm")),
        expectedSheet,
        // Colonne de la v3, remplacée par « Republished as » sur la consommation.
        // On la lit encore -- et seulement ici -- pour que la mise à niveau puisse
        // déplacer l'information ; plus rien d'autre ne la consulte.
        relais: (() => {
          const header = findHeader(feuilleInterfaces.headers, COLONNE_HERITEE_RELAIS);
          return header ? (r[header] ?? "").toString().trim() : "";
        })(),
        ...validite(r, headerMapInterfaces),
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

  const consumptions: Consommation[] = [];
  for (const sheet of fxSheets) {
    const headersFx = sheet.headers;
    noterColonnesAbsentes(sheet.name, headersFx, COLONNES_FX);
    const headerMapFx = buildHeaderMap(headersFx, [...COLONNES_FX, COLONNE_HERITEE_STATUT]);
    for (const { row, values: r } of sheet.rows) {
      if (!rowHasContent(r, headerMapFx, COLONNES_FX)) continue;
      const flowName = get(r, headerMapFx, "Flow name");
      if (flowName === "") continue;
      consumptions.push({
        row,
        flowName,
        version: get(r, headerMapFx, "Version"),
        consumerName: get(r, headerMapFx, "Consumer"),
        usage: get(r, headerMapFx, "Usage"),
        criticality: get(r, headerMapFx, "Criticality for this consumer"),
        statut: get(r, headerMapFx, COLONNE_HERITEE_STATUT),
        decision: get(r, headerMapFx, "Decision"),
        republishedAs: get(r, headerMapFx, COLONNE_REPUBLICATION),
        commentaires: get(r, headerMapFx, "Comments"),
        sheet: sheet.name,
        ...validite(r, headerMapFx),
      });
    }
  }

  return {
    ok: true,
    model: {
      actors,
      groups,
      groupesAbsents,
      typesActeur,
      flowTypes,
      milestones,
      interfaces,
      consumptions,
      fxSheetNames,
      colonnesOptionnellesAbsentes,
      versionModele: lireVersionModele(workbook.sheets),
      fichierModifie: workbook.fichierModifie,
    },
  };
}
