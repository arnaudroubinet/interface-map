// This file covers nothing but displayName collisions. The rest of the
// hand-written OOXML -- defined names, validations, tag order -- is verified
// tag by tag in template-export.test.ts, which inspects the XML actually
// produced. Good coverage, filed under another name.
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { applyOoxmlExtras, readPart, type TableToApply } from "./xlsx-tables";
import { readReferentialUrls } from "./datamashup";

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

describe("referentials in the package", () => {
  // A one-sheet workbook is enough: what is being checked is the package, not
  // the sheet.
  function minimal(): ArrayBuffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name"], ["Tatooine"]]), "Actors");
    return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  }

  const tables = [{ sheet: "Actors", columns: ["Name"], rows: 1 }];

  it("writes the three custom parts when a URL is set", () => {
    const out = applyOoxmlExtras(minimal(), {
      tables,
      referentials: { actors: "https://ref/a.csv", technologies: "" },
    });
    const cfb = XLSX.CFB.read(new Uint8Array(out), { type: "array" });
    expect(XLSX.CFB.find(cfb, "/customXml/item1.xml")).toBeTruthy();
    expect(XLSX.CFB.find(cfb, "/customXml/itemProps1.xml")).toBeTruthy();
    expect(XLSX.CFB.find(cfb, "/customXml/_rels/item1.xml.rels")).toBeTruthy();
  });

  it("declares only itemProps, the item falling under the xml default", () => {
    const out = applyOoxmlExtras(minimal(), {
      tables,
      referentials: { actors: "https://ref/a.csv", technologies: "" },
    });
    const cfb = XLSX.CFB.read(new Uint8Array(out), { type: "array" });
    const types = readPart(cfb, "/[Content_Types].xml")!;
    expect(types).toContain('PartName="/customXml/itemProps1.xml"');
    expect(types).not.toContain('PartName="/customXml/item1.xml"');
  });

  it("relates the item to the workbook under an unused id", () => {
    const out = applyOoxmlExtras(minimal(), {
      tables,
      referentials: { actors: "https://ref/a.csv", technologies: "" },
    });
    const cfb = XLSX.CFB.read(new Uint8Array(out), { type: "array" });
    const rels = readPart(cfb, "/xl/_rels/workbook.xml.rels")!;
    const match = /Id="(rId\d+)"[^>]*customXml[^>]*Target="\.\.\/customXml\/item1\.xml"/.exec(rels);
    expect(match).toBeTruthy();
    // The id must not already be taken by a sheet, a style or the theme.
    const others = [...rels.matchAll(/Id="(rId\d+)"/g)].map((m) => m[1]);
    expect(others.filter((id) => id === match![1])).toHaveLength(1);
  });

  it("writes nothing at all when both URLs are empty", () => {
    const out = applyOoxmlExtras(minimal(), { tables, referentials: { actors: "", technologies: "" } });
    const cfb = XLSX.CFB.read(new Uint8Array(out), { type: "array" });
    expect(XLSX.CFB.find(cfb, "/customXml/item1.xml")).toBeFalsy();
  });

  it("produces a package the reader can take the URLs back out of", async () => {
    const urls = { actors: "https://ref/a.csv", technologies: "https://ref/t.csv" };
    const out = applyOoxmlExtras(minimal(), { tables, referentials: urls });
    expect(await readReferentialUrls(out)).toEqual(urls);
  });
});

describe("query tables", () => {
  function minimal(): ArrayBuffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name", "Group"], ["", ""]]), "RefActors");
    return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
  }

  const extras = {
    tables: [{ sheet: "RefActors", columns: ["Name", "Group"], rows: 0, query: "RefActors" }],
    referentials: { actors: "https://ref/a.csv", technologies: "" },
  };

  it("declares one connection per query, pointing at the workbook's own mashup", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(applyOoxmlExtras(minimal(), extras)), { type: "array" });
    const connections = readPart(cfb, "/xl/connections.xml")!;
    expect(connections).toContain('type="5"');
    expect(connections).toContain("Provider=Microsoft.Mashup.OleDb.1");
    expect(connections).toContain("Location=RefActors");
    expect(connections).toContain("SELECT * FROM [RefActors]");
    // Saved data is what makes the workbook readable with no network.
    expect(connections).toContain('saveData="1"');
  });

  it("writes a query table naming every column of its table", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(applyOoxmlExtras(minimal(), extras)), { type: "array" });
    const queryTable = readPart(cfb, "/xl/queryTables/queryTable1.xml")!;
    expect(queryTable).toContain('connectionId="1"');
    expect(queryTable).toContain('<queryTableField id="1" name="Name" tableColumnId="1"/>');
    expect(queryTable).toContain('<queryTableField id="2" name="Group" tableColumnId="2"/>');
  });

  it("marks the table as fed by a query and links each column to its field", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(applyOoxmlExtras(minimal(), extras)), { type: "array" });
    const table = readPart(cfb, "/xl/tables/table1.xml")!;
    expect(table).toContain('tableType="queryTable"');
    expect(table).toContain('queryTableFieldId="1"');
    expect(table).toContain('queryTableFieldId="2"');
    const rels = readPart(cfb, "/xl/tables/_rels/table1.xml.rels")!;
    expect(rels).toContain("../queryTables/queryTable1.xml");
  });

  // Excel writes uniqueName on the columns of a query-backed table and on those
  // alone. Its absence was one of the two differences with a workbook Excel had
  // itself produced, on a file it refused to open without repairing.
  it("gives every query-backed column the uniqueName Excel writes", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(applyOoxmlExtras(minimal(), extras)), { type: "array" });
    const table = readPart(cfb, "/xl/tables/table1.xml")!;
    expect(table).toContain('<tableColumn id="1" uniqueName="1" name="Name" queryTableFieldId="1"/>');
    expect(table).toContain('<tableColumn id="2" uniqueName="2" name="Group" queryTableFieldId="2"/>');
  });

  // The external data range: the hidden defined name tying the query to where
  // it lands. Excel drops a query table that has none -- "Fonction supprimée :
  // Tableau dans la partie /xl/tables/tableN.xml" -- and repairs the file.
  it("declares the external data range of the query table", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(applyOoxmlExtras(minimal(), extras)), { type: "array" });
    const workbook = readPart(cfb, "/xl/workbook.xml")!;
    expect(workbook).toContain(
      '<definedName name="ExternalData_1" localSheetId="0" hidden="1">RefActors!$A$1:$B$2</definedName>'
    );
  });

  // localSheetId is a position in the workbook's sheet order, not a sheetId:
  // pointing at the wrong sheet is pointing at the wrong range.
  it("numbers the external data range from the sheet's rank in the workbook", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Flow name"], ["a"]]), "Interfaces");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Name", "Group"], ["", ""]]), "Ref actors");
    const raw = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    const out = applyOoxmlExtras(raw, {
      tables: [
        { sheet: "Interfaces", columns: ["Flow name"], rows: 1 },
        { sheet: "Ref actors", columns: ["Name", "Group"], rows: 0, query: "RefActors" },
      ],
      referentials: { actors: "https://ref/a.csv", technologies: "" },
    });
    const workbook = readPart(XLSX.CFB.read(new Uint8Array(out), { type: "array" }), "/xl/workbook.xml")!;
    // A sheet name carrying a space is quoted, as a formula quotes it.
    expect(workbook).toContain(
      `<definedName name="ExternalData_1" localSheetId="1" hidden="1">'Ref actors'!$A$1:$B$2</definedName>`
    );
  });

  it("declares both new parts in the content types", () => {
    const cfb = XLSX.CFB.read(new Uint8Array(applyOoxmlExtras(minimal(), extras)), { type: "array" });
    const types = readPart(cfb, "/[Content_Types].xml")!;
    expect(types).toContain('PartName="/xl/connections.xml"');
    expect(types).toContain('PartName="/xl/queryTables/queryTable1.xml"');
  });

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
