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

function displayNamesDesTables(paquet: ArrayBuffer): string[] {
  const cfb = XLSX.CFB.read(new Uint8Array(paquet), { type: "array" });
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
    const paquet = applyOoxmlExtras(minimalWorkbook(sheets), { tables });
    const names = displayNamesDesTables(paquet);
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
  });

  it("names the tables stably from one generation to the next", () => {
    const raw = minimalWorkbook(sheets);
    const premier = displayNamesDesTables(applyOoxmlExtras(raw, { tables }));
    const second = displayNamesDesTables(applyOoxmlExtras(raw, { tables }));
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
