import * as XLSX from "xlsx";
import { downloadWorkbook } from "./download";
import {
  COLONNES_ACTEURS,
  COLONNES_GROUPES,
  COLONNES_TYPESACTEUR,
  COLONNE_APERCU_ICONE,
  COLONNES_TYPESFLUX,
  COLONNES_INTERFACES,
  COLONNES_FX,
  COLONNE_REPUBLICATION,
  COLONNES_PALIERS,
  COLONNES_VALIDITE,
  VERSION_MODELE,
  FEUILLE_VERSION,
  COLONNE_VERSION_MODELE,
  PREFIXE_FEUILLE_FX,
  sanitiseTabName,
  CARACTERES_INTERDITS_ONGLET,
  REMPLACEMENT_ONGLET,
  LONGUEUR_MAX_ONGLET,
  SEPARATEUR_FEUILLE_FX,
} from "../parsing/build-model";
import { ICONES_DISPONIBLES, APERCU_ICONES } from "../render/icons";
import {
  VOCABULARY_DIRECTION,
  VOCABULARY_DECISION,
  VOCABULARY_CRITICALITY,
  VOCABULARY_NATURE,
  VOCABULARY_PERIMETER,
} from "../aggregation/vocabularies";
import {
  applyOoxmlExtras,
  type TableToApply,
  type NamedList,
  type ValidationToApply,
  type StyleToApply,
} from "./xlsx-tables";
import { ICONES_PAR_DEFAUT, LISTES, MODE_EMPLOI, TYPES_FLUX, type RowRole } from "./template-data";

// Les vocabulaires et le mode d'emploi vivent dans modele-donnees.ts ; ce
// module-ci n'est plus que la machinerie qui les assemble en classeur.
export { LISTES, TYPES_FLUX } from "./template-data";



function sheet(rows: (string | number)[][], largeurs: number[], filtrable = true): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = largeurs.map((wch) => ({ wch }));
  // L'autofiltre engendre un nom défini « _xlnm._FilterDatabase » qui cite le
  // nom de la feuille entre apostrophes. SheetJS ne double PAS l'apostrophe
  // interne de « Mode d'emploi », ce qui produit un nom défini malformé --
  // Excel ouvre alors sur une demande de réparation, là où SheetJS relit son
  // propre fichier sans rien voir. Une feuille de prose n'a de toute façon rien
  // à filtrer.
  if (filtrable && rows.length > 0) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: rows[0].length - 1 } }),
    };
  }
  return ws;
}

// Une feuille de saisie : sa ligne d'en-tête, et rien d'autre. Les largeurs
// suivent la longueur du titre, faute de données pour les calibrer.
function feuilleVide(columns: readonly string[]): XLSX.WorkSheet {
  return sheet([[...columns]], columns.map((c) => Math.max(14, c.length + 4)));
}

// La troisième colonne montre l'icône choisie sur la ligne. Elle ne se saisit
// pas : c'est une formule, recopiée par Excel sur chaque nouvelle ligne du
// tableau (colonne calculée). Elle va chercher l'aperçu dans l'onglet Listes,
// en face du nom retenu.
//
// Références de plage, PAS de références structurées. La version précédente
// écrivait « T_Lists[Preview] » : Excel charge les tables dans l'ordre, et
// T_Listes est la septième — elle n'existait pas encore quand il validait la
// troisième, qu'il supprimait donc en proposant de réparer le classeur. Son
// journal le disait mot pour mot : « Enregistrements supprimés: Tableau dans
// la partie /xl/tables/table3.xml ».
// Le nom de l'onglet des listes, à un seul endroit. Il était écrit en toutes
// lettres dans les formules et une fois de plus à la création : le passage à
// l'anglais a renommé la seconde et oublié les premières, et Excel a lu
// « Listes! » comme un renvoi vers un AUTRE CLASSEUR -- d'où l'avertissement
// sur les liaisons externes, et des listes déroulantes qui ne se remplissaient
// plus.
export const FEUILLE_LISTES = "Lists";

export function formuleApercu(row: number): string {
  const icon = colonneDeListe("Icon");
  const preview = colonneDeListe("Preview");
  return `IFERROR(INDEX(${FEUILLE_LISTES}!$${preview}:$${preview},MATCH(B${row},${FEUILLE_LISTES}!$${icon}:$${icon},0)),"")`;
}

// Seul onglet pré-rempli : sans lui, tous les acteurs porteraient le jeton
// neutre et un contrôle d'intégrité s'allumerait sur un classeur neuf.
function feuilleTypesActeur(declared: readonly (readonly string[])[]): XLSX.WorkSheet {
  const rows = declared.length > 0 ? declared.map((l) => [...l]) : ICONES_PAR_DEFAUT.map(([t, i]) => [t, i]);
  const headers = [...COLONNES_TYPESACTEUR, COLONNE_APERCU_ICONE];
  // La colonne Aperçu suit COLONNES_TYPESACTEUR au lieu d'une lettre écrite en
  // dur : l'ajout de "Nature" l'a décalée de C à D, et une lettre figée
  // aurait écrasé la colonne voisine au lieu de la formule attendue.
  const colonneApercu = XLSX.utils.encode_col(COLONNES_TYPESACTEUR.length);
  const ws = sheet([headers, ...rows], [22, 18, 14, 12]);
  rows.forEach(([, icon], rank) => {
    // La valeur en cache est celle qu'Excel recalculera de toute façon : elle
    // sert à ce que l'aperçu s'affiche juste dès l'ouverture, avant le premier
    // recalcul.
    ws[`${colonneApercu}${rank + 2}`] = { t: "str", f: formuleApercu(rank + 2), v: APERCU_ICONES[icon] ?? "" };
  });
  ws["!ref"] = `A1:${colonneApercu}${rows.length + 1}`;
  return ws;
}

// Le numéro de schéma du classeur, dans un onglet à lui. Une seule valeur, sur
// une feuille masquée : ce n'est pas une donnée à saisir, c'est la signature du
// format, celle qui dit à l'outil s'il sait lire ce fichier tel quel.
function feuilleVersion(): XLSX.WorkSheet {
  return sheet([[COLONNE_VERSION_MODELE], [VERSION_MODELE]], [20], false);
}

// Les onglets FX_ portent, hors du tableau de saisie et dans une colonne
// masquée, une cellule qui donne le nom de leur propre onglet. Les deux
// validations dépendantes savent ainsi sur quel onglet elles se trouvent, et
// la cellule suit toute copie ou tout renommage de la feuille. Une cellule par
// feuille plutôt que l'expression répétée dans chaque validation : CELL est
// volatile.
export const COLONNE_APPOINT = XLSX.utils.encode_col(COLONNES_FX.length + 1);
export const CELLULE_ONGLET = `${COLONNE_APPOINT}1`;
const FORMULE_NOM_ONGLET =
  'MID(CELL("filename",$A$1),FIND("]",CELL("filename",$A$1))+1,255)';

// Une fonction postérieure à Excel 2007 se STOCKE dans le fichier sous un nom
// préfixé -- « _xlfn. », et « _xlfn._xlws. » pour celles qui ne valent que sur
// une feuille de calcul. Excel les réaffiche sans le préfixe. Sans lui, il ne
// reconnaît pas la fonction, supprime la formule et propose de réparer le
// classeur : c'est exactement ce qu'il a fait sur une première version.
const NOMS_STOCKES: Record<string, string> = {
  FILTER: "_xlfn._xlws.FILTER",
  SORT: "_xlfn._xlws.SORT",
  UNIQUE: "_xlfn.UNIQUE",
  SEQUENCE: "_xlfn.SEQUENCE",
  HSTACK: "_xlfn.HSTACK",
};

function nameForExcel(formule: string): string {
  return formule.replace(
    new RegExp(`(?<![.A-Za-z_])(${Object.keys(NOMS_STOCKES).join("|")})\\(`, "g"),
    (_, name: string) => `${NOMS_STOCKES[name]}(`
  );
}

// Les tables d'appoint lisent l'onglet Interfaces sur une plage déclarée
// d'avance -- une formule à résultat étalé rend toujours la même hauteur. Cette
// plage doit dépasser le nombre d'interfaces écrites, sans quoi les listes
// dépendantes cessent de voir les derniers flux sans rien dire. Le plancher
// laisse de quoi saisir dans un classeur neuf.
const MARGE_LIGNES_LISTES = 1000;
const lastListRow = (nbInterfaces: number) => nbInterfaces + MARGE_LIGNES_LISTES;

// Emplacement des deux tables d'appoint dans l'onglet Listes : après les
// colonnes de vocabulaire, séparées d'elles et l'une de l'autre par une colonne
// vide, pour qu'on distingue à l'œil ce qui se saisit de ce qui se calcule.
function colonnesDAppoint() {
  const base = Object.keys(LISTES).length;
  const col = (i: number) => XLSX.utils.encode_col(base + i);
  return {
    cleVersion: col(1),
    version: col(2),
    ongletFlux: col(4),
    flows: col(5),
    provider: col(7),
    interfaceExposee: col(8),
  };
}

// Les deux tables sont VIVANTES : figées à la génération, elles cesseraient
// d'être justes dès la première interface ajoutée dans Excel. D'où des formules
// à résultat étalé, sur une plage fixe déclarée d'avance -- INDEX + SEQUENCE
// rendent toujours la même hauteur, et IFERROR vide le surplus.
// La formule Excel refait l'assainissement d'assainirNomOnglet à l'identique.
// Elle reconstruit le nom d'onglet pour retrouver les flux qui s'y rattachent :
// raccourci d'un seul côté, ce nom ne désignerait plus rien et les listes
// dépendantes d'un onglet au nom long resteraient vides.
function formuleAssainirOnglet(expression: string): string {
  const sanitised = CARACTERES_INTERDITS_ONGLET.reduce(
    (current, interdit) => `SUBSTITUTE(${current},"${interdit}","${REMPLACEMENT_ONGLET}")`,
    expression
  );
  return `LEFT(${sanitised},${LONGUEUR_MAX_ONGLET})`;
}

function formulesDAppoint(lastRow: number): { cellule: string; ref: string; formule: string }[] {
  const c = colonnesDAppoint();
  const plage = (column: string) => `Interfaces!$${column}$2:$${column}$${lastRow}`;
  const flows = plage(columnOf(COLONNES_INTERFACES, "Flow name"));
  const version = plage(columnOf(COLONNES_INTERFACES, "Version"));
  const provider = plage(columnOf(COLONNES_INTERFACES, "Provider"));
  const type = plage(columnOf(COLONNES_INTERFACES, "Flow type"));
  // L'onglet attendu, reconstruit comme partout ailleurs dans le projet
  // (feuilleFxAttendue, dans parsing/build-model.ts, fait foi).
  const tab = formuleAssainirOnglet(`"${PREFIXE_FEUILLE_FX}"&${provider}&"${SEPARATEUR_FEUILLE_FX}"&${type}`);
  const nonVide = `${flows}<>""`;
  const spread = (table: string) =>
    nameForExcel(`IFERROR(INDEX(${table},SEQUENCE(${lastRow - 1}),{1,2}),"")`);

  return [
    {
      // Clé (onglet|flux) et version, triées par clé : c'est le tri qui rend
      // les versions d'un même flux contiguës, condition de MATCH + COUNTIF.
      cellule: `${c.cleVersion}2`,
      ref: `${c.cleVersion}2:${c.version}${lastRow}`,
      formule: spread(`SORT(FILTER(HSTACK(${tab}&"|"&${flows},${version}),${nonVide}),1,1)`),
    },
    {
      // Couples (onglet, flux) dédoublonnés : sans UNIQUE, un flux à trois
      // versions apparaîtrait trois fois dans la liste déroulante.
      cellule: `${c.ongletFlux}2`,
      ref: `${c.ongletFlux}2:${c.flows}${lastRow}`,
      formule: spread(`SORT(UNIQUE(FILTER(HSTACK(${tab},${flows}),${nonVide})),1,1)`),
    },
    {
      // Couples (exposant, interface versionnée), triés par exposant : c'est ce
      // qui alimente la liste « Republished as » d'un onglet FX_, où l'on ne
      // doit proposer que les interfaces de l'acteur de la ligne. La version
      // est dans le libellé : deux versions d'un même flux sont deux
      // republications possibles, et les confondre reviendrait à deviner.
      cellule: `${c.provider}2`,
      ref: `${c.provider}2:${c.interfaceExposee}${lastRow}`,
      // Le libellé versionné, construit comme libelleInterface : le nom, une
      // espace seulement s'il y a une version, puis la version.
      formule: spread(
        `SORT(UNIQUE(FILTER(HSTACK(${provider},${flows}&IF(${version}="",""," ")&${version}),${nonVide})),1,1)`
      ),
    },
  ];
}

function feuilleListes(lastRow: number): XLSX.WorkSheet {
  const entetes = Object.keys(LISTES);
  const height = Math.max(...entetes.map((e) => LISTES[e].length));
  const rows: string[][] = [entetes];
  for (let i = 0; i < height; i++) {
    rows.push(entetes.map((e) => LISTES[e][i] ?? ""));
  }
  const ws = sheet(rows, entetes.map((e) => Math.max(16, e.length + 4)), false);

  const c = colonnesDAppoint();
  const titles: [string, string][] = [
    [`${c.cleVersion}1`, "CleFluxVersion"],
    [`${c.version}1`, "VersionDuFlux"],
    [`${c.ongletFlux}1`, "OngletDuFlux"],
    [`${c.flows}1`, "FluxDeLOnglet"],
    [`${c.provider}1`, "ActeurExposant"],
    [`${c.interfaceExposee}1`, "InterfaceExposee"],
  ];
  for (const [address, title] of titles) ws[address] = { t: "s", v: title };
  for (const { cellule, ref, formule } of formulesDAppoint(lastRow)) {
    ws[cellule] = { t: "s", v: "", f: formule, F: ref };
  }
  ws["!ref"] = `A1:${c.interfaceExposee}${lastRow}`;
  return ws;
}

// De quoi remplir le classeur. Vide, on obtient le modèle ; garni, le fichier
// d'exemple -- même structure, mêmes tableaux, mêmes listes déroulantes, une
// seule mécanique à maintenir.
export interface DonneesClasseur {
  // Les deux référentiels du classeur. Vides, on retombe sur l'amorce : c'est
  // le cas du modèle vierge. Renseignés, ils sont repris tels quels -- une mise
  // à niveau qui les remplacerait par l'amorce effacerait les types que
  // l'équipe a déclarés, et briserait toutes les interfaces qui s'y réfèrent.
  flowTypes: readonly (readonly string[])[];
  actorTypes: readonly (readonly string[])[];
  milestones: readonly (readonly string[])[];
  groups: readonly (readonly string[])[];
  actors: readonly (readonly string[])[];
  interfaces: readonly (readonly string[])[];
  fx: readonly { name: string; rows: readonly (readonly string[])[] }[];
}

const CLASSEUR_VIDE: DonneesClasseur = { flowTypes: [], actorTypes: [], milestones: [], groups: [], actors: [], interfaces: [], fx: [] };

// Un onglet FX_<exposant>_<type> de plus de 31 caractères, ou portant un
// caractère qu'Excel refuse dans un nom de feuille, ferait échouer l'écriture
// du classeur tout entier -- alors qu'un référentiel réel a des noms
// d'acteur et de technologie longs. On l'écarte plutôt, comme le fait déjà
// donneesDepuisModele() (migration-modele.ts) pour la réparation d'un
// classeur courant : l'interface reste au catalogue, et le contrôle
// d'intégrité, qui sait déjà lire « son onglet FX_ attendu n'existe pas »,
// le signale à la relecture -- ce n'est donc pas un silence.
// Les onglets de consommations, sous le nom qu'Excel accepte. La règle est
// celle de feuilleFxAttendue et elle ne vit qu'à un endroit : l'appliquer aussi
// ici rend l'écriture totale -- avant, un nom trop long était écarté en
// silence, et ses consommations disparaissaient du classeur produit.
function fxTabs(donnees: DonneesClasseur): DonneesClasseur["fx"] {
  return donnees.fx.map((o) => ({ ...o, name: sanitiseTabName(o.name) }));
}

function feuilleGarnie(columns: readonly string[], rows: readonly (readonly string[])[], largeurs: number[]) {
  return sheet([[...columns], ...rows.map((l) => [...l])], largeurs);
}

// Un onglet de consommations : le tableau de saisie, plus la cellule qui le
// nomme, dans une colonne masquée au-delà du tableau.
function feuilleFx(rows: readonly (readonly string[])[], largeurs: number[]): XLSX.WorkSheet {
  const ws = feuilleGarnie(COLONNES_FX, rows, largeurs);
  ws[CELLULE_ONGLET] = { t: "s", v: "", f: FORMULE_NOM_ONGLET };
  ws["!ref"] = `A1:${COLONNE_APPOINT}${Math.max(2, rows.length + 1)}`;
  const cols = (ws["!cols"] ??= []);
  while (cols.length <= COLONNES_FX.length + 1) cols.push({ wch: 10 });
  cols[COLONNES_FX.length + 1] = { hidden: true, wch: 10 };
  return ws;
}

export function buildTemplateWorkbook(donnees: DonneesClasseur = CLASSEUR_VIDE): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const largeursActeurs = COLONNES_ACTEURS.map((c) => Math.max(16, c.length + 4));
  const largeursInterfaces = COLONNES_INTERFACES.map((c) => Math.max(18, c.length + 4));
  const largeursFx = COLONNES_FX.map((c) => Math.max(16, c.length + 4));

  XLSX.utils.book_append_sheet(wb, sheet(MODE_EMPLOI.map((l) => [l.gauche, l.droite]), [26, 104], false), "Instructions");
  XLSX.utils.book_append_sheet(wb, feuilleGarnie(COLONNES_ACTEURS, donnees.actors, largeursActeurs), "Actors");
  XLSX.utils.book_append_sheet(wb, feuilleGarnie(COLONNES_GROUPES, donnees.groups, [24, 16]), "Groups");
  // Visible, et placé tôt : la chronologie de la plateforme se saisit, elle ne
  // se déduit pas, et les deux bornes de validité de toutes les autres
  // feuilles y puisent leur liste.
  XLSX.utils.book_append_sheet(
    wb,
    feuilleGarnie(COLONNES_PALIERS, donnees.milestones, COLONNES_PALIERS.map((c) => Math.max(14, c.length + 4))),
    "Milestones"
  );

  XLSX.utils.book_append_sheet(wb, feuilleTypesActeur(donnees.actorTypes), "ActorTypes");

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [[...COLONNES_TYPESFLUX], ...(donnees.flowTypes.length > 0 ? donnees.flowTypes : TYPES_FLUX).map((t) => [...t])],
      [22, 26, 62]
    ),
    "FlowTypes"
  );
  XLSX.utils.book_append_sheet(wb, feuilleGarnie(COLONNES_INTERFACES, donnees.interfaces, largeursInterfaces), "Interfaces");
  for (const tab of fxTabs(donnees)) {
    XLSX.utils.book_append_sheet(wb, feuilleFx(tab.rows, largeursFx), tab.name);
  }
  XLSX.utils.book_append_sheet(wb, feuilleListes(lastListRow(donnees.interfaces.length)), FEUILLE_LISTES);
  XLSX.utils.book_append_sheet(wb, feuilleVersion(), FEUILLE_VERSION);

  // Listes alimente les listes déroulantes, Version porte la signature du
  // format : ni l'un ni l'autre ne se remplit à la main. Masqués, ils ne se
  // confondent plus avec les onglets de saisie.
  const hidden = new Set([FEUILLE_LISTES, FEUILLE_VERSION]);
  wb.Workbook = { Sheets: wb.SheetNames.map((name) => ({ Hidden: hidden.has(name) ? 1 : 0 })) };

  return wb;
}

// Les feuilles de saisie deviennent de vrais tableaux Excel : la plage suit
// les lignes qu'on ajoute, au lieu de laisser filtres et formats derrière soi.
// La feuille de prose n'en est pas un.
// Un référentiel vide retombe sur son amorce, renseigné il est repris tel quel
// -- règle appliquée par les deux feuilles concernées. Le tableau structuré
// doit compter les MÊMES lignes : dimensionné sur l'amorce, il déborde en
// lignes vides quand l'équipe en a retiré, et laisse hors du tableau les types
// qu'elle a ajoutés, donc hors de la liste déroulante qui le vise.
const writtenRows = (declared: readonly unknown[], amorce: readonly unknown[]) =>
  declared.length > 0 ? declared.length : amorce.length;

export function tableauxDuModele(donnees: DonneesClasseur = CLASSEUR_VIDE): TableToApply[] {
  return [
    { sheet: "Actors", columns: COLONNES_ACTEURS, rows: donnees.actors.length },
    { sheet: "Groups", columns: COLONNES_GROUPES, rows: donnees.groups.length },
    { sheet: "Milestones", columns: COLONNES_PALIERS, rows: donnees.milestones.length },
    {
      sheet: "ActorTypes",
      columns: [...COLONNES_TYPESACTEUR, COLONNE_APERCU_ICONE],
      rows: writtenRows(donnees.actorTypes, ICONES_PAR_DEFAUT),
      // Colonne calculée : Excel la remplit tout seul sur les lignes ajoutées.
      // La formule stockée dans le tableau est celle de la première ligne de
      // données : Excel la décale lui-même sur les lignes suivantes.
      formuleParColonne: { [COLONNE_APERCU_ICONE]: formuleApercu(2) },
    },
    { sheet: "FlowTypes", columns: COLONNES_TYPESFLUX, rows: writtenRows(donnees.flowTypes, TYPES_FLUX) },
    { sheet: "Interfaces", columns: COLONNES_INTERFACES, rows: donnees.interfaces.length },
    ...fxTabs(donnees).map((o) => ({ sheet: o.name, columns: COLONNES_FX, rows: o.rows.length })),
    // Un tableau PAR vocabulaire, dimensionné à son seul contenu -- pas un
    // tableau unique couvrant les huit colonnes, dimensionné sur la plus
    // longue (Icon) : les listes plus courtes se seraient sinon retrouvées
    // rembourrées de lignes vides jusqu'à cette hauteur, visibles dans le menu
    // déroulant et comptées par COUNTA puisque SheetJS y écrit des cellules
    // chaîne vides plutôt que de ne rien écrire.
    ...Object.keys(LISTES).map((key, index) => ({
      sheet: FEUILLE_LISTES,
      columns: [key],
      rows: LISTES[key].length,
      startColumn: index,
    })),
  ];
}

// Colonne de l'onglet Listes portant un vocabulaire donné, calculée depuis
// l'ordre de LISTES : ajouter une entrée ne doit pas décaler silencieusement
// toutes les listes déroulantes.
function colonneDeListe(key: string): string {
  const index = Object.keys(LISTES).indexOf(key);
  if (index < 0) throw new Error(`vocabulaire inconnu : ${key}`);
  return XLSX.utils.encode_col(index);
}

// « Toute référence à un acteur ou à un type passe par une liste déroulante. Ne
// tapez jamais un nom à la main : une variante d'orthographe crée un acteur
// fantôme. » -- la règle du classeur, appliquée par le fichier lui-même.
export function listesDuModele(): NamedList[] {
  return [
    { name: "L_Perimetre", sheet: FEUILLE_LISTES, heading: "Perimeter" },
    { name: "L_Sens", sheet: FEUILLE_LISTES, heading: "Direction" },
    { name: "L_Decision", sheet: FEUILLE_LISTES, heading: "Decision" },
    { name: "L_Criticite", sheet: FEUILLE_LISTES, heading: "Criticality" },
    { name: "L_Confirmation", sheet: FEUILLE_LISTES, heading: "Confirmation" },
    { name: "L_Icone", sheet: FEUILLE_LISTES, heading: "Icon" },
    { name: "L_Nature", sheet: FEUILLE_LISTES, heading: "Nature" },
    // Ces trois-là pointent sur des onglets de saisie : la liste s'enrichit à
    // mesure qu'on remplit le classeur.
    { name: "L_TypeActeur", sheet: "ActorTypes", heading: "Actor type" },
    { name: "L_Acteur", sheet: "Actors", heading: "Name" },
    { name: "L_Groupe", sheet: "Groups", heading: "Group" },
    { name: "L_TypeFlux", sheet: "FlowTypes", heading: "Flow type" },
    { name: "L_Palier", sheet: "Milestones", heading: "Milestone" },
  ];
}

export function columnOf(columns: readonly string[], heading: string): string {
  const index = columns.indexOf(heading);
  if (index < 0) throw new Error(`column "${heading}" absente`);
  return XLSX.utils.encode_col(index);
}

// Les deux listes dépendantes d'un onglet FX_. OFFSET découpe dans la table
// d'appoint le bloc contigu que MATCH localise et que COUNTIF dimensionne --
// MAX(1,...) parce qu'Excel refuse une plage de hauteur nulle.
function formulesDependantes(lastRow: number) {
  const c = colonnesDAppoint();
  const colonneFlux = columnOf(COLONNES_FX, "Flow name");
  const colonneConsommateur = columnOf(COLONNES_FX, "Consumer");
  const block = (key: string, cléCol: string, valeurCol: string) => {
    const keys = `${FEUILLE_LISTES}!$${cléCol}$2:$${cléCol}$${lastRow}`;
    return `OFFSET(${FEUILLE_LISTES}!$${valeurCol}$2,MATCH(${key},${keys},0)-1,0,MAX(1,COUNTIF(${keys},${key})),1)`;
  };
  return {
    // Les flux de CET onglet : la clé est le nom de l'onglet, porté par la
    // cellule d'appoint.
    flows: block(`$${COLONNE_APPOINT}$1`, c.ongletFlux, c.flows),
    // Les versions du flux de CETTE ligne : la référence à la colonne du flux
    // est relative en ligne, Excel décale donc la formule d'une ligne à l'autre.
    version: block(`$${COLONNE_APPOINT}$1&"|"&$${colonneFlux}2`, c.cleVersion, c.version),
    // Les interfaces exposées par le consommateur de CETTE ligne : une
    // republication ne peut désigner qu'une interface de son propre acteur.
    republication: block(`$${colonneConsommateur}2`, c.provider, c.interfaceExposee),
  };
}

// Ce qu'Excel dit à la sélection d'une cellule, colonne par colonne. On ne
// commente que ce que l'en-tête ne dit pas déjà : l'ordre de saisie quand une
// liste dépend d'une autre, et le sens exact d'une valeur quand il se devine
// mal. Excel borne le titre à 32 caractères et le texte à 255.
// Exporté pour que le test puisse vérifier qu'aucune invite ne vise une
// colonne inexistante -- une couverture illusoire est pire qu'un trou connu.
export const INVITES: Record<string, { title: string; text: string }> = {
  "Flow name": { title: "Interface", text: "An interface exposed by this sheet's provider. Declare it on the Interfaces sheet first." },
  // Le défaut d'origine : sans le flux, la source de cette liste vaut #N/A et
  // la liste ne s'ouvre pas. Le comportement est juste, il manquait de le dire.
  Version: { title: "Version", text: "Fill in Flow name first: the versions offered are the ones declared for that interface." },
  // Un même intitulé ne veut pas dire la même chose partout : sur Interfaces,
  // « Version » est la version QU'ON DÉCLARE, pas une à choisir dans une liste.
  // La clé qualifiée par la feuille l'emporte sur la clé nue.
  "Interfaces.Version": {
    title: "Version",
    text:
      "The contract's version, in whatever form your team uses. Free text: it is (provider, flow name, version) that identifies an interface, so two versions of one flow are two lines here.",
  },
  "Criticality for this consumer": { title: "Criticality", text: "How critical this flow is for THIS consumer, not in general. The same interface may be vital to one and secondary to another." },
  Decision: { title: "Decision", text: "What has been decided for this consumption. Remove is a deprecation warning, not a retirement: retirement is the Retired at column." },
  "Introduced at": { title: "Introduced at", text: "A milestone from the Milestones sheet, the one this line appears at. Leave empty if it has always been there." },
  "Retired at": { title: "Retired at", text: "The milestone this line is gone AT: it no longer exists at that milestone. Leave empty if it is still there." },
  "Republished as": {
    title: "Republished as",
    text:
      "Fill in only when the consumer is a technical actor: which of ITS OWN interfaces republishes this flow. Several lines pointing at the same interface is how a bus aggregates.",
  },
  Nature: { title: "Nature", text: "Technical actors are traversed in the functional reading: their actors do not appear, the flows through them are joined end to end." },
  Perimeter: { title: "Perimeter", text: "Platform for what the team owns, External for the rest. This is what decides how the group is drawn." },
  Direction: { title: "Direction", text: "Which way the arrow is drawn for this technology, on every diagram." },
  "To confirm": { title: "To confirm", text: "Yes when the interface is not certain. The report lists these separately so nothing gets asserted by mistake." },

  // --- Colonnes de saisie LIBRE. Aucune liste ne les guide, et elles étaient
  // les seules à ne rien dire -- alors que ce sont celles où l'on hésite.
  Name: { title: "Name", text: "The component's name, as everyone here calls it. It becomes the reference used everywhere else: renaming it later means a find-and-replace across the whole workbook." },
  Group: { title: "Group", text: "The group this component belongs to. The group carries the perimeter — Platform or External — so everything it holds follows." },
  "Actor type": { title: "Actor type", text: "Declared on the ActorTypes sheet, which also gives it its icon and says whether it is business or technical." },
  Owner: { title: "Owner", text: "Who to talk to about this component. Carried through to the exports, never drawn." },
  Description: { title: "Description", text: "One or two lines, drawn inside the box on the diagrams. Longer than about 120 characters and it gets cut on the drawing." },
  Comments: { title: "Comments", text: "Anything worth keeping that has no column of its own. Carried through to the exports, never drawn." },
  Usage: { title: "Usage", text: "What THIS consumer does with the flow. Two consumers of the same interface rarely use it for the same thing." },
  "Contract link": { title: "Contract link", text: "A URL to the contract or its documentation. It becomes a clickable link on the exported diagrams." },
  "Contract reference": { title: "Contract reference", text: "The contract's reference in whatever registry holds it. Free text." },
  Milestone: { title: "Milestone", text: "The name you will use in the Introduced at and Retired at columns everywhere else. Keep it short: it is shown on every diagram." },
  Rank: { title: "Rank", text: "A whole number giving the order of milestones. It is the rank that orders the timeline, not the date." },
  Label: { title: "Label", text: "The milestone's readable name, shown next to it in the tool." },
  Status: { title: "Status", text: "Where this milestone stands. The default milestone shown is the delivered one with the highest rank." },
  Date: { title: "Date", text: "When the milestone happens. Informative: it is Rank that decides the order." },
  Icon: { title: "Icon", text: "The icon drawn inside the box for this type of actor. Pick from the list; Preview shows the result." },
  "Flow type": { title: "Flow type", text: "The technology this interface travels over. Declared on the FlowTypes sheet, which also sets which way the arrow is drawn." },
  Provider: { title: "Provider", text: "The actor that PROVIDES this interface. It is what tells two interfaces of the same name apart, and it decides which FX_ sheet holds the consumptions." },
  Consumer: { title: "Consumer", text: "The actor that consumes this interface. One line per consumer: an interface consumed by four actors has four lines." },
};

// La feuille d'abord, l'intitulé ensuite : un même nom de colonne ne dit pas la
// même chose d'une feuille à l'autre.
function invitePour(sheet: string, heading: string): { title: string; text: string } | undefined {
  return INVITES[`${sheet}.${heading}`] ?? INVITES[heading];
}

export function validationsDuModele(donnees: DonneesClasseur = CLASSEUR_VIDE): ValidationToApply[] {
  const v = (sheet: string, columns: readonly string[], heading: string, formule?: string) => ({
    sheet,
    column: columnOf(columns, heading),
    formule,
    prompt: invitePour(sheet, heading),
  });

  // Toute colonne qu'aucune liste ne guide reçoit quand même son infobulle :
  // c'est la moitié du classeur, et c'était la moitié muette. On part de la
  // LISTE DES COLONNES et non d'une énumération à la main -- une colonne
  // ajoutée demain hérite ainsi du même traitement, ou se signale par son
  // absence d'invite.
  const libres = (sheet: string, columns: readonly string[], guidées: readonly string[]) =>
    columns.filter((c) => !guidées.includes(c) && invitePour(sheet, c)).map((c) => v(sheet, columns, c));
  const dependent = formulesDependantes(lastListRow(donnees.interfaces.length));
  // Les deux bornes de validité se posent partout où l'on date des objets, et
  // toujours de la même façon.
  const bounds = (sheet: string, columns: readonly string[]) =>
    COLONNES_VALIDITE.map((heading) => v(sheet, columns, heading, "L_Palier"));

  const GUIDEES_FX = [
    "Flow name",
    "Version",
    "Consumer",
    "Criticality for this consumer",
    "Decision",
    COLONNE_REPUBLICATION,
    ...COLONNES_VALIDITE,
  ];
  const listesFx = (sheet: string) => [
    v(sheet, COLONNES_FX, "Flow name", dependent.flows),
    v(sheet, COLONNES_FX, "Version", dependent.version),
    v(sheet, COLONNES_FX, "Consumer", "L_Acteur"),
    v(sheet, COLONNES_FX, "Criticality for this consumer", "L_Criticite"),
    v(sheet, COLONNES_FX, "Decision", "L_Decision"),
    v(sheet, COLONNES_FX, COLONNE_REPUBLICATION, dependent.republication),
    ...bounds(sheet, COLONNES_FX),
    ...libres(sheet, COLONNES_FX, GUIDEES_FX),
  ];
  return [
    v("Actors", COLONNES_ACTEURS, "Group", "L_Groupe"),
    v("Actors", COLONNES_ACTEURS, "Actor type", "L_TypeActeur"),
    v("Groups", COLONNES_GROUPES, "Perimeter", "L_Perimetre"),
    v("ActorTypes", COLONNES_TYPESACTEUR, "Icon", "L_Icone"),
    v("ActorTypes", COLONNES_TYPESACTEUR, "Nature", "L_Nature"),
    v("FlowTypes", COLONNES_TYPESFLUX, "Direction", "L_Sens"),
    v("Interfaces", COLONNES_INTERFACES, "Provider", "L_Acteur"),
    v("Interfaces", COLONNES_INTERFACES, "Flow type", "L_TypeFlux"),
    v("Interfaces", COLONNES_INTERFACES, "To confirm", "L_Confirmation"),
    ...bounds("Actors", COLONNES_ACTEURS),
    ...bounds("Interfaces", COLONNES_INTERFACES),
    ...libres("Actors", COLONNES_ACTEURS, ["Group", "Actor type", ...COLONNES_VALIDITE]),
    ...libres("Groups", COLONNES_GROUPES, ["Perimeter"]),
    ...libres("Milestones", COLONNES_PALIERS, []),
    ...libres("ActorTypes", COLONNES_TYPESACTEUR, ["Icon", "Nature"]),
    ...libres("FlowTypes", COLONNES_TYPESFLUX, ["Direction"]),
    ...libres("Interfaces", COLONNES_INTERFACES, ["Provider", "Flow type", "To confirm", ...COLONNES_VALIDITE]),
    // Les onglets de flux garnis reçoivent les mêmes listes que leur patron.
    ...fxTabs(donnees).flatMap((o) => listesFx(o.name)),
  ];
}

// Les feuilles de saisie et leurs colonnes, en un seul endroit : l'en-tête à
// styler, le volet à figer et l'invite à poser s'en déduisent tous les trois.
const FEUILLES_DE_SAISIE: [string, readonly string[]][] = [
  ["Actors", COLONNES_ACTEURS],
  ["Groups", COLONNES_GROUPES],
  ["Milestones", COLONNES_PALIERS],
  ["ActorTypes", COLONNES_TYPESACTEUR],
  ["FlowTypes", COLONNES_TYPESFLUX],
  ["Interfaces", COLONNES_INTERFACES],
];

// La mise en forme de l'onglet d'explication : le rôle de chaque ligne décide
// de son style, et c'est ce qui permet de ne plus couper les phrases à la main.
// Les deux colonnes reçoivent le même style -- une section dont seule la
// gauche serait colorée aurait l'air d'une erreur d'alignement.
export function misesEnFormeDuModele(): StyleToApply[] {
  const byRole = new Map<RowRole, string[]>();
  MODE_EMPLOI.forEach((row, i) => {
    const cellules = byRole.get(row.role) ?? [];
    cellules.push(`A${i + 1}`, `B${i + 1}`);
    byRole.set(row.role, cellules);
  });
  const misesEnForme: StyleToApply[] = [...byRole.entries()].map(([role, cellules]) => ({
    sheet: "Instructions",
    cellules,
    role,
  }));
  // La ligne d'en-tête de chaque feuille de saisie : elle reste à l'écran
  // (volet figé) et doit se distinguer des données qu'elle nomme.
  for (const [name, columns] of FEUILLES_DE_SAISIE) {
    misesEnForme.push({
      sheet: name,
      cellules: columns.map((_, i) => `${XLSX.utils.encode_col(i)}1`),
      role: "header",
    });
  }
  return misesEnForme;
}

export function writeTemplate(donnees: DonneesClasseur = CLASSEUR_VIDE, écritLe: Date = new Date()): ArrayBuffer {
  const workbook = buildTemplateWorkbook(donnees);
  // Les propriétés de document, que l'outil ne posait pas : un classeur qu'il
  // venait de produire se relisait donc SANS date de sauvegarde, et le
  // cartouche de chaque schéma annonçait « save date unknown » sur des données
  // fraîches. Excel remplit ModifiedDate à chaque enregistrement ; nous devons
  // en faire autant, sans quoi c'est l'outil qui a l'air de mal lire.
  //
  // La date est injectée plutôt que lue de l'horloge, pour que l'écriture reste
  // reproductible et testable -- comme la migration le fait déjà.
  workbook.Props = {
    ...workbook.Props,
    Title: "Interface map",
    Application: "Interface Map",
    CreatedDate: écritLe,
    ModifiedDate: écritLe,
  };
  const brut = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const completed = applyOoxmlExtras(brut, {
    tables: tableauxDuModele(donnees),
    lists: listesDuModele(),
    validations: validationsDuModele(donnees),
    misesEnForme: [
      ...misesEnFormeDuModele(),
      // Les onglets de flux garnis portent la même ligne d'en-tête que leur
      // patron : sans cette ligne, seuls les onglets vides l'auraient.
      ...fxTabs(donnees).map((o) => ({
        sheet: o.name,
        cellules: COLONNES_FX.map((_, i) => `${XLSX.utils.encode_col(i)}1`),
        role: "header" as const,
      })),
    ],
    volets: [...FEUILLES_DE_SAISIE.map(([name]) => name), ...fxTabs(donnees).map((o) => o.name)],
  });
  return completed;
}

// Les classeurs générés ne portent plus aucun code : ce sont des .xlsx
// ordinaires. Le VBA a été retiré parce qu'il ne survit pas à la
// synchronisation SharePoint, et rien ne l'a remplacé -- il n'y a plus rien à
// automatiser depuis que l'outil crée lui-même les onglets attendus.
export function downloadTemplateXlsx(filename: string, donneesClasseur?: DonneesClasseur): void {
  const donnees = writeTemplate(donneesClasseur);
  downloadWorkbook(donnees, filename);
}
