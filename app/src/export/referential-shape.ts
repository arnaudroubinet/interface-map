import {
  REF_ACTORS_SHEET,
  REF_GROUPS_SHEET,
  REF_ACTOR_TYPES_SHEET,
  REF_TECHNOLOGIES_SHEET,
  REF_ACTOR_COLUMNS,
  REF_GROUP_COLUMNS,
  REF_ACTOR_TYPE_COLUMNS,
  REF_TECHNOLOGY_COLUMNS,
} from "../parsing/build-model";

// The referential workbook's own shape -- the file the tool produces, and the
// only one its queries know how to read.
//
// It is described here rather than in template-export because three modules
// need it and none may depend on the other two: the query writer
// (datamashup.ts), the cartography's hidden sheets (template-export.ts), and
// the generator of the referential itself (referential-template.ts).
//
// `table` duplicates what tableName() in xlsx-tables.ts would compute from
// `sheet`. It cannot be imported from there -- xlsx-tables already imports
// datamashup, and the cycle would be real -- so a test pins the two together
// instead: the duplication is guarded rather than merely regretted.
export interface ReferentialSheet {
  // The sheet of the REFERENTIAL workbook, and the named table it carries.
  sheet: string;
  table: string;
  // The sheet of the CARTOGRAPHY workbook that this table's query fills.
  fills: string;
  // The columns the query keeps, in order. Anything else the referential
  // carries is dropped rather than poured into a table that does not expect
  // it; anything missing arrives empty rather than failing the refresh.
  columns: readonly string[];
}

export const REFERENTIAL_SHEETS: readonly ReferentialSheet[] = [
  { sheet: "Actors", table: "TblActors", fills: REF_ACTORS_SHEET, columns: REF_ACTOR_COLUMNS },
  { sheet: "Groups", table: "TblGroups", fills: REF_GROUPS_SHEET, columns: REF_GROUP_COLUMNS },
  { sheet: "ActorTypes", table: "TblActorTypes", fills: REF_ACTOR_TYPES_SHEET, columns: REF_ACTOR_TYPE_COLUMNS },
  { sheet: "FlowTypes", table: "TblFlowTypes", fills: REF_TECHNOLOGIES_SHEET, columns: REF_TECHNOLOGY_COLUMNS },
];
