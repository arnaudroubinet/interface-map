import * as XLSX from "xlsx";
import { downloadWorkbook } from "./download";
import {
  ACTOR_COLUMNS,
  GROUP_COLUMNS,
  ACTOR_TYPE_COLUMNS,
  ICON_PREVIEW_COLUMN,
  FLOW_TYPE_COLUMNS,
  INTERFACE_COLUMNS,
  FX_COLUMNS,
  REPUBLICATION_COLUMN,
  MILESTONE_COLUMNS,
  VALIDITY_COLUMNS,
  SCHEMA_VERSION,
  VERSION_SHEET,
  SCHEMA_VERSION_COLUMN,
  FX_SHEET_PREFIX,
  sanitiseTabName,
  FORBIDDEN_TAB_CHARACTERS,
  TAB_REPLACEMENT_CHARACTER,
  MAX_TAB_LENGTH,
  FX_SHEET_SEPARATOR,
  REF_ACTORS_SHEET,
  REF_TECHNOLOGIES_SHEET,
  REF_ACTOR_COLUMNS,
  REF_TECHNOLOGY_COLUMNS,
} from "../parsing/build-model";
import { AVAILABLE_ICONS, ICON_PREVIEWS } from "../render/icons";
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
import { DEFAULT_ICONS, LISTES, INSTRUCTIONS, FLOW_TYPES, type RowRole } from "./template-data";
import { NO_REFERENTIAL } from "./datamashup";
import type { ReferentialUrls } from "./datamashup";

// The vocabularies and the instructions live in template-data.ts; this module
// is nothing more than the machinery that assembles them into a workbook.
export { LISTES, FLOW_TYPES } from "./template-data";
// The referential sheets' names, re-exported for whoever wants to point at
// them without reaching into build-model.ts directly.
export { REF_ACTORS_SHEET, REF_TECHNOLOGIES_SHEET } from "../parsing/build-model";



function sheet(rows: (string | number)[][], widths: number[], filtrable = true): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = widths.map((wch) => ({ wch }));
  // The autofilter generates a defined name "_xlnm._FilterDatabase" quoting the
  // sheet's name between apostrophes. SheetJS does NOT double the inner
  // apostrophe of "Mode d'emploi", which produces a malformed defined name --
  // Excel then opens on a repair prompt, where SheetJS rereads its own file
  // without noticing a thing. A prose sheet has nothing to filter anyway.
  //
  if (filtrable && rows.length > 0) {
    ws["!autofilter"] = {
      ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: rows[0].length - 1 } }),
    };
  }
  return ws;
}

// An entry sheet: its header row, and nothing else. The widths follow the
// title's length, for want of data to calibrate them on.
function emptySheet(columns: readonly string[]): XLSX.WorkSheet {
  return sheet([[...columns]], columns.map((c) => Math.max(14, c.length + 4)));
}

// The third column shows the icon chosen on the row. It is not typed in: it is
// a formula, copied by Excel onto every new row of the table (a calculated
// column). It fetches the preview from the Lists sheet, opposite the name
// chosen.
//
// Range references, NOT structured references. The previous version wrote
// "T_Lists[Preview]": Excel loads the tables in order, and T_Lists is the
// seventh — it did not exist yet when Excel validated the third, which it
// therefore deleted while offering to repair the workbook. Its log said so
// word for word: "Records removed: Table from /xl/tables/table3.xml".
//
// The lists sheet's name, in one place only. It used to be spelled out in the
// formulas and once more at creation time: the switch to English renamed the
// latter and forgot the former, and Excel read "Listes!" as a reference to
// ANOTHER WORKBOOK -- hence the external-links warning, and drop-downs that no
// longer filled.
//
export const LISTS_SHEET = "Lists";

export function previewFormula(row: number): string {
  const icon = listColumn("Icon");
  const preview = listColumn("Preview");
  return `IFERROR(INDEX(${LISTS_SHEET}!$${preview}:$${preview},MATCH(B${row},${LISTS_SHEET}!$${icon}:$${icon},0)),"")`;
}

// The only pre-filled sheet: without it every actor would carry the neutral
// token and an integrity check would light up on a brand-new workbook.
function actorTypesSheet(declared: readonly (readonly string[])[]): XLSX.WorkSheet {
  const rows = declared.length > 0 ? declared.map((l) => [...l]) : DEFAULT_ICONS.map(([t, i]) => [t, i]);
  const headers = [...ACTOR_TYPE_COLUMNS, ICON_PREVIEW_COLUMN];
  // The Preview column follows ACTOR_TYPE_COLUMNS rather than a hard-coded
  // letter: adding "Nature" shifted it from C to D, and a frozen letter would
  // have overwritten the neighbouring column instead of the expected formula.
  const previewColumn = XLSX.utils.encode_col(ACTOR_TYPE_COLUMNS.length);
  const ws = sheet([headers, ...rows], [22, 18, 14, 12]);
  rows.forEach(([, icon], rank) => {
    // The cached value is the one Excel will recompute anyway: it is there so
    // that the preview shows correctly from the moment the file opens, before
    // the first recalculation.
    ws[`${previewColumn}${rank + 2}`] = { t: "str", f: previewFormula(rank + 2), v: ICON_PREVIEWS[icon] ?? "" };
  });
  ws["!ref"] = `A1:${previewColumn}${rows.length + 1}`;
  return ws;
}

// The workbook's schema number, on a sheet of its own. A single value on a
// hidden sheet: this is not data to be entered, it is the format's signature,
// the one that tells the tool whether it can read this file as it stands.
function versionSheet(): XLSX.WorkSheet {
  return sheet([[SCHEMA_VERSION_COLUMN], [SCHEMA_VERSION]], [20], false);
}

// The FX_ sheets carry, outside the entry table and in a hidden column, a cell
// giving the name of their own sheet. The two dependent validations thereby
// know which sheet they are on, and the cell follows any copy or rename of the
// sheet. One cell per sheet rather than the expression repeated in every
// validation: CELL is volatile.
//
export const EXTRA_COLUMN = XLSX.utils.encode_col(FX_COLUMNS.length + 1);
export const TAB_CELL = `${EXTRA_COLUMN}1`;
const TAB_NAME_FORMULA =
  'MID(CELL("filename",$A$1),FIND("]",CELL("filename",$A$1))+1,255)';

// A function newer than Excel 2007 is STORED in the file under a prefixed name
// -- "_xlfn.", and "_xlfn._xlws." for those valid only on a worksheet. Excel
// redisplays them without the prefix. Without it, Excel does not recognise the
// function, deletes the formula and offers to repair the workbook: which is
// exactly what it did on a first version.
const STORED_NAMES: Record<string, string> = {
  FILTER: "_xlfn._xlws.FILTER",
  SORT: "_xlfn._xlws.SORT",
  UNIQUE: "_xlfn.UNIQUE",
  SEQUENCE: "_xlfn.SEQUENCE",
  HSTACK: "_xlfn.HSTACK",
};

function nameForExcel(formula: string): string {
  return formula.replace(
    new RegExp(`(?<![.A-Za-z_])(${Object.keys(STORED_NAMES).join("|")})\\(`, "g"),
    (_, name: string) => `${STORED_NAMES[name]}(`
  );
}

// The helper tables read the Interfaces sheet over a range declared in
// advance -- a spilled formula always returns the same height. That range must
// exceed the number of interfaces written, failing which the dependent lists
// silently stop seeing the last flows. The floor leaves room to type in a
// brand-new workbook.
const LIST_ROWS_MARGIN = 1000;
const lastListRow = (nbInterfaces: number) => nbInterfaces + LIST_ROWS_MARGIN;

// Where the two helper tables sit on the Lists sheet: after the vocabulary
// columns, separated from them and from each other by a blank column, so that
// what is typed can be told by eye from what is computed.
function extraColumns() {
  const base = Object.keys(LISTES).length;
  const col = (i: number) => XLSX.utils.encode_col(base + i);
  return {
    versionKey: col(1),
    version: col(2),
    flowTab: col(4),
    flows: col(5),
    provider: col(7),
    publishedInterface: col(8),
  };
}

// Both tables are LIVE: frozen at generation time they would stop being right
// the moment the first interface was added in Excel. Hence spilled formulas,
// over a fixed range declared in advance -- INDEX + SEQUENCE always return the
// same height, and IFERROR empties the surplus.
// The Excel formula reproduces sanitiseTabName's sanitising identically. It
// rebuilds the sheet name to find the flows attached to it: shortened on one
// side only, that name would designate nothing any more and the dependent
// lists of a long-named sheet would stay empty.
function sanitiseTabFormula(expression: string): string {
  const sanitised = FORBIDDEN_TAB_CHARACTERS.reduce(
    (current, forbidden) => `SUBSTITUTE(${current},"${forbidden}","${TAB_REPLACEMENT_CHARACTER}")`,
    expression
  );
  return `LEFT(${sanitised},${MAX_TAB_LENGTH})`;
}

function helperFormulas(lastRow: number): { cell: string; ref: string; formula: string }[] {
  const c = extraColumns();
  const range = (column: string) => `Interfaces!$${column}$2:$${column}$${lastRow}`;
  const flows = range(columnOf(INTERFACE_COLUMNS, "Flow name"));
  const version = range(columnOf(INTERFACE_COLUMNS, "Version"));
  const provider = range(columnOf(INTERFACE_COLUMNS, "Provider"));
  const type = range(columnOf(INTERFACE_COLUMNS, "Flow type"));
  // The expected sheet, rebuilt as everywhere else in the project
  // (expectedFxSheet, in parsing/build-model.ts, is authoritative).
  const tab = sanitiseTabFormula(`"${FX_SHEET_PREFIX}"&${provider}&"${FX_SHEET_SEPARATOR}"&${type}`);
  const notEmpty = `${flows}<>""`;
  const spread = (table: string) =>
    nameForExcel(`IFERROR(INDEX(${table},SEQUENCE(${lastRow - 1}),{1,2}),"")`);

  return [
    {
      // Key (sheet|flow) and version, sorted by key: it is the sort that makes
      // one flow's versions contiguous, the condition for MATCH + COUNTIF.
      cell: `${c.versionKey}2`,
      ref: `${c.versionKey}2:${c.version}${lastRow}`,
      formula: spread(`SORT(FILTER(HSTACK(${tab}&"|"&${flows},${version}),${notEmpty}),1,1)`),
    },
    {
      // (sheet, flow) pairs deduplicated: without UNIQUE, a flow with three
      // versions would appear three times in the drop-down.
      cell: `${c.flowTab}2`,
      ref: `${c.flowTab}2:${c.flows}${lastRow}`,
      formula: spread(`SORT(UNIQUE(FILTER(HSTACK(${tab},${flows}),${notEmpty})),1,1)`),
    },
    {
      // (publisher, versioned interface) pairs, sorted by publisher: this is what
      // feeds an FX_ sheet's "Republished as" list, where only the interfaces of
      // the row's actor may be offered. The version is in the label: two versions
      // of one flow are two possible republications, and conflating them would
      // amount to guessing.
      cell: `${c.provider}2`,
      ref: `${c.provider}2:${c.publishedInterface}${lastRow}`,
      // The versioned label, built like interfaceLabel: the name, a space only if
      // there is a version, then the version.
      formula: spread(
        `SORT(UNIQUE(FILTER(HSTACK(${provider},${flows}&IF(${version}="",""," ")&${version}),${notEmpty})),1,1)`
      ),
    },
  ];
}

function listsSheet(lastRow: number): XLSX.WorkSheet {
  const headers = Object.keys(LISTES);
  const height = Math.max(...headers.map((e) => LISTES[e].length));
  const rows: string[][] = [headers];
  for (let i = 0; i < height; i++) {
    rows.push(headers.map((e) => LISTES[e][i] ?? ""));
  }
  const ws = sheet(rows, headers.map((e) => Math.max(16, e.length + 4)), false);

  const c = extraColumns();
  const titles: [string, string][] = [
    [`${c.versionKey}1`, "CleFluxVersion"],
    [`${c.version}1`, "VersionDuFlux"],
    [`${c.flowTab}1`, "OngletDuFlux"],
    [`${c.flows}1`, "FluxDeLOnglet"],
    [`${c.provider}1`, "ActeurExposant"],
    [`${c.publishedInterface}1`, "InterfaceExposee"],
  ];
  for (const [address, title] of titles) ws[address] = { t: "s", v: title };
  for (const { cell, ref, formula } of helperFormulas(lastRow)) {
    ws[cell] = { t: "s", v: "", f: formula, F: ref };
  }
  ws["!ref"] = `A1:${c.publishedInterface}${lastRow}`;
  return ws;
}

// What fills the workbook. Empty gives the template; filled gives the sample
// file -- same structure, same tables, same drop-downs, one single mechanism
// to maintain.
export interface WorkbookData {
  // The workbook's two referentials. Empty, they fall back to the seed: that is
  // the blank template's case. Filled, they are taken as they are -- an upgrade
  // replacing them with the seed would erase the types the team declared, and
  // break every interface referring to them.
  flowTypes: readonly (readonly string[])[];
  actorTypes: readonly (readonly string[])[];
  milestones: readonly (readonly string[])[];
  groups: readonly (readonly string[])[];
  actors: readonly (readonly string[])[];
  interfaces: readonly (readonly string[])[];
  fx: readonly { name: string; rows: readonly (readonly string[])[] }[];
  // Where the two referentials are published. Absent means the workbook has
  // none, which is an ordinary state.
  referentials?: ReferentialUrls;
}

const EMPTY_WORKBOOK: WorkbookData = { flowTypes: [], actorTypes: [], milestones: [], groups: [], actors: [], interfaces: [], fx: [] };

// An FX_<publisher>_<type> sheet longer than 31 characters, or carrying a
// character Excel refuses in a sheet name, would fail the writing of the whole
// workbook -- whereas a real referential has long actor and technology names.
// It is dropped instead, as dataFromModel() (schema-upgrade.ts) already does
// when repairing a current workbook: the interface stays in the catalogue, and
// the integrity check, which already knows how to say "its expected FX_ sheet
// does not exist", reports it on re-reading -- so this is not a silence.
//
// The consumption sheets, under the name Excel accepts. The rule is the one in
// expectedFxSheet and it lives in one place only: applying it here as well
// makes the writing total -- before, an overlong name was dropped in silence,
// and its consumptions disappeared from the produced workbook.
function fxTabs(data: WorkbookData): WorkbookData["fx"] {
  return data.fx.map((o) => ({ ...o, name: sanitiseTabName(o.name) }));
}

function filledSheet(columns: readonly string[], rows: readonly (readonly string[])[], widths: number[]) {
  return sheet([[...columns], ...rows.map((l) => [...l])], widths);
}

// A consumption sheet: the entry table, plus the cell naming it, in a hidden
// column beyond the table.
function fxSheet(rows: readonly (readonly string[])[], widths: number[]): XLSX.WorkSheet {
  const ws = filledSheet(FX_COLUMNS, rows, widths);
  ws[TAB_CELL] = { t: "s", v: "", f: TAB_NAME_FORMULA };
  ws["!ref"] = `A1:${EXTRA_COLUMN}${Math.max(2, rows.length + 1)}`;
  const cols = (ws["!cols"] ??= []);
  while (cols.length <= FX_COLUMNS.length + 1) cols.push({ wch: 10 });
  cols[FX_COLUMNS.length + 1] = { hidden: true, wch: 10 };
  return ws;
}

export function buildTemplateWorkbook(data: WorkbookData = EMPTY_WORKBOOK): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const actorWidths = ACTOR_COLUMNS.map((c) => Math.max(16, c.length + 4));
  const interfaceWidths = INTERFACE_COLUMNS.map((c) => Math.max(18, c.length + 4));
  const fxWidths = FX_COLUMNS.map((c) => Math.max(16, c.length + 4));

  XLSX.utils.book_append_sheet(wb, sheet(INSTRUCTIONS.map((l) => [l.left, l.right]), [26, 104], false), "Instructions");
  XLSX.utils.book_append_sheet(wb, filledSheet(ACTOR_COLUMNS, data.actors, actorWidths), "Actors");
  XLSX.utils.book_append_sheet(wb, filledSheet(GROUP_COLUMNS, data.groups, [24, 16]), "Groups");
  // Visible, and placed early: the platform's chronology is entered, it is not
  // deduced, and every other sheet's two validity bounds draw their list from
  // it.
  XLSX.utils.book_append_sheet(
    wb,
    filledSheet(MILESTONE_COLUMNS, data.milestones, MILESTONE_COLUMNS.map((c) => Math.max(14, c.length + 4))),
    "Milestones"
  );

  XLSX.utils.book_append_sheet(wb, actorTypesSheet(data.actorTypes), "ActorTypes");

  XLSX.utils.book_append_sheet(
    wb,
    sheet(
      [[...FLOW_TYPE_COLUMNS], ...(data.flowTypes.length > 0 ? data.flowTypes : FLOW_TYPES).map((t) => [...t])],
      [22, 26, 62]
    ),
    "FlowTypes"
  );
  XLSX.utils.book_append_sheet(wb, filledSheet(INTERFACE_COLUMNS, data.interfaces, interfaceWidths), "Interfaces");
  for (const tab of fxTabs(data)) {
    XLSX.utils.book_append_sheet(wb, fxSheet(tab.rows, fxWidths), tab.name);
  }
  XLSX.utils.book_append_sheet(wb, listsSheet(lastListRow(data.interfaces.length)), LISTS_SHEET);
  // Query-owned, and therefore empty here: Excel pours the rows in on the first
  // refresh. The header row alone is written, so the structured table has
  // something to declare.
  XLSX.utils.book_append_sheet(wb, sheet([[...REF_ACTOR_COLUMNS]], REF_ACTOR_COLUMNS.map(() => 20)), REF_ACTORS_SHEET);
  XLSX.utils.book_append_sheet(
    wb,
    sheet([[...REF_TECHNOLOGY_COLUMNS]], REF_TECHNOLOGY_COLUMNS.map(() => 20)),
    REF_TECHNOLOGIES_SHEET
  );
  XLSX.utils.book_append_sheet(wb, versionSheet(), VERSION_SHEET);

  // Lists feeds the drop-downs, Version carries the format's signature: neither
  // one is filled by hand. Hidden, they can no longer be confused with the entry
  // sheets.
  const hidden = new Set([LISTS_SHEET, VERSION_SHEET, REF_ACTORS_SHEET, REF_TECHNOLOGIES_SHEET]);
  wb.Workbook = { Sheets: wb.SheetNames.map((name) => ({ Hidden: hidden.has(name) ? 1 : 0 })) };

  return wb;
}

// The entry sheets become real Excel tables: the range follows the rows one
// adds, instead of leaving filters and formats behind.
// The prose sheet is not one.
// An empty referential falls back to its seed; filled, it is taken as it is --
// a rule applied by both sheets concerned. The structured table must count the
// SAME rows: sized on the seed, it spills into blank rows when the team has
// removed some, and leaves the types it added outside the table, hence outside
// the drop-down that targets it.
const writtenRows = (declared: readonly unknown[], seed: readonly unknown[]) =>
  declared.length > 0 ? declared.length : seed.length;

export function tablesOfTemplate(data: WorkbookData = EMPTY_WORKBOOK): TableToApply[] {
  // Per query, not per workbook: queriesOf (datamashup.ts) only writes the M
  // section for a URL that is actually set -- "a query pointing nowhere is not
  // written". Marking a table as a queryTable for a query that was never
  // written would leave its connection pointing at nothing, which is worse
  // than the ordinary, query-less table this sheet gets when its URL is blank.
  const referentials = data.referentials ?? NO_REFERENTIAL;
  return [
    { sheet: "Actors", columns: ACTOR_COLUMNS, rows: data.actors.length },
    { sheet: "Groups", columns: GROUP_COLUMNS, rows: data.groups.length },
    { sheet: "Milestones", columns: MILESTONE_COLUMNS, rows: data.milestones.length },
    {
      sheet: "ActorTypes",
      columns: [...ACTOR_TYPE_COLUMNS, ICON_PREVIEW_COLUMN],
      rows: writtenRows(data.actorTypes, DEFAULT_ICONS),
      // Calculated column: Excel fills it by itself on the rows added. The
      // formula stored in the table is the first data row's: Excel shifts it
      // itself onto the following rows.
      formulaByColumn: { [ICON_PREVIEW_COLUMN]: previewFormula(2) },
    },
    { sheet: "FlowTypes", columns: FLOW_TYPE_COLUMNS, rows: writtenRows(data.flowTypes, FLOW_TYPES) },
    { sheet: "Interfaces", columns: INTERFACE_COLUMNS, rows: data.interfaces.length },
    ...fxTabs(data).map((o) => ({ sheet: o.name, columns: FX_COLUMNS, rows: o.rows.length })),
    // One table PER vocabulary, sized to its own content -- not a single table
    // covering all eight columns, sized on the longest one (Icon): the shorter
    // lists would otherwise have been padded with blank rows up to that height,
    // visible in the drop-down and counted by COUNTA since SheetJS writes empty
    // string cells there rather than writing nothing at all.
    //
    ...Object.keys(LISTES).map((key, index) => ({
      sheet: LISTS_SHEET,
      columns: [key],
      rows: LISTES[key].length,
      startColumn: index,
    })),
    {
      sheet: REF_ACTORS_SHEET,
      columns: REF_ACTOR_COLUMNS,
      rows: 0,
      query: referentials.actors.trim() ? REF_ACTORS_SHEET : undefined,
    },
    {
      sheet: REF_TECHNOLOGIES_SHEET,
      columns: REF_TECHNOLOGY_COLUMNS,
      rows: 0,
      query: referentials.technologies.trim() ? REF_TECHNOLOGIES_SHEET : undefined,
    },
  ];
}

// The Lists column carrying a given vocabulary, computed from the order of
// LISTS: adding an entry must not silently shift every drop-down.
//
function listColumn(key: string): string {
  const index = Object.keys(LISTES).indexOf(key);
  if (index < 0) throw new Error(`unknown vocabulary: ${key}`);
  return XLSX.utils.encode_col(index);
}

// "Every reference to an actor or a type goes through a drop-down. Never type a
// name by hand: a spelling variant creates a phantom actor." -- the workbook's
// rule, enforced by the file itself.
export function listsOfTemplate(): NamedList[] {
  return [
    { name: "L_Perimetre", sheet: LISTS_SHEET, heading: "Perimeter" },
    { name: "L_Sens", sheet: LISTS_SHEET, heading: "Direction" },
    { name: "L_Decision", sheet: LISTS_SHEET, heading: "Decision" },
    { name: "L_Criticite", sheet: LISTS_SHEET, heading: "Criticality" },
    { name: "L_Confirmation", sheet: LISTS_SHEET, heading: "Confirmation" },
    { name: "L_Icone", sheet: LISTS_SHEET, heading: "Icon" },
    { name: "L_Nature", sheet: LISTS_SHEET, heading: "Nature" },
    // These three point at entry sheets: the list grows as the workbook gets
    // filled in.
    { name: "L_TypeActeur", sheet: "ActorTypes", heading: "Actor type" },
    { name: "L_Acteur", sheet: "Actors", heading: "Name" },
    { name: "L_Groupe", sheet: "Groups", heading: "Group" },
    { name: "L_TypeFlux", sheet: "FlowTypes", heading: "Flow type" },
    { name: "L_Palier", sheet: "Milestones", heading: "Milestone" },
    // The referential's vocabulary. It grows on refresh, so a named range over
    // the table follows it without anything to recompute.
    { name: "L_RefActeur", sheet: REF_ACTORS_SHEET, heading: "Name" },
    { name: "L_RefGroupe", sheet: REF_ACTORS_SHEET, heading: "Group" },
    { name: "L_RefTypeActeur", sheet: REF_ACTORS_SHEET, heading: "Actor type" },
    { name: "L_RefTypeFlux", sheet: REF_TECHNOLOGIES_SHEET, heading: "Flow type" },
  ];
}

export function columnOf(columns: readonly string[], heading: string): string {
  const index = columns.indexOf(heading);
  if (index < 0) throw new Error(`column "${heading}" absente`);
  return XLSX.utils.encode_col(index);
}

// An FX_ sheet's two dependent lists. OFFSET carves out of the helper table
// the contiguous block MATCH locates and COUNTIF sizes -- MAX(1,...) because
// Excel refuses a range of zero height.
function dependentFormulas(lastRow: number) {
  const c = extraColumns();
  const flowColumn = columnOf(FX_COLUMNS, "Flow name");
  const consumerColumn = columnOf(FX_COLUMNS, "Consumer");
  const block = (key: string, colKey: string, colValue: string) => {
    const keys = `${LISTS_SHEET}!$${colKey}$2:$${colKey}$${lastRow}`;
    return `OFFSET(${LISTS_SHEET}!$${colValue}$2,MATCH(${key},${keys},0)-1,0,MAX(1,COUNTIF(${keys},${key})),1)`;
  };
  return {
    // THIS sheet's flows: the key is the sheet's name, carried by the helper
    // cell.
    flows: block(`$${EXTRA_COLUMN}$1`, c.flowTab, c.flows),
    // THIS row's flow's versions: the reference to the flow column is relative
    // in row, so Excel shifts the formula from one row to the next.
    version: block(`$${EXTRA_COLUMN}$1&"|"&$${flowColumn}2`, c.versionKey, c.version),
    // The interfaces published by THIS row's consumer: a republication can only
    // name an interface of its own actor.
    republication: block(`$${consumerColumn}2`, c.provider, c.publishedInterface),
  };
}

// What Excel says when a cell is selected, column by column. Only what the
// header does not already say is commented: the entry order when one list
// depends on another, and a value's exact meaning when it is hard to guess.
// Excel caps the title at 32 characters and the text at 255.
// Exported so the test can check that no prompt targets a non-existent column
// -- illusory coverage is worse than a known hole.
export const PROMPTS: Record<string, { title: string; text: string }> = {
  "Flow name": { title: "Interface", text: "An interface exposed by this sheet's provider. Declare it on the Interfaces sheet first." },
  // The original defect: without the flow, this list's source is #N/A and the
  // list does not open. The behaviour is right, it just failed to say so.
  Version: { title: "Version", text: "Fill in Flow name first: the versions offered are the ones declared for that interface." },
  // One and the same heading does not mean the same thing everywhere: on
  // Interfaces, "Version" is the version ONE DECLARES, not one to pick from a
  // list. The sheet-qualified key wins over the bare key.
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

  // --- FREE-entry columns. No list guides them, and they were the only ones
  // saying nothing -- although they are the ones people hesitate over.
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

// The sheet first, the heading second: one and the same column name does not
// mean the same thing from one sheet to the next.
function promptFor(sheet: string, heading: string): { title: string; text: string } | undefined {
  return PROMPTS[`${sheet}.${heading}`] ?? PROMPTS[heading];
}

// The lists a query fills, told apart from the ones the workbook owns by the
// sheet they read: a list added on a Ref* sheet tomorrow is covered without
// anything to remember here.
export function referentialListNames(): string[] {
  return listsOfTemplate()
    .filter((l) => l.sheet === REF_ACTORS_SHEET || l.sheet === REF_TECHNOLOGIES_SHEET)
    .map((l) => l.name);
}

export function validationsOfTemplate(data: WorkbookData = EMPTY_WORKBOOK): ValidationToApply[] {
  const fromReferential = new Set(referentialListNames());
  const v = (sheet: string, columns: readonly string[], heading: string, formula?: string) => ({
    sheet,
    column: columnOf(columns, heading),
    formula,
    prompt: promptFor(sheet, heading),
    suggestsOnly: formula !== undefined && fromReferential.has(formula),
  });

  // Every column no list guides still gets its tooltip: that is half the
  // workbook, and it was the mute half. This starts from the COLUMN LIST rather
  // than a hand-written enumeration -- a column added tomorrow thereby inherits
  // the same treatment, or reports itself by the absence of a prompt.
  //
  const free = (sheet: string, columns: readonly string[], guided: readonly string[]) =>
    columns.filter((c) => !guided.includes(c) && promptFor(sheet, c)).map((c) => v(sheet, columns, c));
  const dependent = dependentFormulas(lastListRow(data.interfaces.length));
  // The two validity bounds are set wherever objects are dated, and always the
  // same way.
  const bounds = (sheet: string, columns: readonly string[]) =>
    VALIDITY_COLUMNS.map((heading) => v(sheet, columns, heading, "L_Palier"));

  const GUIDED_FX_COLUMNS = [
    "Flow name",
    "Version",
    "Consumer",
    "Criticality for this consumer",
    "Decision",
    REPUBLICATION_COLUMN,
    ...VALIDITY_COLUMNS,
  ];
  const fxLists = (sheet: string) => [
    v(sheet, FX_COLUMNS, "Flow name", dependent.flows),
    v(sheet, FX_COLUMNS, "Version", dependent.version),
    v(sheet, FX_COLUMNS, "Consumer", "L_Acteur"),
    v(sheet, FX_COLUMNS, "Criticality for this consumer", "L_Criticite"),
    v(sheet, FX_COLUMNS, "Decision", "L_Decision"),
    v(sheet, FX_COLUMNS, REPUBLICATION_COLUMN, dependent.republication),
    ...bounds(sheet, FX_COLUMNS),
    ...free(sheet, FX_COLUMNS, GUIDED_FX_COLUMNS),
  ];
  return [
    v("Actors", ACTOR_COLUMNS, "Name", "L_RefActeur"),
    // The group and the actor type stay on the LOCAL sheets, although the
    // referential carries both. The integrity check holds "Groups" to be
    // authoritative and counts an anomaly against any group absent from it,
    // and "ActorTypes" alone carries each type's icon. A drop-down offering the
    // referential's values would therefore propose exactly what the report
    // marks red, and draw a component with no icon.
    v("Actors", ACTOR_COLUMNS, "Group", "L_Groupe"),
    v("Actors", ACTOR_COLUMNS, "Actor type", "L_TypeActeur"),
    v("FlowTypes", FLOW_TYPE_COLUMNS, "Flow type", "L_RefTypeFlux"),
    v("Groups", GROUP_COLUMNS, "Perimeter", "L_Perimetre"),
    v("ActorTypes", ACTOR_TYPE_COLUMNS, "Icon", "L_Icone"),
    v("ActorTypes", ACTOR_TYPE_COLUMNS, "Nature", "L_Nature"),
    v("FlowTypes", FLOW_TYPE_COLUMNS, "Direction", "L_Sens"),
    v("Interfaces", INTERFACE_COLUMNS, "Provider", "L_Acteur"),
    v("Interfaces", INTERFACE_COLUMNS, "Flow type", "L_TypeFlux"),
    v("Interfaces", INTERFACE_COLUMNS, "To confirm", "L_Confirmation"),
    ...bounds("Actors", ACTOR_COLUMNS),
    ...bounds("Interfaces", INTERFACE_COLUMNS),
    ...free("Actors", ACTOR_COLUMNS, ["Name", "Group", "Actor type", ...VALIDITY_COLUMNS]),
    ...free("Groups", GROUP_COLUMNS, ["Perimeter"]),
    ...free("Milestones", MILESTONE_COLUMNS, []),
    ...free("ActorTypes", ACTOR_TYPE_COLUMNS, ["Icon", "Nature"]),
    ...free("FlowTypes", FLOW_TYPE_COLUMNS, ["Flow type", "Direction"]),
    ...free("Interfaces", INTERFACE_COLUMNS, ["Provider", "Flow type", "To confirm", ...VALIDITY_COLUMNS]),
    // The filled flow sheets get the same lists as their pattern.
    ...fxTabs(data).flatMap((o) => fxLists(o.name)),
  ];
}

// The entry sheets and their columns, in one place: the header to style, the
// pane to freeze and the prompt to set are all three deduced from it.
const ENTRY_SHEETS: [string, readonly string[]][] = [
  ["Actors", ACTOR_COLUMNS],
  ["Groups", GROUP_COLUMNS],
  ["Milestones", MILESTONE_COLUMNS],
  ["ActorTypes", ACTOR_TYPE_COLUMNS],
  ["FlowTypes", FLOW_TYPE_COLUMNS],
  ["Interfaces", INTERFACE_COLUMNS],
];

// The formatting of the explanation sheet: each row's role decides its style,
// which is what allows sentences to no longer be broken by hand.
// Both columns get the same style -- a section with only its left half
// coloured would look like an alignment mistake.
export function stylesOfTemplate(): StyleToApply[] {
  const byRole = new Map<RowRole, string[]>();
  INSTRUCTIONS.forEach((row, i) => {
    const cells = byRole.get(row.role) ?? [];
    cells.push(`A${i + 1}`, `B${i + 1}`);
    byRole.set(row.role, cells);
  });
  const styles: StyleToApply[] = [...byRole.entries()].map(([role, cells]) => ({
    sheet: "Instructions",
    cells,
    role,
  }));
  // Each entry sheet's header row: it stays on screen (frozen pane) and must
  // be distinguishable from the data it names.
  for (const [name, columns] of ENTRY_SHEETS) {
    styles.push({
      sheet: name,
      cells: columns.map((_, i) => `${XLSX.utils.encode_col(i)}1`),
      role: "header",
    });
  }
  return styles;
}

export function writeTemplate(data: WorkbookData = EMPTY_WORKBOOK, writtenOn: Date = new Date()): ArrayBuffer {
  const workbook = buildTemplateWorkbook(data);
  // The document properties, which the tool did not set: a workbook it had just
  // produced therefore reread WITHOUT a save date, and every diagram's title
  // block announced "save date unknown" over fresh data. Excel fills
  // ModifiedDate at every save; we must do the same, failing which it is the
  // tool that looks like it is reading badly.
  //
  // The date is injected rather than read from the clock, so that the writing
  // stays reproducible and testable -- as the migration already does.
  workbook.Props = {
    ...workbook.Props,
    Title: "Interface map",
    Application: "Interface Map",
    CreatedDate: writtenOn,
    ModifiedDate: writtenOn,
  };
  const raw = XLSX.write(workbook, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const completed = applyOoxmlExtras(raw, {
    tables: tablesOfTemplate(data),
    lists: listsOfTemplate(),
    validations: validationsOfTemplate(data),
    referentials: data.referentials ?? NO_REFERENTIAL,
    styles: [
      ...stylesOfTemplate(),
      // The filled flow sheets carry the same header row as their pattern:
      // without this line, only the empty sheets would have it.
      ...fxTabs(data).map((o) => ({
        sheet: o.name,
        cells: FX_COLUMNS.map((_, i) => `${XLSX.utils.encode_col(i)}1`),
        role: "header" as const,
      })),
    ],
    panes: [...ENTRY_SHEETS.map(([name]) => name), ...fxTabs(data).map((o) => o.name)],
  });
  return completed;
}

// The generated workbooks no longer carry any code: they are ordinary .xlsx
// files. The VBA was removed because it does not survive SharePoint
// synchronisation, and nothing replaced it -- there is nothing left to
// automate now that the tool creates the expected sheets itself.
export function downloadTemplateXlsx(filename: string, workbookData?: WorkbookData): void {
  const data = writeTemplate(workbookData);
  downloadWorkbook(data, filename);
}
