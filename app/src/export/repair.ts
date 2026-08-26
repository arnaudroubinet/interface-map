import { parseWorkbook } from "../parsing/workbook";
import { buildModel } from "../parsing/build-model";
import { upgrade } from "./schema-upgrade";
import { migrateLegacyWorkbook, type MigrationReport } from "./legacy-upgrade";
import type { WorkbookData } from "./template-export";
import { NO_REFERENTIAL, type ReferentialUrl } from "./datamashup";

export interface Reparation {
  data: WorkbookData;
  // Filled only when the workbook came from the original format: that is where
  // choices were made for want of information, and it must be said.
  legacyReport: MigrationReport | null;
}

// The single door: hand in a workbook, get back one that is complete and in
// the current format. Three cases, one single gesture for the user.
//
// The routing is done on what the parser can read, not on the sheets' names: a
// workbook of our family reads, an original one does not. That is the surest
// test, since it is exactly the question that matters.
//
// The model built from `packageBytes` cannot know the referential URLs -- they live
// in the workbook's binary Power Query stream, not in anything the parser
// reads -- so the caller, which already holds the bytes, hands them in here
// instead of patching the result afterwards.
export function repairWorkbook(
  packageBytes: ArrayBuffer,
  dateMigration: Date = new Date(),
  referential: ReferentialUrl = NO_REFERENTIAL
): Reparation {
  const lu = buildModel(parseWorkbook(packageBytes));
  if (lu.ok) {
    // Our family: schema upgrade where applicable, and creation of the expected
    // sheets, whether the workbook is up to date or not.
    return { data: { ...upgrade(lu.model, dateMigration), referential }, legacyReport: null };
  }
  const legacy = migrateLegacyWorkbook(packageBytes, dateMigration);
  return { data: { ...legacy.data, referential }, legacyReport: legacy };
}
