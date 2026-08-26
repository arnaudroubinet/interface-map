import * as XLSX from "xlsx";
import {
  applyOoxmlExtras,
  type TableToApply,
  type NamedList,
  type ValidationToApply,
} from "./xlsx-tables";
import { downloadWorkbook } from "./download";
import { REFERENTIAL_SHEETS } from "./referential-shape";
import { SAMPLE_DATA } from "./sample-data";
import { FLOW_TYPES, DEFAULT_ICONS } from "./template-data";
import { VOCABULARY_DIRECTION, VOCABULARY_NATURE } from "../aggregation/vocabularies";
import { AVAILABLE_ICONS, ICON_PREVIEWS } from "../render/icons";
import { PALETTE } from "../render/colors";

// The referential workbook itself -- the file the queries read.
//
// The tool produces it for the same reason it produces the cartography's
// template: a shape nobody typed by hand is a shape the query can rely on. The
// names it must carry are in referential-shape.ts; here is only the file.
//
// It carries no version sheet and no drop-down: it is not read by the tool, it
// is read by Excel, on the other side of a query. Its one hard constraint is
// that the four tables keep their names -- hence the sheet that says so, in
// prose, at the front of the file.

export interface ReferentialData {
  actors: readonly (readonly string[])[];
  groups: readonly (readonly string[])[];
  actorTypes: readonly (readonly string[])[];
  flowTypes: readonly (readonly string[])[];
}

export const EMPTY_REFERENTIAL: ReferentialData = { actors: [], groups: [], actorTypes: [], flowTypes: [] };

// What "blank" means for a referential: no actor and no group -- those belong
// to the estate being mapped -- but the two vocabularies nobody should have to
// retype. They used to be seeded into every cartography; they belong here now,
// since a cartography picks its types and technologies from the referential
// instead of declaring them. A blank referential is therefore usable at once,
// while a blank cartography beside no referential can declare nothing -- which
// is the point: the lists carry the data.
export const BLANK_REFERENTIAL: ReferentialData = {
  actors: [],
  groups: [],
  actorTypes: DEFAULT_ICONS.map(([type, icon, nature]) => [type, icon, nature, ""]),
  // No colour: the palette decides until someone fixes one. A seeded colour
  // would look like a decision the referential never made.
  flowTypes: FLOW_TYPES.map(([type, direction, description]) => [type, direction, description, ""]),
};

// The referential's own hidden sheet: the closed vocabularies its columns are
// picked from. It carries only what this file needs -- an icon, a nature, a
// direction -- and not the cartography's own eight: a criticality has nothing
// to do in a referential.
const REFERENTIAL_LISTS: Record<string, string[]> = {
  Icon: AVAILABLE_ICONS,
  Preview: AVAILABLE_ICONS.map((n) => ICON_PREVIEWS[n] ?? ""),
  Nature: VOCABULARY_NATURE,
  Direction: VOCABULARY_DIRECTION,
};

const LISTS_SHEET = "Lists";

// The icon shown beside the name that was picked. It sits HERE, and no longer
// on the cartography, because here is where an icon is chosen: on the other
// side the column is a lookup nobody types into, and a preview of a value one
// cannot change is a column of noise.
export const PREVIEW_COLUMN = "Preview";

function previewFormula(): string {
  return `IFERROR(INDEX(${LISTS_SHEET}!$B:$B,MATCH([@Icon],${LISTS_SHEET}!$A:$A,0)),"")`;
}

const INSTRUCTIONS: [string, string][] = [
  ["What this file is", "The referential the interface maps draw their names from. One workbook, one URL."],
  ["Do not rename the tables", `Each sheet carries one Excel table: ${REFERENTIAL_SHEETS.map((r) => r.table).join(", ")}. The queries look for them by name — rename one and the map stops loading it.`],
  ["Add columns freely", "A column the map does not know is ignored, not an error. A column it expects and does not find arrives empty."],
  ["Who fills it", "Whoever owns the referential. A map never writes back into this file."],
  ["How a map reads it", "Repair or upgrade a workbook → External referential → the download URL of this file. Excel loads it on refresh."],
  ["Names are the contract", "A map picks its actors, groups, types and technologies here. Renaming a row here does not rename it in a map: the old name simply becomes unknown to the referential, and the map's integrity report says so."],
];

function sheetOf(columns: readonly string[], rows: readonly (readonly string[])[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet([[...columns], ...rows.map((r) => [...r])]);
  ws["!cols"] = columns.map((c) => ({ wch: Math.max(18, c.length + 4) }));
  ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 0, c: columns.length - 1 } }) };
  return ws;
}

// The columns a referential sheet is written with: its own, plus the icon
// preview on the sheet where an icon is chosen.
function columnsOfSheet(sheet: string, columns: readonly string[]): string[] {
  return sheet === "ActorTypes" ? [...columns, PREVIEW_COLUMN] : [...columns];
}

function listsSheet(): XLSX.WorkSheet {
  const headers = Object.keys(REFERENTIAL_LISTS);
  const height = Math.max(...headers.map((h) => REFERENTIAL_LISTS[h].length));
  const rows: string[][] = [headers];
  for (let i = 0; i < height; i++) rows.push(headers.map((h) => REFERENTIAL_LISTS[h][i] ?? ""));
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(16, h.length + 4) }));
  return ws;
}

// One table per vocabulary, sized to its own content: a single table over all
// four would pad the short lists with blank rows up to the longest, and the
// blanks would show in the drop-downs. The cartography learned this the hard
// way; the referential inherits the lesson rather than the bug.
function listTables(): TableToApply[] {
  return Object.keys(REFERENTIAL_LISTS).map((key, index) => ({
    sheet: LISTS_SHEET,
    columns: [key],
    rows: REFERENTIAL_LISTS[key].length,
    startColumn: index,
  }));
}

function listsOfReferential(): NamedList[] {
  return [
    { name: "L_Icone", sheet: LISTS_SHEET, heading: "Icon" },
    { name: "L_Nature", sheet: LISTS_SHEET, heading: "Nature" },
    { name: "L_Sens", sheet: LISTS_SHEET, heading: "Direction" },
    // Excel's data validation does NOT accept a structured reference: a list
    // whose formula reads TblGroups[Name] is refused outright. A defined name
    // over the same column is accepted, and follows the table as it grows --
    // which is why every list in this project is one.
    { name: "L_Groupe", sheet: "Groups", heading: "Name" },
    { name: "L_TypeActeur", sheet: "ActorTypes", heading: "Actor type" },
  ];
}

// Every column of the referential that names something already named on
// another of its sheets. Typed by hand, a group or a type invents a name that
// matches nothing, and the cartography inherits the divergence -- the very
// thing a referential exists to prevent.
function validationsOfReferential(): ValidationToApply[] {
  const at = (sheet: string, heading: string, formula: string): ValidationToApply => {
    const entry = REFERENTIAL_SHEETS.find((r) => r.sheet === sheet)!;
    return { sheet, column: XLSX.utils.encode_col(entry.columns.indexOf(heading)), formula };
  };
  return [
    at("Actors", "Group", "L_Groupe"),
    at("Actors", "Actor type", "L_TypeActeur"),
    at("ActorTypes", "Icon", "L_Icone"),
    at("ActorTypes", "Nature", "L_Nature"),
    at("FlowTypes", "Direction", "L_Sens"),
  ];
}

const rowsFor = (data: ReferentialData, sheet: string): readonly (readonly string[])[] => {
  if (sheet === "Actors") return data.actors;
  if (sheet === "Groups") return data.groups;
  if (sheet === "ActorTypes") return data.actorTypes;
  return data.flowTypes;
};

export function writeReferential(
  data: ReferentialData = EMPTY_REFERENTIAL,
  writtenOn: Date = new Date()
): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  // Not filterable: the apostrophe-in-a-sheet-name trap that costs a repair
  // prompt is documented in template-export.ts, and prose has nothing to
  // filter anyway.
  const instructions = XLSX.utils.aoa_to_sheet(INSTRUCTIONS.map(([left, right]) => [left, right]));
  instructions["!cols"] = [{ wch: 26 }, { wch: 104 }];
  XLSX.utils.book_append_sheet(wb, instructions, "Instructions");
  for (const r of REFERENTIAL_SHEETS) {
    const rows = rowsFor(data, r.sheet);
    const ws = sheetOf(columnsOfSheet(r.sheet, r.columns), rows);
    if (r.sheet === "ActorTypes") {
      // The cached value is the one Excel recomputes anyway: it is there so the
      // preview shows from the moment the file opens, before the first
      // recalculation.
      const column = XLSX.utils.encode_col(r.columns.length);
      const icon = r.columns.indexOf("Icon");
      rows.forEach((row, rank) => {
        ws[`${column}${rank + 2}`] = { t: "str", f: previewFormula(), v: ICON_PREVIEWS[row[icon]] ?? "" };
      });
    }
    XLSX.utils.book_append_sheet(wb, ws, r.sheet);
  }
  XLSX.utils.book_append_sheet(wb, listsSheet(), LISTS_SHEET);
  // Hidden for the same reason as the cartography's: it is not data to be
  // entered, it is what the drop-downs are made of.
  wb.Workbook = { Sheets: wb.SheetNames.map((name) => ({ Hidden: name === LISTS_SHEET ? 1 : 0 })) };

  // The same reason as the cartography's own writer: a workbook with no
  // ModifiedDate is reread without a save date.
  wb.Props = {
    ...wb.Props,
    Title: "Interface map referential",
    Application: "Interface Map",
    CreatedDate: writtenOn,
    ModifiedDate: writtenOn,
  };

  const raw = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  const tables: TableToApply[] = [
    ...REFERENTIAL_SHEETS.map((r) => ({
      sheet: r.sheet,
      columns: columnsOfSheet(r.sheet, r.columns),
      rows: rowsFor(data, r.sheet).length,
      ...(r.sheet === "ActorTypes" ? { formulaByColumn: { [PREVIEW_COLUMN]: previewFormula() } } : {}),
    })),
    ...listTables(),
  ];
  return applyOoxmlExtras(raw, {
    tables,
    lists: listsOfReferential(),
    validations: validationsOfReferential(),
    styles: REFERENTIAL_SHEETS.map((r) => ({
      sheet: r.sheet,
      cells: columnsOfSheet(r.sheet, r.columns).map((_, i) => `${XLSX.utils.encode_col(i)}1`),
      role: "header" as const,
    })),
    panes: REFERENTIAL_SHEETS.map((r) => r.sheet),
  });
}

// What the sample cartography declares, published as a referential. Derived
// from SAMPLE_DATA rather than written twice: the two files are meant to be
// pointed at each other, and a name drifting on one side would show up as an
// anomaly the sample is supposed never to have.
const columnsOf = (rows: readonly (readonly string[])[], indices: number[]) =>
  rows.map((r) => indices.map((i) => r[i] ?? ""));

// The sample cartography declares no technology of its own -- it lives off the
// seed -- so the referential publishes that seed, with a colour: a referential
// that carries none would leave the palette to decide, and the sample would
// show nothing of what the Colour column does.
const SAMPLE_TECHNOLOGIES = FLOW_TYPES.map((t, i) => [t[0], t[1], t[2], PALETTE[i % PALETTE.length]]);

export const SAMPLE_REFERENTIAL: ReferentialData = {
  actors: columnsOf(SAMPLE_DATA.actors, [0, 1, 2, 3, 4]),
  groups: SAMPLE_DATA.groups.map((g) => [g[0], `${g[1]} perimeter`]),
  actorTypes: SAMPLE_DATA.actorTypes.map((t) => [t[0], t[1], t[2], ""]),
  flowTypes: SAMPLE_TECHNOLOGIES,
};

export function downloadReferentialXlsx(filename: string, data?: ReferentialData): void {
  downloadWorkbook(writeReferential(data), filename);
}
