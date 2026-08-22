import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseWorkbook } from "./workbook";

function buildFixtureBuffer(modifiedDate: Date): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([
    ["Name", "Group"],
    ["Tatooine", "Socle"],
    ["", ""],
  ]);
  XLSX.utils.book_append_sheet(wb, sheet, "Actors");
  wb.Props = { ModifiedDate: modifiedDate };
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx" });
  return out;
}

describe("parseWorkbook", () => {
  it("reads sheet names and rows keyed by header", () => {
    const buffer = buildFixtureBuffer(new Date("2026-08-01T10:00:00Z"));
    const result = parseWorkbook(buffer);
    expect(result.sheets).toHaveLength(1);
    expect(result.sheets[0].name).toBe("Actors");
    expect(result.sheets[0].rows[0].values).toEqual({ Name: "Tatooine", Group: "Socle" });
  });

  it("reads the core.xml modified date", () => {
    const buffer = buildFixtureBuffer(new Date("2026-08-01T10:00:00Z"));
    const result = parseWorkbook(buffer);
    expect(result.savedAt).toBeInstanceOf(Date);
    expect(result.savedAt?.toISOString()).toBe("2026-08-01T10:00:00.000Z");
  });

  it("reads headers from the header row itself, even for a sheet with no data rows", () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([["Flow name", "Consumer"]]);
    XLSX.utils.book_append_sheet(wb, sheet, "FX_Vide");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    const result = parseWorkbook(buffer);

    expect(result.sheets[0].rows).toHaveLength(0);
    expect(result.sheets[0].headers).toEqual(["Flow name", "Consumer"]);
  });

  it("does not throw and fills a blank header cell with an empty string, not a hole", () => {
    // A spacer column with no header text produces a genuinely absent cell
    // in the header row — sheet_to_json({header:1}) returns it as an array
    // hole (not an empty string: aoa_to_sheet writes "" as a real cell and
    // round-trips it without a hole, which would make this fixture vacuous).
    // A naive .map() passes the hole through unchanged, and find() (headers.ts)
    // then calls normalizeText(undefined) on it and throws.
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Flow name", null, "Usage"],
      ["Authent", null, "Ouverture"],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, "FX_Spacer");
    const buffer = XLSX.write(wb, { type: "array", bookType: "xlsx" });

    expect(() => parseWorkbook(buffer)).not.toThrow();
    const result = parseWorkbook(buffer);
    expect(result.sheets[0].headers).toEqual(["Flow name", "", "Usage"]);
    expect(1 in result.sheets[0].headers).toBe(true);
  });
});

describe("parseWorkbook — numéro de ligne", () => {
  // Le rapport cite l'emplacement pour qu'on aille corriger ; l'indice du
  // tableau ne suffit pas, puisqu'une ligne vide intercalée le décale.
  it("carries the Excel row number of each row", () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Name", "Group"],
      ["Tatooine", "Core"],
      ["Mygeeto", "Sales"],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, "Actors");
    const result = parseWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    expect(result.sheets[0].rows.map((r) => r.row)).toEqual([2, 3]);
    expect(result.sheets[0].rows[0].values).toEqual({ Name: "Tatooine", Group: "Core" });
  });

  it("keeps counting across a blank row rather than closing the gap", () => {
    const wb = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Name", "Group"],
      ["Tatooine", "Core"],
      ["", ""],
      ["Mygeeto", "Sales"],
    ]);
    XLSX.utils.book_append_sheet(wb, sheet, "Actors");
    const result = parseWorkbook(XLSX.write(wb, { type: "array", bookType: "xlsx" }));
    // La ligne vide est écartée, mais Mygeeto reste en ligne 4 du classeur.
    expect(result.sheets[0].rows.map((r) => r.values.Name)).toEqual(["Tatooine", "Mygeeto"]);
    expect(result.sheets[0].rows.map((r) => r.row)).toEqual([2, 4]);
  });
});
