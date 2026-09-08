import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { migrateLegacyWorkbook } from "./legacy-upgrade";
import { runIntegrityChecks } from "../integrity/checks";
import { writeTemplate, FLOW_TYPE_SHEET_COLUMNS } from "./template-export";
import { parseWorkbook } from "../parsing/workbook";
import {
  buildModel,
  INTERFACE_COLUMNS,
  FX_COLUMNS,
  ACTOR_COLUMNS,
  GROUP_COLUMNS,
  MILESTONE_COLUMNS,
  ACTOR_TYPE_COLUMNS,
  SCHEMA_VERSION,
  isValidTabName,
} from "../parsing/build-model";

// Original-format workbooks built for the test, not the sample file: a
// conversion that only worked on one known file would be nothing but a
// disguised transcription.
function legacyWorkbook(
  flows: Record<string, string>[],
  components: Record<string, string>[] = []
): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(flows), "Flux");
  if (components.length > 0) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(components), "Composants");
  }
  return XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
}

// The rows produced are positional: they are read by column name rather than
// by index, otherwise any column inserted upstream breaks these tests while
// saying nothing about the conversion itself.
const iPublisher = INTERFACE_COLUMNS.indexOf("Provider");
const iConsumer = FX_COLUMNS.indexOf("Consumer");
const iDecision = FX_COLUMNS.indexOf("Decision");

const link = (o: Partial<Record<string, string>> = {}) => ({
  "Composant source": "Appelant",
  "Composant cible": "Appelé",
  "Type de flux": "HTTP",
  "Nom du flux": "Flux A",
  "Description": "d",
  "Emplacement du contrat": "portail",
  Statut: "A conserver",
  Comments: "",
  ...o,
});

describe("migration from the original format", () => {
  // The heart of the conversion. The original format says "source → target"; the
  // current one says "who publishes". The two coincide only according to the
  // type's representation direction.
  it("makes the target publish when the call goes from consumer to publisher", () => {
    const { data } = migrateLegacyWorkbook(legacyWorkbook([link({ "Type de flux": "HTTP" })]));
    expect(data.interfaces[0][iPublisher]).toBe("Appelé");
    expect(data.fx[0].name).toBe("FX_Appelé_HTTP");
    expect(data.fx[0].rows[0][iConsumer]).toBe("Appelant");
  });

  it("makes the source publish when the producer's push is represented", () => {
    const { data } = migrateLegacyWorkbook(legacyWorkbook([link({ "Type de flux": "Kafka" })]));
    expect(data.interfaces[0][iPublisher]).toBe("Appelant");
    expect(data.fx[0].rows[0][iConsumer]).toBe("Appelé");
  });

  // A type outside the referential has no known direction: it is not invented,
  // the call is fallen back on, and it is reported.
  it("reports a type absent from the referential, whatever it is", () => {
    const { unknownTypes, data } = migrateLegacyWorkbook(
      legacyWorkbook([link({ "Type de flux": "AS2" }), link({ "Type de flux": "Fichier + ESB", "Nom du flux": "B" })])
    );
    expect(unknownTypes.sort()).toEqual(["AS2", "Fichier + ESB"]);
    expect(data.interfaces[0][iPublisher]).toBe("Appelé");
  });

  // Since v8 nothing seeds FlowTypes: a converted workbook came out with that
  // sheet empty, every interface naming a technology no sheet declared, and
  // the derived columns reading from an empty copy.
  it("declares the types the flows use, and seeds the copy they read from", () => {
    const { data } = migrateLegacyWorkbook(
      legacyWorkbook([link({ "Type de flux": "HTTP" }), link({ "Type de flux": "AS2", "Nom du flux": "B" })])
    );
    expect(data.flowTypes.map((t) => t[0]).sort()).toEqual(["AS2", "HTTP"]);
    const reread = buildModel(parseWorkbook(writeTemplate(data)));
    if (!reread.ok) throw new Error("unreadable");
    const http = reread.model.flowTypes.find((t) => t.type === "HTTP")!;
    expect(http.direction).toBe("consumer-to-provider");
    // An unknown type is DECLARED with the direction the migration drew with,
    // rather than left blank for the parser to guess the same thing in silence.
    const as2 = reread.model.flowTypes.find((t) => t.type === "AS2")!;
    expect(as2.rawDirection).toBe("consumer → provider");
    expect(reread.model.referentialTechnologies.length).toBeGreaterThan(0);
    expect(reread.model.referentialActorTypes.length).toBeGreaterThan(0);
    const structure = runIntegrityChecks(reread.model).families.find((f) => f.id === "structure")!;
    expect(structure.anomalies.map((a) => a.message).join(" ")).not.toContain("FlowTypes");
  });

  // The matching is done against the current vocabulary, not against a table
  // taken from one file: any case or accentuation passes.
  it("finds the decision again in the current vocabulary, up to accents", () => {
    const { data } = migrateLegacyWorkbook(
      legacyWorkbook([
        link({ Statut: "A supprimer" }),
        link({ Statut: "à TRANSFORMER", "Nom du flux": "B" }),
        link({ Statut: "Bidon", "Nom du flux": "C" }),
      ])
    );
    const decisions = data.fx.flatMap((o) => o.rows).map((l) => l[iDecision]);
    // "À supprimer" stays a decision: the original format says nowhere when that
    // flow leaves, only that it no longer has any reason to be.
    const retirements = data.fx.flatMap((o) => o.rows).map((l) => l[FX_COLUMNS.indexOf("Retired at")]);
    expect(retirements.every((r) => r === "")).toBe(true);
    expect(decisions).toContain("Remove");
    expect(decisions).toContain("Transform");
    // A value outside the vocabulary is not guessed: it stays empty, and
    // completeness asks for it.
    expect(decisions).toContain("");
  });

  // In real files, the Composants sheet is not kept up to date.
  it("recovers the components only the flows name", () => {
    const { data, actorsCreated } = migrateLegacyWorkbook(
      legacyWorkbook([link({})], [{ Groupe: "G1", Nom: "Déjà là", Description: "d", Commentaires: "" }])
    );
    expect(actorsCreated.sort()).toEqual(["Appelant", "Appelé"]);
    expect(data.actors.map((a) => a[0])).toContain("Déjà là");
    // Created with no group: the integrity check will ask for it.
    expect(data.actors.find((a) => a[0] === "Appelant")![1]).toBe("");
    expect(data.groups).toEqual([["G1", ""]]);
  });

  it("gathers one publisher's consumptions into a single sheet", () => {
    const { data } = migrateLegacyWorkbook(
      legacyWorkbook([
        link({ "Composant source": "A", "Nom du flux": "F1" }),
        link({ "Composant source": "B", "Nom du flux": "F2" }),
      ])
    );
    expect(data.fx).toHaveLength(1);
    expect(data.fx[0].rows.map((l) => l[iConsumer]).sort()).toEqual(["A", "B"]);
  });

  // Excel refuses "/" in a sheet name. The sheet used to be given up on, and its
  // consumptions went with it. The name is now sanitised: the forbidden
  // character becomes a dash and everything is kept.
  it("sanitises the sheet Excel would refuse rather than giving it up", () => {
    const { data } = migrateLegacyWorkbook(legacyWorkbook([link({ "Type de flux": "OIDC/SSO" })]));
    expect(data.interfaces).toHaveLength(1);
    expect(data.fx.map((o) => o.name)).toEqual(["FX_Appelé_OIDC-SSO"]);
  });

  it("refuses a workbook with no Flux sheet", () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["rien"]]), "Autre");
    const bytes = XLSX.write(wb, { bookType: "xlsx", type: "array" }) as ArrayBuffer;
    expect(() => migrateLegacyWorkbook(bytes)).toThrow(/Flux/);
  });
});

describe("legacy migration — the version and state columns", () => {
  it("aligns each produced row on the current column count", () => {
    // An actor from Composants and another created for want of appearing there:
    // both actor-writing paths must be covered.
    const { data } = migrateLegacyWorkbook(
      legacyWorkbook([link({})], [{ Groupe: "G1", Nom: "Appelant", Description: "d", Commentaires: "" }])
    );
    for (const row of data.interfaces) expect(row).toHaveLength(INTERFACE_COLUMNS.length);
    for (const tab of data.fx) {
      for (const row of tab.rows) expect(row).toHaveLength(FX_COLUMNS.length);
    }
    for (const row of data.actors) expect(row).toHaveLength(ACTOR_COLUMNS.length);
    for (const row of data.groups) expect(row).toHaveLength(GROUP_COLUMNS.length);
    for (const row of data.milestones) expect(row).toHaveLength(MILESTONE_COLUMNS.length);
    // The FlowTypes SHEET has one column more than the schema's three: the
    // colour, derived from the hidden copy.
    for (const row of data.flowTypes) expect(row).toHaveLength(FLOW_TYPE_SHEET_COLUMNS.length);
    for (const row of data.actorTypes) expect(row).toHaveLength(ACTOR_TYPE_COLUMNS.length);
    // Genuinely non-empty: otherwise the loops above check nothing.
    expect(data.actors.length).toBeGreaterThan(0);
    expect(data.groups.length).toBeGreaterThan(0);
    expect(data.milestones.length).toBeGreaterThan(0);
  });

  // The original format knows neither version nor state: they are not invented,
  // and §7.4 will report the gaps.
  it("leaves version empty rather than inventing it", () => {
    const { data } = migrateLegacyWorkbook(legacyWorkbook([link({})]));
    const result = buildModel(parseWorkbook(writeTemplate(data)));
    if (!result.ok) throw new Error("unreadable migrated workbook");
    expect(result.model.interfaces[0].version).toBe("");
    expect(result.model.consumptions[0].version).toBe("");
  });

  it("emits a workbook already at the current schema number", () => {
    const { data } = migrateLegacyWorkbook(legacyWorkbook([link({})]));
    const result = buildModel(parseWorkbook(writeTemplate(data)));
    if (!result.ok) throw new Error("unreadable migrated workbook");
    expect(result.model.schemaVersion).toBe(SCHEMA_VERSION);
  });
});

// The rule saying what Excel accepts as a sheet name is single
// (build-model.ts), but two paths consume it separately: the migration decides
// here, at writing time, whether it creates the FX_ sheet; buildModel decides
// later, on re-reading, whether the interface has a valid sheet. Each name is
// put through both: if they ever drifted apart, the produced workbook would
// carry an interface the integrity check would ask for on a sheet nothing could
// ever have created.
describe("FX_ sheet name — the same rule on both sides (migration and re-reading)", () => {
  // A fixed prefix for this legacy workbook: "FX_Appelé_" (10 characters,
  // link()'s default publisher being "Appelé"). A 22-character type therefore
  // pushes the whole name to 32 -- one more than the limit
  // d'Excel.
  const casHostiles: [string, string][] = [
    ["dépasse 31 caractères", "X".repeat(22)],
    ["porte un « : »", ":"],
    ["porte un « \\ »", "\\"],
    ["porte un « / »", "/"],
    ["porte un « ? »", "?"],
    ["porte un « * »", "*"],
    ["porte un « [ »", "["],
    ["porte un « ] »", "]"],
  ];

  it.each(casHostiles)("crée des deux côtés le même onglet quand le type %s", (_cas, type) => {
    const { data } = migrateLegacyWorkbook(legacyWorkbook([link({ "Type de flux": type })]));
    expect(data.fx).toHaveLength(1);
    expect(isValidTabName(data.fx[0].name)).toBe(true);

    const result = buildModel(parseWorkbook(writeTemplate(data)));
    if (!result.ok) throw new Error("unreadable migrated workbook");
    // The heart of the matter: the sheet the writing created is exactly the one
    // the re-reading expects, and the consumption survived the trip.
    expect(result.model.interfaces[0].expectedSheet).toBe(data.fx[0].name);
    expect(result.model.consumptions).toHaveLength(1);
  });

  it("creates the same sheet on both sides for an already valid name", () => {
    const { data } = migrateLegacyWorkbook(legacyWorkbook([link({ "Type de flux": "HTTP" })]));
    expect(data.fx.map((o) => o.name)).toEqual(["FX_Appelé_HTTP"]);

    const result = buildModel(parseWorkbook(writeTemplate(data)));
    if (!result.ok) throw new Error("unreadable migrated workbook");
    expect(result.model.interfaces[0].expectedSheet).toBe("FX_Appelé_HTTP");
    expect(result.model.consumptions).toHaveLength(1);
  });
});
