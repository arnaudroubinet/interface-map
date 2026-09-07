import type { ParsedWorkbook, RawSheet } from "./model";
import { normalizeText } from "../shared/text";
import { REFERENTIAL_SHEETS, type ReferentialRows } from "./referential-shape";

// The referential is a file one drops, like the cartography -- no longer an
// address Excel goes to fetch. This module tells the two apart and reads the
// first.
//
// A referential and a cartography share three sheet names (Actors, ActorTypes,
// FlowTypes), and their Actors sheets even share their columns. What tells them
// apart is said here once: a referential names its groups under `Name`, where
// a cartography's Groups sheet says `Group` and `Perimeter`; and a referential
// has no interface catalogue, since it describes no flow. Both signs are
// required, so that a cartography missing its Interfaces sheet -- which the
// repair screen exists for -- is still refused as a referential, and read as
// the incomplete cartography it is.
//
// The sheets are matched by name, not the tables: the tables are what Excel
// went by, and a copy saved through another tool loses them while keeping the
// sheets. The names of the tables stay in the file the tool writes, for whoever
// still reads it with a query of their own.
//
// By their CURRENT names only -- not the French spellings headers.ts still
// accepts for the cartography. The referential is a file the tool writes, in
// English; a hand-kept French cartography missing its "Flux" sheet matched the
// old spellings and was taken for a referential, when it is precisely the
// broken cartography the repair screen exists for.

const INTERFACES_SHEET = "Interfaces";

const sameName = (a: string, b: string) => normalizeText(a) === normalizeText(b);

function findSheet(sheets: RawSheet[], name: string): RawSheet | undefined {
  return sheets.find((s) => sameName(s.name, name));
}

function findHeader(headers: string[], column: string): string | undefined {
  return headers.find((h) => sameName(h, column));
}

// The column a sheet is recognised by, and the one a row must fill to count:
// the first of its columns, its name.
function keyColumn(columns: readonly string[]): string {
  return columns[0];
}

export function isReferentialWorkbook(workbook: ParsedWorkbook): boolean {
  if (findSheet(workbook.sheets, INTERFACES_SHEET)) return false;
  return REFERENTIAL_SHEETS.every((r) => {
    const sheet = findSheet(workbook.sheets, r.sheet);
    return sheet !== undefined && findHeader(sheet.headers, keyColumn(r.columns)) !== undefined;
  });
}

// What a referential publishes, in the shape the cartography holds it: one
// entry per hidden sheet, the columns that sheet declares, in its order. A
// column the referential lacks arrives empty; a column it adds is not carried.
// A row with no name is not a row -- Excel hands back every cell typed under
// a table, and a stray space there would otherwise become a nameless actor.
//
// `null` when the workbook is not a referential at all: that is the caller's
// cue to read it as a cartography instead.
export function readReferentialWorkbook(workbook: ParsedWorkbook): ReferentialRows | null {
  if (!isReferentialWorkbook(workbook)) return null;
  const rows: ReferentialRows = {};
  for (const r of REFERENTIAL_SHEETS) {
    const sheet = findSheet(workbook.sheets, r.sheet)!;
    const headers = r.columns.map((c) => findHeader(sheet.headers, c));
    const key = r.columns.indexOf(keyColumn(r.columns));
    rows[r.fills] = sheet.rows
      .map(({ values }) => headers.map((h) => (h === undefined ? "" : (values[h] ?? "").toString().trim())))
      .filter((row) => row[key] !== "");
  }
  return rows;
}

// The copy a workbook will carry once a referential is applied to it: the
// referential's rows, sheet by sheet -- except where it publishes NOTHING,
// where the copy the workbook held stays. A referential with an empty sheet
// says "I have no groups", not "forget yours": emptying the copy would empty
// the drop-downs and the calculated columns made of it, the one thing a
// rewrite must never do. Used by the repair and by the drop alike, so that the
// two doors apply one rule.
export function mergeReferential(held: ReferentialRows | undefined, published: ReferentialRows): ReferentialRows {
  const merged: ReferentialRows = { ...(held ?? {}) };
  for (const r of REFERENTIAL_SHEETS) {
    const rows = published[r.fills] ?? [];
    if (rows.length > 0) merged[r.fills] = rows;
  }
  return merged;
}

// Has the cartography's copy drifted from what the referential publishes?
//
// Cell for cell, in order. A row moved is a drift too, and that is fine: the
// cost of a false positive is one rewrite of a copy that comes out identical
// in content, whereas any attempt at "the same rows in another order" would
// have to decide what a row's identity is -- and a renamed actor is precisely
// the case where the two sides disagree on that.
export function referentialDrifted(held: ReferentialRows, published: ReferentialRows): boolean {
  return REFERENTIAL_SHEETS.some((r) => {
    const mine = held[r.fills] ?? [];
    const theirs = published[r.fills] ?? [];
    if (mine.length !== theirs.length) return true;
    return mine.some((row, i) =>
      r.columns.some((_, c) => (row[c] ?? "").trim() !== (theirs[i][c] ?? "").trim())
    );
  });
}
