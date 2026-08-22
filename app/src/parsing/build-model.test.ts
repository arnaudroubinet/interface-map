import { describe, it, expect } from "vitest";
import { buildModel, FX_COLUMNS, expectedFxSheet, isValidTabName } from "./build-model";
import type { ParsedWorkbook, RawSheet } from "./model";

function wb(sheets: RawSheet[]): ParsedWorkbook {
  return { sheets, savedAt: null };
}

// The real headers come from row 1 of the sheet, not from the data rows (see
// RawSheet.headers); for a test fixture with at least one row, the union of
// its keys is a faithful equivalent.
function sheet(name: string, rows: Record<string, string>[], headers?: string[]): RawSheet {
  return {
    name,
    headers: headers ?? [...new Set(rows.flatMap((r) => Object.keys(r)))],
    rows: rows.map((values, i) => ({ row: i + 2, values })),
  };
}

const actorsOk: RawSheet = sheet("Actors", [
  { Name: "Tatooine", Group: "Socle", "Perimeter": "Platform", "Actor type": "Application", Status: "Actif", Owner: "", Description: "", Comments: "" },
  { Name: "Mygeeto", Group: "Ryloth", "Perimeter": "External", "Actor type": "Application", Status: "Actif", Owner: "", Description: "", Comments: "" },
]);

const flowTypesOk: RawSheet = sheet("FlowTypes", [
  { "Flow type": "HTTP", "Direction": "consumer → provider", Description: "" },
  { "Flow type": "Kafka", "Direction": "provider → consumer", Description: "" },
]);

const interfacesOk: RawSheet = sheet("Interfaces", [
  { "Flow name": "Authent", "Provider": "Tatooine", "Flow type": "HTTP", Description: "Ouverture de session", "Contract link": "", "Contract reference": "MOD1", Comments: "", "To confirm": "" },
]);

const fxTatooineHttp: RawSheet = sheet("FX_Tatooine_HTTP", [
  { "Flow name": "Authent", "Consumer": "Mygeeto", Usage: "Ouverture", "Criticality for this consumer": "1 - Critical", Status: "Actif", "Decision": "Keep", Comments: "" },
]);

describe("buildModel — happy path", () => {
  it("builds the referential, catalog and consumptions", () => {
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, fxTatooineHttp]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.actors).toHaveLength(2);
    expect(result.model.flowTypes).toHaveLength(2);
    expect(result.model.interfaces).toHaveLength(1);
    expect(result.model.interfaces[0].expectedSheet).toBe("FX_Tatooine_HTTP");
    expect(result.model.consumptions).toHaveLength(1);
    expect(result.model.consumptions[0].sheet).toBe("FX_Tatooine_HTTP");
    expect(result.model.fxSheetNames).toEqual(["FX_Tatooine_HTTP"]);
  });

  it("matches sheet names case/accent-insensitively", () => {
    const result = buildModel(
      wb([
        { ...actorsOk, name: "actors" },
        { ...flowTypesOk, name: "TYPESFLUX" },
        interfacesOk,
      ])
    );
    expect(result.ok).toBe(true);
  });

  it("ignores FX_Modèle as a consumption sheet", () => {
    const template: RawSheet = { name: "FX_Modèle", headers: [], rows: [] };
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, fxTatooineHttp, template]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.fxSheetNames).toEqual(["FX_Tatooine_HTTP"]);
  });

  it("drops rows with no content in any expected column", () => {
    const withBlankRow: RawSheet = {
      ...actorsOk,
      rows: [
        ...actorsOk.rows,
        { row: 4, values: { Name: "", Group: "", "Perimeter": "", "Actor type": "", Status: "", Owner: "", Description: "", Comments: "" } },
      ],
    };
    const result = buildModel(wb([withBlankRow, flowTypesOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.actors).toHaveLength(2);
  });

  // The intent has not changed -- never let a name Excel refuses reach the
  // workbook -- but the means has: it is sanitised at the source instead of
  // being marked invalid and thrown away at writing time, which carried the
  // sheet's consumptions off without a word.
  it("keeps a reconstructed FX_ name within what Excel accepts, however long the flow type", () => {
    const longTypeName: RawSheet = sheet("FlowTypes", [
      { "Flow type": "Un type de flux vraiment beaucoup trop long", "Direction": "consumer → provider", Description: "" },
    ]);
    const longInterfaceName: RawSheet = sheet("Interfaces", [
      { "Flow name": "X", "Provider": "Tatooine", "Flow type": "Un type de flux vraiment beaucoup trop long", Description: "", "Contract link": "", "Contract reference": "", Comments: "", "To confirm": "" },
    ]);
    const result = buildModel(wb([actorsOk, longTypeName, longInterfaceName]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const expected = result.model.interfaces[0].expectedSheet;
    expect(expected.length).toBeLessThanOrEqual(31);
    expect(isValidTabName(expected)).toBe(true);
  });

  it("tracks non-key columns missing from a sheet's header row", () => {
    const actorsWithoutGroup: RawSheet = sheet("Actors", [{ Name: "Tatooine" }]);
    const result = buildModel(wb([actorsWithoutGroup, flowTypesOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.missingOptionalColumns).toContainEqual({ sheet: "Actors", column: "Group" });
  });

  it("does not report every column missing on a present-but-empty FX_ tab (freshly generated by the macro, §12)", () => {
    const emptyFx: RawSheet = { name: "FX_Bespin_OIDC-SSO", headers: [...FX_COLUMNS], rows: [] };
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, emptyFx]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.missingOptionalColumns.filter((c) => c.sheet === "FX_Bespin_OIDC-SSO")).toHaveLength(0);
  });
});

describe("buildModel — blocking errors", () => {
  it("blocks when a structuring sheet is missing", () => {
    const result = buildModel(wb([actorsOk, flowTypesOk]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes("Interfaces"))).toBe(true);
  });

  it("blocks when a key column is missing", () => {
    const unnamedActors: RawSheet = sheet("Actors", [{ Group: "Socle" }]);
    const result = buildModel(wb([unnamedActors, flowTypesOk, interfacesOk]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes("Name"))).toBe(true);
  });

  it("reports every blocking cause at once", () => {
    const result = buildModel(wb([]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(3);
  });

  it("reports a present sheet's missing key column even when a different sheet is absent entirely", () => {
    const unnamedActors: RawSheet = sheet("Actors", [{ Group: "Socle" }]);
    const result = buildModel(wb([unnamedActors, flowTypesOk]));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.message.includes("Interfaces"))).toBe(true);
    expect(result.errors.some((e) => e.message.includes("Name") && e.message.includes("Actors"))).toBe(true);
  });
});

describe("buildModel — an interface's version and state", () => {
  it("reads the Version and État columns of an interface", () => {
    const interfaces = sheet("Interfaces", [
      { "Flow name": "Authent", Version: "1.0", "État": "À décommissionner", "Provider": "Tatooine", "Flow type": "HTTP" },
    ]);
    const result = buildModel(wb([actorsOk, flowTypesOk, interfaces]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].version).toBe("1.0");
    expect(result.model.interfaces[0].legacyState).toBe("À décommissionner");
  });

  it("reads the Version column of a consumption", () => {
    const fx = sheet("FX_Tatooine_HTTP", [
      { "Flow name": "Authent", Version: "2.0", "Consumer": "Mygeeto", Status: "Actif", "Decision": "Keep" },
    ]);
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, fx]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.consumptions[0].version).toBe("2.0");
  });

  // An empty version is a version, not an absence: that is what lets earlier
  // workbooks match exactly as before.
  it("leaves version empty rather than absent when the column is missing", () => {
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, fxTatooineHttp]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].version).toBe("");
    expect(result.model.consumptions[0].version).toBe("");
  });
});

describe("buildModel — the workbook's schema number", () => {
  it("reads the schema number from the hidden Version sheet", () => {
    const version = sheet("Version", [{ "Model version": "1" }]);
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, version]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.schemaVersion).toBe(1);
  });

  // Every workbook produced before this change.
  it("treats a workbook without the sheet as version 0", () => {
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.schemaVersion).toBe(0);
  });

  it("falls back to 0 on an unreadable schema number", () => {
    const version = sheet("Version", [{ "Model version": "n'importe quoi" }]);
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, version]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.schemaVersion).toBe(0);
  });

  it("does not mistake the Version sheet for a consumption sheet", () => {
    const version = sheet("Version", [{ "Model version": "1" }]);
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, version]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.fxSheetNames).toEqual([]);
  });
});

const milestonesOk: RawSheet = sheet("Milestones", [
  { Milestone: "v1", Rank: "1", "Label": "Socle initial", Status: "Delivered", Date: "2026-01-15", Description: "" },
  { Milestone: "v2", Rank: "2", "Label": "Ouverture partenaires", Status: "Delivered", Date: "2026-06-01", Description: "" },
  { Milestone: "v3", Rank: "3", "Label": "Temps réel", Status: "Planned", Date: "", Description: "" },
]);

describe("buildModel — onglet Paliers", () => {
  it("reads the declared paliers with their rank and status", () => {
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, milestonesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.milestones.map((p) => p.name)).toEqual(["v1", "v2", "v3"]);
    expect(result.model.milestones[1].rank).toBe(2);
    expect(result.model.milestones[2].status).toBe("Planned");
  });

  // The order comes from the rank, not from the row order: a sort in Excel would
  // destroy an implicit order without saying a word.
  it("orders by rank, not by row order", () => {
    const shuffled: RawSheet = sheet("Milestones", [
      { Milestone: "v3", Rank: "3", Status: "Planned" },
      { Milestone: "v1", Rank: "1", Status: "Delivered" },
      { Milestone: "v2", Rank: "2", Status: "Delivered" },
    ]);
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, shuffled]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.milestones.map((p) => p.name)).toEqual(["v1", "v2", "v3"]);
  });

  it("leaves the list empty when the sheet is absent", () => {
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.milestones).toEqual([]);
  });
});

describe("buildModel — validity columns", () => {
  it("reads the introduction and retirement paliers of an acteur", () => {
    const actors: RawSheet = sheet("Actors", [
      { Name: "Tatooine", Group: "Socle", "Introduced at": "v1", "Retired at": "v3" },
    ]);
    const result = buildModel(wb([actors, flowTypesOk, interfacesOk, milestonesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.actors[0].introducedAt).toBe("v1");
    expect(result.model.actors[0].retiredAt).toBe("v3");
  });

  it("reads them on an interface and on a consumption", () => {
    const interfaces: RawSheet = sheet("Interfaces", [
      { "Flow name": "Authent", "Provider": "Tatooine", "Flow type": "HTTP", "Introduced at": "v2" },
    ]);
    const fx: RawSheet = sheet("FX_Tatooine_HTTP", [
      { "Flow name": "Authent", "Consumer": "Mygeeto", "Retired at": "v3" },
    ]);
    const result = buildModel(wb([actorsOk, flowTypesOk, interfaces, fx, milestonesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].introducedAt).toBe("v2");
    expect(result.model.consumptions[0].retiredAt).toBe("v3");
  });

  // Empty, they keep the project's usual meaning: "always been there" and
  // "still there". Workbooks that date nothing read identically.
  it("leaves them empty rather than absent when nothing is declared", () => {
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, fxTatooineHttp]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.actors[0].introducedAt).toBe("");
    expect(result.model.interfaces[0].retiredAt).toBe("");
    expect(result.model.consumptions[0].introducedAt).toBe("");
  });
});

describe("an actor type's nature and an interface's relay", () => {
  it("reads the nature declared on the actor type", () => {
    const result = buildModel(
      wb([
        sheet("Actors", [{ Name: "Tatooine", Group: "Socle", "Actor type": "Application" }]),
        sheet("ActorTypes", [
          { "Actor type": "Application", Icon: "app-window", Nature: "Business" },
          { "Actor type": "Middleware", Icon: "server", Nature: "Technical" },
        ]),
        flowTypesOk,
        sheet("Interfaces", [{ "Flow name": "F", Provider: "Tatooine", "Flow type": "HTTP" }]),
      ])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.actorTypes.map((t) => [t.type, t.nature])).toEqual([
      ["Application", "Business"],
      ["Middleware", "Technical"],
    ]);
  });

  it("reads the relay declared on an interface", () => {
    const result = buildModel(
      wb([
        sheet("Actors", [{ Name: "Bus", Group: "Socle", "Actor type": "Middleware" }]),
        sheet("ActorTypes", [{ "Actor type": "Middleware", Icon: "server", Nature: "Technical" }]),
        flowTypesOk,
        sheet("Interfaces", [{ "Flow name": "trx.norm", Provider: "Bus", "Flow type": "HTTP", Relays: "Transactions" }]),
      ])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.interfaces[0].legacyRelays).toBe("Transactions");
  });

  // A workbook from before v3 has neither column: it must read identically, with
  // both fields empty.
  it("reads both fields empty when the columns are missing", () => {
    const result = buildModel(
      wb([
        sheet("Actors", [{ Name: "Tatooine", Group: "Socle", "Actor type": "Application" }]),
        sheet("ActorTypes", [{ "Actor type": "Application", Icon: "app-window" }]),
        flowTypesOk,
        sheet("Interfaces", [{ "Flow name": "F", Provider: "Tatooine", "Flow type": "HTTP" }]),
      ])
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.actorTypes[0].nature).toBe("");
    expect(result.model.interfaces[0].legacyRelays).toBe("");
  });
});

// --- QA: Excel refuses a sheet name longer than 31 characters or carrying one
// of: \ / ? * [ ]. The name being DERIVED from the publisher and the flow type,
// an actor with a slightly long name produced an impossible sheet -- and the
// writing dropped it in silence, taking its consumptions with it. The name is
// now sanitised at the one place it is made.
describe("expectedFxSheet — a name Excel always accepts", () => {
  it("cuts at 31 characters", () => {
    const name = expectedFxSheet("Plateforme de règlement-livraison", "HTTP");
    expect(name).toHaveLength(31);
    expect(isValidTabName(name)).toBe(true);
  });

  it("replaces the characters Excel forbids", () => {
    const name = expectedFxSheet("Referentiel", "OIDC/SSO");
    expect(name).toBe("FX_Referentiel_OIDC-SSO");
    expect(isValidTabName(name)).toBe(true);
  });

  it("leaves an already acceptable name alone", () => {
    expect(expectedFxSheet("Tatooine", "HTTP")).toBe("FX_Tatooine_HTTP");
  });

  it("sanitises every one of the forbidden characters", () => {
    for (const c of [":", "\\", "/", "?", "*", "[", "]"]) {
      expect(isValidTabName(expectedFxSheet("A", `X${c}Y`))).toBe(true);
    }
  });
});

describe("external referential", () => {
  it("reads both referential sheets when they carry rows", () => {
    const refActors = sheet("RefActors", [
      { Name: "Tatooine", Group: "Core", "Actor type": "Application", Owner: "Ada", Description: "The mothership" },
    ]);
    const refTechnologies = sheet("RefTechnologies", [
      { "Flow type": "HTTP", Direction: "provider to consumer", Description: "Synchronous", Colour: "#1f5fae" },
    ]);
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, refActors, refTechnologies]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.referentialActors).toEqual([
      { name: "Tatooine", group: "Core", actorType: "Application", owner: "Ada", description: "The mothership" },
    ]);
    expect(result.model.referentialTechnologies).toEqual([
      { type: "HTTP", direction: "provider to consumer", description: "Synchronous", colour: "#1f5fae" },
    ]);
  });

  it("leaves both lists empty when the sheets are absent, without complaining", () => {
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.referentialActors).toEqual([]);
    expect(result.model.referentialTechnologies).toEqual([]);
  });

  it("drops a nameless referential row rather than carrying a blank entry", () => {
    const refActors = sheet("RefActors", [
      { Name: "", Group: "Core" },
      { Name: "Alderaan", Group: "Core" },
    ]);
    const result = buildModel(wb([actorsOk, flowTypesOk, interfacesOk, refActors]));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.referentialActors.map((a) => a.name)).toEqual(["Alderaan"]);
  });
});
