import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { writeReferential, SAMPLE_REFERENTIAL, EMPTY_REFERENTIAL, BLANK_REFERENTIAL } from "./referential-template";
import { REFERENTIAL_SHEETS } from "../parsing/referential-shape";
import { VOCABULARY_NATURE } from "../aggregation/vocabularies";
import { tableName } from "./xlsx-tables";
import { SAMPLE_DATA } from "./sample-data";
import { writeTemplate } from "./template-export";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel } from "../parsing/build-model";
import { runIntegrityChecks } from "../integrity/checks";

function part(bytes: ArrayBuffer, path: string): string {
  const cfb = XLSX.CFB.read(new Uint8Array(bytes), { type: "array" });
  const found = XLSX.CFB.find(cfb, path);
  if (!found) throw new Error(`${path} missing`);
  return new TextDecoder().decode(new Uint8Array(found.content as never));
}

function tableNames(bytes: ArrayBuffer): string[] {
  const cfb = XLSX.CFB.read(new Uint8Array(bytes), { type: "array" });
  return (cfb as { FullPaths: string[] }).FullPaths.filter((p) => /\/xl\/tables\/table\d+\.xml$/.test(p))
    .map((p) => /displayName="([^"]+)"/.exec(part(bytes, p))?.[1] ?? "")
    .sort();
}

// referential-shape.ts spells out the table names, because it cannot import
// tableName() -- the parsing layer does not depend on the export layer. This
// is the guard that makes the duplication safe.
describe("the referential workbook — the names its tables carry", () => {
  it("names each table exactly as the shape announces it", () => {
    for (const r of REFERENTIAL_SHEETS) {
      expect(r.table).toBe(tableName(r.sheet));
    }
  });

  it("lays down every table the shape announces", () => {
    const written = tableNames(writeReferential());
    for (const r of REFERENTIAL_SHEETS) {
      expect(written).toContain(r.table);
    }
  });

  it("carries one sheet per vocabulary, the sheet that explains the file, and its own lists", () => {
    const wb = XLSX.read(new Uint8Array(writeReferential()), { type: "array" });
    expect(wb.SheetNames).toEqual(["Instructions", ...REFERENTIAL_SHEETS.map((r) => r.sheet), "Lists"]);
  });

  // The preview sits here now: this is where an icon is chosen. It is not one
  // of the columns the query carries over -- the cartography has no use for a
  // preview of a value it cannot change.
  it("heads each sheet with the columns its query keeps, plus the icon preview", () => {
    const wb = XLSX.read(new Uint8Array(writeReferential()), { type: "array" });
    for (const r of REFERENTIAL_SHEETS) {
      const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[r.sheet], { header: 1 });
      const expected = r.sheet === "ActorTypes" ? [...r.columns, "Preview"] : [...r.columns];
      expect(rows[0]).toEqual(expected);
    }
  });
});

// A referential with nothing in it shows nothing of what a referential does.
// The sample one publishes exactly what the sample cartography declares, so
// that pointing one at the other reports no name unknown to the referential.
describe("SAMPLE_REFERENTIAL", () => {
  const rows = (bytes: ArrayBuffer, sheet: string) => {
    const wb = XLSX.read(new Uint8Array(bytes), { type: "array" });
    return XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheet], { header: 1 }).slice(1);
  };

  it("publishes every actor of the sample cartography", () => {
    const names = rows(writeReferential(SAMPLE_REFERENTIAL), "Actors").map((r) => r[0]);
    expect(names).toEqual(SAMPLE_DATA.actors.map((a) => a[0]));
  });

  it("publishes its groups and its actor types", () => {
    const bytes = writeReferential(SAMPLE_REFERENTIAL);
    expect(rows(bytes, "Groups").map((r) => r[0])).toEqual(SAMPLE_DATA.groups.map((g) => g[0]));
    expect(rows(bytes, "ActorTypes").map((r) => r[0])).toEqual(SAMPLE_DATA.actorTypes.map((t) => t[0]));
  });

  // The sample cartography declares no technology of its own: it lives off the
  // seed. The referential must publish that seed, or every technology drawn
  // would be reported unknown to it.
  it("publishes the technologies the sample cartography actually uses", () => {
    const declared = rows(writeReferential(SAMPLE_REFERENTIAL), "FlowTypes").map((r) => r[0]);
    const used = new Set(SAMPLE_DATA.interfaces.map((i) => i[3]));
    for (const technology of used) expect(declared).toContain(technology);
  });

  it("carries a colour for every technology it publishes", () => {
    for (const row of rows(writeReferential(SAMPLE_REFERENTIAL), "FlowTypes")) {
      expect(row[3]).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

// An Excel table always spans one row beyond its header, empty or not: that is
// the row the first entry lands in. What must not appear is a VALUE nobody
// typed -- a seed the referential's owner would have to delete.
describe("writeReferential — an empty referential", () => {
  it("heads every sheet and fills none of them", () => {
    const wb = XLSX.read(new Uint8Array(writeReferential(EMPTY_REFERENTIAL)), { type: "array" });
    for (const r of REFERENTIAL_SHEETS) {
      const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[r.sheet], { header: 1 });
      expect(rows[0].slice(0, r.columns.length)).toEqual([...r.columns]);
      expect(rows.slice(1).flat().filter((cell) => `${cell ?? ""}`.trim() !== "")).toEqual([]);
    }
  });
});

// The promise the two sample files make together: publish the sample
// referential, point the sample cartography at it, and the report says nothing
// is unknown to it. The query cannot run here -- only Excel fills the Ref*
// sheets -- so the rows it would pour in are put in the model directly.
describe("the sample referential and the sample cartography, pointed at each other", () => {
  it("leaves no name unknown to the referential", () => {
    const built = buildModel(parseWorkbook(writeTemplate(SAMPLE_DATA)));
    if (!built.ok) throw new Error("unreadable sample workbook");

    const report = runIntegrityChecks({
      ...built.model,
      referentialActors: SAMPLE_REFERENTIAL.actors.map((a) => ({
        name: a[0], group: a[1], actorType: a[2], owner: a[3], description: a[4],
      })),
      referentialGroups: SAMPLE_REFERENTIAL.groups.map((g) => ({ name: g[0], description: g[1] })),
      referentialActorTypes: SAMPLE_REFERENTIAL.actorTypes.map((t) => ({
        type: t[0], icon: t[1], nature: t[2], description: t[3],
      })),
      referentialTechnologies: SAMPLE_REFERENTIAL.flowTypes.map((t) => ({
        type: t[0], direction: t[1], description: t[2], colour: t[3],
      })),
    });

    expect(report.infoBlocks.find((b) => b.id === "out-of-referential")).toBeUndefined();
  });
});

// A referential whose own columns are typed by hand invents the divergence it
// exists to prevent: "Data & Finance" here, "Data and Finance" three rows down,
// and the cartography inherits both.
describe("the referential workbook — its own drop-downs", () => {
  const validationsOf = (sheet: string): string[] => {
    const cfb = XLSX.CFB.read(new Uint8Array(writeReferential()), { type: "array" });
    const index = REFERENTIAL_SHEETS.findIndex((r) => r.sheet === sheet) + 2;
    const xml = part(writeReferential(), `/xl/worksheets/sheet${index}.xml`);
    return [...xml.matchAll(/<formula1>(.*?)<\/formula1>/g)].map((m) => m[1]);
  };

  it("picks the group and the actor type from the sheets that hold them", () => {
    const lists = validationsOf("Actors");
    expect(lists).toContain("L_Groupe");
    expect(lists).toContain("L_TypeActeur");
  });

  // Excel's data validation refuses a structured reference outright: a list
  // whose formula reads TblGroups[Name] simply does not open. Every list goes
  // through a defined name, here as in the cartography.
  it("names every list rather than pointing a validation at a table", () => {
    for (const r of REFERENTIAL_SHEETS) {
      for (const formula of validationsOf(r.sheet)) expect(formula).not.toMatch(/Tbl[A-Za-z]+\[/);
    }
  });

  it("points those names at the columns that carry the vocabulary", () => {
    const workbook = part(writeReferential(), "/xl/workbook.xml");
    expect(workbook).toContain('<definedName name="L_Groupe">TblGroups[Name]</definedName>');
    expect(workbook).toContain('<definedName name="L_TypeActeur">TblActorTypes[Actor type]</definedName>');
  });

  it("picks the icon and the nature from its own vocabularies", () => {
    const lists = validationsOf("ActorTypes");
    expect(lists).toContain("L_Icone");
    expect(lists).toContain("L_Nature");
  });

  it("picks a technology's direction from its own vocabulary", () => {
    expect(validationsOf("FlowTypes")).toContain("L_Sens");
  });

  it("shows the icon it names, through a calculated column", () => {
    const wb = XLSX.read(new Uint8Array(writeReferential(BLANK_REFERENTIAL)), { type: "array" });
    const preview = XLSX.utils.encode_col(REFERENTIAL_SHEETS.find((r) => r.sheet === "ActorTypes")!.columns.length);
    const cell = wb.Sheets.ActorTypes[`${preview}2`];
    expect(cell.f).toContain("MATCH([@Icon]");
    expect(cell.v).not.toBe("");
  });
});

// The two vocabularies nobody should retype used to be seeded into every
// cartography. They belong here now: a cartography takes the types and the
// technologies it uses FROM the referential, so a blank one must have some.
describe("BLANK_REFERENTIAL", () => {
  const rows = (sheet: string) => {
    const wb = XLSX.read(new Uint8Array(writeReferential(BLANK_REFERENTIAL)), { type: "array" });
    return XLSX.utils.sheet_to_json<string[]>(wb.Sheets[sheet], { header: 1 }).slice(1);
  };

  it("ships the common technologies, each with the way it is drawn", () => {
    const technologies = rows("FlowTypes");
    expect(technologies.map((r) => r[0])).toContain("HTTP");
    expect(technologies.map((r) => r[0])).toContain("Kafka");
    expect(technologies.every((r) => (r[1] ?? "").trim() !== "")).toBe(true);
  });

  it("ships the starting actor types, each with an icon and a nature", () => {
    for (const row of rows("ActorTypes")) {
      expect(row[1]).not.toBe("");
      expect(VOCABULARY_NATURE).toContain(row[2]);
    }
  });

  // The estate being mapped is nobody else's: a blank referential that named
  // actors would be naming someone's.
  it("names no actor and no group", () => {
    // The table always spans one row past its header, empty or not: what must
    // not be there is a VALUE nobody typed.
    expect(rows("Actors").flat().filter(Boolean)).toEqual([]);
    expect(rows("Groups").flat().filter(Boolean)).toEqual([]);
  });
});
