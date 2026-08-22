import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { colourForTechnologies, coloursOfModel, PALETTE } from "./colors";
import { contrastRatio } from "./contrast";
import type { ParsedModel, InterfaceCatalogue, FlowType } from "../parsing/model";
import { SCHEMA_VERSION } from "../parsing/build-model";

function flowType(type: string): FlowType {
  return base.flowType({ type });
}

function iface(flowName: string, flowType: string): InterfaceCatalogue {
  return base.iface({ flowName, flowType });
}

// The FlowTypes sheet is a REFERENTIAL: the shipped template holds sixteen, of
// which a team uses only a handful. Indexing the palette on that referential
// wrapped eight hues over sixteen entries, hence gave the same colour to two
// technologies drawn side by side -- legend
// comprise.
describe("couleursDuModele", () => {
  const model = (types: string[], used: string[]): ParsedModel => ({
    actors: [], groups: [], groupsSheetMissing: false, actorTypes: [], milestones: [],
    flowTypes: types.map(flowType),
    interfaces: used.map((t, i) => iface(`F${i}`, t)),
    consumptions: [], fxSheetNames: [], missingOptionalColumns: [],
    schemaVersion: SCHEMA_VERSION, savedAt: null,
    referentialActors: [], referentialTechnologies: [],
  });

  const SEIZE = ["Kafka", "SFTP", "HTTP", "File", "SMTP", "JMS", "LDAP", "NTP",
    "Manual", "SQL", "Syslog", "gRPC", "Proprietary", "Screen entry", "Screen lookup", "Object storage (S3)"];

  it("gives a distinct colour to every technology actually drawn", () => {
    const colours = coloursOfModel(model(SEIZE, ["HTTP", "Kafka", "File", "SFTP", "SMTP"]));
    const distinctes = new Set([...colours.values()]);
    expect(distinctes.size).toBe(5);
  });

  it("wraps around the palette only beyond its eight hues", () => {
    const fresh = SEIZE.slice(0, 9);
    const colours = coloursOfModel(model(SEIZE, fresh));
    expect(new Set([...colours.values()]).size).toBe(8);
  });

  it("keeps the same colour for a technology from one view to the next", () => {
    // The workbook, not the board: a view showing only part of it must not
    // redistribute the hues.
    const m = model(SEIZE, ["HTTP", "Kafka", "File", "SFTP", "SMTP"]);
    expect(coloursOfModel(m).get("SFTP")).toBe(coloursOfModel(m).get("SFTP"));
  });
});

describe("colorForTechnologies", () => {
  it("stays stable whatever order it receives", () => {
    const a = colourForTechnologies(["Kafka", "HTTP"]);
    const b = colourForTechnologies(["HTTP", "Kafka"]);
    expect(a.get("Kafka")).toBe(b.get("Kafka"));
  });
});

// --- The external referential will carry each technology's colour, in
// hexadecimal. It therefore stops being derived from a rank -- which made it
// change as soon as a technology was added ahead of the others alphabetically
// -- and becomes data. The palette now serves only those that declare none.
//
describe("coloursOfModel — a colour declared by the referential", () => {
  const estate = (types: [string, string][], used: string[]): ParsedModel => ({
    actors: [], groups: [], groupsSheetMissing: false, actorTypes: [], milestones: [],
    flowTypes: types.map(([type, colour]) => ({ ...flowType(type), colour })),
    interfaces: used.map((t, i) => iface(`F${i}`, t)),
    consumptions: [], fxSheetNames: [], missingOptionalColumns: [],
    schemaVersion: SCHEMA_VERSION, savedAt: null,
    referentialActors: [], referentialTechnologies: [],
  });

  it("honours the declared colour", () => {
    const c = coloursOfModel(estate([["HTTP", "#123456"], ["Kafka", ""]], ["HTTP", "Kafka"]));
    expect(c.get("HTTP")).toBe("#123456");
  });

  // A hue dark enough to pass the contrast guard untouched: this test is about
  // the SPELLING accepted, not about the lightness correction.
  it("accepts hexadecimal without a hash and normalises it", () => {
    expect(coloursOfModel(estate([["HTTP", "1F5FAE"]], ["HTTP"])).get("HTTP")).toBe("#1f5fae");
  });

  it("ignores a value that is not a colour", () => {
    const c = coloursOfModel(estate([["HTTP", "bleu ciel"]], ["HTTP"]));
    expect(c.get("HTTP")).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.get("HTTP")).not.toBe("bleu ciel");
  });

  // The point that justifies everything: a declared technology keeps its hue
  // whatever is added around it, where the alphabetical rank shifted it.
  it("no longer moves when a technology is added ahead of it alphabetically", () => {
    const types: [string, string][] = [["HTTP", "#123456"], ["Kafka", "#654321"]];
    const before = coloursOfModel(estate(types, ["HTTP", "Kafka"]));
    const after = coloursOfModel(estate([...types, ["Batch", "#0f0f0f"]], ["HTTP", "Kafka", "Batch"]));
    expect(after.get("HTTP")).toBe(before.get("HTTP"));
    expect(after.get("Kafka")).toBe(before.get("Kafka"));
  });

  // A hue already taken by a declaration must not be redistributed to a
  // neighbour: two identical lines would stay indistinguishable.
  it("does not give another one a hue already declared", () => {
    const c = coloursOfModel(estate([["HTTP", "#2a78d6"], ["Kafka", ""], ["File", ""]], ["HTTP", "Kafka", "File"]));
    expect(new Set([...c.values()]).size).toBe(3);
  });
});

// --- A technology MUST be declared in the referential: that is the project's
// rule. A technology used without appearing in it is not drawn anyway -- its
// representation direction is unknown -- but it still took a hue, and therefore
// shifted those of the technologies that are drawn.
// On a real workbook, three drawn technologies shared the 1st, 3rd and 4th
// hues because two unknown ones had slipped in between.
describe("coloursOfModel — an undeclared technology takes no hue", () => {
  const estate = (declared: string[], used: string[]): ParsedModel => ({
    actors: [], groups: [], groupsSheetMissing: false, actorTypes: [], milestones: [],
    flowTypes: declared.map((t) => flowType(t)),
    interfaces: used.map((t, i) => iface(`F${i}`, t)),
    consumptions: [], fxSheetNames: [], missingOptionalColumns: [],
    schemaVersion: SCHEMA_VERSION, savedAt: null,
    referentialActors: [], referentialTechnologies: [],
  });

  it("ignores a technology absent from the referential", () => {
    const c = coloursOfModel(estate(["HTTP", "Kafka"], ["HTTP", "Kafka", "Inconnue"]));
    expect([...c.keys()].sort()).toEqual(["HTTP", "Kafka"]);
  });

  it("does not let an unknown one shift the others' hues", () => {
    const sans = coloursOfModel(estate(["HTTP", "Kafka"], ["HTTP", "Kafka"]));
    const avec = coloursOfModel(estate(["HTTP", "Kafka"], ["HTTP", "Kafka", "Batch"]));
    expect(avec.get("HTTP")).toBe(sans.get("HTTP"));
    expect(avec.get("Kafka")).toBe(sans.get("Kafka"));
  });
});

// --- QA: the fallback palette had never been judged as INK. Five hues out of
// eight fell below 3:1 as a stroke, eight out of eight below 4.5:1 as text --
// and the edge label is written in that colour.
describe("the fallback palette is legible", () => {
  it("puts every hue above 4.5:1 on white", () => {
    for (const c of PALETTE) expect(contrastRatio(c, "#ffffff"), c).toBeGreaterThanOrEqual(4.5);
  });

  // Eight hues that pass the contrast but look alike are worth nothing: the
  // legend tells them apart by name, the drawing by hue.
  it("keeps the hues distinct from one another", () => {
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });
});

// --- The referential can impose any hue at all. A light yellow declared in the
// workbook produced an invisible line, without a word.
describe("coloursOfModel — the contrast guard", () => {
  const estate = (colour: string) => ({
    interfaces: [{ flowType: "HTTP" }],
    flowTypes: [{ type: "HTTP", colour }],
  });

  it("darkens an unreadable declared colour rather than drawing it as it is", () => {
    expect(contrastRatio(coloursOfModel(estate("#ffee00")).get("HTTP")!, "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("honours as it is a declared colour that passes the threshold", () => {
    expect(coloursOfModel(estate("#1f5fae")).get("HTTP")).toBe("#1f5fae");
  });
});

describe("colour priority", () => {
  const base = {
    interfaces: [{ flowType: "HTTP" }],
    flowTypes: [{ type: "HTTP", colour: "" }],
  };

  it("takes the referential's colour when the workbook declares none", () => {
    const colours = coloursOfModel({
      ...base,
      referentialTechnologies: [{ type: "HTTP", colour: "#b8481f" }],
    });
    expect(colours.get("HTTP")).toBe("#b8481f");
  });

  it("lets a colour typed in the workbook win over the referential", () => {
    const colours = coloursOfModel({
      interfaces: [{ flowType: "HTTP" }],
      flowTypes: [{ type: "HTTP", colour: "#0e7f56" }],
      referentialTechnologies: [{ type: "HTTP", colour: "#b8481f" }],
    });
    expect(colours.get("HTTP")).toBe("#0e7f56");
  });

  it("falls back on the palette when neither declares one", () => {
    expect(coloursOfModel(base).get("HTTP")).toBe(PALETTE[0]);
  });

  // The two features have to agree on what "the referential knows this" means.
  // The integrity report matches on the normalised name, so it reported "http"
  // as known while the colour, keyed on the raw spelling, was lost.
  it("matches the referential's technology whatever its case", () => {
    const colours = coloursOfModel({
      ...base,
      referentialTechnologies: [{ type: "http", colour: "#b8481f" }],
    });
    expect(colours.get("HTTP")).toBe("#b8481f");
  });

  it("ignores a referential colour that is not hexadecimal", () => {
    const colours = coloursOfModel({
      ...base,
      referentialTechnologies: [{ type: "HTTP", colour: "blue" }],
    });
    expect(colours.get("HTTP")).toBe(PALETTE[0]);
  });
});
