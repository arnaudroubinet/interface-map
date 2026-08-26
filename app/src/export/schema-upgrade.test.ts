import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { UPGRADE_STEPS, dataFromModel, upgrade } from "./schema-upgrade";
import { writeTemplate, LISTES } from "./template-export";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel, SCHEMA_VERSION, INTERFACE_COLUMNS, expectedFxSheet } from "../parsing/build-model";
import { runIntegrityChecks } from "../integrity/checks";
import type { ParsedModel } from "../parsing/model";

// A workbook from before versioning: the Version and État columns do not exist
// in it, so the parser read them empty.
function originalModel(): ParsedModel {
  return base.template({
    actors: [
      base.actor({ name: "Tatooine", group: "Socle", owner: "Yavin", description: "d", comments: "c" }),
      base.actor({ name: "Mygeeto", group: "Ryloth" }),
    ],
    groups: [base.group({ name: "Socle" }), base.group({ name: "Ryloth", perimeter: "External" })],
    actorTypes: [base.actorType()],
    flowTypes: [base.flowType()],
    interfaces: [
      base.iface({
        flowName: "Authent", providerName: "Tatooine", description: "Ouverture de session",
        contractLink: "https://c", contractReference: "CTR-1", comments: "note", toConfirm: true,
        expectedSheet: "FX_Tatooine_HTTP",
      }),
    ],
    consumptions: [
      base.consumption({
        flowName: "Authent", consumerName: "Mygeeto", usage: "Ouverture",
        criticality: "1 - Critical", legacyStatus: "Actif", decision: "Keep", sheet: "FX_Tatooine_HTTP",
      }),
    ],
    fxSheetNames: ["FX_Tatooine_HTTP"],
    schemaVersion: 0,
  });
}

describe("the upgrade chain", () => {
  it("chains the steps with neither gap nor overlap, up to the current version", () => {
    let expected = 0;
    for (const step of UPGRADE_STEPS) {
      expect(step.de).toBe(expected);
      expect(step.vers).toBe(expected + 1);
      expected = step.vers;
    }
    expect(expected).toBe(SCHEMA_VERSION);
  });

  // The referential became ONE workbook, read through named tables and now
  // owning four vocabularies. Nothing to transform -- the address lives in the
  // Power Query stream and the new sheets are born at writing time -- but each
  // step must exist all the same: that is what makes the workbooks already in
  // circulation be recognised as stale.
  it("takes a v6 workbook to v7 without transforming the model", () => {
    expect(SCHEMA_VERSION).toBe(7);
    const step = UPGRADE_STEPS.find((s) => s.de === 6);
    expect(step?.vers).toBe(7);
  });
});

describe("upgrading a workbook in the original format", () => {
  it("produces a workbook at the current version", () => {
    const result = buildModel(parseWorkbook(writeTemplate(upgrade(originalModel()))));
    if (!result.ok) throw new Error("unreadable upgraded workbook");
    expect(result.model.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it("keeps actors, groups, interfaces and consumptions", () => {
    const result = buildModel(parseWorkbook(writeTemplate(upgrade(originalModel()))));
    if (!result.ok) throw new Error("unreadable upgraded workbook");
    const m = result.model;
    expect(m.actors.map((a) => a.name).sort()).toEqual(["Mygeeto", "Tatooine"]);
    expect(m.actors.find((a) => a.name === "Tatooine")!.owner).toBe("Yavin");
    expect(m.groups.find((g) => g.name === "Socle")!.perimeter).toBe("Platform");
    expect(m.interfaces).toHaveLength(1);
    expect(m.interfaces[0].providerName).toBe("Tatooine");
    expect(m.interfaces[0].contractReference).toBe("CTR-1");
    expect(m.interfaces[0].toConfirm).toBe(true);
    expect(m.consumptions).toHaveLength(1);
    expect(m.consumptions[0].consumerName).toBe("Mygeeto");
    expect(m.consumptions[0].criticality).toBe("1 - Critical");
  });

  // Both columns arrive empty: v0 can say nothing about them, and inventing an
  // "Active" state would pass off as decided what never was.
  it("leaves the new columns empty", () => {
    const result = buildModel(parseWorkbook(writeTemplate(upgrade(originalModel()))));
    if (!result.ok) throw new Error("unreadable upgraded workbook");
    expect(result.model.interfaces[0].version).toBe("");
    expect(result.model.interfaces[0].legacyState).toBe("");
    expect(result.model.consumptions[0].version).toBe("");
  });

  it("files each consumption in the sheet it came from", () => {
    const data = dataFromModel(originalModel());
    expect(data.fx.map((o) => o.name)).toEqual(["FX_Tatooine_HTTP"]);
    expect(data.fx[0].rows).toHaveLength(1);
  });
});

// The same one, with what it said about time through its État and Statut columns.
function templateDate(): ParsedModel {
  return {
    ...originalModel(),
    interfaces: [
      { ...originalModel().interfaces[0], legacyState: "À décommissionner" },
      { ...originalModel().interfaces[0], flowName: "Autre", legacyState: "Retiré" },
      { ...originalModel().interfaces[0], flowName: "Vivant", legacyState: "Actif" },
    ],
    consumptions: [
      { ...originalModel().consumptions[0], legacyStatus: "Actif" },
      { ...originalModel().consumptions[0], flowName: "Autre", legacyStatus: "En projet" },
      { ...originalModel().consumptions[0], flowName: "Vivant", decision: "À supprimer" },
    ],
  };
}

const THE_DAY = new Date("2026-08-17T10:00:00Z");

describe("upgrade — the milestone axis replaces État and Statut", () => {
  it("creates an Origin milestone, delivered, carrying the migration's date", () => {
    const data = upgrade(templateDate(), THE_DAY);
    const origin = data.milestones.find((p) => p[0] === "Origin")!;
    expect(origin).toBeDefined();
    expect(origin[3]).toBe("Delivered");
    expect(origin[4]).toBe("2026-08-17");
  });

  // Without that anchor point, the arrival being mandatory, the converted
  // workbook would open on one completeness anomaly per row.
  it("sets Origin as the arrival milestone on every existing row", () => {
    const r = buildModel(parseWorkbook(writeTemplate(upgrade(templateDate(), THE_DAY))));
    if (!r.ok) throw new Error("unreadable");
    expect(r.model.actors.every((a) => a.introducedAt === "Origin")).toBe(true);
    expect(r.model.interfaces.filter((i) => i.flowName !== "Autre").every((i) => i.introducedAt === "Origin")).toBe(true);
    // What v1 declared "Planned" arrives later, what it declared already gone comes
    // from before: each has its own test.
    expect(r.model.consumptions.some((c) => c.introducedAt === "Origin")).toBe(true);
  });

  it("converts what is retired or on its way out into a retirement milestone", () => {
    const r = buildModel(parseWorkbook(writeTemplate(upgrade(templateDate(), THE_DAY))));
    if (!r.ok) throw new Error("unreadable");
    // Retired: already gone, so its retirement is the origin milestone itself.
    expect(r.model.interfaces.find((i) => i.flowName === "Autre")!.retiredAt).toBe("Origin");
    // To be decommissioned: gone at the next milestone, which is therefore created.
    const setBack = r.model.interfaces.find((i) => i.flowName === "Authent")!;
    expect(setBack.retiredAt).not.toBe("");
    expect(setBack.retiredAt).not.toBe("Origin");
    expect(r.model.milestones.map((p) => p.name)).toContain(setBack.retiredAt);
  });

  // "À supprimer" does not say when the consumption leaves, only that it no
  // longer has any reason to be: that is a judgement, at best a deprecation
  // warning. Turning it into a date would invent a departure nobody decided --
  // the conversion translates it, it does not swallow it.
  it("keeps À supprimer as a decision, without inventing a retirement", () => {
    const r = buildModel(parseWorkbook(writeTemplate(upgrade(templateDate(), THE_DAY))));
    if (!r.ok) throw new Error("unreadable");
    const toDelete = r.model.consumptions.find((c) => c.flowName === "Vivant")!;
    expect(toDelete.decision).toBe("Remove");
    expect(toDelete.retiredAt).toBe("");
  });

  it("converts an En projet status into an arrival at the planned milestone", () => {
    const r = buildModel(parseWorkbook(writeTemplate(upgrade(templateDate(), THE_DAY))));
    if (!r.ok) throw new Error("unreadable");
    const planned = r.model.consumptions.find((c) => c.flowName === "Autre")!;
    expect(planned.introducedAt).not.toBe("Origin");
  });

  // The converted workbook must complain neither about the axis just set on it,
  // nor about the columns just removed from it.
  it("complains neither about the milestones nor about the removed columns", () => {
    const r = buildModel(parseWorkbook(writeTemplate(upgrade(templateDate(), THE_DAY))));
    if (!r.ok) throw new Error("unreadable");
    const messages = runIntegrityChecks(r.model).families.flatMap((f) => f.anomalies.map((a) => a.message)).join(" | ");
    expect(messages).not.toContain("palier");
    expect(messages).not.toContain("statut");
    expect(messages).not.toContain("état");
  });
});

// The ranks must run from 1 with no gap: "Before" is created only if it serves,
// and a numbering starting at 2 would suggest a lost milestone.
describe("upgrade — numbering the milestones created", () => {
  it("numbers from 1 with no gap", () => {
    const r = buildModel(parseWorkbook(writeTemplate(upgrade(templateDate(), THE_DAY))));
    if (!r.ok) throw new Error("unreadable");
    expect(r.model.milestones.map((p) => p.rank)).toEqual(r.model.milestones.map((_, i) => i + 1));
  });
});

describe("classeur produit — onglets attendus", () => {
  // This is what replaces the macro: putting a workbook through the migration
  // returns a file where every expected sheet exists, even if empty.
  it("creates a sheet for an interface that has no consumption yet", () => {
    const template: ParsedModel = {
      ...templateDate(),
      interfaces: [
        { ...templateDate().interfaces[0], flowName: "Sans conso", expectedSheet: "FX_Tatooine_Kafka", legacyState: "" },
      ],
      consumptions: [],
    };
    const data = upgrade(template, THE_DAY);
    expect(data.fx.map((o) => o.name)).toContain("FX_Tatooine_Kafka");
    expect(data.fx.find((o) => o.name === "FX_Tatooine_Kafka")!.rows).toEqual([]);
  });

  // A workbook Excel would refuse is never manufactured. It used to be given up
  // on by not writing the sheet -- and its consumptions went with it, without a
  // word. The name is now cut down to what Excel accepts.
  it("creates the sheet under a name Excel accepts rather than giving it up", () => {
    // A genuinely long publisher: the sheet name is DERIVED from it, it is not set
    // by hand -- that is exactly how the problem arrives.
    const long = "Plateforme de règlement-livraison interbancaire";
    const base = templateDate();
    const template: ParsedModel = {
      ...base,
      actors: [...base.actors, { ...base.actors[0], name: long }],
      interfaces: [
        {
          ...base.interfaces[0],
          providerName: long,
          expectedSheet: expectedFxSheet(long, base.interfaces[0].flowType),
        },
      ],
      consumptions: [],
    };
    // At the level of the produced workbook, the only one that counts: the sheet
    // exists, its name fits within the limit, and the re-reading lands exactly on it.
    const bytes = writeTemplate(upgrade(template, THE_DAY));
    const reread = buildModel(parseWorkbook(bytes));
    if (!reread.ok) throw new Error("unreadable workbook");
    expect(reread.model.fxSheetNames.every((n) => n.length <= 31)).toBe(true);
    expect(reread.model.fxSheetNames).toContain(reread.model.interfaces[0].expectedSheet);
  });

  it("does not duplicate a sheet that already carries consumptions", () => {
    const data = upgrade(templateDate(), THE_DAY);
    const names = data.fx.map((o) => o.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("upgrade — the workbook switches to English", () => {
  function frenchModel(): ParsedModel {
    return {
      ...templateDate(),
      groups: [{ name: "Socle", perimeter: "Plateforme", sheet: "Groups", row: 0 }, { name: "Lothal", perimeter: "Externe", sheet: "Groups", row: 0 }],
      flowTypes: [base.flowType({ type: "HTTP", rawDirection: "consommateur → exposant" })],
      consumptions: [{ ...templateDate().consumptions[0], criticality: "1 - Vitale", decision: "À transformer" }],
      interfaces: [{ ...templateDate().interfaces[0], legacyState: "" }],
    };
  }

  it("translates the values already entered", () => {
    const r = buildModel(parseWorkbook(writeTemplate(upgrade(frenchModel(), THE_DAY))));
    if (!r.ok) throw new Error("unreadable");
    expect(r.model.groups.map((g) => g.perimeter)).toEqual(["Platform", "External"]);
    expect(r.model.flowTypes[0].rawDirection).toBe("consumer → provider");
    expect(r.model.milestones[0].status).toBe("Delivered");
    expect(r.model.consumptions[0].criticality).toBe("1 - Critical");
    expect(r.model.consumptions[0].decision).toBe("Transform");
  });

  // A term of the team's own is not closed vocabulary: it is not overwritten, and
  // the vocabulary check will report it if it has no business being there.
  it("leaves a value it does not recognise alone", () => {
    const template = { ...frenchModel(), groups: [{ name: "Socle", perimeter: "Zone grise", sheet: "Groups", row: 0 }] };
    const r = buildModel(parseWorkbook(writeTemplate(upgrade(template, THE_DAY))));
    if (!r.ok) throw new Error("unreadable");
    expect(r.model.groups[0].perimeter).toBe("Zone grise");
  });

  // The workbook's own vocabularies must not be replaced by the seed: the types the
  // team declared survive the upgrade.
  it("keeps the workbook's own flow types rather than reseeding them", () => {
    const template = {
      ...frenchModel(),
      flowTypes: [base.flowType({ type: "Saleucami", rawDirection: "consommateur → exposant", description: "Protocole interne" })],
    };
    const r = buildModel(parseWorkbook(writeTemplate(upgrade(template, THE_DAY))));
    if (!r.ok) throw new Error("unreadable");
    expect(r.model.flowTypes.map((t) => t.type)).toContain("Saleucami");
  });
});

// v1 went to production before its broken formulas were discovered. The chain
// must therefore recognise it as stale and have it rewritten -- failing which
// the workbooks already distributed keep their phantom links.
describe("upgrade — the v1 already distributed", () => {
  function modelV1(): ParsedModel {
    return { ...originalModel(), schemaVersion: 1, milestones: [
      { name: "Origin", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 2 },
    ] };
  }

  it("is recognised as stale by the current version", () => {
    expect(modelV1().schemaVersion).toBeLessThan(SCHEMA_VERSION);
  });

  it("ressort au format courant, son contenu intact", () => {
    const r = buildModel(parseWorkbook(writeTemplate(upgrade(modelV1(), THE_DAY))));
    if (!r.ok) throw new Error("unreadable");
    expect(r.model.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.model.actors.map((a) => a.name)).toEqual(modelV1().actors.map((a) => a.name));
    expect(r.model.milestones.map((p) => p.name)).toEqual(["Origin"]);
  });

  // The v1 → v2 step does not touch the model: all the benefit is in the
  // rewriting. Checking it prevents slipping a transformation in by mistake.
  it("transforms nothing in the model itself", () => {
    const before = modelV1();
    const step = UPGRADE_STEPS.find((e) => e.de === 1)!;
    expect(step.appliquer(before, { dateMigration: THE_DAY })).toBe(before);
  });
});

describe("upgrade — the v2 already distributed", () => {
  function modelV2(): ParsedModel {
    return { ...originalModel(), schemaVersion: 2 };
  }

  it("is recognised as stale", () => {
    expect(modelV2().schemaVersion).toBeLessThan(SCHEMA_VERSION);
  });

  it("ressort au format courant, son contenu intact", () => {
    const r = buildModel(parseWorkbook(writeTemplate(upgrade(modelV2(), THE_DAY))));
    if (!r.ok) throw new Error("unreadable");
    expect(r.model.schemaVersion).toBe(SCHEMA_VERSION);
    expect(r.model.actors.map((a) => a.name)).toEqual(modelV2().actors.map((a) => a.name));
  });

  it("transforms nothing in the model itself", () => {
    const before = modelV2();
    const step = UPGRADE_STEPS.find((e) => e.de === 2)!;
    expect(step.appliquer(before, { dateMigration: THE_DAY })).toBe(before);
  });
});

// A hand-kept workbook rarely names its sheets to the character. The parser
// tolerates it -- it matches the consumption to its interface despite the case
// -- but the rewriting filed the interfaces under the rebuilt name and the
// consumptions under the original one. One sheet came out as two: one new and
// empty, and the old one orphaned.
describe("upgrade — a sheet named otherwise than rebuilt", () => {
  function modelOtherTab(): ParsedModel {
    const base = originalModel();
    return {
      ...base,
      // The real sheet is written FX_TATOOINE_HTTP, the rebuilt name FX_Tatooine_HTTP.
      consumptions: [{ ...base.consumptions[0], sheet: "FX_TATOOINE_HTTP" }],
      fxSheetNames: ["FX_TATOOINE_HTTP"],
    };
  }

  it("produces one sheet only, carrying the consumptions", () => {
    const data = dataFromModel(modelOtherTab());
    expect(data.fx.map((o) => o.name)).toEqual(["FX_Tatooine_HTTP"]);
    expect(data.fx[0].rows).toHaveLength(1);
  });

  // A consumption matching no interface has no canonical sheet to go to: moving
  // it on one's own authority would lose it.
  it("leaves a consumption matching nothing in its own sheet", () => {
    const base = originalModel();
    const data = dataFromModel({
      ...base,
      consumptions: [{ ...base.consumptions[0], flowName: "Inconnu", sheet: "FX_Ailleurs_HTTP" }],
      fxSheetNames: ["FX_Ailleurs_HTTP"],
    });
    const elsewhere = data.fx.find((o) => o.name === "FX_Ailleurs_HTTP")!;
    expect(elsewhere.rows).toHaveLength(1);
  });
});

// --- QA: the rebuilt workbook has spoken English since schema v3, except the
// "To confirm" column, left in French. The value written therefore does not
// belong to the drop-down that same workbook sets on that column.
describe("upgrade — the To confirm column's vocabulary", () => {
  it("writes the current vocabulary's value, not its old French spelling", () => {
    const data = dataFromModel(originalModel());
    const column = INTERFACE_COLUMNS.indexOf("To confirm");
    expect(LISTES.Confirmation).toContain(data.interfaces[0][column]);
  });
});

// --- QA: two FX_ sheets whose names differ only by case. Excel does not accept
// two sheets sharing a name up to case: it refuses to open the file. The case
// arises as soon as an orphan consumption lives in a hand-kept sheet
// ("FX_TATOOINE_HTTP") while an interface makes
// attendre l'onglet reconstruit (« FX_Tatooine_HTTP »).
describe("upgrade — sheets sharing a name up to case", () => {
  it("does not produce two sheets differing only by case", () => {
    const base = originalModel();
    const data = dataFromModel({
      ...base,
      consumptions: [{ ...base.consumptions[0], flowName: "Inconnu", sheet: "FX_TATOOINE_HTTP" }],
      fxSheetNames: ["FX_TATOOINE_HTTP"],
    });
    const names = data.fx.map((o) => o.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
  });
});

// --- QA: a workbook of a version NEWER than the tool crossed no step and came
// out labelled with the tool's version. Nothing can produce it today, v3 being
// the last; the day a v4 circulates, an earlier version of the tool would
// downgrade it in silence, losing everything the parser of that day cannot
// read.
describe("upgrade — a workbook newer than the tool", () => {
  it("refuses to downgrade rather than rewriting in silence", () => {
    const future = { ...originalModel(), schemaVersion: SCHEMA_VERSION + 1 };
    expect(() => upgrade(future)).toThrow(/newer|recent/i);
  });

  it("lets a workbook at the tool's version through", () => {
    expect(() => upgrade({ ...originalModel(), schemaVersion: SCHEMA_VERSION })).not.toThrow();
  });
});

// --- QA: an original workbook may have no groups sheet, its actors' "Groupe"
// column carrying the information on its own. The rebuild then wrote
// model.groups, empty, and the groups disappeared: on a real workbook, nineteen
// groups lost, and as many actors referring to a group that no longer exists.
//
describe("upgrade — a workbook with no groups sheet", () => {
  const withoutGroupsSheet = () => {
    const base = originalModel();
    return {
      ...base,
      groups: [],
      groupsSheetMissing: true,
      actors: base.actors.map((a, i) => ({ ...a, group: i === 0 ? "Socle" : "Partenaires" })),
    };
  };

  it("rebuilds the groups the actors carry", () => {
    const data = upgrade(withoutGroupsSheet());
    expect(data.groups.map((g) => g[0]).sort()).toEqual(["Partenaires", "Socle"]);
  });

  // The perimeter is not guessed: it stays empty, and completeness asks for it.
  // Inventing "Platform" would give a workbook that looks complete and is wrong.
  it("leaves the perimeter empty rather than inventing it", () => {
    expect(upgrade(withoutGroupsSheet()).groups.every((g) => g[1] === "")).toBe(true);
  });

  it("touches nothing when the sheet exists", () => {
    const data = upgrade(originalModel());
    expect(data.groups.map((g) => g[0])).toEqual(originalModel().groups.map((g) => g.name));
  });
});

// --- QA: v3 carried the functional reading on the INTERFACE ROW, in a "Relays"
// column naming several input flows. v4 carries it on the consumption. What is
// found again is moved; what is not used to disappear from the conversion
// without a word, and the converted workbook no longer said anywhere that a
// relay had been declared.
describe("upgrade — v3's relays", () => {
  const modelV3 = (legacyRelays: string): ParsedModel => {
    const b = originalModel();
    return {
      ...b,
      schemaVersion: 3,
      milestones: [base.milestone({ name: "v1", rank: 1 })],
      actors: [...b.actors, base.actor({ name: "Bus", group: "Socle" })],
      interfaces: [
        ...b.interfaces,
        base.iface({
          flowName: "Republié", version: "1.0", providerName: "Bus",
          expectedSheet: "FX_Bus_HTTP", comments: "note", legacyRelays,
        }),
      ],
      consumptions: [
        ...b.consumptions,
        base.consumption({ flowName: "Authent", consumerName: "Bus", sheet: "FX_Tatooine_HTTP" }),
      ],
      fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
    };
  };

  const relire = (m: ParsedModel) => {
    const reread = buildModel(parseWorkbook(writeTemplate(upgrade(m, THE_DAY))));
    if (!reread.ok) throw new Error("unreadable workbook");
    return reread.model;
  };

  it("carries the relay onto the consumption it named", () => {
    const m = relire(modelV3("Authent"));
    const input = m.consumptions.find((c) => c.consumerName === "Bus")!;
    expect(input.republishedAs).toBe("Republié 1.0");
  });

  it("keeps in the workbook the relay it could not place", () => {
    const m = relire(modelV3("Introuvable"));
    expect(m.consumptions.every((c) => c.republishedAs === "")).toBe(true);
    const iface = m.interfaces.find((i) => i.flowName === "Republié")!;
    expect(iface.comments).toContain("note");
    expect(iface.comments).toContain("Introuvable");
  });
});
