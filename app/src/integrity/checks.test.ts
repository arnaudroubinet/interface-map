import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { runIntegrityChecks } from "./checks";
import { buildFlowInstances } from "../aggregation/core";
import { buildFunctionalFlows } from "../aggregation/reading";
import { SCHEMA_VERSION, expectedFxSheet } from "../parsing/build-model";
import type { ParsedModel, Actor, InterfaceCatalogue, Consumption } from "../parsing/model";

// An estate that triggers nothing: each test then introduces a single fault,
// the one it examines.
function actor(o: Partial<Actor> = {}): Actor {
  return base.actor({ description: "d", ...o });
}

function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return base.iface({ description: "d", contractLink: "lien", ...o });
}

function consumption(o: Partial<Consumption> = {}): Consumption {
  return base.consumption({ usage: "u", criticality: "1 - Critical", legacyStatus: "Actif", decision: "Keep", ...o });
}

function model(overrides: Partial<ParsedModel>): ParsedModel {
  return {
    actors: [actor({ name: "A" }), actor({ name: "B" })],
    groups: [{ name: "G", perimeter: "Platform", sheet: "Groups", row: 0 }],
    groupsSheetMissing: false,
    actorTypes: [{ type: "Application", icon: "app-window", nature: "", sheet: "ActorTypes", row: 0 }],
    milestones: [],
  flowTypes: [base.flowType({ type: "HTTP" })],
    interfaces: [iface({})],
    consumptions: [consumption({})],
    fxSheetNames: ["FX_A_HTTP"],
    missingOptionalColumns: [],
    schemaVersion: SCHEMA_VERSION,
    savedAt: null,
    referentialActors: [],
    referentialTechnologies: [],
    ...overrides,
  };
}

describe("7.1 structure", () => {
  it("reports nothing on a clean model", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.families.find((f) => f.id === "structure")!.anomalies).toHaveLength(0);
  });

  it("flags a missing optional column", () => {
    const report = runIntegrityChecks(model({ missingOptionalColumns: [{ sheet: "Actors", column: "Group" }] }));
    expect(report.families.find((f) => f.id === "structure")!.anomalies).toHaveLength(1);
  });

  it("flags a duplicate actor name", () => {
    const report = runIntegrityChecks(model({ actors: [actor({ name: "A" }), actor({ name: "A" })] }));
    expect(report.families.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes('"A"'))).toBe(true);
  });

  it("flags a duplicate interface name", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ flowName: "F" }), iface({ flowName: "F" })] }));
    expect(report.families.find((f) => f.id === "structure")!.anomalies.length).toBeGreaterThan(0);
  });

  it("flags a missing FX_ tab expected by an interface", () => {
    const report = runIntegrityChecks(model({ fxSheetNames: [] }));
    expect(report.families.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes("missing from the workbook"))).toBe(true);
  });

  it("flags an FX_ tab with no matching interface", () => {
    const report = runIntegrityChecks(model({ fxSheetNames: ["FX_A_HTTP", "FX_Orphelin_HTTP"] }));
    expect(report.families.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes("FX_Orphelin_HTTP"))).toBe(true);
  });

  // Colour matching was made case-insensitive: "HTTP" and "http" now get the
  // same colour, and the "two technologies share a colour" check compares the
  // raw declared colours, so it stays silent here. This duplicate check is
  // what catches it.
  it("flags flow types that collide only by case", () => {
    const report = runIntegrityChecks(
      model({ flowTypes: [base.flowType({ type: "HTTP" }), base.flowType({ type: "http" })] })
    );
    expect(
      report.families.find((f) => f.id === "structure")!.anomalies.some((a) => a.message.includes('"http"'))
    ).toBe(true);
  });
});

describe("7.2 references", () => {
  it("reports nothing when all references resolve", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.families.find((f) => f.id === "references")!.anomalies).toHaveLength(0);
  });

  it("flags an unknown exposant", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ providerName: "Inconnu" })] }));
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Inconnu"))).toBe(true);
  });

  it("flags an unknown flow type", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ flowType: "SFTP" })] }));
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("SFTP"))).toBe(true);
  });

  it("flags an unknown acteur consommateur", () => {
    const report = runIntegrityChecks(model({ consumptions: [consumption({ consumerName: "Inconnu" })] }));
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Inconnu"))).toBe(true);
  });

  it("flags a consumption whose flow name is not in the catalog", () => {
    const report = runIntegrityChecks(model({ consumptions: [consumption({ flowName: "Fantome" })] }));
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("Fantome"))).toBe(true);
  });

  it("flags a consumption filed under the wrong tab", () => {
    const report = runIntegrityChecks(model({ consumptions: [consumption({ sheet: "FX_Mauvais_Onglet" })] }));
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("FX_A_HTTP"))).toBe(true);
  });

  it("does not flag a consumption as misfiled when a same-named interface exists on another tab (§3.3 rattachement)", () => {
    // Two catalog interfaces share the name "F" on different tabs (already
    // flagged elsewhere as a 7.1 duplicate). The consumption is filed under
    // the FIRST interface's tab (FX_A_HTTP) — a name-only lookup (the pre-fix
    // behaviour) always keeps the LAST-inserted entry (FX_C_HTTP) and would
    // wrongly flag this correctly-filed row as "filed in the wrong sheet";
    // only a (sheet, flow name) lookup (§3.3) gets this right.
    const report = runIntegrityChecks(
      model({
        interfaces: [iface({ expectedSheet: "FX_A_HTTP" }), iface({ providerName: "C", expectedSheet: "FX_C_HTTP" })],
        actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C" })],
        consumptions: [consumption({ sheet: "FX_A_HTTP" })],
      })
    );
    expect(report.families.find((f) => f.id === "references")!.anomalies.some((a) => a.message.includes("rangée"))).toBe(false);
  });
});

describe("7.3 consistency", () => {
  it("reports nothing on a clean model", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.families.find((f) => f.id === "coherence")!.anomalies).toHaveLength(0);
  });

  it("flags a consumer identical to the exposant", () => {
    const report = runIntegrityChecks(model({ consumptions: [consumption({ consumerName: "A" })] }));
    expect(report.families.find((f) => f.id === "coherence")!.anomalies.length).toBeGreaterThan(0);
  });

  it("flags an interface with no consumption", () => {
    const report = runIntegrityChecks(model({ consumptions: [] }));
    expect(report.families.find((f) => f.id === "coherence")!.anomalies.some((a) => a.message.includes("no declared consumption"))).toBe(true);
  });

  // A component with no flow invalidates nothing: it simply appears nowhere. It
  // is a warning, not an error.
  it("warns about an actor with no flow at all", () => {
    const report = runIntegrityChecks(model({ actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "Isole" })] }));
    expect(report.families.find((f) => f.id === "coherence")!.anomalies.some((a) => a.message.includes("Isole"))).toBe(false);
    const block = report.infoBlocks.find((b) => b.id === "actors-with-no-flow")!;
    expect(block.level).toBe("warning");
    expect(block.items).toEqual(["Isole (Actors, row 0)"]);
  });
});

describe("7.4 completeness", () => {
  it("reports nothing on a clean model", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.families.find((f) => f.id === "completeness")!.anomalies).toHaveLength(0);
  });

  it("flags an empty interface description", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ description: "" })] }));
    expect(report.families.find((f) => f.id === "completeness")!.anomalies.some((a) => a.message.includes("description"))).toBe(true);
  });

  it("flags an interface with no contract at all", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ contractLink: "", contractReference: "" })] }));
    expect(report.families.find((f) => f.id === "completeness")!.anomalies.some((a) => a.message.includes("no contract"))).toBe(true);
  });

  it("flags a consumption with an empty usage or decision", () => {
    const report = runIntegrityChecks(model({ consumptions: [consumption({ usage: "", decision: "" })] }));
    expect(report.families.find((f) => f.id === "completeness")!.anomalies.length).toBe(2);
  });

  // A declared retirement already says what is done with that consumption: it
  // leaves, at that milestone. Asking for a judgement decision on top would ask
  // for the same thing twice.
  it("does not ask for a decision on a consumption that has a retirement milestone", () => {
    const report = runIntegrityChecks(
      model({ milestones: [], consumptions: [consumption({ decision: "", retiredAt: "v2" })] })
    );
    const messages = report.families.find((f) => f.id === "completeness")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes("decision empty"))).toBe(false);
  });

  it("flags an actor with an empty groupe", () => {
    const report = runIntegrityChecks(model({ actors: [actor({ name: "A", group: "" }), actor({ name: "B" })] }));
    expect(report.families.find((f) => f.id === "completeness")!.anomalies.length).toBe(1);
  });

  // The perimeter is now entered on the group, no longer on the actor.
  it("flags a group with an empty perimeter", () => {
    const report = runIntegrityChecks(model({ groups: [{ name: "G", perimeter: "", sheet: "Groups", row: 0 }] }));
    const messages = report.families.find((f) => f.id === "completeness")!.anomalies.map((a) => a.message);
    expect(messages).toContain('Group "G" (Groups, row 0): perimeter not filled in.');
  });
});

describe("7.6 onglet Groupes", () => {
  it("flags a missing Groupes sheet", () => {
    const report = runIntegrityChecks(model({ groups: [], groupsSheetMissing: true }));
    const messages = report.families.find((f) => f.id === "structure")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes('Sheet "Groups" missing'))).toBe(true);
  });

  it("flags an actor whose groupe is not declared", () => {
    const report = runIntegrityChecks(model({ groups: [{ name: "Autre", perimeter: "External", sheet: "Groups", row: 0 }] }));
    const messages = report.families.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes('group "G" missing from the "Groups" sheet'))).toBe(true);
  });

  it("flags a declared groupe nobody belongs to", () => {
    const report = runIntegrityChecks(model({ groups: [{ name: "G", perimeter: "External", sheet: "Groups", row: 0 }, { name: "Orphelin", perimeter: "External", sheet: "Groups", row: 0 }] }));
    const messages = report.families.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages).toContain('Group "Orphelin" (Groups, row 0) is declared but no actor belongs to it.');
  });
});

describe("7.5 candidates for decommissioning", () => {
  it("is empty when nothing qualifies", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.infoBlocks.find((b) => b.id === "decommissioning")!.items).toHaveLength(0);
  });

  it("lists an interface whose only consumption is on its way out", () => {
    const report = runIntegrityChecks(model({ consumptions: [consumption({ retiredAt: "v2" })] }));
    expect(report.infoBlocks.find((b) => b.id === "decommissioning")!.items).toEqual(["F (Interfaces, row 0)"]);
  });



  // A component's status no longer exists: it can no longer decide on its own
  // that an interface is a candidate for decommissioning.
  it("does not list an interface whose consumptions are all active", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.infoBlocks.find((b) => b.id === "decommissioning")!.items).toEqual([]);
  });
});

describe("7.6 interfaces to confirm", () => {
  it("lists interfaces flagged Oui", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ flowName: "F", toConfirm: true })] }));
    expect(report.infoBlocks.find((b) => b.id === "to-confirm")!.items).toEqual(["F (Interfaces, row 0)"]);
  });
});

describe("7.7 near-duplicate groups", () => {
  it("leaves out the block entirely when every group is clearly distinct", () => {
    const report = runIntegrityChecks(
      model({
        actors: [
          actor({ name: "A", group: "Core" }),
          actor({ name: "B", group: "Sales network" }),
          actor({ name: "C", group: "Finance" }),
        ],
      })
    );
    expect(report.infoBlocks.find((b) => b.id === "groups")).toBeUndefined();
  });

  it("pairs a case variant", () => {
    const report = runIntegrityChecks(
      model({
        actors: [
          ...Array.from({ length: 8 }, (_, i) => actor({ name: `A${i}`, group: "Core" })),
          actor({ name: "B", group: "core" }),
        ],
      })
    );
    expect(report.infoBlocks.find((b) => b.id === "groups")!.items).toEqual([
      "Core (8) and core (1) — same name but for case",
    ]);
  });

  it("pairs a punctuation variant", () => {
    const report = runIntegrityChecks(
      model({
        actors: [actor({ name: "A", group: "Sales-network" }), actor({ name: "B", group: "Sales network" })],
      })
    );
    expect(report.infoBlocks.find((b) => b.id === "groups")!.items).toEqual([
      "Sales network (1) and Sales-network (1) — same name once punctuation is ignored",
    ]);
  });

  it("pairs a one-letter typo", () => {
    const report = runIntegrityChecks(
      model({
        actors: [actor({ name: "A", group: "Support" }), actor({ name: "B", group: "Suport" })],
      })
    );
    expect(report.infoBlocks.find((b) => b.id === "groups")!.items).toEqual([
      "Suport (1) and Support (1) — 1 letter apart",
    ]);
  });

  it("does not pair short names one edit apart", () => {
    const report = runIntegrityChecks(
      model({
        actors: [actor({ name: "A", group: "Core" }), actor({ name: "B", group: "Care" })],
      })
    );
    expect(report.infoBlocks.find((b) => b.id === "groups")).toBeUndefined();
  });

  it("does not pair short names further apart", () => {
    const report = runIntegrityChecks(
      model({
        actors: [actor({ name: "A", group: "Core" }), actor({ name: "B", group: "Crait" })],
      })
    );
    expect(report.infoBlocks.find((b) => b.id === "groups")).toBeUndefined();
  });

  it("drops a match equally close to two different others", () => {
    const report = runIntegrityChecks(
      model({
        actors: [
          actor({ name: "A", group: "Redis" }),
          actor({ name: "B", group: "Redit" }),
          actor({ name: "C", group: "Redia" }),
        ],
      })
    );
    expect(report.infoBlocks.find((b) => b.id === "groups")).toBeUndefined();
  });

  // The acronym guard added for the referential-suggestion use must not
  // reach this caller: group names here are human labels, never acronyms,
  // so a short all-caps group pair still pairs on edit distance.
  it("still pairs a short all-caps group one edit apart", () => {
    const report = runIntegrityChecks(
      model({
        actors: [actor({ name: "A", group: "HTTP" }), actor({ name: "B", group: "HTTPS" })],
      })
    );
    expect(report.infoBlocks.find((b) => b.id === "groups")!.items).toEqual([
      "HTTP (1) and HTTPS (1) — 1 letter apart",
    ]);
  });
});

describe("totalAnomalies", () => {
  it("counts only the anomaly families, not the informational blocks", () => {
    const report = runIntegrityChecks(model({ interfaces: [iface({ description: "" })] }));
    expect(report.totalAnomalies).toBeGreaterThan(0);
    expect(report.totalAnomalies).toBe(
      report.families.reduce((sum, f) => sum + f.anomalies.length, 0)
    );
  });
});

// This is the only check where a typo produces a WRONG diagram in silence: an
// unrecognised value stops dimming the flow, or reverses the arrow for a
// representation direction.
describe("7.6 vocabulaires", () => {
  it("reports nothing when every value is in its list", () => {
    const report = runIntegrityChecks(model({}));
    expect(report.families.find((f) => f.id === "vocabularies")!.anomalies).toHaveLength(0);
  });

  it("flags a mistyped decision or criticality", () => {
    const report = runIntegrityChecks(
      model({ consumptions: [consumption({ decision: "A garder", criticality: "Haute" })] })
    );
    const messages = report.families.find((f) => f.id === "vocabularies")!.anomalies.map((a) => a.message);
    expect(messages.some((m) => m.includes("Haute"))).toBe(true);
    expect(messages.some((m) => m.includes("A garder"))).toBe(true);
    expect(messages.some((m) => m.includes("Haute"))).toBe(true);
  });

  // build-model falls back silently to "consumer → publisher" for any value it
  // does not recognise: the arrow would reverse without a word.
  it("flags an unknown representation direction, which would silently flip the arrow", () => {
    const report = runIntegrityChecks(
      model({
        flowTypes: [
          base.flowType({ type: "HTTP", rawDirection: "du client au serveur" }),
        ],
      })
    );
    expect(
      report.families.find((f) => f.id === "vocabularies")!.anomalies.some((a) => a.message.includes("du client au serveur"))
    ).toBe(true);
  });

  it("flags an unknown nature", () => {
    const report = runIntegrityChecks(
      model({ actorTypes: [{ type: "Application", icon: "app-window", nature: "Fonctionnelle", sheet: "ActorTypes", row: 0 }] })
    );
    expect(
      report.families.find((f) => f.id === "vocabularies")!.anomalies.some((a) => a.message.includes("Fonctionnelle"))
    ).toBe(true);
  });

  it("stays silent on an empty value, which the completeness family already covers", () => {
    const report = runIntegrityChecks(model({ consumptions: [consumption({ legacyStatus: "", decision: "", criticality: "" })] }));
    expect(report.families.find((f) => f.id === "vocabularies")!.anomalies).toHaveLength(0);
  });
});

describe("7.7 signaux non bloquants", () => {
  it("warns about a missing criticality rather than failing the file", () => {
    const report = runIntegrityChecks(model({ consumptions: [consumption({ criticality: "" })] }));
    const block = report.infoBlocks.find((b) => b.id === "missing-criticality")!;
    expect(block.level).toBe("warning");
    expect(block.items).toHaveLength(1);
  });

  // Two components may exchange several times over the same technology: that is
  // legitimate, it is shown without being held against them.
  it("reports a repeated exchange between the same pair as information", () => {
    const report = runIntegrityChecks(
      model({ consumptions: [consumption({}), consumption({ flowName: "F", consumerName: "B" })] })
    );
    const block = report.infoBlocks.find((b) => b.id === "repeated-exchanges")!;
    expect(block.level).toBe("info");
    expect(block.items.some((i) => i.includes("A → B over HTTP"))).toBe(true);
  });

  it("reports an unused flow type as information", () => {
    const report = runIntegrityChecks(
      model({
        flowTypes: [
          base.flowType({ type: "HTTP" }),
          base.flowType({ type: "Kafka", direction: "provider-to-consumer", rawDirection: "provider → consumer" }),
        ],
      })
    );
    const block = report.infoBlocks.find((b) => b.id === "unused-flow-types")!;
    expect(block.level).toBe("info");
    expect(block.items).toEqual(["Kafka (FlowTypes, row 0)"]);
  });
});

// A shortcut for the models with two versions of one contract: that is the
// situation this whole family of checks describes.
function modelTwoVersions(overrides: Partial<ParsedModel> = {}): ParsedModel {
  return model({
    milestones,
    interfaces: [
      iface({ version: "1.0", introducedAt: "v1", retiredAt: "v3" }),
      iface({ version: "2.0", introducedAt: "v1" }),
    ],
    consumptions: [consumption({ version: "1.0", introducedAt: "v1" })],
    ...overrides,
  });
}

describe("interface versions — references", () => {
  it("reports a consumption whose version is absent from the catalogue", () => {
    const report = runIntegrityChecks(modelTwoVersions({ consumptions: [consumption({ version: "9.9" })] }));
    const messages = report.families.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages.join(" ")).toContain('version "9.9"');
  });

  it("does not confuse two versions of the same flux", () => {
    const report = runIntegrityChecks(modelTwoVersions());
    const messages = report.families.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(messages).toEqual([]);
  });
});


describe("interface versions — consistency", () => {
  it("reports a consumer sitting on two versions of the same contract", () => {
    const report = runIntegrityChecks(
      modelTwoVersions({ consumptions: [consumption({ version: "1.0" }), consumption({ version: "2.0" })] })
    );
    const messages = report.families.find((f) => f.id === "coherence")!.anomalies.map((a) => a.message);
    expect(messages.join(" ")).toContain("B");
    expect(messages.join(" ")).toContain("two versions");
  });

  it("says nothing when two different consumers each sit on one version", () => {
    const report = runIntegrityChecks(
      modelTwoVersions({
        actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C" })],
        consumptions: [consumption({ version: "1.0" }), consumption({ version: "2.0", consumerName: "C" })],
      })
    );
    const messages = report.families.find((f) => f.id === "coherence")!.anomalies.map((a) => a.message);
    expect(messages.join(" ")).not.toContain("two versions");
  });


});

describe("interface versions — the migrations' action block", () => {
  it("names the interface, both versions and the consumers left behind", () => {
    const report = runIntegrityChecks(modelTwoVersions());
    const block = report.infoBlocks.find((b) => b.id === "migrations")!;
    expect(block.level).toBe("action");
    expect(block.items).toEqual(["F 1.0 (Interfaces, row 0) → 2.0: B"]);
  });

  it("counts towards the action total, not the anomaly one", () => {
    const report = runIntegrityChecks(modelTwoVersions());
    expect(report.totalActions).toBeGreaterThan(0);
  });

  // Without this wording, the report would suggest that moving a cell is enough,
  // whereas the arrival version is still to be created.
  it("says so when no active version exists to migrate towards", () => {
    const report = runIntegrityChecks(
      model({ milestones, interfaces: [iface({ version: "1.0", retiredAt: "v3", introducedAt: "v1" })], consumptions: [consumption({ version: "1.0", introducedAt: "v1" })] })
    );
    const block = report.infoBlocks.find((b) => b.id === "migrations")!;
    expect(block.items).toEqual(["F 1.0 (Interfaces, row 0) → no active version: B"]);
  });

  it("names every active version rather than choosing one", () => {
    const report = runIntegrityChecks(
      model({
        milestones,
        interfaces: [
          iface({ version: "1.0", introducedAt: "v1", retiredAt: "v3" }),
          iface({ version: "2.0", introducedAt: "v1" }),
          iface({ version: "3.0", introducedAt: "v1" }),
        ],
        consumptions: [consumption({ version: "1.0", introducedAt: "v1" })],
      })
    );
    const block = report.infoBlocks.find((b) => b.id === "migrations")!;
    expect(block.items).toEqual(["F 1.0 (Interfaces, row 0) → 2.0, 3.0: B"]);
  });

  it("drops an interface nobody consumes any more from the block", () => {
    const report = runIntegrityChecks(modelTwoVersions({ consumptions: [consumption({ version: "2.0" })] }));
    expect(report.infoBlocks.find((b) => b.id === "migrations")!.items).toEqual([]);
  });
});

const milestones = [
  { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
  { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
  { name: "v3", rank: 3, label: "", status: "Planned", date: "", description: "", sheet: "Milestones", row: 0 },
];

function messagesCoherence(m: ParsedModel): string {
  return runIntegrityChecks(m).families.find((f) => f.id === "coherence")!.anomalies.map((a) => a.message).join(" | ");
}

describe("milestones — temporal checks", () => {
  it("says nothing on a workbook whose intervals nest properly", () => {
    const m = model({
      milestones,
      actors: [actor({ name: "A", introducedAt: "v1" }), actor({ name: "B", introducedAt: "v1" })],
      interfaces: [iface({ introducedAt: "v2" })],
      consumptions: [consumption({ introducedAt: "v2" })],
    });
    expect(messagesCoherence(m)).not.toContain("milestone");
  });

  // The same check seen from both ends: an interface spilling out of its
  // publisher's life is also a retired actor still carrying flows.
  it("reports an interface living outside its exposant's own interval", () => {
    const m = model({
      milestones,
      actors: [actor({ name: "A", retiredAt: "v2" }), actor({ name: "B" })],
      interfaces: [iface({ retiredAt: "v3" })],
    });
    expect(messagesCoherence(m)).toContain("A");
  });

  it("reports a consumption living outside its interface's interval", () => {
    const m = model({
      milestones,
      interfaces: [iface({ retiredAt: "v2" })],
      consumptions: [consumption({ retiredAt: "v3" })],
    });
    expect(messagesCoherence(m)).toContain("F");
  });

  it("reports a consumption living outside its consumer's interval", () => {
    const m = model({
      milestones,
      actors: [actor({ name: "A" }), actor({ name: "B", introducedAt: "v3" })],
      consumptions: [consumption({ introducedAt: "v1" })],
    });
    expect(messagesCoherence(m)).toContain("B");
  });

  it("reports a retirement that precedes the introduction", () => {
    const m = model({ milestones, interfaces: [iface({ introducedAt: "v3", retiredAt: "v1" })] });
    expect(messagesCoherence(m)).toContain("at or before");
  });

  it("reports a palier cited by a row but absent from the Paliers sheet", () => {
    const m = model({ milestones, interfaces: [iface({ introducedAt: "v9" })] });
    const refs = runIntegrityChecks(m).families.find((f) => f.id === "references")!.anomalies.map((a) => a.message);
    expect(refs.join(" ")).toContain("v9");
  });

  it("reports duplicate ranks in the Paliers sheet", () => {
    const m = model({ milestones: [...milestones, { name: "v4", rank: 2, label: "", status: "Planned", date: "", description: "", sheet: "Milestones", row: 0 }] });
    const struct = runIntegrityChecks(m).families.find((f) => f.id === "structure")!.anomalies.map((a) => a.message);
    expect(struct.join(" ")).toContain("rank");
  });

  // With no milestone delivered, the current milestone is undetermined: the views
  // fall back on the first declared, so it may as well be said.
  it("reports a Paliers sheet without a single delivered palier", () => {
    const m = model({ milestones: milestones.map((p) => ({ ...p, status: "Planned" })) });
    const struct = runIntegrityChecks(m).families.find((f) => f.id === "structure")!.anomalies.map((a) => a.message);
    expect(struct.join(" ")).toContain("Delivered");
  });

  // A workbook with no milestone declared must not start talking about them.
  it("stays silent on a workbook that declares no palier at all", () => {
    const report = runIntegrityChecks(model({}));
    const tout = report.families.flatMap((f) => f.anomalies.map((a) => a.message)).join(" ");
    expect(tout).not.toContain("milestone");
    expect(tout).not.toContain("Milestone");
  });
});

describe("milestones — completeness", () => {
  function messagesCompleteness(m: ParsedModel): string {
    return runIntegrityChecks(m).families.find((f) => f.id === "completeness")!.anomalies.map((a) => a.message).join(" | ");
  }

  // Nothing is guessed on behalf of whoever keeps the file: at worst they will
  // put an arbitrary milestone, but the choice is theirs.
  it("reports an interface with no arrival palier", () => {
    const m = model({ milestones, interfaces: [iface({})], consumptions: [] });
    expect(messagesCompleteness(m)).toContain("introduction milestone");
  });

  it("reports a consumption with no arrival palier — that is when its consumer arrived", () => {
    const m = model({
      milestones,
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [consumption({})],
    });
    expect(messagesCompleteness(m)).toContain("Consumption");
  });

  it("reports an acteur with no arrival palier", () => {
    const m = model({ milestones, actors: [actor({ name: "A" }), actor({ name: "B", introducedAt: "v1" })] });
    expect(messagesCompleteness(m)).toContain("Actor");
  });

  // An empty retirement is not a gap: it is a fact, the row is still there.
  it("says nothing about an empty retirement palier", () => {
    const m = model({
      milestones,
      actors: [actor({ name: "A", introducedAt: "v1" }), actor({ name: "B", introducedAt: "v1" })],
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [consumption({ introducedAt: "v1" })],
    });
    expect(messagesCompleteness(m)).not.toContain("milestone");
  });

  // Until the team has adopted the axis, the tool says nothing of it.
  it("stays silent when no palier is declared at all", () => {
    const m = model({ interfaces: [iface({})], consumptions: [consumption({})] });
    expect(messagesCompleteness(m)).not.toContain("milestone");
  });
});

describe("milestones — the report follows the displayed milestone", () => {
  const threeMilestones = [
    { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
    { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
  ];

  // An actor retired at v2 obviously has no flow left at v2: reporting it would
  // fill the report with false anomalies from the first retired row onwards.
  it("does not blame a retired acteur for having no flow any more", () => {
    const m = model({
      milestones: threeMilestones,
      actors: [
        actor({ name: "A", introducedAt: "v1" }),
        actor({ name: "B", introducedAt: "v1" }),
        actor({ name: "C", introducedAt: "v1", retiredAt: "v2" }),
      ],
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [consumption({ introducedAt: "v1" })],
    });
    const block = (rank: number) =>
      runIntegrityChecks(m, rank).infoBlocks.find((b) => b.id === "actors-with-no-flow")!.items;
    expect(block(1)).toContain("C (Actors, row 0)");
    expect(block(2)).not.toContain("C (Actors, row 0)");
  });

  // The structure, for its part, judges the workbook and not a moment of its history.
  it("keeps structural checks independent of the displayed palier", () => {
    const m = model({
      milestones: threeMilestones,
      missingOptionalColumns: [{ sheet: "Actors", column: "Group" }],
      actors: [actor({ name: "A", introducedAt: "v1" }), actor({ name: "B", introducedAt: "v1" })],
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [consumption({ introducedAt: "v1" })],
    });
    const structure = (rank: number) =>
      runIntegrityChecks(m, rank).families.find((f) => f.id === "structure")!.anomalies.length;
    expect(structure(1)).toBe(structure(2));
    expect(structure(1)).toBeGreaterThan(0);
  });
});

// A report exists to be acted on. Without the address, every line forces one
// to find the cell oneself, and the reading order follows nothing.
describe("the anomalies' location", () => {
  const messages = (m: ParsedModel, id: string) =>
    runIntegrityChecks(m).families.find((f) => f.id === id)!.anomalies.map((a) => a.message);

  it("cites the sheet and the row of the line at fault", () => {
    const m = model({
      interfaces: [iface({ description: "", row: 42 })],
      consumptions: [consumption({ usage: "", sheet: "FX_A_HTTP", row: 7 })],
    });
    const completeness = messages(m, "completeness");

    expect(completeness).toContain('Interface "F" (Interfaces, row 42): description empty.');
    expect(completeness).toContain('Consumption "F" (FX_A_HTTP, row 7): usage not described.');
  });

  it("carries the address as data too, so the report can order and link on it", () => {
    const m = model({ interfaces: [iface({ description: "", row: 42 })] });
    const anomaly = runIntegrityChecks(m)
      .families.find((f) => f.id === "completeness")!
      .anomalies.find((a) => a.message.includes("description empty"))!;

    expect(anomaly.location).toEqual({ sheet: "Interfaces", row: 42 });
  });

  it("orders a family by sheet then by ascending row", () => {
    const m = model({
      actors: [actor({ name: "A", group: "" , row: 9 }), actor({ name: "B", group: "", row: 3 })],
      interfaces: [iface({ description: "", contractLink: "l", row: 5 })],
      consumptions: [],
    });
    const addresses = runIntegrityChecks(m)
      .families.find((f) => f.id === "completeness")!
      .anomalies.map((a) => `${a.location!.sheet}:${a.location!.row}`);

    expect(addresses).toEqual(["Actors:3", "Actors:9", "Interfaces:5"]);
  });

  it("puts what has no address first, since it points at the file rather than a line", () => {
    const m = model({
      groupsSheetMissing: true,
      groups: [],
      interfaces: [iface({ expectedSheet: "FX_A_MQTT", row: 4 })],
      consumptions: [],
      fxSheetNames: [],
    });
    const structure = runIntegrityChecks(m).families.find((f) => f.id === "structure")!.anomalies;

    expect(structure[0].location).toBeUndefined();
    expect(structure.some((a) => a.location)).toBe(true);
  });
});

describe("the informational blocks' location", () => {
  const block = (m: ParsedModel, id: string) =>
    runIntegrityChecks(m).infoBlocks.find((b) => b.id === id)!.items;

  it("cites the address on every item that designates a line", () => {
    const m = model({
      actors: [actor({ name: "A", row: 2 }), actor({ name: "B", row: 3 }), actor({ name: "Seul", row: 8 })],
      interfaces: [iface({ toConfirm: true, row: 5 })],
      consumptions: [consumption({ criticality: "", row: 6 })],
      flowTypes: [
        base.flowType({ type: "HTTP", row: 2 }),
        base.flowType({ type: "SFTP", row: 3 }),
      ],
    });

    expect(block(m, "actors-with-no-flow")).toEqual(["Seul (Actors, row 8)"]);
    expect(block(m, "to-confirm")).toEqual(["F (Interfaces, row 5)"]);
    expect(block(m, "missing-criticality")).toEqual(["F (FX_A_HTTP, row 6) — B"]);
    expect(block(m, "unused-flow-types")).toEqual(["SFTP (FlowTypes, row 3)"]);
  });

  it("orders a block by ascending row, like the rest of the report", () => {
    const m = model({
      actors: [actor({ name: "A", row: 2 }), actor({ name: "Z", row: 4 }), actor({ name: "M", row: 9 })],
      interfaces: [],
      consumptions: [],
    });

    expect(block(m, "actors-with-no-flow")).toEqual(["A (Actors, row 2)", "Z (Actors, row 4)", "M (Actors, row 9)"]);
  });
});

describe("dependency cycles", () => {
  const cycles = (m: ParsedModel, rank: number | null = null) =>
    runIntegrityChecks(m, rank).infoBlocks.find((b) => b.id === "cycles")!.items;

  // A consumer depends on the publisher of the interface it consumes.
  // A publishes F1 which B consumes; B publishes F2 which A consumes: each needs
  // the other to work.
  function loop(names: string[]) {
    const interfaces = names.map((name, i) =>
      iface({ flowName: `F${i}`, providerName: name, expectedSheet: `FX_${name}_HTTP` })
    );
    const consumptions = names.map((name, i) =>
      consumption({
        flowName: `F${i}`,
        // Each is consumed by the next, the last by the first.
        consumerName: names[(i + 1) % names.length],
        sheet: `FX_${name}_HTTP`,
      })
    );
    return {
      actors: names.map((name) => actor({ name })),
      interfaces,
      consumptions,
      fxSheetNames: names.map((name) => `FX_${name}_HTTP`),
    };
  }

  it("stays silent on a workbook where nothing loops", () => {
    expect(cycles(model({}))).toEqual([]);
  });

  it("names the two components that need each other", () => {
    expect(cycles(model(loop(["A", "B"])))).toEqual(["A, B (2 components)"]);
  });

  // The dependency propagates: A needs C without ever naming it.
  it("finds a loop that closes through a third component", () => {
    expect(cycles(model(loop(["A", "B", "C"])))).toEqual(["A, B, C (3 components)"]);
  });

  // An actor consuming its own interface is not a cycle between components: it
  // is an internal loop, which the aggregated views already hide.
  it("ignores a component that consumes its own interface", () => {
    const m = model({
      actors: [actor({ name: "A" })],
      interfaces: [iface({ providerName: "A" })],
      consumptions: [consumption({ consumerName: "A" })],
    });
    expect(cycles(m)).toEqual([]);
  });

  it("reports two independent loops separately", () => {
    const un = loop(["A", "B"]);
    const two = loop(["Y", "Z"]);
    const m = model({
      actors: [...un.actors, ...two.actors],
      interfaces: [...un.interfaces, ...two.interfaces],
      consumptions: [...un.consumptions, ...two.consumptions],
      fxSheetNames: [...un.fxSheetNames, ...two.fxSheetNames],
    });
    expect(cycles(m)).toEqual(["A, B (2 components)", "Y, Z (2 components)"]);
  });

  // The cycle is a state of the platform, not a defect in the file: what is
  // retired at the displayed milestone no longer closes it.
  it("reads the loop at the milestone on show", () => {
    const loopV1 = loop(["A", "B"]);
    const m = model({
      ...loopV1,
      milestones,
      actors: loopV1.actors.map((a) => ({ ...a, introducedAt: "v1" })),
      interfaces: loopV1.interfaces.map((i) => ({ ...i, introducedAt: "v1" })),
      consumptions: loopV1.consumptions.map((c, i) => ({
        ...c,
        introducedAt: "v1",
        // Only one of the two links leaves at milestone 2: the loop opens.
        retiredAt: i === 0 ? "v2" : "",
      })),
    });
    expect(cycles(m, 1)).toEqual(["A, B (2 components)"]);
    expect(cycles(m, 2)).toEqual([]);
  });
});

describe("nature and relays", () => {
  const TYPES = [
    { type: "Application", icon: "app-window", nature: "Business", sheet: "ActorTypes", row: 2 },
    { type: "Middleware", icon: "server", nature: "Technical", sheet: "ActorTypes", row: 3 },
  ];
  const messages = (m: ParsedModel, family: string) =>
    runIntegrityChecks(m).families.find((f) => f.id === family)!.anomalies.map((a) => a.message).join(" | ");

  // The republication is carried by the bus's consumption row: it is that row
  // that says under which of ITS interfaces the input comes back out.
  function relayEstate(republishedAs = "trx.norm"): ParsedModel {
    return model({
      actorTypes: TYPES,
      actors: [actor({ name: "Tatooine" }), actor({ name: "Bus", actorType: "Middleware" }), actor({ name: "B" })],
      interfaces: [
        iface({ flowName: "Transactions", providerName: "Tatooine" }),
        iface({ flowName: "trx.norm", providerName: "Bus", expectedSheet: "FX_Bus_HTTP" }),
      ],
      consumptions: [
        consumption({ flowName: "Transactions", consumerName: "Bus", republishedAs }),
        consumption({ flowName: "trx.norm", consumerName: "B", sheet: "FX_Bus_HTTP" }),
      ],
      fxSheetNames: ["FX_A_HTTP", "FX_Bus_HTTP"],
    });
  }

  it("reports nothing on a whole chain", () => {
    expect(messages(relayEstate(), "references")).not.toContain("republished");
    expect(messages(relayEstate(), "coherence")).not.toContain("republish");
  });

  it("reports a republication towards an interface the actor does not publish", () => {
    expect(messages(relayEstate("Fantôme"), "references")).toContain("Fantôme");
  });

  it("reports a republication declared by a business actor", () => {
    const m = relayEstate();
    m.consumptions[1].republishedAs = "Autre chose";
    expect(messages(m, "coherence")).toContain("only plumbing relays");
  });

  it("reports a republished interface that nothing feeds", () => {
    expect(messages(relayEstate(""), "coherence")).toContain("nothing feeds it");
  });

  // The catch-all bus: the flow goes into the plumbing and comes out for nobody,
  // failing which the functional link would be missing in silence.
  it("reports a flow that enters a technical actor and comes out for nobody", () => {
    const m = relayEstate();
    m.interfaces.push(iface({ flowName: "Référentiel", providerName: "Tatooine", expectedSheet: "FX_Tatooine_REF" }));
    m.consumptions.push(consumption({ flowName: "Référentiel", consumerName: "Bus", sheet: "FX_Tatooine_REF" }));
    m.fxSheetNames.push("FX_Tatooine_REF");
    expect(messages(m, "coherence")).toContain("Référentiel");
  });

  it("reports a nature outside the vocabulary", () => {
    const m = relayEstate();
    m.actorTypes = [{ ...TYPES[0], nature: "Métier" }, TYPES[1]];
    expect(messages(m, "vocabularies")).toContain("Métier");
  });

  it("asks for the missing nature as soon as one type declares one", () => {
    const m = relayEstate();
    m.actorTypes = [{ ...TYPES[0], nature: "" }, TYPES[1]];
    expect(messages(m, "completeness")).toContain("nature");
  });

  // Until the team has adopted the distinction, the tool says nothing of it.
  it("stays silent on a workbook where no type declares a nature", () => {
    const m = relayEstate();
    m.actorTypes = TYPES.map((t) => ({ ...t, nature: "" }));
    expect(messages(m, "completeness")).not.toContain("nature");
  });
});

// --- QA: the report and the diagrams describe the SAME milestone and must
// therefore keep the same flows. The diagrams (aggregation/core.ts) require the
// whole chain alive -- publisher, interface, consumption, consumer; the report
// filtered the three tables each on its own side, and so kept a consumption
// whose actor had disappeared. The report contradicted the diagram displayed
// beside it.
describe("the report at the milestone — the whole chain, like the diagrams", () => {
  const atMilestone = (rank: number) =>
    runIntegrityChecks(
      model({
        milestones: [
          { name: "v1", rank: 1, label: "", status: "", date: "", description: "", sheet: "Milestones", row: 0 },
          { name: "v2", rank: 2, label: "", status: "", date: "", description: "", sheet: "Milestones", row: 0 },
        ],
        actors: [actor({ name: "A", retiredAt: "v1" }), actor({ name: "B" })],
        interfaces: [iface({ providerName: "A" })],
        consumptions: [consumption({ consumerName: "B" })],
      }),
      rank
    );

  it("no longer quotes a retired actor in the informational blocks", () => {
    expect(JSON.stringify(atMilestone(1).infoBlocks)).not.toContain('"A"');
  });

  it("drops the consumption whose publisher has disappeared", () => {
    const withoutFlows = atMilestone(1).infoBlocks.find((b) => b.title.includes("no flow"));
    expect(withoutFlows?.items.join(" ")).toContain("B");
  });

  it("keeps everything as long as the actor is alive", () => {
    const withoutFlows = atMilestone(0).infoBlocks.find((b) => b.title.includes("no flow"));
    expect(withoutFlows?.items.join(" ")).not.toContain("B");
  });
});

// --- QA: the roadmap itself was not checked. An unreadable rank counts as 0 on
// reading -- "a check asks for the rank", build-model.ts's comment promised, but
// that check did not exist. And two milestones whose names differ only by case
// blur together, since it is on the normalised name that every dated row
// resolves its rank.
describe("the milestone roadmap", () => {
  const milestone = (name: string, rank: number) => ({
    name, rank, label: "", status: "Delivered", date: "", description: "",
    sheet: "Milestones", row: 0,
  });
  // Every dated row must carry its introduction bound as soon as a roadmap
  // exists: without it, those are the anomalies one would read, not the
  // roadmap's.
  const anomalies = (milestones: ReturnType<typeof milestone>[]) => {
    const asSoonAs = { introducedAt: milestones[0].name };
    return runIntegrityChecks(
      model({
        milestones,
        actors: [actor({ name: "A", ...asSoonAs }), actor({ name: "B", ...asSoonAs })],
        interfaces: [iface({ ...asSoonAs })],
        consumptions: [consumption({ ...asSoonAs })],
      })
    )
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .join(" ");
  };

  it("asks for a usable rank", () => {
    expect(anomalies([milestone("v1", 1), milestone("v2", 0)])).toContain("v2");
  });

  it("reports two milestones separated by case alone", () => {
    expect(anomalies([milestone("v1", 1), milestone("V1", 2)])).toContain("V1");
  });

  it("leaves a sound roadmap alone", () => {
    expect(anomalies([milestone("v1", 1), milestone("v2", 2)])).toBe("");
  });
});

// --- QA: two blocks named the interface without its version. Two versions of
// one contract then gave two items strictly identical to the eye, although
// "Migrations under way" has been able to write "F 1.0" from the start.
describe("informational blocks — an interface is named with its version", () => {
  const twoVersions = () =>
    model({
      interfaces: [
        iface({ flowName: "F", version: "1.0", toConfirm: true }),
        iface({ flowName: "F", version: "2.0", toConfirm: true, row: 1 }),
      ],
      consumptions: [],
    });

  it("tells the two versions apart in \"Interfaces to confirm\"", () => {
    const block = runIntegrityChecks(twoVersions()).infoBlocks.find((b) => b.title === "Interfaces to confirm")!;
    expect(block.items).toHaveLength(2);
    expect(new Set(block.items.map((i) => i.replace(/\(.*\)/, "")))).toHaveProperty("size", 2);
  });
});

// --- QA: two actors may publish a contract of the same name without having
// agreed on it -- that is commonplace, and they are two distinct interfaces. The
// check took them for a duplicate because it looked only at (name, version): on
// a real workbook, 4 false duplicates out of 9. The publisher is part of the identity.
describe("duplicate interface — the publisher is part of the identity", () => {
  const anomaliesFor = (interfaces: ReturnType<typeof iface>[]) =>
    runIntegrityChecks(model({ interfaces, consumptions: [] }))
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .filter((m) => m.includes("more than once"));

  it("does not report two different publishers for one name", () => {
    expect(
      anomaliesFor([
        iface({ flowName: "Kashyyyk", providerName: "A", expectedSheet: "FX_A_HTTP" }),
        iface({ flowName: "Kashyyyk", providerName: "B", expectedSheet: "FX_B_HTTP" }),
      ])
    ).toHaveLength(0);
  });

  it("still reports the same name at the same publisher", () => {
    expect(
      anomaliesFor([
        iface({ flowName: "Kashyyyk", providerName: "A" }),
        iface({ flowName: "Kashyyyk", providerName: "A", row: 1 }),
      ])
    ).toHaveLength(1);
  });

  it("leaves two versions of one contract alone", () => {
    expect(
      anomaliesFor([
        iface({ flowName: "Kashyyyk", version: "1.0", providerName: "A" }),
        iface({ flowName: "Kashyyyk", version: "2.0", providerName: "A", row: 1 }),
      ])
    ).toHaveLength(0);
  });
});

// --- QA: cutting the name at 31 characters can land two (publisher, flow type)
// pairs on the same sheet. Merging them would mix two contracts' consumptions
// without a word; the check says so, and the user shortens a name.
//
describe("FX_ sheet — two pairs landing on the same name", () => {
  const messages = (interfaces: ReturnType<typeof iface>[]) =>
    runIntegrityChecks(model({ interfaces, consumptions: [] }))
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .filter((m) => m.includes("same sheet"));

  const long = (suffix: string) => `Plateforme de règlement-livraison ${suffix}`;

  it("reports two publishers whose cut names blur together", () => {
    const dits = messages([
      iface({ flowName: "F", providerName: long("Nord"), expectedSheet: expectedFxSheet(long("Nord"), "HTTP") }),
      iface({ flowName: "G", providerName: long("Sud"), expectedSheet: expectedFxSheet(long("Sud"), "HTTP"), row: 1 }),
    ]);
    expect(dits).toHaveLength(1);
    expect(dits[0]).toContain("Plateforme de règlement-livraison");
  });

  it("says nothing when the sheets differ", () => {
    expect(
      messages([
        iface({ flowName: "F", providerName: "Tatooine", expectedSheet: expectedFxSheet("Tatooine", "HTTP") }),
        iface({ flowName: "G", providerName: "Chandrila", expectedSheet: expectedFxSheet("Chandrila", "HTTP"), row: 1 }),
      ])
    ).toHaveLength(0);
  });

  it("says nothing for two interfaces of the same pair, which rightly share the sheet", () => {
    expect(
      messages([
        iface({ flowName: "F", providerName: "Tatooine" }),
        iface({ flowName: "G", providerName: "Tatooine", row: 1 }),
      ])
    ).toHaveLength(0);
  });
});

// --- QA: a chain broken by a relay that cannot be followed produced NO anomaly
// at all. The functional link was therefore missing in silence -- exactly what
// the catch-all bus check sets out to avoid elsewhere
// ailleurs.
// --- The two simple cases are covered above. This one is not: the chain breaks
// IN THE MIDDLE, two hops from the business consumer. The walk-up having to
// recurse, a deep break could very well not
// jamais remonter jusqu'au rapport.
describe("a chain broken in its middle", () => {
  const TYPES = [
    { type: "Application", icon: "app-window", nature: "Business", sheet: "ActorTypes", row: 0 },
    { type: "Middleware", icon: "server", nature: "Technical", sheet: "ActorTypes", row: 0 },
  ];

  it("reports the offending interface, not the one it was entered by", () => {
    const m = model({
      actorTypes: TYPES,
      actors: [
        actor({ name: "A" }),
        actor({ name: "X", actorType: "Middleware" }),
        actor({ name: "Y", actorType: "Middleware" }),
        actor({ name: "C" }),
      ],
      interfaces: [
        iface({ flowName: "f0", providerName: "A", expectedSheet: "FX_A_HTTP" }),
        iface({ flowName: "f1", providerName: "X", expectedSheet: "FX_X_HTTP", row: 1 }),
        iface({ flowName: "f2", providerName: "Y", expectedSheet: "FX_Y_HTTP", row: 2 }),
      ],
      consumptions: [
        // f0 does reach X, but X does not say under what it republishes it: it is
        // f1 that nothing feeds.
        consumption({ flowName: "f0", consumerName: "X", sheet: "FX_A_HTTP" }),
        consumption({ flowName: "f1", consumerName: "Y", sheet: "FX_X_HTTP", republishedAs: "f2", row: 1 }),
        consumption({ flowName: "f2", consumerName: "C", sheet: "FX_Y_HTTP", row: 2 }),
      ],
      fxSheetNames: ["FX_A_HTTP", "FX_X_HTTP", "FX_Y_HTTP"],
    });
    const dits = runIntegrityChecks(m)
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .filter((msg) => msg.includes("nothing feeds it"));
    expect(dits).toHaveLength(1);
    expect(dits[0]).toContain('"f1"');
  });
});


// --- The technologies' colour will come from an external referential, in
// hexadecimal. A value that is not one, or two technologies sharing the same,
// cannot be seen in the workbook: the first falls back silently on the palette,
// the second makes two lines indistinguishable.
describe("a technology's declared colour", () => {
  const estate = (colours: [string, string][]) =>
    model({
      flowTypes: colours.map(([type, colour], i) => base.flowType({ type, colour, row: i })),
      interfaces: colours.map(([type], i) =>
        iface({ flowName: `F${i}`, flowType: type, expectedSheet: `FX_A_${type}`, row: i })
      ),
      consumptions: [],
      fxSheetNames: colours.map(([type]) => `FX_A_${type}`),
    });

  const messages = (m: ParsedModel) =>
    runIntegrityChecks(m).families.flatMap((f) => f.anomalies).map((a) => a.message).filter((x) => x.includes("colour"));

  it("accepts a hexadecimal, with or without a hash", () => {
    expect(messages(estate([["HTTP", "#2a78d6"], ["Kafka", "eb6834"]]))).toHaveLength(0);
  });

  it("accepts an absent colour", () => {
    expect(messages(estate([["HTTP", ""], ["Kafka", ""]]))).toHaveLength(0);
  });

  it("reports a value that is not a colour", () => {
    expect(messages(estate([["HTTP", "sky blue"]]))[0]).toContain("sky blue");
  });

  it("reports two technologies declaring the same colour", () => {
    const dits = messages(estate([["HTTP", "#2a78d6"], ["Kafka", "#2A78D6"]]));
    expect(dits).toHaveLength(1);
    expect(dits[0]).toContain("Kafka");
  });
});

// --- A technology not declared in the referential makes its representation
// direction unknown: the interface and all its consumptions drop out of the
// diagrams. The report named the fault without saying what it costs -- on a real
// workbook, 24 interfaces out of 59 absent from every drawing, for a line that
// looked like a plain vocabulary reminder.
describe("a technology absent from the referential", () => {
  it("says the interface is no longer drawn", () => {
    const m = model({
      interfaces: [iface({ flowType: "Inconnue" })],
      consumptions: [],
    });
    const dit = runIntegrityChecks(m)
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .find((msg) => msg.includes("Inconnue"))!;
    expect(dit).toContain("not drawn");
  });
});

// --- QA: the perimeter decides the whole drawing -- what is inside the
// boundary, what is outside -- and its vocabulary was not checked. A faulty
// value therefore triggered nothing: the group was neither platform nor
// externe, silencieusement.
describe("the perimeter's vocabulary", () => {
  const messages = (perimeter: string) =>
    runIntegrityChecks(model({ groups: [{ name: "G", perimeter, sheet: "Groups", row: 0 }] }))
      .families.flatMap((f) => f.anomalies)
      .map((a) => a.message)
      .filter((m) => m.toLowerCase().includes("perimeter"));

  it("accepts both values, up to case and accents", () => {
    for (const v of ["Platform", "platform", "External", "EXTERNAL"]) {
      expect(messages(v).filter((m) => m.includes("unknown"))).toHaveLength(0);
    }
  });

  it("reports a value outside the vocabulary", () => {
    expect(messages("Platfrom").some((m) => m.includes("Platfrom"))).toBe(true);
  });
});

// --- QA: the milestone filter judged EXISTENCE as well as life. A publisher
// absent from the Actors sheet -- a reference fault, which the checks report
// separately -- therefore made its interface vanish from the report, although
// the diagrams draw it (core.ts treats it as alive, deliberately). The report
// declared "B has no flow" under a diagram showing a flow towards B.
//
describe("the milestone filter — an unknown actor is not a dead actor", () => {
  const fantome = () =>
    model({
      milestones: [
        { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
        { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 1 },
      ],
      // "Fantome" publishes, but does not appear in the Actors sheet.
      actors: [actor({ name: "B", introducedAt: "v1" })],
      interfaces: [iface({ providerName: "Fantome", introducedAt: "v1" })],
      consumptions: [consumption({ consumerName: "B", introducedAt: "v1" })],
    });

  const blocks = (rank: number | null) =>
    runIntegrityChecks(fantome(), rank).infoBlocks.flatMap((b) => b.items.map((i) => `${b.title} | ${i}`));

  it("does not declare flowless an actor the diagram links", () => {
    expect(buildFlowInstances(fantome(), 1)).toHaveLength(1);
    expect(blocks(1).filter((i) => i.includes("no flow"))).toHaveLength(0);
  });

  it("says the same thing at a milestone and without one", () => {
    expect(blocks(1).filter((i) => /no flow|Unused flow/.test(i))).toEqual(
      blocks(null).filter((i) => /no flow|Unused flow/.test(i))
    );
  });

  // A KNOWN and retired actor does remove its flows: that is the other half of
  // the rule, fixed earlier, and it must not reopen.
  it("still removes the flows of a known, retired actor", () => {
    const m = model({
      milestones: [{ name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 }],
      actors: [actor({ name: "A", introducedAt: "v1", retiredAt: "v1" }), actor({ name: "B", introducedAt: "v1" })],
      interfaces: [iface({ providerName: "A", introducedAt: "v1" })],
      consumptions: [consumption({ consumerName: "B", introducedAt: "v1" })],
    });
    expect(buildFlowInstances(m, 1)).toHaveLength(0);
  });
});

// --- QA: the consistency checks ALL judged the whole workbook. What the
// displayed milestone's diagram shows -- an interface losing its last consumer
// there, a relay chain that time cuts -- therefore disappeared in silence under
// an empty diagram. Symmetrically, two dated rows of one migration were counted
// together, and the file was reproached for
// suivre sa propre consigne.
const fixtureMessages = (m: Parameters<typeof runIntegrityChecks>[0], rank: number | null) =>
  runIntegrityChecks(m, rank).families.flatMap((f) => f.anomalies.map((a) => a.message));
// ---------------------------------------------------------------------------
// 3. The integrity report against the milestone axis.
// ---------------------------------------------------------------------------

const MILESTONES_FIXTURE = [base.milestone({ name: "v1", rank: 1 }), base.milestone({ name: "v2", rank: 2 }), base.milestone({ name: "v3", rank: 3 })];
const CORE_FIXTURE = {
  groups: [base.group({ name: "G" })],
  actorTypes: [base.actorType()],
  flowTypes: [base.flowType()],
  milestones: MILESTONES_FIXTURE,
  fxSheetNames: ["FX_A_HTTP"],
};

describe("the integrity report and the milestone axis", () => {
  it("does not cry inconsistency over a two-row dated migration", () => {
    // What the workbook's instructions prescribe: "Obsolete row: do not delete
    // it: give it a retirement milestone." The two intervals are DISJOINT -- at no
    // milestone does B consume two versions.
    const m = base.template({
      ...CORE_FIXTURE,
      actors: [base.actor({ name: "A", introducedAt: "v1" }), base.actor({ name: "B", introducedAt: "v1" })],
      interfaces: [
        base.iface({ flowName: "F", version: "1.0", providerName: "A", introducedAt: "v1", retiredAt: "v2" }),
        base.iface({ flowName: "F", version: "2.0", providerName: "A", introducedAt: "v2" }),
      ],
      consumptions: [
        base.consumption({ flowName: "F", version: "1.0", consumerName: "B", introducedAt: "v1", retiredAt: "v2", row: 2 }),
        base.consumption({ flowName: "F", version: "2.0", consumerName: "B", introducedAt: "v2", row: 3 }),
      ],
    });
    expect(buildFlowInstances(m, 1).map((f) => f.version)).toEqual(["1.0"]);
    expect(buildFlowInstances(m, 2).map((f) => f.version)).toEqual(["2.0"]);
    for (const rank of [null, 1, 2, 3]) {
      expect(fixtureMessages(m, rank).filter((x) => x.includes("two versions"))).toEqual([]);
    }
  });

  it("reports a consumption whose interval never meets its interface's", () => {
    const m = base.template({
      ...CORE_FIXTURE,
      actors: [base.actor({ name: "A", introducedAt: "v1" }), base.actor({ name: "B", introducedAt: "v1" })],
      interfaces: [base.iface({ flowName: "F", providerName: "A", introducedAt: "v1", retiredAt: "v2" })],
      consumptions: [base.consumption({ flowName: "F", consumerName: "B", introducedAt: "v2" })],
    });
    expect([1, 2, 3].map((r) => buildFlowInstances(m, r).length)).toEqual([0, 0, 0]);
    expect(fixtureMessages(m, 2).some((x) => x.includes("lives outside the lifetime"))).toBe(true);
  });

  it("says an interface has no consumption left at the displayed milestone", () => {
    const m = base.template({
      ...CORE_FIXTURE,
      actors: [base.actor({ name: "A", introducedAt: "v1" }), base.actor({ name: "B", introducedAt: "v1" })],
      interfaces: [base.iface({ flowName: "F", providerName: "A", introducedAt: "v1" })],
      consumptions: [base.consumption({ flowName: "F", consumerName: "B", introducedAt: "v1", retiredAt: "v2" })],
    });
    expect(buildFlowInstances(m, 2)).toHaveLength(0);
    expect(fixtureMessages(m, 2).some((x) => x.includes("no declared consumption"))).toBe(true);
  });

  it("says a relay chain is cut by time", () => {
    const m = base.template({
      milestones: [base.milestone({ name: "v1", rank: 1 }), base.milestone({ name: "v2", rank: 2 })],
      groups: [base.group({ name: "G" })],
      actors: [
        base.actor({ name: "Src", introducedAt: "v1" }),
        base.actor({ name: "Bus", actorType: "Infra", introducedAt: "v1" }),
        base.actor({ name: "Dst", introducedAt: "v1" }),
      ],
      actorTypes: [base.actorType({ nature: "Business" }), base.actorType({ type: "Infra", nature: "Technical" })],
      flowTypes: [base.flowType()],
      fxSheetNames: ["FX_Src_HTTP", "FX_Bus_HTTP"],
      interfaces: [
        base.iface({ flowName: "In", providerName: "Src", expectedSheet: "FX_Src_HTTP", introducedAt: "v1" }),
        base.iface({ flowName: "Out", providerName: "Bus", expectedSheet: "FX_Bus_HTTP", introducedAt: "v1" }),
      ],
      consumptions: [
        base.consumption({ flowName: "In", consumerName: "Bus", sheet: "FX_Src_HTTP", republishedAs: "Out", introducedAt: "v1", retiredAt: "v2" }),
        base.consumption({ flowName: "Out", consumerName: "Dst", sheet: "FX_Bus_HTTP", introducedAt: "v1" }),
      ],
    });
    expect(buildFunctionalFlows(m, 1)).toHaveLength(1);
    expect(buildFunctionalFlows(m, 2)).toHaveLength(0);
    expect(fixtureMessages(m, 2).some((x) => x.includes("nothing feeds it"))).toBe(true);
  });

  it("does not claim a flow name is absent from the catalogue when the diagram draws it", () => {
    const m = base.template({
      groups: [base.group({ name: "G" })],
      actors: [base.actor({ name: "A" }), base.actor({ name: "B" })],
      actorTypes: [base.actorType()],
      flowTypes: [base.flowType()],
      fxSheetNames: ["FX_A_HTTP"],
      interfaces: [base.iface({ flowName: "Authent", providerName: "A", expectedSheet: "FX_A_HTTP" })],
      consumptions: [base.consumption({ flowName: "authent", consumerName: "B", sheet: "FX_A_HTTP" })],
    });
    expect(buildFlowInstances(m, null)).toHaveLength(1);
    expect(fixtureMessages(m, null).some((x) => x.includes("missing from the Interfaces catalogue"))).toBe(false);
  });
});


// --- The workbook is authoritative on the colour, but it must know it had to
// be corrected: otherwise the hue on screen is not the one it wrote, and nobody
// understands why.
describe("checks — colours too light to be drawn", () => {
  const block = (colour: string) =>
    runIntegrityChecks(model({ flowTypes: [base.flowType({ type: "HTTP", colour })] })).infoBlocks.find(
      (b) => b.id === "contrast"
    );

  it("reports a declared colour too light for a line", () => {
    expect(block("#ffee00")?.items.join(" ")).toContain("HTTP");
    expect(block("#ffee00")?.level).toBe("warning");
  });

  it("reports nothing when the declared colour passes the threshold", () => {
    expect(block("#1f5fae")?.items).toEqual([]);
  });

  // A value that is not a colour falls to the vocabulary checks, not here:
  // reporting it twice would say the same cell twice.
  it("does not report a value that is not a colour", () => {
    expect(block("sky blue")?.items).toEqual([]);
  });
});

// --- The dependency graph existed and served only the cycles. "If X falls, who
// is affected?" is nonetheless the question of the day a migration has to be
// arbitrated, and nothing answered it.
describe("checks — blast radius", () => {
  const block = (m: ParsedModel) => runIntegrityChecks(m).infoBlocks.find((b) => b.id === "blast-radius");

  // A supplies B, B supplies C: A takes both down.
  const chain = () =>
    model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C" })],
      fxSheetNames: ["FX_A_HTTP", "FX_B_HTTP"],
      interfaces: [
        iface({ flowName: "F1", providerName: "A", expectedSheet: "FX_A_HTTP" }),
        iface({ flowName: "F2", providerName: "B", expectedSheet: "FX_B_HTTP" }),
      ],
      consumptions: [
        consumption({ flowName: "F1", consumerName: "B", sheet: "FX_A_HTTP" }),
        consumption({ flowName: "F2", consumerName: "C", sheet: "FX_B_HTTP" }),
      ],
    });

  it("counts the transitive downstream, not merely the neighbours", () => {
    expect(block(chain())?.items[0]).toBe("A: 2 components downstream.");
  });

  it("ranks the one taking most down first", () => {
    expect(block(chain())?.items.map((i) => i.split(":")[0])).toEqual(["A", "B"]);
  });

  // Naming with a zero would lengthen the list without adding anything to it.
  it("does not name those who take nobody down", () => {
    expect(block(chain())?.items.some((i) => i.startsWith("C:"))).toBe(false);
  });

  it("agrees in the singular", () => {
    expect(block(chain())?.items[1]).toBe("B: 1 component downstream.");
  });

  // A cycle brings the actor back into its own downstream: "how many I take
  // down" must not count me.
  it("does not count itself when a cycle brings it back", () => {
    const loop = model({
      actors: [actor({ name: "A" }), actor({ name: "B" })],
      fxSheetNames: ["FX_A_HTTP", "FX_B_HTTP"],
      interfaces: [
        iface({ flowName: "F1", providerName: "A", expectedSheet: "FX_A_HTTP" }),
        iface({ flowName: "F2", providerName: "B", expectedSheet: "FX_B_HTTP" }),
      ],
      consumptions: [
        consumption({ flowName: "F1", consumerName: "B", sheet: "FX_A_HTTP" }),
        consumption({ flowName: "F2", consumerName: "A", sheet: "FX_B_HTTP" }),
      ],
    });
    expect(block(loop)?.items).toEqual(["A: 1 component downstream.", "B: 1 component downstream."]);
  });
});

describe("out of referential", () => {
  it("says nothing when the workbook carries no referential", () => {
    const report = runIntegrityChecks(model({ referentialActors: [], referentialTechnologies: [] }));
    expect(report.infoBlocks.find((b) => b.id === "out-of-referential")).toBeUndefined();
  });

  it("names an actor the referential does not know", () => {
    const report = runIntegrityChecks(
      model({
        actors: [actor({ name: "Tatooine" }), actor({ name: "Alderaan" })],
        referentialActors: [{ name: "Tatooine", group: "", actorType: "", owner: "", description: "" }],
      })
    );
    const infoBlock = report.infoBlocks.find((b) => b.id === "out-of-referential")!;
    expect(infoBlock.items.join(" ")).toContain("Alderaan");
    expect(infoBlock.items.join(" ")).not.toContain("Tatooine");
  });

  it("names a technology the referential does not know", () => {
    const report = runIntegrityChecks(
      model({
        flowTypes: [base.flowType({ type: "HTTP" }), base.flowType({ type: "MQ" })],
        referentialTechnologies: [{ type: "HTTP", direction: "", description: "", colour: "" }],
      })
    );
    const infoBlock = report.infoBlocks.find((b) => b.id === "out-of-referential")!;
    expect(infoBlock.items.join(" ")).toContain("MQ");
  });

  // A name the referential does not know is a decision waiting for someone,
  // not a remark: it must rank as an action, not merely be seen.
  it("is an action: the file is correct, but a decision is waiting", () => {
    const report = runIntegrityChecks(
      model({
        actors: [actor({ name: "Alderaan" })],
        referentialActors: [{ name: "Tatooine", group: "", actorType: "", owner: "", description: "" }],
      })
    );
    const infoBlock = report.infoBlocks.find((b) => b.id === "out-of-referential")!;
    expect(infoBlock.level).toBe("action");
  });

  it("compares regardless of case and accents, as every other check does", () => {
    const report = runIntegrityChecks(
      model({
        actors: [actor({ name: "TATOOINE" })],
        referentialActors: [{ name: "Tatooine", group: "", actorType: "", owner: "", description: "" }],
      })
    );
    expect(report.infoBlocks.find((b) => b.id === "out-of-referential")).toBeUndefined();
  });

  it("suggests a near-duplicate referential actor name", () => {
    const report = runIntegrityChecks(
      model({
        actors: [actor({ name: "Chandrilla" })],
        referentialActors: [{ name: "Chandrila", group: "", actorType: "", owner: "", description: "" }],
      })
    );
    const infoBlock = report.infoBlocks.find((b) => b.id === "out-of-referential")!;
    expect(infoBlock.items.join(" ")).toContain('did you mean "Chandrila"?');
  });

  it("does not suggest an acronym technology one edit away from another acronym", () => {
    const report = runIntegrityChecks(
      model({
        flowTypes: [base.flowType({ type: "SFTP" })],
        referentialTechnologies: [{ type: "SMTP", direction: "", description: "", colour: "" }],
      })
    );
    const infoBlock = report.infoBlocks.find((b) => b.id === "out-of-referential")!;
    expect(infoBlock.items.join(" ")).not.toContain("did you mean");
  });

  it("does not suggest HTTPS for the unknown acronym HTTP", () => {
    const report = runIntegrityChecks(
      model({
        flowTypes: [base.flowType({ type: "HTTP" })],
        referentialTechnologies: [{ type: "HTTPS", direction: "", description: "", colour: "" }],
      })
    );
    const infoBlock = report.infoBlocks.find((b) => b.id === "out-of-referential")!;
    expect(infoBlock.items.join(" ")).not.toContain("did you mean");
  });

  it("leaves the plain wording when nothing in the referential is close", () => {
    const report = runIntegrityChecks(
      model({
        actors: [actor({ name: "Alderaan" })],
        referentialActors: [{ name: "Tatooine", group: "", actorType: "", owner: "", description: "" }],
      })
    );
    const infoBlock = report.infoBlocks.find((b) => b.id === "out-of-referential")!;
    expect(infoBlock.items).toEqual([`actor "Alderaan" (Actors, row 0)`]);
  });
});
