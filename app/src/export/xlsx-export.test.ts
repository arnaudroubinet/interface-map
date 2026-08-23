import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { buildMatrixWorkbook } from "./xlsx-export";
import type { MatrixResult } from "../aggregation/views";
import * as base from "../testing/fixtures";

// The table arrives already pruned: neither Kamino nor Muet sends, so they
// have no row, and Tatooine receives nothing, so it has no column.
const matrix: MatrixResult = base.matrix({
  columns: ["Kamino", "Muet"],
  rows: [
    {
      actor: "Tatooine",
      cells: new Map([
        ["Kamino", [{ technology: "HTTP", count: 3, attenuated: false, names: [] }]],
        ["Muet", [{ technology: "Kafka", count: 1, attenuated: true, names: [] }]],
      ]),
    },
  ],
});

// The written workbook is reread, not the in-memory object: it is the file
// received in Excel that counts.
function producedWorkbook(): XLSX.WorkBook {
  const wb = buildMatrixWorkbook(matrix);
  const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  return XLSX.read(new Uint8Array(bytes), { type: "array" });
}

describe("Excel export of the matrix", () => {
  it("writes one grid sheet and one flat sheet", () => {
    const wb = producedWorkbook();
    expect(wb.SheetNames).toEqual(["Matrix", "Flows"]);
  });

  it("puts the technologies at the sender/receiver intersection", () => {
    const wb = producedWorkbook();
    const grille = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Matrix, { header: 1, defval: "" });
    expect(grille[0]).toEqual(["From \\ To", "Kamino", "Muet"]);
    expect(grille[1][0]).toBe("Tatooine");
    expect(grille[1][1]).toBe("HTTP ×3");
    expect(grille).toHaveLength(2);
  });

  it("unfolds one flow per row on the flat sheet, with its count", () => {
    const wb = producedWorkbook();
    const flows = XLSX.utils.sheet_to_json<Record<string, string | number>>(wb.Sheets.Flows, { defval: "" });
    expect(flows).toEqual([
      { From: "Tatooine", To: "Kamino", Technology: "HTTP", Count: 3, Attenuated: "" },
      { From: "Tatooine", To: "Muet", Technology: "Kafka", Count: 1, Attenuated: "Yes" },
    ]);
  });

  // What makes the grid usable in Excel and what the library really writes: the
  // autofilter on the header row. The frozen panes, for their part, are not
  // produced by the community edition.
  it("sets an autofilter on both sheets' header", () => {
    const wb = producedWorkbook();
    expect(wb.Sheets.Matrix["!autofilter"]).toBeDefined();
    expect(wb.Sheets.Flows["!autofilter"]).toBeDefined();
  });

});

// In functional mode the technology is emptied (§4.2): without this fallback
// counter, the exported grid has nothing but its headers -- a workbook that
// looks correct and tells nobody it no longer shows anything.
describe("Excel export of the matrix — functional mode (empty technology)", () => {
  const functionalMatrix: MatrixResult = base.matrix({
    columns: ["Kamino", "Muet"],
    rows: [
      {
        actor: "Tatooine",
        cells: new Map([
          ["Kamino", [{ technology: "", count: 1, attenuated: false, names: [] }]],
          ["Muet", [{ technology: "", count: 3, attenuated: false, names: [] }]],
        ]),
      },
    ],
  });

  function functionalWorkbook(): XLSX.WorkBook {
    const wb = buildMatrixWorkbook(functionalMatrix);
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    return XLSX.read(new Uint8Array(bytes), { type: "array" });
  }

  it("shows the counter alone when there is no technology", () => {
    const wb = functionalWorkbook();
    const grille = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Matrix, { header: 1, defval: "" });
    expect(grille[1][1]).toBe("1");
    expect(grille[1][2]).toBe("3");
  });
});

// --- "What is on screen is what is exported": the row order is decided in
// buildMatrixView, once, and the export must on no account re-sort it --
// otherwise the workbook taken away is not the table one had in front of one.
//
describe("buildMatrixWorkbook — the order received is the order written", () => {
  const cell = { technology: "HTTP", count: 1, attenuated: false, names: [] };
  const nonAlphabetical = base.matrix({
    columns: ["Zeffo", "Bracca"],
    rows: [
      { actor: "Zeffo", cells: new Map([["Bracca", [cell]]]) },
      { actor: "Bracca", cells: new Map([["Zeffo", [cell]]]) },
    ],
  });

  it("writes the rows in the table's order, not in alphabetical order", () => {
    const sheet = buildMatrixWorkbook(nonAlphabetical).Sheets["Matrix"];
    expect([sheet.A2.v, sheet.A3.v]).toEqual(["Zeffo", "Bracca"]);
  });

  it("writes the columns in the table's order", () => {
    const sheet = buildMatrixWorkbook(nonAlphabetical).Sheets["Matrix"];
    expect([sheet.B1.v, sheet.C1.v]).toEqual(["Zeffo", "Bracca"]);
  });
});
