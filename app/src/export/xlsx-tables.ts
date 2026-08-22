import * as XLSX from "xlsx";

// SheetJS does not write Excel's structured tables: in its writer,
// "tableParts" is nothing but a comment. But it exposes CFB, which can reread
// the .xlsx package as a zip, add entries to it and write it back. The file is
// therefore completed afterwards, with no extra dependency.
//
// A real table gives what a plain autofilter does not: the range extends by
// itself when a row is added (formats, validations and formulas follow), the
// rows are banded, and the columns are named.
//

// A structured table's column, targeted by its reference -- Tbl<Sheet>[Heading]
// -- rather than by an OFFSET/COUNTA range: the table extends by itself when
// an actor or a flow type is added, and the formula has nothing left to
// recompute. A real user had seen the old formula trigger, in their workbook,
// Excel's warning about "links to one or more external sources" -- the same
// symptom as a reference to ANOTHER WORKBOOK -- and had replaced it by hand
// with a table reference, which works. That is the form taken up here.
//
export interface NamedList {
  name: string;
  sheet: string;
  heading: string;
}

// An entry column constrained by a list. The formula is most often a plain
// range name -- which is one -- but it may also compute its list, for the FX_
// sheets' dependent lists.
export interface ValidationToApply {
  sheet: string;
  column: string;
  // Absent on a free-entry column: Excel accepts a validation with no
  // constraint, whose only effect is the tooltip. That is what makes it
  // possible to explain the columns no list guides AS WELL -- they were the
  // only ones saying nothing, although they are the ones people hesitate over.
  formule?: string;
  // The bubble Excel shows when a cell of the column is selected. The
  // showInputMessage flag had been set since day one, with no text to show.
  prompt?: { title: string; text: string };
}

export interface TableToApply {
  // The sheet's name, as it appears in the workbook.
  sheet: string;
  // Column headings, in order. They must reproduce the first row exactly: Excel
  // refuses a table whose declared header differs.
  columns: readonly string[];
  // The number of data rows already present.
  rows: number;
  // Calculated columns, by heading: Excel copies the formula onto every row
  // added to the table, and restores it if it is replaced by a typed value.
  formulaByColumn?: Readonly<Record<string, string>>;
  // The position (0 = A) of the table's first column on the sheet. Lets several
  // tables live side by side on one sheet -- Lists puts one per vocabulary,
  // each sized to its own content, rather than a single table padded to the
  // height of the longest.
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

// A deterministic fingerprint (djb2) of a string, in base36. Used to separate
// two tables whose sanitised names coincide, from the ORIGINAL sheet name
// rather than from a positional counter: the result therefore does not depend
// on the order the sheets are supplied in, which can vary from one generation
// to the next for the same data.
function fingerprint(text: string): string {
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

// A table name is an Excel defined name: no space, no punctuation, and it does
// not start with a digit.
//
// The "Tbl" prefix named the tables for the GenererOngletsManquants macro,
// which looks for "TblInterfaces" on the Interfaces sheet. Under another name
// it stops on "Tableau TblInterfaces introuvable".
//
// `column`, when supplied, tells apart several tables laid on the same sheet
// -- Lists carries one per vocabulary.
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

// The types SheetJS publishes do not describe the CFB container: it is handled
// through a minimal shape rather than bending the code to their gaps.
export type Conteneur = Parameters<typeof XLSX.CFB.write>[0];

export function readPart(cfb: Conteneur, path: string): string | null {
  const input = XLSX.CFB.find(cfb, path);
  if (!input || !input.content) return null;
  return new TextDecoder().decode(new Uint8Array(input.content as unknown as ArrayBufferLike));
}

export function writePart(cfb: Conteneur, path: string, content: string): void {
  const bytes = new TextEncoder().encode(content);
  XLSX.CFB.utils.cfb_add(cfb, path, bytes as unknown as number[]);
}

// How far a sheet's validations reach: at least enough to type comfortably in
// a brand-new workbook, and always beyond the last row actually written.
// Frozen at 1000, the validation gave up silently on a bigger workbook -- the
// 1001st entry was no longer checked at all.
const PLANCHER_VALIDATION = 1000;

// Adds only the missing <row>s: the sheet's dimension is set separately
// (applyTheTables), once the extent of ALL the tables it carries is known --
// a sheet like Lists receives several.
function materialiseRows(sheet: string, upTo: number): string {
  const present = new Set(
    [...sheet.matchAll(/<row r="(\d+)"/g)].map((m) => Number(m[1]))
  );
  const missing: string[] = [];
  for (let row = 1; row <= upTo; row++) {
    if (!present.has(row)) missing.push(`<row r="${row}"/>`);
  }
  return sheet.replace("</sheetData>", `${missing.join("")}</sheetData>`);
}

// The last column and the last row of a dimension reference -- a range
// ("A1:N1000") or, on a single-cell sheet, a bare cell ("A1").
//
function declaredExtent(ref: string): { columnIdx: number; row: number } {
  const last = ref.split(":").pop()!;
  const m = last.match(/^([A-Z]+)(\d+)$/);
  if (!m) return { columnIdx: 0, row: 1 };
  return { columnIdx: XLSX.utils.decode_col(m[1]), row: Number(m[2]) };
}

// Each defined name's reference targets the table actually laid down for the
// list concerned -- not tableName(sheet) recomputed alongside, which ignored
// that a sheet like Lists carries several and would have got the wrong one.
//
function definedNamesXml(
  lists: readonly NamedList[],
  tables: readonly TableToApply[],
  nomParTableau: ReadonlyMap<TableToApply, string>
): string {
  if (lists.length === 0) return "";
  const names = lists
    .map((l) => {
      const table = tables.find((t) => t.sheet === l.sheet && t.columns.includes(l.heading));
      if (!table) throw new Error(`list "${l.name}" : aucun table sur "${l.sheet}" ne porte "${l.heading}"`);
      // A table always covers at least one data row (see applyTheTables below),
      // even on a blank workbook: the reference therefore targets a one-cell
      // empty range rather than a null range, which Excel refuses in a
      // validation.
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
      // With no formula, a "none" validation: no constraint, only the tooltip.
      // Excel accepts it and shows no alert.
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

// A sheet's formatting. SheetJS in its community build DROPS cell styles on
// write -- verified: the cell comes out with no `s` attribute and styles.xml
// with no added font. The workbook therefore had no presentation at all, and
// the explanation sheet read like a slab of raw text.
//
//
// So they are applied here, in the same pass as the tables: four roles, no
// more. An open set of styles would become a styling engine, which an entry
// workbook has no business containing.
export type StyleRole = "title" | "section" | "body" | "aside" | "header";

export interface StyleToApply {
  sheet: string;
  // Cell addresses ("A1", "B12"), not ranges: only what exists is styled, and
  // the caller knows exactly which rows it wrote.
  cells: readonly string[];
  role: StyleRole;
}

// The fonts and fills added, in order. The starting indexes are read from the
// existing styles.xml: this ADDS, it does not replace, failing which the
// indexes SheetJS already set would become wrong.
// The workbook's default font is Calibri 12: nothing must go BELOW it. A body
// at 11 and notes at 10, as first set, wrote the explanation smaller than the
// data it explains.
//
// And no pale grey on white: #5B6472 held the WCAG threshold (5.98:1) without
// being comfortable for all that, especially in italic and at small sizes. The
// notes therefore move to a frank slate, 10.16:1, and keep the italic to stand
// apart -- it is the SHAPE that sets them back, not the paleness.
const ADDED_FONTS: Record<StyleRole, string> = {
  title: '<font><b/><sz val="18"/><color rgb="FF0E7DAD"/><name val="Calibri"/><family val="2"/></font>',
  section: '<font><b/><sz val="14"/><color rgb="FF14181F"/><name val="Calibri"/><family val="2"/></font>',
  body: '<font><sz val="12"/><color rgb="FF14181F"/><name val="Calibri"/><family val="2"/></font>',
  aside: '<font><i/><sz val="12"/><color rgb="FF39424F"/><name val="Calibri"/><family val="2"/></font>',
  header: '<font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>',
};

const ADDED_FILLS: Record<StyleRole, string | null> = {
  title: null,
  section: '<fill><patternFill patternType="solid"><fgColor rgb="FFEAF3F8"/><bgColor indexed="64"/></patternFill></fill>',
  body: null,
  aside: null,
  header: '<fill><patternFill patternType="solid"><fgColor rgb="FF0E7DAD"/><bgColor indexed="64"/></patternFill></fill>',
};

const ROLES: StyleRole[] = ["title", "section", "body", "aside", "header"];

// Long text must WRAP inside its cell. Without that, sentences have to be
// broken by hand in the code -- which is what the explanation sheet did, and
// which comes undone as soon as the column is widened.
function xfForRole(role: StyleRole, fontId: number, fillId: number | null): string {
  const result = role === "body" || role === "section" ? ' applyAlignment="1"' : "";
  const alignment =
    role === "body" || role === "section" ? '<alignment vertical="top" wrapText="1"/>' : "";
  const fill = fillId === null ? "" : ` fillId="${fillId}" applyFill="1"`;
  return `<xf numFmtId="0" fontId="${fontId}" borderId="0" xfId="0" applyFont="1"${fill}${result}>${alignment}</xf>`;
}

// Adds our styles to SheetJS's and returns the index of each.
function addTheStyles(styles: string): { xml: string; index: Record<StyleRole, number> } {
  const count = (tag: string) => Number(new RegExp(`<${tag} count="(\\d+)"`).exec(styles)?.[1] ?? "0");
  const nbPolices = count("fonts");
  const fillCount = count("fills");
  const nbXf = count("cellXfs");

  let nextFont = nbPolices;
  let nextFill = fillCount;
  const fontOf: Record<string, number> = {};
  const fillOf: Record<string, number> = {};
  const policesXml: string[] = [];
  const fillsXml: string[] = [];
  for (const role of ROLES) {
    fontOf[role] = nextFont++;
    policesXml.push(ADDED_FONTS[role]);
    const fill = ADDED_FILLS[role];
    if (fill) {
      fillOf[role] = nextFill++;
      fillsXml.push(fill);
    }
  }

  const index = {} as Record<StyleRole, number>;
  const xfsXml: string[] = [];
  ROLES.forEach((role, i) => {
    index[role] = nbXf + i;
    xfsXml.push(xfForRole(role, fontOf[role], fillOf[role] ?? null));
  });

  const xml = styles
    .replace(`<fonts count="${nbPolices}">`, `<fonts count="${nbPolices + policesXml.length}">`)
    .replace("</fonts>", `${policesXml.join("")}</fonts>`)
    .replace(`<fills count="${fillCount}">`, `<fills count="${fillCount + fillsXml.length}">`)
    .replace("</fills>", `${fillsXml.join("")}</fills>`)
    .replace(`<cellXfs count="${nbXf}">`, `<cellXfs count="${nbXf + xfsXml.length}">`)
    .replace("</cellXfs>", `${xfsXml.join("")}</cellXfs>`);
  return { xml, index };
}

// Sets the `s` attribute on the targeted cells of an already-written sheet.
function applyTheStyles(sheet: string, parCellule: Map<string, number>): string {
  return sheet.replace(/<c r="([A-Z]+\d+)"([^>]*?)(\/?)>/g, (tout, ref: string, attributs: string, closed: string) => {
    const style = parCellule.get(ref);
    if (style === undefined) return tout;
    const withoutStyle = attributs.replace(/\s+s="\d+"/, "");
    return `<c r="${ref}"${withoutStyle} s="${style}"${closed}>`;
  });
}

export interface OoxmlExtras {
  tables: readonly TableToApply[];
  lists?: readonly NamedList[];
  validations?: readonly ValidationToApply[];
  styles?: readonly StyleToApply[];
  // The sheets whose header row stays visible while scrolling. A thirty-row
  // entry sheet is filled in blind without it.
  panes?: readonly string[];
}

export function applyOoxmlExtras(bytes: ArrayBuffer, extras: OoxmlExtras | readonly TableToApply[]): ArrayBuffer {
  const {
    tables,
    lists = [],
    validations = [],
    styles = [],
    panes = [],
  } = Array.isArray(extras)
    ? { tables: extras as readonly TableToApply[], lists: [], validations: [], styles: [], panes: [] }
    : (extras as OoxmlExtras);
  const cfb = XLSX.CFB.read(new Uint8Array(bytes), { type: "array" });

  const workbook = readPart(cfb, "/xl/workbook.xml");
  if (!workbook) throw new Error("classeur illisible : xl/workbook.xml absent");

  // The order of sheets in workbook.xml = the order of the sheetN.xml files.
  const names = [...workbook.matchAll(/<sheet name="([^"]*)"/g)].map((m) =>
    m[1].replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")
  );

  let contentTypes = readPart(cfb, "/[Content_Types].xml");
  if (!contentTypes) throw new Error("classeur illisible : [Content_Types].xml absent");

  // Several tables can live on one sheet -- Lists puts one per vocabulary
  // (startColumn) -- and must leave only one <tableParts> there, only one set
  // of relations: so they are grouped by sheet rather than each table being
  // handled in isolation.
  const bySheet = new Map<string, TableToApply[]>();
  for (const table of tables) {
    const list = bySheet.get(table.sheet) ?? [];
    list.push(table);
    bySheet.set(table.sheet, list);
  }

  let idTable = 0;
  const nomParTableau = new Map<TableToApply, string>();
  const usedNames = new Set<string>();

  for (const [sheetName, tablesOfSheet] of bySheet) {
    const index = names.indexOf(sheetName);
    if (index < 0) throw new Error(`sheet "${sheetName}" absente du workbook`);

    const sheetNumber = index + 1;
    const sheetPath = `/xl/worksheets/sheet${sheetNumber}.xml`;
    let sheet = readPart(cfb, sheetPath);
    if (!sheet) throw new Error(`sheet "${sheetName}" absente du paquet`);

    // What SheetJS had already declared before this touched it: on Lists, that
    // is the helper area (columns J to Q, up to row 1000); on an FX_ sheet, it
    // is the column carrying the cell that names the sheet. The sheet's final
    // dimension is the maximum of that extent and of the tables' -- never one
    // in place of the other.
    const dimInitiale = sheet.match(/<dimension ref="([^"]*)"\/>/);
    const initialExtent = dimInitiale ? declaredExtent(dimInitiale[1]) : { columnIdx: 0, row: 1 };

    const relations: string[] = [];
    let lastSheetRow = initialExtent.row;
    let lastSheetColumnIndex = initialExtent.columnIdx;

    for (const table of tablesOfSheet) {
      idTable += 1;
      const startColumn = table.startColumn ?? 0;
      // A table covers its header AND at least one row: that is what Excel itself
      // writes for an empty table, and it refuses a table with no body.
      const lastRow = 1 + Math.max(1, table.rows);
      const lastColumnIndex = startColumn + table.columns.length - 1;
      const ref = `${XLSX.utils.encode_col(startColumn)}1:${XLSX.utils.encode_col(lastColumnIndex)}${lastRow}`;
      // Several tables on one sheet are told apart by their columns --
      // tableName(sheet) alone would fall back to the same name for each.
      //
      let name =
        tablesOfSheet.length > 1
          ? nomDeTableau(sheetName, table.columns.join("_"))
          : nomDeTableau(sheetName);
      // Two different sheets can sanitise to the same name -- two flow types
      // differing only in punctuation, for instance. A duplicate table name is
      // not a curiosity Excel tolerates: ECMA-376 §18.5.1.2 requires a unique
      // displayName within the workbook, and Excel resolves the collision by
      // deleting one of the two tables, silently.
      if (usedNames.has(name)) {
        const disambiguated = `${name}_${fingerprint(sheetName)}`;
        name = usedNames.has(disambiguated) ? `${disambiguated}_${idTable}` : disambiguated;
      }
      usedNames.add(name);
      nomParTableau.set(table, name);

      lastSheetRow = Math.max(lastSheetRow, lastRow);
      lastSheetColumnIndex = Math.max(lastSheetColumnIndex, lastColumnIndex);

      writePart(
        cfb,
        `/xl/tables/table${idTable}.xml`,
        xmlDuTableau(idTable, name, ref, table.columns, table.formulaByColumn)
      );
      relations.push(`<Relationship Id="rId${relations.length + 1}" Type="${NS_REL}/table" Target="../tables/table${idTable}.xml"/>`);

      contentTypes = contentTypes.replace(
        "</Types>",
        `<Override PartName="/xl/tables/table${idTable}.xml" ContentType="${TYPE_TABLE}"/></Types>`
      );
    }
    // One tablePart per relation, in the same order: rId1 for the first table
    // laid on this sheet, rId2 for the second, and so on.
    const tablePartsXml = relations.map((_, i) => `<tablePart r:id="rId${i + 1}"/>`).join("");

    writePart(
      cfb,
      `/xl/worksheets/_rels/sheet${sheetNumber}.xml.rels`,
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join("")}</Relationships>`
    );

    // The sheet autofilter would duplicate the table's, over the same range. It
    // is also what set the defined name _xlnm._FilterDatabase, which SheetJS
    // escaped badly as soon as the sheet name carried an apostrophe -- Excel
    // then offered to repair the workbook.
    // A table covers at least one data row. On an empty sheet, that row does
    // not exist in the XML: the dimension stops at the header and no <row>
    // follows. Excel then sees a table spilling out of the used area and offers
    // to repair the workbook. So the missing rows are materialised -- a <row>
    // with no cell is perfectly legal -- up to the most demanding of the
    // sheet's tables.
    sheet = materialiseRows(sheet, lastSheetRow).replace(/<autoFilter[^>]*\/>/, "");
    // The sheet's validations. The order of a sheet's elements is imposed by
    // the OOXML schema: dataValidations comes after sheetData and before
    // ignoredErrors, hence right after the data closes.
    const desValidations = xmlDesValidations(validations.filter((v) => v.sheet === sheetName), lastSheetRow);
    // "tableParts" goes last in a sheet, right before it closes: the order of
    // elements is imposed by the OOXML schema.
    sheet = sheet
      .replace("</sheetData>", `</sheetData>${desValidations}`)
      .replace("</worksheet>", `<tableParts count="${relations.length}">${tablePartsXml}</tableParts></worksheet>`)
      .replace(
        /<dimension ref="[^"]*"\/>/,
        `<dimension ref="A1:${XLSX.utils.encode_col(lastSheetColumnIndex)}${lastSheetRow}"/>`
      );

    writePart(cfb, sheetPath, sheet);
  }

  // SheetJS always writes a "metadata" part describing dynamic arrays, to which
  // no cell attaches here. An orphan part brings nothing and gives Excel one
  // more occasion to find the workbook dubious: it is removed, along with its
  // declaration and its relation.
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

  // The formatting and the frozen panes, on sheets the table loop does not
  // necessarily visit: they are therefore applied separately, but in the same
  // pass -- the workbook is opened only once.
  if (styles.length > 0) {
    const stylesXml = readPart(cfb, "/xl/styles.xml");
    if (!stylesXml) throw new Error("classeur illisible : xl/styles.xml absent");
    const { xml, index } = addTheStyles(stylesXml);
    writePart(cfb, "/xl/styles.xml", xml);
    const styleBySheet = new Map<string, Map<string, number>>();
    for (const style of styles) {
      const map = styleBySheet.get(style.sheet) ?? new Map<string, number>();
      for (const cellule of style.cells) map.set(cellule, index[style.role]);
      styleBySheet.set(style.sheet, map);
    }
    for (const [sheetName, map] of styleBySheet) {
      const i = names.indexOf(sheetName);
      if (i < 0) throw new Error(`sheet "${sheetName}" absente du workbook`);
      const path = `/xl/worksheets/sheet${i + 1}.xml`;
      const content = readPart(cfb, path);
      if (content) writePart(cfb, path, applyTheStyles(content, map));
    }
  }

  for (const sheetName of panes) {
    const i = names.indexOf(sheetName);
    if (i < 0) continue;
    const path = `/xl/worksheets/sheet${i + 1}.xml`;
    const content = readPart(cfb, path);
    if (!content || content.includes("<pane ")) continue;
    // The header row stays on screen: a thirty-row entry sheet is filled in
    // blind without it.
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
  // The original defined names came from the sheet autofilters, which have just
  // been removed; they are replaced by the drop-downs' named ranges.
  writePart(
    cfb,
    "/xl/workbook.xml",
    workbook
      .replace(/<definedNames>.*?<\/definedNames>/, "")
      .replace("</sheets>", `</sheets>${definedNamesXml(lists, tables, nomParTableau)}`)
  );

  const output = XLSX.CFB.write(cfb, { fileType: "zip", type: "array" }) as unknown as number[];
  return new Uint8Array(output).buffer;
}
