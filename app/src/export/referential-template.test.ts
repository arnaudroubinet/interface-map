import { describe, it, expect, vi } from "vitest";
import * as XLSX from "xlsx";
import { writeReferential, SAMPLE_REFERENTIAL, EMPTY_REFERENTIAL } from "./referential-template";
import { REFERENTIAL_SHEETS } from "./referential-shape";
import { tableName } from "./xlsx-tables";
import { sectionM } from "./datamashup";
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

// referential-shape.ts spells out the table names the queries look for, because
// it cannot import tableName() -- xlsx-tables already imports datamashup, and
// the cycle would be real. This is the guard that makes the duplication safe.
describe("the referential workbook — the names the queries look for", () => {
  it("names each table exactly as the query asks for it", () => {
    for (const r of REFERENTIAL_SHEETS) {
      expect(r.table).toBe(tableName(r.sheet));
    }
  });

  it("lays down every table the queries navigate to", () => {
    const written = tableNames(writeReferential());
    for (const r of REFERENTIAL_SHEETS) {
      expect(written).toContain(r.table);
      expect(sectionM("https://ref/r.xlsx")).toContain(`Item="${r.table}"`);
    }
  });

  it("carries one sheet per vocabulary, plus the sheet that explains the file", () => {
    const wb = XLSX.read(new Uint8Array(writeReferential()), { type: "array" });
    expect(wb.SheetNames).toEqual(["Instructions", ...REFERENTIAL_SHEETS.map((r) => r.sheet)]);
  });

  it("heads each sheet with the columns its query keeps", () => {
    const wb = XLSX.read(new Uint8Array(writeReferential()), { type: "array" });
    for (const r of REFERENTIAL_SHEETS) {
      const rows = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[r.sheet], { header: 1 });
      expect(rows[0]).toEqual([...r.columns]);
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
      expect(rows[0]).toEqual([...r.columns]);
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
