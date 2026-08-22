export interface RawSheet {
  name: string;
  // En-têtes lus depuis la ligne 1 de la feuille elle-même, pas déduits de
  // `rows` : une feuille présente mais sans ligne de données (les onglets
  // FX_ créés vides par l'outil) aurait sinon 0 colonne connue
  // et déclencherait de fausses anomalies "colonne absente" sur chacune.
  headers: string[];
  rows: RawRow[];
}

// Une ligne de feuille, avec son numéro tel qu'Excel l'affiche. Le numéro sert
// au rapport d'intégrité, qui cite l'emplacement pour qu'on aille corriger :
// l'indice du tableau ne conviendrait pas, une ligne vide intercalée le
// décalant de la réalité.
export interface RawRow {
  row: number;
  values: Record<string, string>;
}

export interface ParsedWorkbook {
  sheets: RawSheet[];
  fichierModifie: Date | null;
}

// D'où vient une ligne du classeur. C'est une donnée de provenance, pas une
// donnée métier : elle ne décrit pas ce que la ligne contient, elle dit où la
// retrouver pour la corriger. Le rapport d'intégrité la cite.
export interface Emplacement {
  sheet: string;
  row: number;
}

// Les deux bornes de validité d'une ligne sur l'axe des paliers. Ce sont des
// PALIERS, jamais des dates : la date est portée par le palier lui-même, dans
// l'onglet Paliers. Une ligne ne sait pas quand elle est arrivée, elle sait à
// quel jalon. Vides, elles
// gardent le sens habituel du projet : « depuis toujours » et « toujours là »,
// donc un classeur qui ne déclare aucun palier se lit exactement comme avant.
export interface ValiditePalier {
  introducedAt: string;
  retiredAt: string;
}

export interface Actor extends ValiditePalier, Emplacement {
  name: string;
  group: string;
  typeActeur: string;
  responsable: string;
  description: string;
  commentaires: string;
}

// Le périmètre est porté par le GROUPE, pas par l'acteur : « Socle » est la
// plateforme, et tout ce qu'il contient en fait partie. Marquer chaque
// application une par une laissait un groupe mixte -- moitié plateforme,
// moitié externe -- dont ni la couleur ni le décompte ne pouvaient être justes.
export interface Groupe extends Emplacement {
  name: string;
  perimeter: string;
}

// Un jalon de la plateforme. À ne jamais confondre avec la version d'un
// contrat d'interface ni avec le numéro de schéma du classeur : trois notions
// distinctes que le mot « version » recouvrirait toutes les trois.
export interface Milestone extends Emplacement {
  name: string;
  // Porte l'ordre. Une colonne et non l'ordre des lignes : un tri dans Excel
  // détruirait un ordre implicite sans rien dire.
  rank: number;
  label: string;
  statut: string;
  date: string;
  description: string;
}

// Le type d'acteur est une liste ouverte, propre à chaque référentiel : c'est
// le classeur qui dit quelle icône lui donner, pas le code.
export interface TypeActeur extends Emplacement {
  type: string;
  icone: string;
  // Métier ou technique. C'est le TYPE qui tranche, jamais l'acteur : même
  // principe que le périmètre, déclaré sur le groupe et non sur ses membres.
  // Vide vaut métier -- un classeur qui n'a pas rempli la colonne montre tout,
  // plutôt que de masquer des acteurs en silence.
  nature: string;
}

export interface TypeFlux extends Emplacement {
  type: string;
  sensRepresentation: "provider-to-consumer" | "consumer-to-provider";
  // La valeur telle que saisie. sensRepresentation la normalise en retombant
  // sur « consommateur → exposant » pour tout ce qu'elle ne reconnaît pas :
  // sans la valeur d'origine, une saisie fautive inverserait la flèche sans
  // que rien ne puisse le signaler.
  sensRepresentationBrut: string;
  description: string;
  // La couleur du référentiel, en hexadécimal, quand il en porte une. Vide
  // sinon : la palette prend alors le relais. C'est ce qui ancre la teinte à la
  // technologie plutôt qu'à son rang, lequel changeait dès qu'on ajoutait une
  // technologie avant les autres dans l'alphabet.
  colour: string;
}

export interface InterfaceCatalogue extends ValiditePalier, Emplacement {
  flowName: string;
  // Une version vide est une version, pas une absence : elle participe à la
  // clé de rattachement au même titre qu'une autre valeur, et c'est ce qui
  // laisse les classeurs antérieurs se lire à l'identique.
  version: string;
  // Hérité de la v1 : l'axe des paliers l'a remplacé. Lu uniquement pour que
  // la mise à niveau sache quoi convertir, jamais réécrit.
  etat: string;
  providerName: string;
  flowType: string;
  description: string;
  lienContrat: string;
  referenceContrat: string;
  commentaires: string;
  aConfirmer: boolean;
  expectedSheet: string;
  // Le nom de flux de l'interface que celle-ci prolonge. Rempli sur les seules
  // interfaces exposées par un acteur technique : c'est lui qui permet de
  // suivre un échange à travers la plomberie, alors même que son nom change
  // d'un segment à l'autre.
  relais: string;
}

export interface Consommation extends ValiditePalier, Emplacement {
  flowName: string;
  // La version consommée, telle qu'écrite au catalogue : c'est le troisième
  // terme de la clé de rattachement à l'interface.
  version: string;
  consumerName: string;
  usage: string;
  criticality: string;
  // Hérité de la v1, comme InterfaceCatalogue.etat.
  statut: string;
  decision: string;
  commentaires: string;
  // Renseigné seulement quand le consommateur est un acteur technique : le nom
  // de CELLE DE SES interfaces qui republie ce flux. C'est ce qui rabat une
  // chaîne en lecture fonctionnelle, et c'est porté par la consommation parce
  // que c'est elle qui désigne le fournisseur et la version d'origine.
  republishedAs: string;
  sheet: string;
}

export interface ParsedModel {
  actors: Actor[];
  groups: Groupe[];
  typesActeur: TypeActeur[];
  // Vrai quand l'onglet « Groupes » manque. Aucun périmètre n'est alors connu :
  // on ne le devine pas, un contrôle d'intégrité réclame l'onglet.
  groupesAbsents: boolean;
  flowTypes: TypeFlux[];
  // Déclarés par l'onglet Paliers, triés par rang. Vide quand l'onglet manque.
  milestones: Milestone[];
  interfaces: InterfaceCatalogue[];
  consumptions: Consommation[];
  fxSheetNames: string[];
  colonnesOptionnellesAbsentes: { sheet: string; column: string }[];
  // Numéro de schéma du classeur : 0 pour tout classeur antérieur à son
  // introduction. Décide si l'outil sait lire ce fichier tel quel.
  versionModele: number;
  fichierModifie: Date | null;
}

export interface BlockingError {
  message: string;
}

export type BuildModelResult =
  | { ok: true; model: ParsedModel }
  | { ok: false; erreurs: BlockingError[] };
