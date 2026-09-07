import {
  REF_ACTORS_SHEET,
  REF_GROUPS_SHEET,
  REF_ACTOR_TYPES_SHEET,
  REF_TECHNOLOGIES_SHEET,
  REF_ACTOR_COLUMNS,
  REF_GROUP_COLUMNS,
  REF_ACTOR_TYPE_COLUMNS,
  REF_TECHNOLOGY_COLUMNS,
} from "./build-model";

// The referential workbook's own shape -- the file the tool produces, and the
// only one it knows how to read back.
//
// It is described here, in the parsing layer, because four modules need it
// and none may depend on the others: the reader that recognises a dropped
// referential (referential-workbook.ts), the cartography's hidden sheets
// (export/template-export.ts), the generator of the referential itself
// (export/referential-template.ts) and the repair screen.
//
// `table` duplicates what tableName() in xlsx-tables.ts would compute from
// `sheet`. It cannot be imported from there -- the export layer depends on
// this one, not the reverse -- so a test pins the two together instead: the
// duplication is guarded rather than merely regretted.
export interface ReferentialSheet {
  // The sheet of the REFERENTIAL workbook, and the named table it carries.
  sheet: string;
  table: string;
  // The sheet of the CARTOGRAPHY workbook that holds this table's copy.
  fills: string;
  // The columns the copy keeps, in order. Anything else the referential
  // carries is dropped rather than poured into a table that does not expect
  // it; anything missing arrives empty rather than refusing the file.
  columns: readonly string[];
}

export const REFERENTIAL_SHEETS: readonly ReferentialSheet[] = [
  { sheet: "Actors", table: "TblActors", fills: REF_ACTORS_SHEET, columns: REF_ACTOR_COLUMNS },
  { sheet: "Groups", table: "TblGroups", fills: REF_GROUPS_SHEET, columns: REF_GROUP_COLUMNS },
  { sheet: "ActorTypes", table: "TblActorTypes", fills: REF_ACTOR_TYPES_SHEET, columns: REF_ACTOR_TYPE_COLUMNS },
  { sheet: "FlowTypes", table: "TblFlowTypes", fills: REF_TECHNOLOGIES_SHEET, columns: REF_TECHNOLOGY_COLUMNS },
];

// The rows of the four hidden sheets, keyed by the CARTOGRAPHY sheet they fill
// (`fills`), each row in the order `columns` gives. This is the one shape the
// referential travels in once read: what a dropped referential yields, what a
// cartography holds as its copy, and what the writer pours into the hidden
// sheets. One shape, so that comparing the two sides is comparing like with
// like.
export type ReferentialRows = Record<string, readonly (readonly string[])[]>;
