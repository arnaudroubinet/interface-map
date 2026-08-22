import * as XLSX from "xlsx";

// SheetJS n'écrit pas les tableaux structurés d'Excel : dans son writer,
// « tableParts » n'est qu'un commentaire. Mais il expose CFB, qui sait relire
// le paquet .xlsx comme un zip, y ajouter des entrées et le réécrire. On
// complète donc le fichier après coup, sans dépendance supplémentaire.
//
// Un vrai tableau apporte ce qu'un simple autofiltre ne donne pas : la plage
// s'étend d'elle-même quand on ajoute une ligne (les formats, les validations
// et les formules suivent), les lignes sont zébrées, et les colonnes se
// désignent par leur nom.

// La colonne d'un tableau structuré, visée par sa référence -- Tbl<Feuille>
// [Intitulé] -- plutôt que par une plage OFFSET/COUNTA : le tableau s'étend
// de lui-même quand on ajoute un acteur ou un type de flux, la formule n'a
// plus rien à recalculer. Un utilisateur réel avait vu l'ancienne formule
// déclencher, dans son classeur, l'avertissement Excel de « liaisons avec une
// ou plusieurs sources externes » -- le même symptôme qu'un renvoi vers un
// AUTRE CLASSEUR -- et l'a remplacée à la main par une référence de tableau,
// qui fonctionne. C'est cette forme qu'on reprend ici.
export interface ListeNommée {
  nom: string;
  feuille: string;
  intitulé: string;
}

// Une colonne de saisie contrainte par une liste. La formule est le plus
// souvent un simple nom de plage -- qui en est une -- mais elle peut aussi
// calculer sa liste, pour les listes dépendantes des onglets FX_.
export interface ValidationÀPoser {
  feuille: string;
  colonne: string;
  // Absente sur une colonne de saisie libre : Excel accepte une validation
  // sans contrainte, dont le seul effet est l'infobulle. C'est ce qui permet
  // d'expliquer AUSSI les colonnes qu'aucune liste ne guide -- elles étaient
  // les seules à ne rien dire, alors que ce sont celles où l'on hésite.
  formule?: string;
  // La bulle qu'Excel affiche à la sélection d'une cellule de la colonne. Le
  // drapeau showInputMessage était posé depuis toujours, sans texte à montrer.
  invite?: { titre: string; texte: string };
}

export interface TableauÀPoser {
  // Nom de la feuille, tel qu'il apparaît dans le classeur.
  feuille: string;
  // Intitulés de colonnes, dans l'ordre. Ils doivent reprendre exactement la
  // première ligne : Excel refuse un tableau dont l'en-tête déclaré diffère.
  colonnes: readonly string[];
  // Nombre de lignes de données déjà présentes.
  lignes: number;
  // Colonnes calculées, par intitulé : Excel recopie la formule sur chaque
  // ligne ajoutée au tableau, et la restaure si on la remplace par une saisie.
  formuleParColonne?: Readonly<Record<string, string>>;
  // Position (0 = A) de la première colonne du tableau sur la feuille. Permet
  // à plusieurs tableaux de cohabiter côte à côte sur une même feuille --
  // Listes en pose un par vocabulaire, chacun dimensionné à son seul contenu,
  // plutôt qu'un tableau unique rembourré à la hauteur du plus long.
  colonneDépart?: number;
}

const NS_TABLE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const TYPE_TABLE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml";

function échapper(texte: string): string {
  return texte
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Empreinte déterministe (djb2) d'une chaîne, en base36. Sert à départager
// deux tableaux dont le nom assaini coïncide, à partir du nom de feuille
// D'ORIGINE plutôt que d'un compteur de position : le résultat ne dépend donc
// pas de l'ordre dans lequel les feuilles sont fournies, qui peut varier d'une
// génération à l'autre pour les mêmes données.
function empreinte(texte: string): string {
  let h = 5381;
  for (let i = 0; i < texte.length; i++) h = (h * 33) ^ texte.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function assainir(texte: string): string {
  return texte
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "_");
}

// Un nom de tableau est un nom défini Excel : ni espace, ni ponctuation, et il
// ne commence pas par un chiffre.
//
// Le préfixe « Tbl » nommait les tableaux pour la macro GenererOngletsManquants
// cherche « TblInterfaces » sur la feuille Interfaces. Un autre nom et elle
// s'arrête sur « Tableau TblInterfaces introuvable ».
//
// `colonne`, quand elle est fournie, distingue plusieurs tableaux posés sur la
// même feuille -- Listes en porte un par vocabulaire.
export function nomDeTableau(feuille: string, colonne?: string): string {
  const base = `Tbl${assainir(feuille)}`;
  return colonne ? `${base}_${assainir(colonne)}` : base;
}

function xmlDuTableau(
  id: number,
  nom: string,
  ref: string,
  colonnes: readonly string[],
  formules: Readonly<Record<string, string>> = {}
): string {
  const cols = colonnes
    .map((c, i) => {
      const formule = formules[c];
      const début = `<tableColumn id="${i + 1}" name="${échapper(c)}"`;
      return formule
        ? `${début}><calculatedColumnFormula>${échapper(formule)}</calculatedColumnFormula></tableColumn>`
        : `${début}/>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<table xmlns="${NS_TABLE}" id="${id}" name="${nom}" displayName="${nom}" ref="${ref}" totalsRowShown="0">` +
    `<autoFilter ref="${ref}"/>` +
    `<tableColumns count="${colonnes.length}">${cols}</tableColumns>` +
    `<tableStyleInfo name="TableStyleMedium2" showFirstColumn="0" showLastColumn="0" showRowStripes="1" showColumnStripes="0"/>` +
    `</table>`
  );
}

function xmlDesRelations(idTable: number): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="${NS_REL}/table" Target="../tables/table${idTable}.xml"/>` +
    `</Relationships>`
  );
}

// Les types publiés par SheetJS ne décrivent pas le conteneur CFB : on le
// manipule via une forme minimale plutôt que de plier le code à leurs lacunes.
export type Conteneur = Parameters<typeof XLSX.CFB.write>[0];

export function lirePartie(cfb: Conteneur, chemin: string): string | null {
  const entrée = XLSX.CFB.find(cfb, chemin);
  if (!entrée || !entrée.content) return null;
  return new TextDecoder().decode(new Uint8Array(entrée.content as unknown as ArrayBufferLike));
}

export function écrirePartie(cfb: Conteneur, chemin: string, contenu: string): void {
  const octets = new TextEncoder().encode(contenu);
  XLSX.CFB.utils.cfb_add(cfb, chemin, octets as unknown as number[]);
}

// Jusqu'où porter les validations d'une feuille : au moins de quoi saisir
// confortablement dans un classeur neuf, et toujours au-delà de la dernière
// ligne réellement écrite. Figée à 1000, la validation lâchait en silence sur
// un classeur plus gros -- la 1001e saisie n'était plus contrôlée du tout.
const PLANCHER_VALIDATION = 1000;

// N'ajoute que les <row> manquantes : la dimension de la feuille se règle à
// part (poserLesTableaux), une fois connue l'étendue de TOUS les tableaux
// qu'elle porte -- une feuille comme Listes en reçoit plusieurs.
function matérialiserLesLignes(feuille: string, jusquÀ: number): string {
  const présentes = new Set(
    [...feuille.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]))
  );
  const manquantes: string[] = [];
  for (let ligne = 1; ligne <= jusquÀ; ligne++) {
    if (!présentes.has(ligne)) manquantes.push(`<row r="${ligne}"/>`);
  }
  return feuille.replace("</sheetData>", `${manquantes.join("")}</sheetData>`);
}

// La dernière colonne et la dernière ligne d'une référence de dimension --
// une plage ("A1:N1000") ou, sur une feuille à une seule cellule, une cellule
// nue ("A1").
function étendueDéclarée(réf: string): { colonneIdx: number; ligne: number } {
  const dernière = réf.split(":").pop()!;
  const m = dernière.match(/^([A-Z]+)(\d+)$/);
  if (!m) return { colonneIdx: 0, ligne: 1 };
  return { colonneIdx: XLSX.utils.decode_col(m[1]), ligne: Number(m[2]) };
}

// La référence de chaque nom défini vise le tableau réellement posé pour la
// liste concernée -- pas nomDeTableau(feuille) recalculé à côté, qui ignorait
// qu'une feuille comme Listes en porte plusieurs et se serait mépris sur
// lequel.
function xmlDesNomsDefinis(
  listes: readonly ListeNommée[],
  tableaux: readonly TableauÀPoser[],
  nomParTableau: ReadonlyMap<TableauÀPoser, string>
): string {
  if (listes.length === 0) return "";
  const noms = listes
    .map((l) => {
      const tableau = tableaux.find((t) => t.feuille === l.feuille && t.colonnes.includes(l.intitulé));
      if (!tableau) throw new Error(`liste "${l.nom}" : aucun tableau sur "${l.feuille}" ne porte "${l.intitulé}"`);
      // Un tableau couvre toujours au moins une ligne de données (voir
      // poserLesTableaux plus bas), même sur un classeur vierge : la référence
      // vise donc une plage d'une cellule vide plutôt qu'une plage nulle, ce
      // qu'Excel refuse dans une validation.
      const référence = `${nomParTableau.get(tableau)}[${échapper(l.intitulé)}]`;
      return `<definedName name="${l.nom}">${référence}</definedName>`;
    })
    .join("");
  return `<definedNames>${noms}</definedNames>`;
}

function xmlDesValidations(validations: readonly ValidationÀPoser[], dernièreLigne: number): string {
  if (validations.length === 0) return "";
  const jusquÀ = Math.max(PLANCHER_VALIDATION, dernièreLigne);
  const items = validations
    .map((v) => {
      const invite = v.invite
        ? `promptTitle="${échapper(v.invite.titre)}" prompt="${échapper(v.invite.texte)}" `
        : "";
      const plage = `sqref="${v.colonne}2:${v.colonne}${jusquÀ}"`;
      // Sans formule, une validation « none » : aucune contrainte, seulement
      // l'infobulle. Excel l'accepte et n'affiche aucune alerte.
      if (!v.formule) {
        return `<dataValidation type="none" allowBlank="1" showInputMessage="1" showErrorMessage="0" ${invite}${plage}/>`;
      }
      return (
        `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" ` +
        `${invite}${plage}><formula1>${échapper(v.formule)}</formula1></dataValidation>`
      );
    })
    .join("");
  return `<dataValidations count="${validations.length}">${items}</dataValidations>`;
}

// La mise en forme d'une feuille. SheetJS en version communautaire SUPPRIME
// les styles de cellule à l'écriture -- vérifié : la cellule ressort sans
// attribut `s` et styles.xml sans police ajoutée. Le classeur n'avait donc
// aucune présentation, et l'onglet d'explication se lisait comme un pavé de
// texte brut.
//
// On les pose donc ici, dans la même passe que les tableaux : quatre rôles,
// pas davantage. Un jeu ouvert de styles deviendrait un moteur de style, ce
// qu'un classeur de saisie n'a pas à contenir.
export type RôleDeStyle = "titre" | "section" | "corps" | "discret" | "entete";

export interface MiseEnFormeÀPoser {
  feuille: string;
  // Adresses de cellules (« A1 », « B12 »), pas des plages : on ne stylise que
  // ce qui existe, et l'appelant sait exactement quelles lignes il a écrites.
  cellules: readonly string[];
  rôle: RôleDeStyle;
}

// Les polices et remplissages ajoutés, dans l'ordre. Les index de départ se
// lisent dans le styles.xml existant : on AJOUTE, on ne remplace pas, sans
// quoi les index déjà posés par SheetJS deviendraient faux.
// La police par défaut du classeur est Calibri 12 : rien ne doit descendre
// SOUS elle. Un corps à 11 et des notes à 10, comme posés d'abord, écrivaient
// l'explication en plus petit que les données qu'elle explique.
//
// Et pas de gris pâle sur blanc : #5B6472 tenait le seuil WCAG (5,98:1) sans
// être confortable pour autant, surtout en italique et en petit corps. Les
// notes passent donc à un ardoise franc, 10,16:1, et gardent l'italique pour
// se distinguer -- c'est la FORME qui les met en retrait, pas la pâleur.
const POLICES_AJOUTEES: Record<RôleDeStyle, string> = {
  titre: '<font><b/><sz val="18"/><color rgb="FF0E7DAD"/><name val="Calibri"/><family val="2"/></font>',
  section: '<font><b/><sz val="14"/><color rgb="FF14181F"/><name val="Calibri"/><family val="2"/></font>',
  corps: '<font><sz val="12"/><color rgb="FF14181F"/><name val="Calibri"/><family val="2"/></font>',
  discret: '<font><i/><sz val="12"/><color rgb="FF39424F"/><name val="Calibri"/><family val="2"/></font>',
  entete: '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>',
};

const REMPLISSAGES_AJOUTES: Record<RôleDeStyle, string | null> = {
  titre: null,
  section: '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F8"/><bgColor indexed="64"/></patternFill></fill>',
  corps: null,
  discret: null,
  entete: '<fill><patternFill patternType="solid"><fgColor rgb="FF0E7DAD"/><bgColor indexed="64"/></patternFill></fill>',
};

const ROLES: RôleDeStyle[] = ["titre", "section", "corps", "discret", "entete"];

// Le texte long doit REVENIR À LA LIGNE dans sa cellule. Sans ça il faut
// couper les phrases à la main dans le code -- ce que faisait l'onglet
// d'explication, et qui se défait dès qu'on élargit la colonne.
function xfDuRôle(rôle: RôleDeStyle, fontId: number, fillId: number | null): string {
  const retour = rôle === "corps" || rôle === "section" ? ' applyAlignment="1"' : "";
  const alignement =
    rôle === "corps" || rôle === "section" ? '<alignment vertical="top" wrapText="1"/>' : "";
  const fond = fillId === null ? "" : ` fillId="${fillId}" applyFill="1"`;
  return `<xf numFmtId="0" fontId="${fontId}" borderId="0" xfId="0" applyFont="1"${fond}${retour}>${alignement}</xf>`;
}

// Ajoute nos styles à ceux de SheetJS et rend l'index de chacun.
function ajouterLesStyles(styles: string): { xml: string; index: Record<RôleDeStyle, number> } {
  const compte = (balise: string) => Number(new RegExp(`<${balise} count="(\\d+)"`).exec(styles)?.[1] ?? "0");
  const nbPolices = compte("fonts");
  const nbFonds = compte("fills");
  const nbXf = compte("cellXfs");

  let policeSuivante = nbPolices;
  let fondSuivant = nbFonds;
  const policeDe: Record<string, number> = {};
  const fondDe: Record<string, number> = {};
  const policesXml: string[] = [];
  const fondsXml: string[] = [];
  for (const rôle of ROLES) {
    policeDe[rôle] = policeSuivante++;
    policesXml.push(POLICES_AJOUTEES[rôle]);
    const fond = REMPLISSAGES_AJOUTES[rôle];
    if (fond) {
      fondDe[rôle] = fondSuivant++;
      fondsXml.push(fond);
    }
  }

  const index = {} as Record<RôleDeStyle, number>;
  const xfsXml: string[] = [];
  ROLES.forEach((rôle, i) => {
    index[rôle] = nbXf + i;
    xfsXml.push(xfDuRôle(rôle, policeDe[rôle], fondDe[rôle] ?? null));
  });

  const xml = styles
    .replace(`<fonts count="${nbPolices}">`, `<fonts count="${nbPolices + policesXml.length}">`)
    .replace("</fonts>", `${policesXml.join("")}</fonts>`)
    .replace(`<fills count="${nbFonds}">`, `<fills count="${nbFonds + fondsXml.length}">`)
    .replace("</fills>", `${fondsXml.join("")}</fills>`)
    .replace(`<cellXfs count="${nbXf}">`, `<cellXfs count="${nbXf + xfsXml.length}">`)
    .replace("</cellXfs>", `${xfsXml.join("")}</cellXfs>`);
  return { xml, index };
}

// Pose l'attribut `s` sur les cellules visées d'une feuille déjà écrite.
function appliquerLesStyles(feuille: string, parCellule: Map<string, number>): string {
  return feuille.replace(/<c r="([A-Z]+\d+)"([^>]*?)(\/?)>/g, (tout, réf: string, attributs: string, fermé: string) => {
    const style = parCellule.get(réf);
    if (style === undefined) return tout;
    const sansStyle = attributs.replace(/\s+s="\d+"/, "");
    return `<c r="${réf}"${sansStyle} s="${style}"${fermé}>`;
  });
}

export interface ComplémentOOXML {
  tableaux: readonly TableauÀPoser[];
  listes?: readonly ListeNommée[];
  validations?: readonly ValidationÀPoser[];
  misesEnForme?: readonly MiseEnFormeÀPoser[];
  // Les feuilles dont la ligne d'en-tête reste visible au défilement. Une
  // feuille de saisie de trente lignes se remplit à l'aveugle sans ça.
  volets?: readonly string[];
}

export function poserLesTableaux(classeur: ArrayBuffer, complément: ComplémentOOXML | readonly TableauÀPoser[]): ArrayBuffer {
  const {
    tableaux,
    listes = [],
    validations = [],
    misesEnForme = [],
    volets = [],
  } = Array.isArray(complément)
    ? { tableaux: complément as readonly TableauÀPoser[], listes: [], validations: [], misesEnForme: [], volets: [] }
    : (complément as ComplémentOOXML);
  const cfb = XLSX.CFB.read(new Uint8Array(classeur), { type: "array" });

  const workbook = lirePartie(cfb, "/xl/workbook.xml");
  if (!workbook) throw new Error("classeur illisible : xl/workbook.xml absent");

  // Ordre des feuilles dans workbook.xml = ordre des fichiers sheetN.xml.
  const noms = [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map((m) =>
    m[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  );

  let contentTypes = lirePartie(cfb, "/[Content_Types].xml");
  if (!contentTypes) throw new Error("classeur illisible : [Content_Types].xml absent");

  // Plusieurs tableaux peuvent cohabiter sur une même feuille -- Listes en
  // pose un par vocabulaire (colonneDépart) -- et ne doivent y laisser qu'un
  // seul <tableParts>, qu'un seul jeu de relations : on groupe donc par
  // feuille plutôt que de traiter chaque tableau isolément.
  const parFeuille = new Map<string, TableauÀPoser[]>();
  for (const tableau of tableaux) {
    const liste = parFeuille.get(tableau.feuille) ?? [];
    liste.push(tableau);
    parFeuille.set(tableau.feuille, liste);
  }

  let idTable = 0;
  const nomParTableau = new Map<TableauÀPoser, string>();
  const nomsUtilisés = new Set<string>();

  for (const [nomFeuille, tableauxDeLaFeuille] of parFeuille) {
    const index = noms.indexOf(nomFeuille);
    if (index < 0) throw new Error(`feuille "${nomFeuille}" absente du classeur`);

    const numéroFeuille = index + 1;
    const cheminFeuille = `/xl/worksheets/sheet${numéroFeuille}.xml`;
    let feuille = lirePartie(cfb, cheminFeuille);
    if (!feuille) throw new Error(`feuille "${nomFeuille}" absente du paquet`);

    // Ce que SheetJS avait déjà déclaré avant qu'on y touche : sur Listes,
    // c'est la zone d'appoint (colonnes J à Q, jusqu'à la ligne 1000) ; sur un
    // onglet FX_, c'est la colonne qui porte la cellule nommant l'onglet. La
    // dimension finale de la feuille est le maximum de cette étendue et de
    // celle des tableaux qu'on pose -- jamais l'une à la place de l'autre.
    const dimInitiale = feuille.match(/<dimension ref="([^"]*)"\/>/);
    const étendueInitiale = dimInitiale ? étendueDéclarée(dimInitiale[1]) : { colonneIdx: 0, ligne: 1 };

    const relations: string[] = [];
    let dernièreLigneFeuille = étendueInitiale.ligne;
    let dernièreColonneIdxFeuille = étendueInitiale.colonneIdx;

    for (const tableau of tableauxDeLaFeuille) {
      idTable += 1;
      const colonneDépart = tableau.colonneDépart ?? 0;
      // Un tableau couvre son en-tête ET au moins une ligne : c'est ce qu'Excel
      // écrit lui-même pour un tableau vide, et il refuse un tableau sans corps.
      const dernièreLigne = 1 + Math.max(1, tableau.lignes);
      const dernièreColonneIdx = colonneDépart + tableau.colonnes.length - 1;
      const ref = `${XLSX.utils.encode_col(colonneDépart)}1:${XLSX.utils.encode_col(dernièreColonneIdx)}${dernièreLigne}`;
      // Plusieurs tableaux sur une même feuille se distinguent par leurs
      // colonnes -- nomDeTableau(feuille) seul retomberait sur le même nom
      // pour chacun.
      let nom =
        tableauxDeLaFeuille.length > 1
          ? nomDeTableau(nomFeuille, tableau.colonnes.join("_"))
          : nomDeTableau(nomFeuille);
      // Deux feuilles différentes peuvent s'assainir au même nom -- deux types
      // de flux qui ne diffèrent que par la ponctuation, par exemple. Un nom
      // de tableau en double n'est pas une curiosité qu'Excel tolère : ECMA-376
      // §18.5.1.2 exige un displayName unique dans le classeur, et Excel
      // résout la collision en supprimant l'un des deux tableaux, en silence.
      if (nomsUtilisés.has(nom)) {
        const désambiguïsé = `${nom}_${empreinte(nomFeuille)}`;
        nom = nomsUtilisés.has(désambiguïsé) ? `${désambiguïsé}_${idTable}` : désambiguïsé;
      }
      nomsUtilisés.add(nom);
      nomParTableau.set(tableau, nom);

      dernièreLigneFeuille = Math.max(dernièreLigneFeuille, dernièreLigne);
      dernièreColonneIdxFeuille = Math.max(dernièreColonneIdxFeuille, dernièreColonneIdx);

      écrirePartie(
        cfb,
        `/xl/tables/table${idTable}.xml`,
        xmlDuTableau(idTable, nom, ref, tableau.colonnes, tableau.formuleParColonne)
      );
      relations.push(`<Relationship Id="rId${relations.length + 1}" Type="${NS_REL}/table" Target="../tables/table${idTable}.xml"/>`);

      contentTypes = contentTypes.replace(
        "</Types>",
        `<Override PartName="/xl/tables/table${idTable}.xml" ContentType="${TYPE_TABLE}"/></Types>`
      );
    }
    // Un tablePart par relation, dans le même ordre : rId1 pour le premier
    // tableau posé sur cette feuille, rId2 pour le second, etc.
    const tablePartsXml = relations.map((_, i) => `<tablePart r:id="rId${i + 1}"/>`).join("");

    écrirePartie(
      cfb,
      `/xl/worksheets/_rels/sheet${numéroFeuille}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join("")}</Relationships>`
    );

    // L'autofiltre de feuille ferait doublon avec celui du tableau, sur la même
    // plage. C'est aussi lui qui posait le nom défini _xlnm._FilterDatabase,
    // que SheetJS échappait mal dès que le nom de feuille portait une
    // apostrophe -- Excel proposait alors de réparer le classeur.
    // Un tableau couvre au moins une ligne de données. Sur une feuille vide,
    // cette ligne n'existe pas dans le XML : la dimension s'arrête à l'en-tête
    // et aucune <row> ne suit. Excel voit alors un tableau qui déborde de la
    // zone utilisée et propose de réparer le classeur. On matérialise donc les
    // lignes manquantes -- une <row> sans cellule est parfaitement légale --
    // jusqu'à la plus exigeante des tableaux de la feuille.
    feuille = matérialiserLesLignes(feuille, dernièreLigneFeuille).replace(/<autoFilter[^>]*\/>/, "");
    // Les validations de la feuille. L'ordre des éléments d'une feuille est
    // imposé par le schéma OOXML : dataValidations vient après sheetData et
    // avant ignoredErrors, donc juste après la fermeture des données.
    const desValidations = xmlDesValidations(validations.filter((v) => v.feuille === nomFeuille), dernièreLigneFeuille);
    // « tableParts » se place en dernier dans une feuille, juste avant sa
    // fermeture : l'ordre des éléments est imposé par le schéma OOXML.
    feuille = feuille
      .replace("</sheetData>", `</sheetData>${desValidations}`)
      .replace("</worksheet>", `<tableParts count="${relations.length}">${tablePartsXml}</tableParts></worksheet>`)
      .replace(
        /<dimension ref="[^"]*"\/>/,
        `<dimension ref="A1:${XLSX.utils.encode_col(dernièreColonneIdxFeuille)}${dernièreLigneFeuille}"/>`
      );

    écrirePartie(cfb, cheminFeuille, feuille);
  }

  // SheetJS écrit toujours une partie « metadata » décrivant les tableaux
  // dynamiques, à laquelle aucune cellule ne se rattache ici. Une partie
  // orpheline n'apporte rien et donne à Excel une occasion de plus de trouver
  // le classeur douteux : on la retire, avec sa déclaration et sa relation.
  XLSX.CFB.utils.cfb_del(cfb, "/xl/metadata.xml");
  contentTypes = contentTypes.replace(/<Override PartName="\/xl\/metadata\.xml"[^>]*\/>/, "");
  const relsWorkbook = lirePartie(cfb, "/xl/_rels/workbook.xml.rels");
  if (relsWorkbook) {
    écrirePartie(
      cfb,
      "/xl/_rels/workbook.xml.rels",
      relsWorkbook.replace(/<Relationship [^>]*sheetMetadata[^>]*\/>/, "")
    );
  }

  // La mise en forme et les volets figés, sur des feuilles que la boucle des
  // tableaux ne visite pas forcément : ils se posent donc à part, mais dans la
  // même passe -- le classeur n'est ouvert qu'une fois.
  if (misesEnForme.length > 0) {
    const styles = lirePartie(cfb, "/xl/styles.xml");
    if (!styles) throw new Error("classeur illisible : xl/styles.xml absent");
    const { xml, index } = ajouterLesStyles(styles);
    écrirePartie(cfb, "/xl/styles.xml", xml);
    const parFeuilleStyle = new Map<string, Map<string, number>>();
    for (const mise of misesEnForme) {
      const carte = parFeuilleStyle.get(mise.feuille) ?? new Map<string, number>();
      for (const cellule of mise.cellules) carte.set(cellule, index[mise.rôle]);
      parFeuilleStyle.set(mise.feuille, carte);
    }
    for (const [nomFeuille, carte] of parFeuilleStyle) {
      const i = noms.indexOf(nomFeuille);
      if (i < 0) throw new Error(`feuille "${nomFeuille}" absente du classeur`);
      const chemin = `/xl/worksheets/sheet${i + 1}.xml`;
      const contenu = lirePartie(cfb, chemin);
      if (contenu) écrirePartie(cfb, chemin, appliquerLesStyles(contenu, carte));
    }
  }

  for (const nomFeuille of volets) {
    const i = noms.indexOf(nomFeuille);
    if (i < 0) continue;
    const chemin = `/xl/worksheets/sheet${i + 1}.xml`;
    const contenu = lirePartie(cfb, chemin);
    if (!contenu || contenu.includes("<pane ")) continue;
    // La ligne d'en-tête reste à l'écran : une feuille de saisie de trente
    // lignes se remplit à l'aveugle sans ça.
    const vue =
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
    écrirePartie(
      cfb,
      chemin,
      contenu.includes("<sheetViews>")
        ? contenu.replace(/<sheetViews>.*?<\/sheetViews>/, vue)
        : contenu.replace(/(<dimension[^>]*\/>)/, `$1${vue}`)
    );
  }

  écrirePartie(cfb, "/[Content_Types].xml", contentTypes);
  // Les noms définis d'origine venaient des autofiltres de feuille, qu'on vient
  // de retirer ; on les remplace par les plages nommées des listes déroulantes.
  écrirePartie(
    cfb,
    "/xl/workbook.xml",
    workbook
      .replace(/<definedNames>.*?<\/definedNames>/, "")
      .replace("</sheets>", `</sheets>${xmlDesNomsDefinis(listes, tableaux, nomParTableau)}`)
  );

  const sortie = XLSX.CFB.write(cfb, { fileType: "zip", type: "array" }) as unknown as number[];
  return new Uint8Array(sortie).buffer;
}
