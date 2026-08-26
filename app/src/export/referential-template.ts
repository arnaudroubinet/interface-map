import * as XLSX from "xlsx";
import { applyOoxmlExtras, type TableToApply } from "./xlsx-tables";
import { downloadWorkbook } from "./download";
import { REFERENTIAL_SHEETS } from "./referential-shape";
import { SAMPLE_DATA } from "./sample-data";
import { FLOW_TYPES } from "./template-data";
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
    XLSX.utils.book_append_sheet(wb, sheetOf(r.columns, rowsFor(data, r.sheet)), r.sheet);
  }

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
  const tables: TableToApply[] = REFERENTIAL_SHEETS.map((r) => ({
    sheet: r.sheet,
    columns: r.columns,
    rows: rowsFor(data, r.sheet).length,
  }));
  return applyOoxmlExtras(raw, {
    tables,
    styles: REFERENTIAL_SHEETS.map((r) => ({
      sheet: r.sheet,
      cells: r.columns.map((_, i) => `${XLSX.utils.encode_col(i)}1`),
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
