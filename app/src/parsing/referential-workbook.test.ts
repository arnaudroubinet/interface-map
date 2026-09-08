import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { isReferentialWorkbook, readReferentialWorkbook, referentialDrifted, mergeReferential } from "./referential-workbook";
import { REFERENTIAL_SHEETS, type ReferentialRows } from "./referential-shape";
import { REF_ACTORS_SHEET, REF_GROUPS_SHEET, REF_ACTOR_TYPES_SHEET, REF_TECHNOLOGIES_SHEET } from "./build-model";
import { parseWorkbook } from "./workbook";
import { writeReferential, type ReferentialData } from "../export/referential-template";
import { writeTemplate } from "../export/template-export";
import { SAMPLE_DATA } from "../export/sample-data";

const published: ReferentialData = {
  actors: [
    ["Tatooine", "Core", "Application", "Leia", "The capital"],
    ["Mygeeto", "Core", "Application", "", ""],
  ],
  groups: [["Core", "The platform"]],
  actorTypes: [["Application", "app-window", "Business", ""]],
  flowTypes: [["HTTP", "consumer → provider", "Direct call", "#1f5fae"]],
};

const parsed = (bytes: ArrayBuffer) => parseWorkbook(bytes);

// A workbook built by hand, sheet by sheet: what a referential kept in another
// tool, or edited freely, looks like once its tables are gone.
function handMade(sheets: Record<string, string[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

describe("isReferentialWorkbook — telling the two files apart", () => {
  it("recognises the referential the tool writes", () => {
    expect(isReferentialWorkbook(parsed(writeReferential(published)))).toBe(true);
  });

  it("recognises a blank referential", () => {
    expect(isReferentialWorkbook(parsed(writeReferential()))).toBe(true);
  });

  // The two share three sheet names, and their Actors sheets share their
  // columns: a cartography must never pass for a referential, or the drop
  // would be read as "nothing to show".
  it("does not take a cartography for a referential", () => {
    expect(isReferentialWorkbook(parsed(writeTemplate(SAMPLE_DATA)))).toBe(false);
    expect(isReferentialWorkbook(parsed(writeTemplate()))).toBe(false);
  });

  // A cartography missing its Interfaces sheet is what the repair screen is
  // for: it is still a cartography, told by its Groups sheet.
  it("does not take a cartography missing its Interfaces sheet for a referential", () => {
    const bytes = handMade({
      Actors: [["Name", "Group", "Actor type"], ["Tatooine", "Core", "Application"]],
      Groups: [["Group", "Perimeter"], ["Core", "Platform"]],
      ActorTypes: [["Actor type", "Icon", "Nature"]],
      FlowTypes: [["Flow type", "Direction"]],
    });
    expect(isReferentialWorkbook(parsed(bytes))).toBe(false);
  });

  // The tables are Excel's business; the sheets are what the tool goes by. A
  // referential saved through another tool keeps its sheets and loses its
  // tables, and must still be recognised.
  it("recognises a referential by its sheets, tables or not", () => {
    const bytes = handMade({
      Actors: [["Name", "Group", "Actor type", "Owner", "Description"], ["Tatooine", "Core", "Application", "", ""]],
      Groups: [["Name", "Description"], ["Core", ""]],
      ActorTypes: [["Actor type", "Icon", "Nature", "Description"]],
      FlowTypes: [["Flow type", "Direction", "Description", "Colour"]],
    });
    expect(isReferentialWorkbook(parsed(bytes))).toBe(true);
  });

  // headers.ts still reads the French spellings of a cartography's sheets. A
  // hand-kept French cartography missing its "Flux" sheet matched them and
  // passed for a referential -- the very file the repair screen exists for.
  it("does not take a French hand-kept cartography for a referential", () => {
    const bytes = handMade({
      Acteurs: [["Nom", "Groupe", "Type d'acteur"], ["Tatooine", "Core", "Application"]],
      Groupes: [["Nom", "Périmètre"], ["Core", "Plateforme"]],
      TypesActeur: [["Type d'acteur", "Icône"]],
      TypesFlux: [["Type de flux", "Sens de représentation"]],
    });
    expect(isReferentialWorkbook(parsed(bytes))).toBe(false);
  });

  it("wants all four sheets", () => {
    const bytes = handMade({
      Actors: [["Name", "Group", "Actor type", "Owner", "Description"]],
      Groups: [["Name", "Description"]],
    });
    expect(isReferentialWorkbook(parsed(bytes))).toBe(false);
  });
});

describe("readReferentialWorkbook — the rows, in the cartography's shape", () => {
  it("hands back every sheet under the name of the sheet it fills, columns in order", () => {
    const rows = readReferentialWorkbook(parsed(writeReferential(published)))!;
    expect(Object.keys(rows).sort()).toEqual(REFERENTIAL_SHEETS.map((r) => r.fills).sort());
    expect(rows[REF_ACTORS_SHEET]).toEqual(published.actors);
    expect(rows[REF_GROUPS_SHEET]).toEqual(published.groups);
    expect(rows[REF_ACTOR_TYPES_SHEET]).toEqual(published.actorTypes);
    expect(rows[REF_TECHNOLOGIES_SHEET]).toEqual(published.flowTypes);
  });

  it("hands back nothing for a cartography", () => {
    expect(readReferentialWorkbook(parsed(writeTemplate(SAMPLE_DATA)))).toBeNull();
  });

  // What the referential adds is not carried; what it lacks arrives empty. The
  // icon preview is the ordinary case of the first: a column of the referential
  // file, never of the copy.
  it("keeps the copy's columns and only them", () => {
    const bytes = handMade({
      Actors: [["Owner", "Name", "Nickname"], ["Leia", "Tatooine", "Tat"]],
      Groups: [["Name"], ["Core"]],
      ActorTypes: [["Actor type", "Icon", "Nature", "Description", "Preview"], ["Application", "app-window", "Business", "", "🗔"]],
      FlowTypes: [["Flow type", "Direction", "Description", "Colour"]],
    });
    const rows = readReferentialWorkbook(parsed(bytes))!;
    expect(rows[REF_ACTORS_SHEET]).toEqual([["Tatooine", "", "", "Leia", ""]]);
    expect(rows[REF_GROUPS_SHEET]).toEqual([["Core", ""]]);
    expect(rows[REF_ACTOR_TYPES_SHEET]).toEqual([["Application", "app-window", "Business", ""]]);
    expect(rows[REF_TECHNOLOGIES_SHEET]).toEqual([]);
  });

  // A stray cell under a table is not a nameless actor.
  it("drops a row with no name, and trims the rest", () => {
    const bytes = handMade({
      Actors: [["Name", "Group", "Actor type", "Owner", "Description"], [" Tatooine ", " Core", "", "", ""], ["", "", "", "note", ""]],
      Groups: [["Name", "Description"], ["Core", ""]],
      ActorTypes: [["Actor type", "Icon", "Nature", "Description"]],
      FlowTypes: [["Flow type", "Direction", "Description", "Colour"]],
    });
    expect(readReferentialWorkbook(parsed(bytes))![REF_ACTORS_SHEET]).toEqual([["Tatooine", "Core", "", "", ""]]);
  });
});

describe("referentialDrifted — has the copy fallen behind?", () => {
  const held = (): ReferentialRows => readReferentialWorkbook(parsed(writeReferential(published)))!;

  it("finds no drift between a copy and the referential it was taken from", () => {
    expect(referentialDrifted(held(), held())).toBe(false);
  });

  it("finds no drift over whitespace alone", () => {
    const mine = held();
    mine[REF_ACTORS_SHEET] = mine[REF_ACTORS_SHEET].map((r) => r.map((c) => ` ${c} `));
    expect(referentialDrifted(mine, held())).toBe(false);
  });

  it("finds a drift in one changed cell", () => {
    const mine = held();
    mine[REF_ACTORS_SHEET] = [["Tatooine", "Core", "Application", "Han", "The capital"], ...mine[REF_ACTORS_SHEET].slice(1)];
    expect(referentialDrifted(mine, held())).toBe(true);
  });

  it("finds a drift in a row added or removed", () => {
    const fewer = held();
    fewer[REF_ACTORS_SHEET] = fewer[REF_ACTORS_SHEET].slice(0, 1);
    expect(referentialDrifted(fewer, held())).toBe(true);
    expect(referentialDrifted(held(), fewer)).toBe(true);
  });

  // A row moved is a drift: cheaper to rewrite an identical copy than to decide
  // what a row's identity is.
  it("counts a reordering as a drift", () => {
    const mine = held();
    mine[REF_ACTORS_SHEET] = [...mine[REF_ACTORS_SHEET]].reverse();
    expect(referentialDrifted(mine, held())).toBe(true);
  });

  // A workbook that never met a referential holds nothing: everything the
  // referential publishes is then new to it.
  it("counts an empty copy as drifted from a filled referential", () => {
    expect(referentialDrifted({}, held())).toBe(true);
  });
});

// A referential with an empty sheet says "I have none", not "forget yours".
describe("mergeReferential — a sheet left empty keeps the copy", () => {
  it("takes the referential's rows where it publishes some, the copy's elsewhere", () => {
    const held = { [REF_ACTORS_SHEET]: [["Naboo", "", "", "", ""]], [REF_GROUPS_SHEET]: [["Core", ""]] };
    const merged = mergeReferential(held, { [REF_ACTORS_SHEET]: [["Tatooine", "", "", "", ""]], [REF_GROUPS_SHEET]: [] });
    expect(merged[REF_ACTORS_SHEET]).toEqual([["Tatooine", "", "", "", ""]]);
    expect(merged[REF_GROUPS_SHEET]).toEqual([["Core", ""]]);
  });

  it("works on a workbook that held no copy at all", () => {
    const merged = mergeReferential(undefined, { [REF_GROUPS_SHEET]: [["Core", ""]] });
    expect(merged).toEqual({ [REF_GROUPS_SHEET]: [["Core", ""]] });
  });
});
