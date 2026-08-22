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
export interface NamedList {
  name: string;
  sheet: string;
  heading: string;
}

// Une colonne de saisie contrainte par une liste. La formule est le plus
// souvent un simple nom de plage -- qui en est une -- mais elle peut aussi
// calculer sa liste, pour les listes dépendantes des onglets FX_.
export interface ValidationToApply {
  sheet: string;
  column: string;
  // Absente sur une colonne de saisie libre : Excel accepte une validation
  // sans contrainte, dont le seul effet est l'infobulle. C'est ce qui permet
  // d'expliquer AUSSI les colonnes qu'aucune liste ne guide -- elles étaient
  // les seules à ne rien dire, alors que ce sont celles où l'on hésite.
  formule?: string;
  // La bulle qu'Excel affiche à la sélection d'une cellule de la colonne. Le
  // drapeau showInputMessage était posé depuis toujours, sans texte à montrer.
  prompt?: { title: string; text: string };
}

export interface TableToApply {
  // Nom de la feuille, tel qu'il apparaît dans le classeur.
  sheet: string;
  // Intitulés de colonnes, dans l'ordre. Ils doivent reprendre exactement la
  // première ligne : Excel refuse un tableau dont l'en-tête déclaré diffère.
  columns: readonly string[];
  // Nombre de lignes de données déjà présentes.
  rows: number;
  // Colonnes calculées, par intitulé : Excel recopie la formule sur chaque
  // ligne ajoutée au tableau, et la restaure si on la remplace par une saisie.
  formuleParColonne?: Readonly<Record<string, string>>;
  // Position (0 = A) de la première colonne du tableau sur la feuille. Permet
  // à plusieurs tableaux de cohabiter côte à côte sur une même feuille --
  // Listes en pose un par vocabulaire, chacun dimensionné à son seul contenu,
  // plutôt qu'un tableau unique rembourré à la hauteur du plus long.
  startColumn?: number;
}

const NS_TABLE = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const TYPE_TABLE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml";

function escapeXml(text: string): string {
  return text
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
function empreinte(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = (h * 33) ^ text.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function sanitise(text: string): string {
  return text
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
export function nomDeTableau(sheet: string, column?: string): string {
  const base = `Tbl${sanitise(sheet)}`;
  return column ? `${base}_${sanitise(column)}` : base;
}

function xmlDuTableau(
  id: number,
  name: string,
  ref: string,
  columns: readonly string[],
  formules: Readonly<Record<string, string>> = {}
): string {
  const cols = columns
    .map((c, i) => {
      const formule = formules[c];
      const start = `<tableColumn id="${i + 1}" name="${escapeXml(c)}"`;
      return formule
        ? `${start}><calculatedColumnFormula>${escapeXml(formule)}</calculatedColumnFormula></tableColumn>`
        : `${start}/>`;
    })
    .join("");
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<table xmlns="${NS_TABLE}" id="${id}" name="${name}" displayName="${name}" ref="${ref}" totalsRowShown="0">` +
    `<autoFilter ref="${ref}"/>` +
    `<tableColumns count="${columns.length}">${cols}</tableColumns>` +
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

export function readPart(cfb: Conteneur, path: string): string | null {
  const input = XLSX.CFB.find(cfb, path);
  if (!input || !input.content) return null;
  return new TextDecoder().decode(new Uint8Array(input.content as unknown as ArrayBufferLike));
}

export function writePart(cfb: Conteneur, path: string, content: string): void {
  const octets = new TextEncoder().encode(content);
  XLSX.CFB.utils.cfb_add(cfb, path, octets as unknown as number[]);
}

// Jusqu'où porter les validations d'une feuille : au moins de quoi saisir
// confortablement dans un classeur neuf, et toujours au-delà de la dernière
// ligne réellement écrite. Figée à 1000, la validation lâchait en silence sur
// un classeur plus gros -- la 1001e saisie n'était plus contrôlée du tout.
const PLANCHER_VALIDATION = 1000;

// N'ajoute que les <row> manquantes : la dimension de la feuille se règle à
// part (poserLesTableaux), une fois connue l'étendue de TOUS les tableaux
// qu'elle porte -- une feuille comme Listes en reçoit plusieurs.
function materialiseRows(sheet: string, upTo: number): string {
  const present = new Set(
    [...sheet.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]))
  );
  const manquantes: string[] = [];
  for (let row = 1; row <= upTo; row++) {
    if (!present.has(row)) manquantes.push(`<row r="${row}"/>`);
  }
  return sheet.replace("</sheetData>", `${manquantes.join("")}</sheetData>`);
}

// La dernière colonne et la dernière ligne d'une référence de dimension --
// une plage ("A1:N1000") ou, sur une feuille à une seule cellule, une cellule
// nue ("A1").
function declaredExtent(réf: string): { colonneIdx: number; row: number } {
  const last = réf.split(":").pop()!;
  const m = last.match(/^([A-Z]+)(\d+)$/);
  if (!m) return { colonneIdx: 0, row: 1 };
  return { colonneIdx: XLSX.utils.decode_col(m[1]), row: Number(m[2]) };
}

// La référence de chaque nom défini vise le tableau réellement posé pour la
// liste concernée -- pas nomDeTableau(feuille) recalculé à côté, qui ignorait
// qu'une feuille comme Listes en porte plusieurs et se serait mépris sur
// lequel.
function xmlDesNomsDefinis(
  lists: readonly NamedList[],
  tables: readonly TableToApply[],
  nomParTableau: ReadonlyMap<TableToApply, string>
): string {
  if (lists.length === 0) return "";
  const names = lists
    .map((l) => {
      const table = tables.find((t) => t.sheet === l.sheet && t.columns.includes(l.heading));
      if (!table) throw new Error(`list "${l.name}" : aucun table sur "${l.sheet}" ne porte "${l.heading}"`);
      // Un tableau couvre toujours au moins une ligne de données (voir
      // poserLesTableaux plus bas), même sur un classeur vierge : la référence
      // vise donc une plage d'une cellule vide plutôt qu'une plage nulle, ce
      // qu'Excel refuse dans une validation.
      const reference = `${nomParTableau.get(table)}[${escapeXml(l.heading)}]`;
      return `<definedName name="${l.name}">${reference}</definedName>`;
    })
    .join("");
  return `<definedNames>${names}</definedNames>`;
}

function xmlDesValidations(validations: readonly ValidationToApply[], lastRow: number): string {
  if (validations.length === 0) return "";
  const upTo = Math.max(PLANCHER_VALIDATION, lastRow);
  const items = validations
    .map((v) => {
      const prompt = v.prompt
        ? `promptTitle="${escapeXml(v.prompt.title)}" prompt="${escapeXml(v.prompt.text)}" `
        : "";
      const plage = `sqref="${v.column}2:${v.column}${upTo}"`;
      // Sans formule, une validation « none » : aucune contrainte, seulement
      // l'infobulle. Excel l'accepte et n'affiche aucune alerte.
      if (!v.formule) {
        return `<dataValidation type="none" allowBlank="1" showInputMessage="1" showErrorMessage="0" ${prompt}${plage}/>`;
      }
      return (
        `<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" ` +
        `${prompt}${plage}><formula1>${escapeXml(v.formule)}</formula1></dataValidation>`
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
export type StyleRole = "title" | "section" | "body" | "aside" | "header";

export interface StyleToApply {
  sheet: string;
  // Adresses de cellules (« A1 », « B12 »), pas des plages : on ne stylise que
  // ce qui existe, et l'appelant sait exactement quelles lignes il a écrites.
  cellules: readonly string[];
  role: StyleRole;
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
const POLICES_AJOUTEES: Record<StyleRole, string> = {
  title: '<font><b/><sz val="18"/><color rgb="FF0E7DAD"/><name val="Calibri"/><family val="2"/></font>',
  section: '<font><b/><sz val="14"/><color rgb="FF14181F"/><name val="Calibri"/><family val="2"/></font>',
  body: '<font><sz val="12"/><color rgb="FF14181F"/><name val="Calibri"/><family val="2"/></font>',
  aside: '<font><i/><sz val="12"/><color rgb="FF39424F"/><name val="Calibri"/><family val="2"/></font>',
  header: '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>',
};

const REMPLISSAGES_AJOUTES: Record<StyleRole, string | null> = {
  title: null,
  section: '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F8"/><bgColor indexed="64"/></patternFill></fill>',
  body: null,
  aside: null,
  header: '<fill><patternFill patternType="solid"><fgColor rgb="FF0E7DAD"/><bgColor indexed="64"/></patternFill></fill>',
};

const ROLES: StyleRole[] = ["title", "section", "body", "aside", "header"];

// Le texte long doit REVENIR À LA LIGNE dans sa cellule. Sans ça il faut
// couper les phrases à la main dans le code -- ce que faisait l'onglet
// d'explication, et qui se défait dès qu'on élargit la colonne.
function xfForRole(role: StyleRole, fontId: number, fillId: number | null): string {
  const retour = role === "body" || role === "section" ? ' applyAlignment="1"' : "";
  const alignement =
    role === "body" || role === "section" ? '<alignment vertical="top" wrapText="1"/>' : "";
  const fill = fillId === null ? "" : ` fillId="${fillId}" applyFill="1"`;
  return `<xf numFmtId="0" fontId="${fontId}" borderId="0" xfId="0" applyFont="1"${fill}${retour}>${alignement}</xf>`;
}

// Ajoute nos styles à ceux de SheetJS et rend l'index de chacun.
function ajouterLesStyles(styles: string): { xml: string; index: Record<StyleRole, number> } {
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
  for (const role of ROLES) {
    policeDe[role] = policeSuivante++;
    policesXml.push(POLICES_AJOUTEES[role]);
    const fill = REMPLISSAGES_AJOUTES[role];
    if (fill) {
      fondDe[role] = fondSuivant++;
      fondsXml.push(fill);
    }
  }

  const index = {} as Record<StyleRole, number>;
  const xfsXml: string[] = [];
  ROLES.forEach((role, i) => {
    index[role] = nbXf + i;
    xfsXml.push(xfForRole(role, policeDe[role], fondDe[role] ?? null));
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
function appliquerLesStyles(sheet: string, parCellule: Map<string, number>): string {
  return sheet.replace(/<c r="([A-Z]+\d+)"([^>]*?)(\/?)>/g, (tout, réf: string, attributs: string, fermé: string) => {
    const style = parCellule.get(réf);
    if (style === undefined) return tout;
    const sansStyle = attributs.replace(/\s+s="\d+"/, "");
    return `<c r="${réf}"${sansStyle} s="${style}"${fermé}>`;
  });
}

export interface OoxmlExtras {
  tables: readonly TableToApply[];
  lists?: readonly NamedList[];
  validations?: readonly ValidationToApply[];
  misesEnForme?: readonly StyleToApply[];
  // Les feuilles dont la ligne d'en-tête reste visible au défilement. Une
  // feuille de saisie de trente lignes se remplit à l'aveugle sans ça.
  volets?: readonly string[];
}

export function applyOoxmlExtras(octets: ArrayBuffer, complément: OoxmlExtras | readonly TableToApply[]): ArrayBuffer {
  const {
    tables,
    lists = [],
    validations = [],
    misesEnForme = [],
    volets = [],
  } = Array.isArray(complément)
    ? { tables: complément as readonly TableToApply[], lists: [], validations: [], misesEnForme: [], volets: [] }
    : (complément as OoxmlExtras);
  const cfb = XLSX.CFB.read(new Uint8Array(octets), { type: "array" });

  const workbook = readPart(cfb, "/xl/workbook.xml");
  if (!workbook) throw new Error("classeur illisible : xl/workbook.xml absent");

  // Ordre des feuilles dans workbook.xml = ordre des fichiers sheetN.xml.
  const names = [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map((m) =>
    m[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  );

  let contentTypes = readPart(cfb, "/[Content_Types].xml");
  if (!contentTypes) throw new Error("classeur illisible : [Content_Types].xml absent");

  // Plusieurs tableaux peuvent cohabiter sur une même feuille -- Listes en
  // pose un par vocabulaire (colonneDépart) -- et ne doivent y laisser qu'un
  // seul <tableParts>, qu'un seul jeu de relations : on groupe donc par
  // feuille plutôt que de traiter chaque tableau isolément.
  const parFeuille = new Map<string, TableToApply[]>();
  for (const table of tables) {
    const list = parFeuille.get(table.sheet) ?? [];
    list.push(table);
    parFeuille.set(table.sheet, list);
  }

  let idTable = 0;
  const nomParTableau = new Map<TableToApply, string>();
  const usedNames = new Set<string>();

  for (const [sheetName, tableauxDeLaFeuille] of parFeuille) {
    const index = names.indexOf(sheetName);
    if (index < 0) throw new Error(`sheet "${sheetName}" absente du workbook`);

    const sheetNumber = index + 1;
    const sheetPath = `/xl/worksheets/sheet${sheetNumber}.xml`;
    let sheet = readPart(cfb, sheetPath);
    if (!sheet) throw new Error(`sheet "${sheetName}" absente du paquet`);

    // Ce que SheetJS avait déjà déclaré avant qu'on y touche : sur Listes,
    // c'est la zone d'appoint (colonnes J à Q, jusqu'à la ligne 1000) ; sur un
    // onglet FX_, c'est la colonne qui porte la cellule nommant l'onglet. La
    // dimension finale de la feuille est le maximum de cette étendue et de
    // celle des tableaux qu'on pose -- jamais l'une à la place de l'autre.
    const dimInitiale = sheet.match(/<dimension ref="([^"]*)"\/>/);
    const initialExtent = dimInitiale ? declaredExtent(dimInitiale[1]) : { colonneIdx: 0, row: 1 };

    const relations: string[] = [];
    let lastSheetRow = initialExtent.row;
    let lastSheetColumnIndex = initialExtent.colonneIdx;

    for (const table of tableauxDeLaFeuille) {
      idTable += 1;
      const startColumn = table.startColumn ?? 0;
      // Un tableau couvre son en-tête ET au moins une ligne : c'est ce qu'Excel
      // écrit lui-même pour un tableau vide, et il refuse un tableau sans corps.
      const lastRow = 1 + Math.max(1, table.rows);
      const lastColumnIndex = startColumn + table.columns.length - 1;
      const ref = `${XLSX.utils.encode_col(startColumn)}1:${XLSX.utils.encode_col(lastColumnIndex)}${lastRow}`;
      // Plusieurs tableaux sur une même feuille se distinguent par leurs
      // colonnes -- nomDeTableau(feuille) seul retomberait sur le même nom
      // pour chacun.
      let name =
        tableauxDeLaFeuille.length > 1
          ? nomDeTableau(sheetName, table.columns.join("_"))
          : nomDeTableau(sheetName);
      // Deux feuilles différentes peuvent s'assainir au même nom -- deux types
      // de flux qui ne diffèrent que par la ponctuation, par exemple. Un nom
      // de tableau en double n'est pas une curiosité qu'Excel tolère : ECMA-376
      // §18.5.1.2 exige un displayName unique dans le classeur, et Excel
      // résout la collision en supprimant l'un des deux tableaux, en silence.
      if (usedNames.has(name)) {
        const disambiguated = `${name}_${empreinte(sheetName)}`;
        name = usedNames.has(disambiguated) ? `${disambiguated}_${idTable}` : disambiguated;
      }
      usedNames.add(name);
      nomParTableau.set(table, name);

      lastSheetRow = Math.max(lastSheetRow, lastRow);
      lastSheetColumnIndex = Math.max(lastSheetColumnIndex, lastColumnIndex);

      writePart(
        cfb,
        `/xl/tables/table${idTable}.xml`,
        xmlDuTableau(idTable, name, ref, table.columns, table.formuleParColonne)
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

    writePart(
      cfb,
      `/xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`,
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
    sheet = materialiseRows(sheet, lastSheetRow).replace(/<autoFilter[^>]*\/>/, "");
    // Les validations de la feuille. L'ordre des éléments d'une feuille est
    // imposé par le schéma OOXML : dataValidations vient après sheetData et
    // avant ignoredErrors, donc juste après la fermeture des données.
    const desValidations = xmlDesValidations(validations.filter((v) => v.sheet === sheetName), lastSheetRow);
    // « tableParts » se place en dernier dans une feuille, juste avant sa
    // fermeture : l'ordre des éléments est imposé par le schéma OOXML.
    sheet = sheet
      .replace("</sheetData>", `</sheetData>${desValidations}`)
      .replace("</worksheet>", `<tableParts count="${relations.length}">${tablePartsXml}</tableParts></worksheet>`)
      .replace(
        /<dimension ref="[^"]*"\/>/,
        `<dimension ref="A1:${XLSX.utils.encode_col(lastSheetColumnIndex)}${lastSheetRow}"/>`
      );

    writePart(cfb, sheetPath, sheet);
  }

  // SheetJS écrit toujours une partie « metadata » décrivant les tableaux
  // dynamiques, à laquelle aucune cellule ne se rattache ici. Une partie
  // orpheline n'apporte rien et donne à Excel une occasion de plus de trouver
  // le classeur douteux : on la retire, avec sa déclaration et sa relation.
  XLSX.CFB.utils.cfb_del(cfb, "/xl/metadata.xml");
  contentTypes = contentTypes.replace(/<Override PartName="\/xl\/metadata\.xml"[^>]*\/>/, "");
  const relsWorkbook = readPart(cfb, "/xl/_rels/workbook.xml.rels");
  if (relsWorkbook) {
    writePart(
      cfb,
      "/xl/_rels/workbook.xml.rels",
      relsWorkbook.replace(/<Relationship [^>]*sheetMetadata[^>]*\/>/, "")
    );
  }

  // La mise en forme et les volets figés, sur des feuilles que la boucle des
  // tableaux ne visite pas forcément : ils se posent donc à part, mais dans la
  // même passe -- le classeur n'est ouvert qu'une fois.
  if (misesEnForme.length > 0) {
    const styles = readPart(cfb, "/xl/styles.xml");
    if (!styles) throw new Error("classeur illisible : xl/styles.xml absent");
    const { xml, index } = ajouterLesStyles(styles);
    writePart(cfb, "/xl/styles.xml", xml);
    const parFeuilleStyle = new Map<string, Map<string, number>>();
    for (const mise of misesEnForme) {
      const map = parFeuilleStyle.get(mise.sheet) ?? new Map<string, number>();
      for (const cellule of mise.cellules) map.set(cellule, index[mise.role]);
      parFeuilleStyle.set(mise.sheet, map);
    }
    for (const [sheetName, map] of parFeuilleStyle) {
      const i = names.indexOf(sheetName);
      if (i < 0) throw new Error(`sheet "${sheetName}" absente du workbook`);
      const path = `/xl/worksheets/sheet${i + 1}.xml`;
      const content = readPart(cfb, path);
      if (content) writePart(cfb, path, appliquerLesStyles(content, map));
    }
  }

  for (const sheetName of volets) {
    const i = names.indexOf(sheetName);
    if (i < 0) continue;
    const path = `/xl/worksheets/sheet${i + 1}.xml`;
    const content = readPart(cfb, path);
    if (!content || content.includes("<pane ")) continue;
    // La ligne d'en-tête reste à l'écran : une feuille de saisie de trente
    // lignes se remplit à l'aveugle sans ça.
    const view =
      '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>';
    writePart(
      cfb,
      path,
      content.includes("<sheetViews>")
        ? content.replace(/<sheetViews>.*?<\/sheetViews>/, view)
        : content.replace(/(<dimension[^>]*\/>)/, `$1${view}`)
    );
  }

  writePart(cfb, "/[Content_Types].xml", contentTypes);
  // Les noms définis d'origine venaient des autofiltres de feuille, qu'on vient
  // de retirer ; on les remplace par les plages nommées des listes déroulantes.
  writePart(
    cfb,
    "/xl/workbook.xml",
    workbook
      .replace(/<definedNames>.*?<\/definedNames>/, "")
      .replace("</sheets>", `</sheets>${xmlDesNomsDefinis(lists, tables, nomParTableau)}`)
  );

  const output = XLSX.CFB.write(cfb, { fileType: "zip", type: "array" }) as unknown as number[];
  return new Uint8Array(output).buffer;
}
