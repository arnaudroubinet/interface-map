import * as XLSX from "xlsx";
import { téléchargerClasseur } from "./telechargement";
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
  assainirNomOnglet,
  CARACTERES_INTERDITS_ONGLET,
  REMPLACEMENT_ONGLET,
  LONGUEUR_MAX_ONGLET,
  SEPARATEUR_FEUILLE_FX,
} from "../parsing/build-model";
import { ICONES_DISPONIBLES, APERCU_ICONES } from "../render/icones";
import {
  VOCABULAIRE_DIRECTION,
  VOCABULAIRE_DECISION,
  VOCABULAIRE_CRITICITE,
  VOCABULAIRE_NATURE,
  VOCABULAIRE_PERIMETRE,
} from "../aggregation/vocabulaires";
import {
  poserLesTableaux,
  type TableauÀPoser,
  type ListeNommée,
  type ValidationÀPoser,
} from "./xlsx-tables";

// Valeurs de référence du domaine. Ce sont elles qu'on recopie dans les
// colonnes du classeur ; l'outil ne les impose pas, il les propose.
// Les types d'acteur ne figurent PAS ici : ils sont désormais énumérés par
// l'onglet TypesActeur, qui fait foi. Les avoir aux deux endroits aurait laissé
// deux vérités concurrentes sur la même question.
export const LISTES: Record<string, string[]> = {
  Perimeter: VOCABULAIRE_PERIMETRE,
  Direction: VOCABULAIRE_DIRECTION,
  Decision: VOCABULAIRE_DECISION,
  Criticality: VOCABULAIRE_CRITICITE,
  Confirmation: ["Yes", "No"],
  Nature: VOCABULAIRE_NATURE,
  // Les noms d'icône acceptés, pour que la colonne Icône de TypesActeur se
  // remplisse par recopie plutôt que de mémoire, avec un aperçu en regard.
  Icon: ICONES_DISPONIBLES,
  Preview: ICONES_DISPONIBLES.map((n) => APERCU_ICONES[n] ?? ""),
};

// Correspondance de départ entre type d'acteur et icône. Rien n'y est figé :
// c'est précisément ce que l'onglet TypesActeur sert à changer.
const ICONES_PAR_DEFAUT: [string, string][] = [
  ["Application", "app-window"],
  ["Service", "cog"],
  ["Packaged product", "package"],
  ["Partner", "handshake"],
  ["Person", "user"],
  ["Infrastructure", "server"],
];

// Les technologies courantes, avec le sens dans lequel on les représente. Repris
// du référentiel réel, mais débarrassé de ce qui n'y avait pas sa place : les
// variantes dépôt/retrait (le sens se déduit de qui expose), les composites
// « + ESB » et « + ETL » (ce sont deux liens, pas un), et OIDC-SSO (un flux
// HTTP, pas une technologie).
export const TYPES_FLUX: [string, string, string][] = [
  ["HTTP", "consumer → provider", "Direct HTTP call, REST or SOAP"],
  ["gRPC", "consumer → provider", "Remote procedure call"],
  ["SQL", "consumer → provider", "Direct database access"],
  ["Kafka", "provider → consumer", "Event publication — drawn as a push from the producer"],
  ["JMS", "provider → consumer", "Message queue — drawn as a push from the sender"],
  ["File", "provider → consumer", "File exchange"],
  ["SFTP", "provider → consumer", "File transfer over SSH"],
  ["Object storage (S3)", "consumer → provider", "Read from or write to a bucket"],
  ["LDAP", "consumer → provider", "Directory lookup"],
  ["SMTP", "provider → consumer", "Sending email"],
  ["Syslog", "provider → consumer", "Log shipping to a collector"],
  ["NTP", "consumer → provider", "Time synchronisation"],
  ["Screen entry", "consumer → provider", "Human entry on a screen the provider exposes"],
  ["Screen lookup", "provider → consumer", "Human reading on a screen the provider exposes"],
  ["Manual", "provider → consumer", "Human hand-off, outside any system"],
  ["Proprietary", "consumer → provider", "Protocol specific to a packaged product"],
];


// Deux colonnes : un intitulé court à gauche, le texte à droite. En une seule
// colonne, chaque phrase devenait une ligne de 90 caractères qu'il fallait lire
// en travers de la feuille.
const MODE_EMPLOI: [string, string][] = [
  ["INTERFACE MAP", "How to fill this workbook in."],
  ["", ""],
  ["THE PRINCIPLE", ""],
  ["", "An interface is PROVIDED once by one actor, and CONSUMED by one or more others."],
  ["", "It is described once in Interfaces, and its consumptions are detailed in a"],
  ["", "FX_<provider>_<flow type> sheet. Two actors may publish interfaces of the same"],
  ["", "name: they are two interfaces, told apart by their provider."],
  ["", ""],
  ["THE TWO READINGS", "The same workbook is read in two ways, and you fill it in only once."],
  ["", "ARCHITECTURE answers « what does it go through »: every hop is drawn, buses"],
  ["", "and gateways included."],
  ["", "BUSINESS answers « who feeds whom »: technical actors disappear and the flows"],
  ["", "crossing them are joined end to end."],
  ["", "Two columns carry it. Nature, in ActorTypes, says which types are technical."],
  ["", "Republished as, on the FX_ sheets, is filled on the technical actor's own"],
  ["", "consumption lines: under which of ITS interfaces that input comes back out."],
  ["", "A bus that aggregates writes nothing special — it simply has several lines"],
  ["", "pointing at the same interface. Fill neither column, and the tool never"],
  ["", "mentions the distinction."],
  ["", ""],
  ["THE SHEETS", ""],
  ["Actors", "Who exists, in which group, of which type."],
  ["Groups", "The perimeter is declared HERE, not on each actor: a group is Platform or"],
  ["", "External, and everything it holds follows."],
  ["Milestones", "The platform's timeline. Every row elsewhere says at which milestone it"],
  ["", "arrived, and at which one it left. A row retired AT v3 is already gone at v3."],
  ["ActorTypes", "Which icon each actor type wears — and thereby the list of types that exist."],
  ["", "Nature tells Business from Technical; the Preview column is not typed in."],
  ["FlowTypes", "The technologies, and the direction they are drawn in. Pre-filled with the"],
  ["", "common ones: remove what does not concern you. An optional Colour column,"],
  ["", "a hex code such as #2a78d6, pins a technology's shade; without it the tool"],
  ["", "picks one from its palette."],
  ["Interfaces", "The catalogue: a flow, its provider, its technology, its contract."],
  ["FX_…", "One sheet per (provider, flow type) pair: who consumes what."],
  ["", ""],
  ["HIDDEN SHEETS", "They are not filled in by hand. Right-click a tab > Unhide."],
  ["Lists", "The dictionary feeding the drop-down lists."],
  ["Version", "The model version this workbook follows. Do not edit."],
  ["", ""],
  ["ENTRY RULES", ""],
  ["Drop-down lists", "Reference columns carry them, and they grow by themselves: add an actor and"],
  ["", "it appears at once in Interfaces and in the FX_ sheets. Never type a name by"],
  ["", "hand — a spelling variant creates a phantom actor. Select a cell and its"],
  ["", "prompt says what is expected."],
  ["Flow name", "Unique for one provider, together with its version: that pair links the"],
  ["", "catalogue to the detail."],
  ["Version", "On an FX_ sheet, fill Flow name in first: the versions offered are the ones"],
  ["", "declared for that interface."],
  ["Republished as", "Only on a technical actor's own consumption lines: which of its interfaces"],
  ["", "republishes this input. A drop-down offers that actor's interfaces and no"],
  ["", "others — the line already says which provider and which version came in."],
  ["Decision", "What has been decided for one consumption. Remove is a DEPRECATION warning,"],
  ["", "not a retirement: retirement is the Retired at column, and only that column"],
  ["", "takes the row off the diagrams."],
  ["Obsolete row", "Do not delete it: give it a retirement milestone."],
  ["Renaming an actor", "Breaks every reference to it. Find and replace across the whole workbook,"],
  ["", "or not at all."],
  ["", ""],
  ["MISSING FX_ SHEETS", ""],
  ["", "Fill Interfaces in first: each row calls for an FX_<provider>_<type> sheet."],
  ["", "Create it by hand, or drop this workbook on the tool and use « Repair or"],
  ["", "upgrade a workbook » — it returns the file with every expected sheet."],
  ["", "Excel caps a tab name at 31 characters and refuses \\ / ? * [ ] : a long"],
  ["", "provider therefore gets a shortened tab. The tool cuts it the same way, so"],
  ["", "the two always agree; it warns if two pairs land on the same tab."],
  ["", ""],
  ["", "The visualisation tool only READS: it never modifies this workbook."],
  ["", ""],
  ["ARROW DIRECTION", ""],
  ["", "Nothing to type in: two things are drawn, and both follow from the flow type."],
  ["", "The LINE follows the data, always provider towards consumer: it leaves the"],
  ["", "provider and reaches the consumer, so a chain of relays reads like a pipe."],
  ["", "The ARROWHEAD says who takes the initiative. On a push — Kafka, JMS, a file"],
  ["", "drop — it sits at the far end. On a pull — HTTP, SQL, LDAP — it sits at the"],
  ["", "near end, pointing back at the provider being queried."],
  ["", "The business reading keeps the line and drops the arrowhead's nuance: a"],
  ["", "chain crosses technologies of opposite conventions, and only the data"],
  ["", "direction survives that."],
];


function feuille(lignes: (string | number)[][], largeurs: number[], filtrable = true): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(lignes);
  ws["!cols"] = largeurs.map((wch) => ({ wch }));
  // L'autofiltre engendre un nom défini « _xlnm._FilterDatabase » qui cite le
  // nom de la feuille entre apostrophes. SheetJS ne double PAS l'apostrophe
  // interne de « Mode d'emploi », ce qui produit un nom défini malformé --
  // Excel ouvre alors sur une demande de réparation, là où SheetJS relit son
  // propre fichier sans rien voir. Une feuille de prose n'a de toute façon rien
  // à filtrer.
  if (filtrable && lignes.length > 0) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: lignes[0].length - 1 } }),
    };
  }
  return ws;
}

// Une feuille de saisie : sa ligne d'en-tête, et rien d'autre. Les largeurs
// suivent la longueur du titre, faute de données pour les calibrer.
function feuilleVide(colonnes: readonly string[]): XLSX.WorkSheet {
  return feuille([[...colonnes]], colonnes.map((c) => Math.max(14, c.length + 4)));
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

export function formuleApercu(ligne: number): string {
  const icone = colonneDeListe("Icon");
  const aperçu = colonneDeListe("Preview");
  return `IFERROR(INDEX(${FEUILLE_LISTES}!$${aperçu}:$${aperçu},MATCH(B${ligne},${FEUILLE_LISTES}!$${icone}:$${icone},0)),"")`;
}

// Seul onglet pré-rempli : sans lui, tous les acteurs porteraient le jeton
// neutre et un contrôle d'intégrité s'allumerait sur un classeur neuf.
function feuilleTypesActeur(déclarés: readonly (readonly string[])[]): XLSX.WorkSheet {
  const lignes = déclarés.length > 0 ? déclarés.map((l) => [...l]) : ICONES_PAR_DEFAUT.map(([t, i]) => [t, i]);
  const entêtes = [...COLONNES_TYPESACTEUR, COLONNE_APERCU_ICONE];
  // La colonne Aperçu suit COLONNES_TYPESACTEUR au lieu d'une lettre écrite en
  // dur : l'ajout de "Nature" l'a décalée de C à D, et une lettre figée
  // aurait écrasé la colonne voisine au lieu de la formule attendue.
  const colonneApercu = XLSX.utils.encode_col(COLONNES_TYPESACTEUR.length);
  const ws = feuille([entêtes, ...lignes], [22, 18, 14, 12]);
  lignes.forEach(([, icone], rang) => {
    // La valeur en cache est celle qu'Excel recalculera de toute façon : elle
    // sert à ce que l'aperçu s'affiche juste dès l'ouverture, avant le premier
    // recalcul.
    ws[`${colonneApercu}${rang + 2}`] = { t: "str", f: formuleApercu(rang + 2), v: APERCU_ICONES[icone] ?? "" };
  });
  ws["!ref"] = `A1:${colonneApercu}${lignes.length + 1}`;
  return ws;
}

// Le numéro de schéma du classeur, dans un onglet à lui. Une seule valeur, sur
// une feuille masquée : ce n'est pas une donnée à saisir, c'est la signature du
// format, celle qui dit à l'outil s'il sait lire ce fichier tel quel.
function feuilleVersion(): XLSX.WorkSheet {
  return feuille([[COLONNE_VERSION_MODELE], [VERSION_MODELE]], [20], false);
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

function nommerPourExcel(formule: string): string {
  return formule.replace(
    new RegExp(`(?<![.A-Za-z_])(${Object.keys(NOMS_STOCKES).join("|")})\\(`, "g"),
    (_, nom: string) => `${NOMS_STOCKES[nom]}(`
  );
}

// Les tables d'appoint lisent l'onglet Interfaces sur une plage déclarée
// d'avance -- une formule à résultat étalé rend toujours la même hauteur. Cette
// plage doit dépasser le nombre d'interfaces écrites, sans quoi les listes
// dépendantes cessent de voir les derniers flux sans rien dire. Le plancher
// laisse de quoi saisir dans un classeur neuf.
const MARGE_LIGNES_LISTES = 1000;
const dernièreLigneListes = (nbInterfaces: number) => nbInterfaces + MARGE_LIGNES_LISTES;

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
    flux: col(5),
    exposant: col(7),
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
  const assaini = CARACTERES_INTERDITS_ONGLET.reduce(
    (courant, interdit) => `SUBSTITUTE(${courant},"${interdit}","${REMPLACEMENT_ONGLET}")`,
    expression
  );
  return `LEFT(${assaini},${LONGUEUR_MAX_ONGLET})`;
}

function formulesDAppoint(dernièreLigne: number): { cellule: string; ref: string; formule: string }[] {
  const c = colonnesDAppoint();
  const plage = (colonne: string) => `Interfaces!$${colonne}$2:$${colonne}$${dernièreLigne}`;
  const flux = plage(colonneDe(COLONNES_INTERFACES, "Flow name"));
  const version = plage(colonneDe(COLONNES_INTERFACES, "Version"));
  const exposant = plage(colonneDe(COLONNES_INTERFACES, "Provider"));
  const type = plage(colonneDe(COLONNES_INTERFACES, "Flow type"));
  // L'onglet attendu, reconstruit comme partout ailleurs dans le projet
  // (feuilleFxAttendue, dans parsing/build-model.ts, fait foi).
  const onglet = formuleAssainirOnglet(`"${PREFIXE_FEUILLE_FX}"&${exposant}&"${SEPARATEUR_FEUILLE_FX}"&${type}`);
  const nonVide = `${flux}<>""`;
  const étalée = (tableau: string) =>
    nommerPourExcel(`IFERROR(INDEX(${tableau},SEQUENCE(${dernièreLigne - 1}),{1,2}),"")`);

  return [
    {
      // Clé (onglet|flux) et version, triées par clé : c'est le tri qui rend
      // les versions d'un même flux contiguës, condition de MATCH + COUNTIF.
      cellule: `${c.cleVersion}2`,
      ref: `${c.cleVersion}2:${c.version}${dernièreLigne}`,
      formule: étalée(`SORT(FILTER(HSTACK(${onglet}&"|"&${flux},${version}),${nonVide}),1,1)`),
    },
    {
      // Couples (onglet, flux) dédoublonnés : sans UNIQUE, un flux à trois
      // versions apparaîtrait trois fois dans la liste déroulante.
      cellule: `${c.ongletFlux}2`,
      ref: `${c.ongletFlux}2:${c.flux}${dernièreLigne}`,
      formule: étalée(`SORT(UNIQUE(FILTER(HSTACK(${onglet},${flux}),${nonVide})),1,1)`),
    },
    {
      // Couples (exposant, interface versionnée), triés par exposant : c'est ce
      // qui alimente la liste « Republished as » d'un onglet FX_, où l'on ne
      // doit proposer que les interfaces de l'acteur de la ligne. La version
      // est dans le libellé : deux versions d'un même flux sont deux
      // republications possibles, et les confondre reviendrait à deviner.
      cellule: `${c.exposant}2`,
      ref: `${c.exposant}2:${c.interfaceExposee}${dernièreLigne}`,
      // Le libellé versionné, construit comme libelleInterface : le nom, une
      // espace seulement s'il y a une version, puis la version.
      formule: étalée(
        `SORT(UNIQUE(FILTER(HSTACK(${exposant},${flux}&IF(${version}="",""," ")&${version}),${nonVide})),1,1)`
      ),
    },
  ];
}

function feuilleListes(dernièreLigne: number): XLSX.WorkSheet {
  const entetes = Object.keys(LISTES);
  const hauteur = Math.max(...entetes.map((e) => LISTES[e].length));
  const lignes: string[][] = [entetes];
  for (let i = 0; i < hauteur; i++) {
    lignes.push(entetes.map((e) => LISTES[e][i] ?? ""));
  }
  const ws = feuille(lignes, entetes.map((e) => Math.max(16, e.length + 4)), false);

  const c = colonnesDAppoint();
  const titres: [string, string][] = [
    [`${c.cleVersion}1`, "CleFluxVersion"],
    [`${c.version}1`, "VersionDuFlux"],
    [`${c.ongletFlux}1`, "OngletDuFlux"],
    [`${c.flux}1`, "FluxDeLOnglet"],
    [`${c.exposant}1`, "ActeurExposant"],
    [`${c.interfaceExposee}1`, "InterfaceExposee"],
  ];
  for (const [adresse, titre] of titres) ws[adresse] = { t: "s", v: titre };
  for (const { cellule, ref, formule } of formulesDAppoint(dernièreLigne)) {
    ws[cellule] = { t: "s", v: "", f: formule, F: ref };
  }
  ws["!ref"] = `A1:${c.interfaceExposee}${dernièreLigne}`;
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
  typesFlux: readonly (readonly string[])[];
  typesActeur: readonly (readonly string[])[];
  paliers: readonly (readonly string[])[];
  groupes: readonly (readonly string[])[];
  acteurs: readonly (readonly string[])[];
  interfaces: readonly (readonly string[])[];
  fx: readonly { nom: string; lignes: readonly (readonly string[])[] }[];
}

const CLASSEUR_VIDE: DonneesClasseur = { typesFlux: [], typesActeur: [], paliers: [], groupes: [], acteurs: [], interfaces: [], fx: [] };

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
function ongletsFx(donnees: DonneesClasseur): DonneesClasseur["fx"] {
  return donnees.fx.map((o) => ({ ...o, nom: assainirNomOnglet(o.nom) }));
}

function feuilleGarnie(colonnes: readonly string[], lignes: readonly (readonly string[])[], largeurs: number[]) {
  return feuille([[...colonnes], ...lignes.map((l) => [...l])], largeurs);
}

// Un onglet de consommations : le tableau de saisie, plus la cellule qui le
// nomme, dans une colonne masquée au-delà du tableau.
function feuilleFx(lignes: readonly (readonly string[])[], largeurs: number[]): XLSX.WorkSheet {
  const ws = feuilleGarnie(COLONNES_FX, lignes, largeurs);
  ws[CELLULE_ONGLET] = { t: "s", v: "", f: FORMULE_NOM_ONGLET };
  ws["!ref"] = `A1:${COLONNE_APPOINT}${Math.max(2, lignes.length + 1)}`;
  const cols = (ws["!cols"] ??= []);
  while (cols.length <= COLONNES_FX.length + 1) cols.push({ wch: 10 });
  cols[COLONNES_FX.length + 1] = { hidden: true, wch: 10 };
  return ws;
}

export function construireClasseurModele(donnees: DonneesClasseur = CLASSEUR_VIDE): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const largeursActeurs = COLONNES_ACTEURS.map((c) => Math.max(16, c.length + 4));
  const largeursInterfaces = COLONNES_INTERFACES.map((c) => Math.max(18, c.length + 4));
  const largeursFx = COLONNES_FX.map((c) => Math.max(16, c.length + 4));

  XLSX.utils.book_append_sheet(wb, feuille(MODE_EMPLOI.map((l) => [...l]), [22, 96], false), "Instructions");
  XLSX.utils.book_append_sheet(wb, feuilleGarnie(COLONNES_ACTEURS, donnees.acteurs, largeursActeurs), "Actors");
  XLSX.utils.book_append_sheet(wb, feuilleGarnie(COLONNES_GROUPES, donnees.groupes, [24, 16]), "Groups");
  // Visible, et placé tôt : la chronologie de la plateforme se saisit, elle ne
  // se déduit pas, et les deux bornes de validité de toutes les autres
  // feuilles y puisent leur liste.
  XLSX.utils.book_append_sheet(
    wb,
    feuilleGarnie(COLONNES_PALIERS, donnees.paliers, COLONNES_PALIERS.map((c) => Math.max(14, c.length + 4))),
    "Milestones"
  );

  XLSX.utils.book_append_sheet(wb, feuilleTypesActeur(donnees.typesActeur), "ActorTypes");

  XLSX.utils.book_append_sheet(
    wb,
    feuille(
      [[...COLONNES_TYPESFLUX], ...(donnees.typesFlux.length > 0 ? donnees.typesFlux : TYPES_FLUX).map((t) => [...t])],
      [22, 26, 62]
    ),
    "FlowTypes"
  );
  XLSX.utils.book_append_sheet(wb, feuilleGarnie(COLONNES_INTERFACES, donnees.interfaces, largeursInterfaces), "Interfaces");
  for (const onglet of ongletsFx(donnees)) {
    XLSX.utils.book_append_sheet(wb, feuilleFx(onglet.lignes, largeursFx), onglet.nom);
  }
  XLSX.utils.book_append_sheet(wb, feuilleListes(dernièreLigneListes(donnees.interfaces.length)), FEUILLE_LISTES);
  XLSX.utils.book_append_sheet(wb, feuilleVersion(), FEUILLE_VERSION);

  // Listes alimente les listes déroulantes, Version porte la signature du
  // format : ni l'un ni l'autre ne se remplit à la main. Masqués, ils ne se
  // confondent plus avec les onglets de saisie.
  const masquées = new Set([FEUILLE_LISTES, FEUILLE_VERSION]);
  wb.Workbook = { Sheets: wb.SheetNames.map((nom) => ({ Hidden: masquées.has(nom) ? 1 : 0 })) };

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
const lignesÉcrites = (déclarés: readonly unknown[], amorce: readonly unknown[]) =>
  déclarés.length > 0 ? déclarés.length : amorce.length;

export function tableauxDuModele(donnees: DonneesClasseur = CLASSEUR_VIDE): TableauÀPoser[] {
  return [
    { feuille: "Actors", colonnes: COLONNES_ACTEURS, lignes: donnees.acteurs.length },
    { feuille: "Groups", colonnes: COLONNES_GROUPES, lignes: donnees.groupes.length },
    { feuille: "Milestones", colonnes: COLONNES_PALIERS, lignes: donnees.paliers.length },
    {
      feuille: "ActorTypes",
      colonnes: [...COLONNES_TYPESACTEUR, COLONNE_APERCU_ICONE],
      lignes: lignesÉcrites(donnees.typesActeur, ICONES_PAR_DEFAUT),
      // Colonne calculée : Excel la remplit tout seul sur les lignes ajoutées.
      // La formule stockée dans le tableau est celle de la première ligne de
      // données : Excel la décale lui-même sur les lignes suivantes.
      formuleParColonne: { [COLONNE_APERCU_ICONE]: formuleApercu(2) },
    },
    { feuille: "FlowTypes", colonnes: COLONNES_TYPESFLUX, lignes: lignesÉcrites(donnees.typesFlux, TYPES_FLUX) },
    { feuille: "Interfaces", colonnes: COLONNES_INTERFACES, lignes: donnees.interfaces.length },
    ...ongletsFx(donnees).map((o) => ({ feuille: o.nom, colonnes: COLONNES_FX, lignes: o.lignes.length })),
    // Un tableau PAR vocabulaire, dimensionné à son seul contenu -- pas un
    // tableau unique couvrant les huit colonnes, dimensionné sur la plus
    // longue (Icon) : les listes plus courtes se seraient sinon retrouvées
    // rembourrées de lignes vides jusqu'à cette hauteur, visibles dans le menu
    // déroulant et comptées par COUNTA puisque SheetJS y écrit des cellules
    // chaîne vides plutôt que de ne rien écrire.
    ...Object.keys(LISTES).map((clé, index) => ({
      feuille: FEUILLE_LISTES,
      colonnes: [clé],
      lignes: LISTES[clé].length,
      colonneDépart: index,
    })),
  ];
}

// Colonne de l'onglet Listes portant un vocabulaire donné, calculée depuis
// l'ordre de LISTES : ajouter une entrée ne doit pas décaler silencieusement
// toutes les listes déroulantes.
function colonneDeListe(clé: string): string {
  const index = Object.keys(LISTES).indexOf(clé);
  if (index < 0) throw new Error(`vocabulaire inconnu : ${clé}`);
  return XLSX.utils.encode_col(index);
}

// « Toute référence à un acteur ou à un type passe par une liste déroulante. Ne
// tapez jamais un nom à la main : une variante d'orthographe crée un acteur
// fantôme. » -- la règle du classeur, appliquée par le fichier lui-même.
export function listesDuModele(): ListeNommée[] {
  return [
    { nom: "L_Perimetre", feuille: FEUILLE_LISTES, intitulé: "Perimeter" },
    { nom: "L_Sens", feuille: FEUILLE_LISTES, intitulé: "Direction" },
    { nom: "L_Decision", feuille: FEUILLE_LISTES, intitulé: "Decision" },
    { nom: "L_Criticite", feuille: FEUILLE_LISTES, intitulé: "Criticality" },
    { nom: "L_Confirmation", feuille: FEUILLE_LISTES, intitulé: "Confirmation" },
    { nom: "L_Icone", feuille: FEUILLE_LISTES, intitulé: "Icon" },
    { nom: "L_Nature", feuille: FEUILLE_LISTES, intitulé: "Nature" },
    // Ces trois-là pointent sur des onglets de saisie : la liste s'enrichit à
    // mesure qu'on remplit le classeur.
    { nom: "L_TypeActeur", feuille: "ActorTypes", intitulé: "Actor type" },
    { nom: "L_Acteur", feuille: "Actors", intitulé: "Name" },
    { nom: "L_Groupe", feuille: "Groups", intitulé: "Group" },
    { nom: "L_TypeFlux", feuille: "FlowTypes", intitulé: "Flow type" },
    { nom: "L_Palier", feuille: "Milestones", intitulé: "Milestone" },
  ];
}

export function colonneDe(colonnes: readonly string[], intitulé: string): string {
  const index = colonnes.indexOf(intitulé);
  if (index < 0) throw new Error(`colonne "${intitulé}" absente`);
  return XLSX.utils.encode_col(index);
}

// Les deux listes dépendantes d'un onglet FX_. OFFSET découpe dans la table
// d'appoint le bloc contigu que MATCH localise et que COUNTIF dimensionne --
// MAX(1,...) parce qu'Excel refuse une plage de hauteur nulle.
function formulesDependantes(dernièreLigne: number) {
  const c = colonnesDAppoint();
  const colonneFlux = colonneDe(COLONNES_FX, "Flow name");
  const colonneConsommateur = colonneDe(COLONNES_FX, "Consumer");
  const bloc = (clé: string, cléCol: string, valeurCol: string) => {
    const clés = `${FEUILLE_LISTES}!$${cléCol}$2:$${cléCol}$${dernièreLigne}`;
    return `OFFSET(${FEUILLE_LISTES}!$${valeurCol}$2,MATCH(${clé},${clés},0)-1,0,MAX(1,COUNTIF(${clés},${clé})),1)`;
  };
  return {
    // Les flux de CET onglet : la clé est le nom de l'onglet, porté par la
    // cellule d'appoint.
    flux: bloc(`$${COLONNE_APPOINT}$1`, c.ongletFlux, c.flux),
    // Les versions du flux de CETTE ligne : la référence à la colonne du flux
    // est relative en ligne, Excel décale donc la formule d'une ligne à l'autre.
    version: bloc(`$${COLONNE_APPOINT}$1&"|"&$${colonneFlux}2`, c.cleVersion, c.version),
    // Les interfaces exposées par le consommateur de CETTE ligne : une
    // republication ne peut désigner qu'une interface de son propre acteur.
    republication: bloc(`$${colonneConsommateur}2`, c.exposant, c.interfaceExposee),
  };
}

// Ce qu'Excel dit à la sélection d'une cellule, colonne par colonne. On ne
// commente que ce que l'en-tête ne dit pas déjà : l'ordre de saisie quand une
// liste dépend d'une autre, et le sens exact d'une valeur quand il se devine
// mal. Excel borne le titre à 32 caractères et le texte à 255.
const INVITES: Record<string, { titre: string; texte: string }> = {
  "Flow name": { titre: "Interface", texte: "An interface exposed by this sheet's provider. Declare it on the Interfaces sheet first." },
  // Le défaut d'origine : sans le flux, la source de cette liste vaut #N/A et
  // la liste ne s'ouvre pas. Le comportement est juste, il manquait de le dire.
  Version: { titre: "Version", texte: "Fill in Flow name first: the versions offered are the ones declared for that interface." },
  "Criticality for this consumer": { titre: "Criticality", texte: "How critical this flow is for THIS consumer, not in general. The same interface may be vital to one and secondary to another." },
  Decision: { titre: "Decision", texte: "What has been decided for this consumption. Remove is a deprecation warning, not a retirement: retirement is the Retired at column." },
  "Introduced at": { titre: "Introduced at", texte: "A milestone from the Milestones sheet, the one this line appears at. Leave empty if it has always been there." },
  "Retired at": { titre: "Retired at", texte: "The milestone this line is gone AT: it no longer exists at that milestone. Leave empty if it is still there." },
  "Republished as": {
    titre: "Republished as",
    texte:
      "Fill in only when the consumer is a technical actor: which of ITS OWN interfaces republishes this flow. Several lines pointing at the same interface is how a bus aggregates.",
  },
  Nature: { titre: "Nature", texte: "Technical actors are traversed in the functional reading: their actors do not appear, the flows through them are joined end to end." },
  Perimeter: { titre: "Perimeter", texte: "Platform for what the team owns, External for the rest. This is what decides how the group is drawn." },
  Direction: { titre: "Direction", texte: "Which way the arrow is drawn for this technology, on every diagram." },
  "To confirm": { titre: "To confirm", texte: "Yes when the interface is not certain. The report lists these separately so nothing gets asserted by mistake." },
};

export function validationsDuModele(donnees: DonneesClasseur = CLASSEUR_VIDE): ValidationÀPoser[] {
  const v = (feuille: string, colonnes: readonly string[], intitulé: string, formule: string) => ({
    feuille,
    colonne: colonneDe(colonnes, intitulé),
    formule,
    invite: INVITES[intitulé],
  });
  const dépendantes = formulesDependantes(dernièreLigneListes(donnees.interfaces.length));
  // Les deux bornes de validité se posent partout où l'on date des objets, et
  // toujours de la même façon.
  const bornes = (feuille: string, colonnes: readonly string[]) =>
    COLONNES_VALIDITE.map((intitulé) => v(feuille, colonnes, intitulé, "L_Palier"));

  const listesFx = (feuille: string) => [
    v(feuille, COLONNES_FX, "Flow name", dépendantes.flux),
    v(feuille, COLONNES_FX, "Version", dépendantes.version),
    v(feuille, COLONNES_FX, "Consumer", "L_Acteur"),
    v(feuille, COLONNES_FX, "Criticality for this consumer", "L_Criticite"),
    v(feuille, COLONNES_FX, "Decision", "L_Decision"),
    v(feuille, COLONNES_FX, COLONNE_REPUBLICATION, dépendantes.republication),
    ...bornes(feuille, COLONNES_FX),
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
    ...bornes("Actors", COLONNES_ACTEURS),
    ...bornes("Interfaces", COLONNES_INTERFACES),
    // Les onglets de flux garnis reçoivent les mêmes listes que leur patron.
    ...ongletsFx(donnees).flatMap((o) => listesFx(o.nom)),
  ];
}

export function écrireModele(donnees: DonneesClasseur = CLASSEUR_VIDE): ArrayBuffer {
  const brut = XLSX.write(construireClasseurModele(donnees), { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const complété = poserLesTableaux(brut, {
    tableaux: tableauxDuModele(donnees),
    listes: listesDuModele(),
    validations: validationsDuModele(donnees),
  });
  return complété;
}

// Les classeurs générés ne portent plus aucun code : ce sont des .xlsx
// ordinaires. Le VBA a été retiré parce qu'il ne survit pas à la
// synchronisation SharePoint, et rien ne l'a remplacé -- il n'y a plus rien à
// automatiser depuis que l'outil crée lui-même les onglets attendus.
export function downloadTemplateXlsx(filename: string, donneesClasseur?: DonneesClasseur): void {
  const donnees = écrireModele(donneesClasseur);
  téléchargerClasseur(donnees, filename);
}
