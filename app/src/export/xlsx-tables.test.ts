// This file covers nothing but displayName collisions. The rest of the
// hand-written OOXML -- defined names, validations, tag order -- is verified
// tag by tag in template-export.test.ts, which inspects the XML actually
// produced. Good coverage, filed under another name.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { applyOoxmlExtras, readPart, type TableToApply } from "./xlsx-tables";

// A minimal workbook, just enough for applyTheTables to find the sheets it is
// asked to complete.
function minimalWorkbook(sheets: readonly string[]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const name of sheets) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Flow name"], ["a"]]), name);
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

function tableDisplayNames(packageBytes: ArrayBuffer): string[] {
  const cfb = XLSX.CFB.read(new Uint8Array(packageBytes), { type: "array" });
  const names: string[] = [];
  for (const path of cfb.FullPaths) {
    if (!/\/xl\/tables\/table\d+\.xml$/.test(path)) continue;
    const input = XLSX.CFB.find(cfb, path.replace(/^[^/]*/, ""));
    const xml = new TextDecoder().decode(new Uint8Array(input!.content as unknown as ArrayBufferLike));
    const m = xml.match(/displayName="([^"]*)"/);
    names.push(m![1]);
  }
  return names;
}

// tableName() sanitises a sheet name by replacing every non-alphanumeric
// character with "_": "FX_A B_HTTP" and "FX_A-B_HTTP" both fall back to
// "TblFX_A_B_HTTP". ECMA-376 §18.5.1.2 requires a unique displayName within
// the workbook; Excel resolves the collision by deleting one of the two tables
// ("Records removed") and offering to repair.
describe("applyTheTables — table-name collision", () => {
  const sheets = ["FX_A B_HTTP", "FX_A-B_HTTP"];
  const tables: TableToApply[] = sheets.map((sheet) => ({
    sheet,
    columns: ["Flow name"],
    rows: 1,
  }));

  it("gives a distinct displayName to two sheets that sanitise identically", () => {
    const packageBytes = applyOoxmlExtras(minimalWorkbook(sheets), { tables });
    const names = tableDisplayNames(packageBytes);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("names the tables stably from one generation to the next", () => {
    const raw = minimalWorkbook(sheets);
    const premier = tableDisplayNames(applyOoxmlExtras(raw, { tables }));
    const second = tableDisplayNames(applyOoxmlExtras(raw, { tables }));
    expect(second).toEqual(premier);
  });
});

// The referential's copy is an ordinary table now: no query feeds it, so the
// package carries no connection, no queryTable part and no Power Query stream.
// Pinned so that none of the three comes back by accident with a change to the
// table loop -- Excel opens a workbook carrying a connection to a query that
// does not exist, and says nothing about it.
describe("no query in the package", () => {
  it("leaves an ordinary table alone", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name"], ["Tatooine"]]), "Actors");
    const raw = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const cfb = XLSX.CFB.read(
      new Uint8Array(applyOoxmlExtras(raw, { tables: [{ sheet: "Actors", columns: ["Name"], rows: 1 }] })),
      { type: "array" }
    );
    expect(readPart(cfb, "/xl/tables/table1.xml")!).not.toContain("queryTable");
    expect(XLSX.CFB.find(cfb, "/xl/connections.xml")).toBeFalsy();
    expect(XLSX.CFB.find(cfb, "/xl/tables/_rels/table1.xml.rels")).toBeFalsy();
    // Neither the uniqueName nor the external data range: Excel writes neither
    // on an ordinary table, and the workbook carries no defined name at all
    // when nothing asks for one.
    expect(readPart(cfb, "/xl/tables/table1.xml")!).toContain('<tableColumn id="1" name="Name"/>');
    expect(readPart(cfb, "/xl/workbook.xml")!).not.toContain("ExternalData_");
    expect(readPart(cfb, "/xl/workbook.xml")!).not.toContain("<definedNames>");
    // What every table needs whether or not a query feeds it, and what nothing
    // pinned until a change to this loop wrote 14 spurious parts into every
    // workbook with all the tests still green: the sheet relates to its table,
    // and the package declares the part.
    expect(readPart(cfb, "/xl/worksheets/_rels/sheet1.xml.rels")!).toContain("../tables/table1.xml");
    expect(readPart(cfb, "/[Content_Types].xml")!).toContain(
      `<Override PartName="/xl/tables/table1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"/>`
    );
  });
});

// The differential format is ADDED to the stylesheet, never assumed at index
// zero: SheetJS writes an empty <dxfs/>, but a stylesheet that already holds
// one must keep it, failing which every earlier rule changes colour.
describe("the colour of an unknown value", () => {
  const raw = () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name"], ["Tatooine"]]), "Actors");
    return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  };
  const tables: TableToApply[] = [{ sheet: "Actors", columns: ["Name"], rows: 1 }];
  const lists = [{ name: "L_Acteur", sheet: "Actors", heading: "Name" }];

  it("declares one differential format, and every rule points at it", () => {
    const cfb = XLSX.CFB.read(
      new Uint8Array(
        applyOoxmlExtras(raw(), {
          tables,
          lists,
          validations: [{ sheet: "Actors", column: "A", formula: "L_Acteur", marksUnknown: true }],
        })
      ),
      { type: "array" }
    );
    const styles = readPart(cfb, "/xl/styles.xml")!;
    expect(styles).toContain('<dxfs count="1"><dxf>');
    expect(styles).not.toContain('<dxfs count="0"/>');
    // Between the cell styles and the table styles: the stylesheet's order is
    // imposed by the schema too.
    expect(styles.indexOf("</cellStyles>")).toBeLessThan(styles.indexOf("<dxfs"));
    expect(styles.indexOf("</dxfs>")).toBeLessThan(styles.indexOf("<tableStyles"));
    expect(readPart(cfb, "/xl/worksheets/sheet1.xml")!).toContain('<cfRule type="expression" dxfId="0" priority="1">');
  });

  it("adds nothing when no column asks for it", () => {
    const cfb = XLSX.CFB.read(
      new Uint8Array(
        applyOoxmlExtras(raw(), {
          tables,
          lists,
          validations: [{ sheet: "Actors", column: "A", formula: "L_Acteur" }],
        })
      ),
      { type: "array" }
    );
    expect(readPart(cfb, "/xl/styles.xml")!).toContain('<dxfs count="0"/>');
    expect(readPart(cfb, "/xl/worksheets/sheet1.xml")!).not.toContain("<conditionalFormatting");
  });
});
