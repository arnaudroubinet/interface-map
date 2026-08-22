import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { buildFunctionalFlows, chainesCoupees, unionReading } from "./reading";
import type { ParsedModel, Actor, ActorType, InterfaceCatalogue, Consumption, Milestone } from "../parsing/model";
import { SCHEMA_VERSION } from "../parsing/build-model";

// Positional factories: in this file it is the CHAINS one reads, and a chain
// is better told as "who publishes what towards whom" than through overrides.
function actor(name: string, actorType: string): Actor {
  return base.actor({ name, actorType });
}

function iface(flowName: string, providerName: string, legacyRelays = ""): InterfaceCatalogue {
  return base.iface({ flowName, providerName, legacyRelays, expectedSheet: `FX_${providerName}_HTTP` });
}

// The fourth argument is v4's novelty: the consumption says under which of its
// consumer's interfaces it is republished. That is what replaces the Relays
// cell, and what a drop-down can guide.
// The fourth argument is v4's novelty: the consumption says under which of its
// consumer's interfaces it is republished.
function consumption(flowName: string, consumerName: string, provider: string, republishedAs = ""): Consumption {
  return base.consumption({ flowName, consumerName, republishedAs, sheet: `FX_${provider}_HTTP` });
}

const TYPES: ActorType[] = [
  { type: "Application", icon: "", nature: "Business", sheet: "ActorTypes", row: 0 },
  { type: "Middleware", icon: "", nature: "Technical", sheet: "ActorTypes", row: 0 },
];

function model(o: Partial<ParsedModel> = {}): ParsedModel {
  return base.template({ actorTypes: TYPES, flowTypes: [base.flowType()], ...o });
}

// Tatooine ─► Bus ─► Naboo, the bus being technical.
function unRelais(): ParsedModel {
  return model({
    actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware"), actor("Naboo", "Application")],
    interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus")],
    consumptions: [consumption("Transactions", "Bus", "Tatooine", "trx.norm"), consumption("trx.norm", "Naboo", "Bus")],
  });
}

const MILESTONES: Milestone[] = [
  { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
  { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
];

// Alderaan ─► Bus ─► ETL ─► Coruscant, the segment carried by the Bus (cmd.raw) retired at v2.
function aRelayWithRetiredSegment(): ParsedModel {
  const m = model({
    actors: [actor("Alderaan", "Application"), actor("Bus", "Middleware"), actor("ETL", "Middleware"), actor("Coruscant", "Application")],
    interfaces: [iface("Commandes", "Alderaan"), iface("cmd.raw", "Bus"), iface("CMD_D", "ETL")],
    consumptions: [consumption("Commandes", "Bus", "Alderaan", "cmd.raw"), consumption("cmd.raw", "ETL", "Bus", "CMD_D"), consumption("CMD_D", "Coruscant", "ETL")],
    milestones: MILESTONES,
  });
  m.interfaces[1].retiredAt = "v2";
  return m;
}

describe("buildFunctionalFlows", () => {
  it("links the business source to the business consumer through a relay", () => {
    const flows = buildFunctionalFlows(unRelais(), null);
    expect(flows).toHaveLength(1);
    expect([flows[0].provider, flows[0].consumer]).toEqual(["Tatooine", "Naboo"]);
  });

  // The business name is the one the producer gives its data, not that of the
  // technical segment that carries it.
  it("names the link after the interface at the source", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].interfaceName).toBe("Transactions");
  });

  // With no technology, the line-merging key no longer takes it into account.
  it("empties the technology", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].flowType).toBe("");
  });

  it("points the arrow from provider to consumer", () => {
    expect(buildFunctionalFlows(unRelais(), null)[0].direction).toBe("provider-to-consumer");
  });

  it("follows a chain of any length", () => {
    const m = model({
      actors: [actor("Alderaan", "Application"), actor("Bus", "Middleware"), actor("ETL", "Middleware"), actor("Coruscant", "Application")],
      interfaces: [iface("Commandes", "Alderaan"), iface("cmd.raw", "Bus"), iface("CMD_D", "ETL")],
      consumptions: [consumption("Commandes", "Bus", "Alderaan", "cmd.raw"), consumption("cmd.raw", "ETL", "Bus", "CMD_D"), consumption("CMD_D", "Coruscant", "ETL")],
    });
    const flows = buildFunctionalFlows(m, null);
    expect(flows).toHaveLength(1);
    expect([flows[0].provider, flows[0].consumer]).toEqual(["Alderaan", "Coruscant"]);
  });

  // The case that justifies the whole mechanism: two flows in one bus must not
  // cross.
  it("does not cross two flows going through the same bus", () => {
    const m = model({
      actors: [actor("Tatooine", "Application"), actor("Alderaan", "Application"), actor("Bus", "Middleware"), actor("Naboo", "Application"), actor("Coruscant", "Application")],
      interfaces: [
        iface("Transactions", "Tatooine"), iface("Référentiel", "Alderaan"),
        iface("trx.norm", "Bus"), iface("ref.norm", "Bus"),
      ],
      consumptions: [
        consumption("Transactions", "Bus", "Tatooine", "trx.norm"), consumption("Référentiel", "Bus", "Alderaan", "ref.norm"),
        consumption("trx.norm", "Naboo", "Bus"), consumption("ref.norm", "Coruscant", "Bus"),
      ],
    });
    const links = buildFunctionalFlows(m, null).map((f) => `${f.provider}→${f.consumer}`).sort();
    expect(links).toEqual(["Alderaan→Coruscant", "Tatooine→Naboo"]);
  });

  it("produces one link per business consumer on a broadcast", () => {
    const m = model({
      actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware"), actor("Coruscant", "Application"), actor("Hoth", "Application")],
      interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus")],
      consumptions: [consumption("Transactions", "Bus", "Tatooine", "trx.norm"), consumption("trx.norm", "Coruscant", "Bus"), consumption("trx.norm", "Hoth", "Bus")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => f.consumer).sort()).toEqual(["Coruscant", "Hoth"]);
  });

  it("keeps an exchange between two business actors as it is", () => {
    const m = model({
      actors: [actor("Tatooine", "Application"), actor("Mygeeto", "Application")],
      interfaces: [iface("Authent", "Tatooine")],
      consumptions: [consumption("Authent", "Mygeeto", "Tatooine")],
    });
    const flows = buildFunctionalFlows(m, null);
    expect([flows[0].provider, flows[0].consumer]).toEqual(["Tatooine", "Mygeeto"]);
  });

  it("produces nothing when nothing feeds the republished interface", () => {
    const m = unRelais();
    m.consumptions[0].republishedAs = "";
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });

  it("produces nothing when the republication names an unknown interface", () => {
    const m = unRelais();
    m.consumptions[0].republishedAs = "Fantôme";
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });

  // Without a guard, the walk would spin forever.
  it("stops on a chain that loops", () => {
    const m = model({
      actors: [actor("Bus", "Middleware"), actor("ETL", "Middleware"), actor("Coruscant", "Application")],
      interfaces: [iface("a", "Bus"), iface("b", "ETL")],
      consumptions: [consumption("a", "Coruscant", "Bus"), consumption("b", "Bus", "ETL", "a"), consumption("a", "ETL", "Bus", "b")],
    });
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });

  // The milestone applies first: a chain with a segment retired at that
  // milestone produces no link -- that is what the Changes view compares.
  it("cuts the chain at the milestone where the intermediate segment is retired", () => {
    const m = aRelayWithRetiredSegment();
    expect(buildFunctionalFlows(m, 1)).toHaveLength(1);
    expect(buildFunctionalFlows(m, 2)).toHaveLength(0);
  });

  it("ignores a segment's retirement when no milestone is displayed", () => {
    expect(buildFunctionalFlows(aRelayWithRetiredSegment(), null)).toHaveLength(1);
  });

  it("does not draw a link whose source is the consumer", () => {
    const m = model({
      actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware")],
      interfaces: [iface("Transactions", "Tatooine"), iface("trx.norm", "Bus")],
      consumptions: [consumption("Transactions", "Bus", "Tatooine", "trx.norm"), consumption("trx.norm", "Tatooine", "Bus")],
    });
    expect(buildFunctionalFlows(m, null)).toHaveLength(0);
  });
});

describe("chainesCoupees", () => {
  it("names the republished interface that nothing feeds", () => {
    const m = unRelais();
    m.consumptions[0].republishedAs = "";
    const cut = chainesCoupees(m, null);
    expect(cut).toHaveLength(1);
    expect(cut[0].reason).toBe("no-input");
    expect(cut[0].iface.flowName).toBe("trx.norm");
  });

  it("also names the one whose only input points at an unknown interface", () => {
    const m = unRelais();
    m.consumptions[0].republishedAs = "Fantôme";
    expect(chainesCoupees(m, null)[0].reason).toBe("no-input");
  });

  it("reports nothing on a whole chain", () => {
    expect(chainesCoupees(unRelais(), null)).toEqual([]);
  });

  // Nothing reads consumption: the integrity report (the only caller) never
  // names the consumption, only the interface where the chain breaks.
  it("does not carry the consumption, which nothing reads", () => {
    const m = unRelais();
    m.consumptions[0].republishedAs = "";
    expect(chainesCoupees(m, null)[0]).not.toHaveProperty("conso");
  });

  // A segment retired at the milestone leaves the republished interface with no
  // live input: exactly the same situation as an input never entered, and no
  // caller tells the two apart.
  it("reports a segment retired at the milestone as an interface with no input", () => {
    const cut = chainesCoupees(aRelayWithRetiredSegment(), 2);
    expect(cut).toHaveLength(1);
    expect(cut[0].reason).toBe("no-input");
  });
});

// --- QA: the walk-up checked the upstream SEGMENT's life but never that of the
// ACTOR publishing it. At the milestone where Tatooine is retired, the
// functional view still drew "Tatooine ─► Naboo"; and since the actors returned
// come from reading(), Tatooine was no longer in it and came out as a group
// box -- with no icon, no type, outside its boundary.
describe("walk-up — the source actor must be alive at the milestone, not only its segment", () => {
  const withTatooineRetired = () => {
    const m = unRelais();
    return {
      ...m,
      milestones: MILESTONES,
      actors: m.actors.map((a) => (a.name === "Tatooine" ? { ...a, retiredAt: "v1" } : a)),
    };
  };

  it("no longer returns a flow whose source actor is retired", () => {
    const flows = buildFunctionalFlows(withTatooineRetired(), 1);
    expect(flows.map((f) => f.provider)).not.toContain("Tatooine");
  });

  it("returns it as long as the actor is alive", () => {
    const flows = buildFunctionalFlows(withTatooineRetired(), 0);
    expect(flows.map((f) => f.provider)).toContain("Tatooine");
  });
});

// --- QA: the relay names a flow by its name alone, and the walk-up looked for
// it in the WHOLE catalogue. Yet what the technical actor relays, it consumes
// -- and its consumptions say from whom and in which version. Looking elsewhere
// is guessing, and the tool guessed badly in silence.
// --- QA: republication is carried by the CONSUMPTION ROW, which alone knows
// which provider and which version the input comes from. v3 carried it on the
// interface row, as a flow name looked up across the whole catalogue: it took
// the first one it met, hence sometimes the wrong publisher or the wrong
// version, in silence.
describe("walk-up — the input names its provider and its version", () => {
  const estate = (o: Partial<ParsedModel>) =>
    model({
      actors: [actor("A", "Application"), actor("B", "Application"), actor("X", "Middleware"), actor("C", "Application")],
      ...o,
    });

  // Two actors publish a flow of the same name -- that is legitimate. The bus
  // consumes only one: that one, and not the other, is what feeds C.
  it("follows the consumption's publisher, not a namesake from the catalogue", () => {
    const m = estate({
      interfaces: [iface("f0", "A"), iface("f0", "B"), iface("f1", "X")],
      consumptions: [consumption("f0", "X", "B", "f1"), consumption("f1", "C", "X")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => f.provider)).toEqual(["B"]);
  });

  it("follows the version actually consumed", () => {
    const m = estate({
      interfaces: [
        { ...iface("f0", "A"), version: "1.0" },
        { ...iface("f0", "A"), version: "2.0" },
        iface("f1", "X"),
      ],
      consumptions: [{ ...consumption("f0", "X", "A", "f1"), version: "2.0" }, consumption("f1", "C", "X")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => f.version)).toEqual(["2.0"]);
  });

  it("lets a sound multi-hop chain through", () => {
    const m = model({
      actors: [actor("A", "Application"), actor("X", "Middleware"), actor("Y", "Middleware"), actor("C", "Application")],
      interfaces: [iface("f0", "A"), iface("f1", "X"), iface("f2", "Y")],
      consumptions: [consumption("f0", "X", "A", "f1"), consumption("f1", "Y", "X", "f2"), consumption("f2", "C", "Y")],
    });
    expect(buildFunctionalFlows(m, null).map((f) => `${f.provider}→${f.consumer}`)).toEqual(["A→C"]);
  });
});

// --- QA: a bus aggregates. It consumes several flows and republishes them
// under one. Carried by the consumption, this case needs no syntax: it is
// simply several rows naming the same interface.
describe("walk-up — a relayer aggregating several sources", () => {
  const estate = (republications: [string, string][]) =>
    model({
      actors: [actor("A", "Application"), actor("B", "Application"), actor("X", "Middleware"), actor("C", "Application")],
      interfaces: [iface("f0", "A"), iface("g0", "B"), iface("f1", "X")],
      consumptions: [
        consumption("f0", "X", "A", republications[0][1]),
        consumption("g0", "X", "B", republications[1][1]),
        consumption("f1", "C", "X"),
      ],
    });

  it("follows every input republished under the same interface", () => {
    const flows = buildFunctionalFlows(estate([["f0", "f1"], ["g0", "f1"]]), null);
    expect(flows.map((f) => `${f.provider}→${f.consumer}`).sort()).toEqual(["A→C", "B→C"]);
  });

  it("follows only one when only one is republished", () => {
    expect(buildFunctionalFlows(estate([["f0", "f1"], ["g0", ""]]), null).map((f) => f.provider)).toEqual(["A"]);
  });

  // Two branches walking up to the same source make a single link: without
  // deduplication the line would count the same exchange twice.
  it("does not count twice a source reached by two paths", () => {
    const m = model({
      actors: [actor("A", "Application"), actor("X", "Middleware"), actor("Y", "Middleware"), actor("Z", "Middleware"), actor("C", "Application")],
      interfaces: [iface("f0", "A"), iface("f1", "X"), iface("f2", "Y"), iface("f3", "Z")],
      consumptions: [
        consumption("f0", "X", "A", "f1"), consumption("f0", "Y", "A", "f2"),
        consumption("f1", "Z", "X", "f3"), consumption("f2", "Z", "Y", "f3"),
        consumption("f3", "C", "Z"),
      ],
    });
    expect(buildFunctionalFlows(m, null)).toHaveLength(1);
  });
});


// --- §2.4: the layout is done over the UNION of all milestones, then each
// milestone shows only its subset. Without that, three extra edges were enough
// to move the same thirteen boxes by a median of 400 px.
describe("lectureUnion", () => {
  const estate = () =>
    base.template({
      milestones: [base.milestone({ name: "v1", rank: 1 }), base.milestone({ name: "v2", rank: 2 })],
      groups: [base.group({ name: "G" })],
      actorTypes: [base.actorType()],
      flowTypes: [base.flowType()],
      fxSheetNames: ["FX_A_HTTP"],
      actors: [
        base.actor({ name: "A", introducedAt: "v1" }),
        base.actor({ name: "B", introducedAt: "v1" }),
        base.actor({ name: "Tardif", introducedAt: "v2" }),
      ],
      interfaces: [base.iface({ flowName: "F", providerName: "A", expectedSheet: "FX_A_HTTP" })],
      consumptions: [
        base.consumption({ flowName: "F", consumerName: "B", sheet: "FX_A_HTTP", introducedAt: "v1", retiredAt: "v2" }),
        base.consumption({ flowName: "F", consumerName: "Tardif", sheet: "FX_A_HTTP", introducedAt: "v2" }),
      ],
    });

  it("unites the actors of every milestone, including those arriving later", () => {
    expect(unionReading(estate(), "architecture").actors.map((a) => a.name).sort()).toEqual(["A", "B", "Tardif"]);
  });

  it("unites the flows of every milestone, including those that disappear", () => {
    const consumers = unionReading(estate(), "architecture").flows.map((f) => f.consumer).sort();
    expect(consumers).toEqual(["B", "Tardif"]);
  });

  // One flow alive at two milestones must not count twice: the board would lay
  // out two overlapping lines.
  it("does not duplicate a flow alive at several milestones", () => {
    const m = estate();
    m.consumptions[0].retiredAt = "";
    expect(unionReading(m, "architecture").flows).toHaveLength(2);
  });

  // A workbook with no milestone has nothing to unite: the ordinary reading is
  // enough, and manufacturing an empty union would erase the whole estate.
  it("falls back to the ordinary reading when the workbook declares no milestone", () => {
    const m = base.template({ ...estate(), milestones: [] });
    expect(unionReading(m, "architecture").actors).toHaveLength(3);
  });
});
