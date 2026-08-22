import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { computeChanges, buildEcartsView } from "./changes";
import { SCHEMA_VERSION } from "../parsing/build-model";
import type { ParsedModel, Actor, InterfaceCatalogue, Consumption } from "../parsing/model";

// Everything is dated v1 in this file: it is between two milestones that it compares.
function actor(o: Partial<Actor> = {}): Actor {
  return base.actor({ group: "G1", introducedAt: "v1", ...o });
}
function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return base.iface({ introducedAt: "v1", ...o });
}
function consumption(o: Partial<Consumption> = {}): Consumption {
  return base.consumption({ legacyStatus: "Actif", decision: "Keep", introducedAt: "v1", ...o });
}

const milestones = [
  { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
  { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
];

function model(o: Partial<ParsedModel> = {}): ParsedModel {
  return {
    actors: [actor({ name: "A" }), actor({ name: "B" })],
    groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }],
    groupsSheetMissing: false,
    actorTypes: [],
    milestones,
    flowTypes: [base.flowType({ type: "HTTP", rawDirection: "" })],
    interfaces: [iface({})],
    consumptions: [consumption({})],
    fxSheetNames: ["FX_A_HTTP"],
    missingOptionalColumns: [],
    schemaVersion: SCHEMA_VERSION,
    savedAt: null,
    referentialActors: [],
    referentialTechnologies: [],
    ...o,
  };
}

// One side of a comparison, when both sides are two ranks of the SAME file --
// which is what this whole file, written before A6, is about.
const at = (m: ParsedModel, rank: number) => ({ model: m, rank });

describe("computeChanges", () => {
  it("says nothing changed between two ranks when nothing moved", () => {
    const e = computeChanges(at(model(), 1), at(model(), 2), "architecture");
    expect(e.actors).toEqual({ ajoutes: [], retires: [] });
    expect(e.interfaces).toEqual({ ajoutes: [], retires: [] });
    expect(e.consumptions).toEqual({ ajoutes: [], retires: [] });
  });

  it("names an acteur that arrives", () => {
    const m = model({ actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C", introducedAt: "v2" })] });
    expect(computeChanges(at(m, 1), at(m, 2), "architecture").actors.ajoutes).toEqual(["C"]);
  });

  it("names an acteur that leaves", () => {
    const m = model({ actors: [actor({ name: "A" }), actor({ name: "B", retiredAt: "v2" })] });
    expect(computeChanges(at(m, 1), at(m, 2), "architecture").actors.retires).toEqual(["B"]);
  });

  it("names an interface that arrives, with its version", () => {
    const m = model({
      interfaces: [iface({}), iface({ version: "2.0", introducedAt: "v2" })],
    });
    expect(computeChanges(at(m, 1), at(m, 2), "architecture").interfaces.ajoutes).toEqual(["F 2.0"]);
  });

  it("names a consumption by the pair it creates", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C" })],
      consumptions: [consumption({}), consumption({ consumerName: "C", introducedAt: "v2" })],
    });
    expect(computeChanges(at(m, 1), at(m, 2), "architecture").consumptions.ajoutes).toEqual(["C → F"]);
  });

  // Reading the change backwards must give the inverse, otherwise the two
  // selectors' reading direction would be ambiguous.
  it("reads backwards as the mirror of forwards", () => {
    const m = model({ actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C", introducedAt: "v2" })] });
    expect(computeChanges(at(m, 2), at(m, 1), "architecture").actors.retires).toEqual(["C"]);
  });
});

describe("buildEcartsView", () => {
  // The diagram's real contribution: a link that exists on both sides but whose
  // volume changed. The binary marking let it through in silence.
  it("labels a link whose volume dropped with the delta, not with its count", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C", group: "G2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
      consumptions: [
        consumption({ consumerName: "B" }),
        consumption({ consumerName: "C", retiredAt: "v2" }),
      ],
    });
    const edge = buildEcartsView(at(m, 1), at(m, 2), "architecture").edges[0];
    expect(edge.label).toBe("−1");
    expect(edge.change).toBe("removed");
  });

  it("labels a link whose volume grew with a signed delta", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C", group: "G2", introducedAt: "v2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
      consumptions: [consumption({}), consumption({ consumerName: "C", introducedAt: "v2" })],
    });
    const edge = buildEcartsView(at(m, 1), at(m, 2), "architecture").edges[0];
    expect(edge.label).toBe("+1");
    expect(edge.change).toBe("added");
  });

  // The diagram shows ONLY the change: mixing the unchanged links in with the
  // rest would drown the few lines that carry information.
  it("drops an unchanged link entirely", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B", group: "G2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
    });
    expect(buildEcartsView(at(m, 1), at(m, 2), "architecture").edges).toEqual([]);
  });

  // The base is "platform detail": one wants to know WHICH component gained or
  // lost a flow, not merely which group.
  it("names the platform components rather than collapsing them into their group", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B", group: "G2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
      consumptions: [consumption({ retiredAt: "v2" })],
    });
    const view = buildEcartsView(at(m, 1), at(m, 2), "architecture");
    // A is in the Platform group: it is named, not folded into "G1".
    expect(view.nodes.map((n) => n.id)).toContain("A");
    expect(view.nodes.map((n) => n.id)).not.toContain("G1");
  });

  // The boundary is a parent node: pruning its children without it would leave
  // nodes pointing at a container that is no longer there.
  it("never leaves a node pointing at a boundary it dropped", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B", group: "G2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
      consumptions: [consumption({ retiredAt: "v2" })],
    });
    const view = buildEcartsView(at(m, 1), at(m, 2), "architecture");
    const ids = new Set(view.nodes.map((n) => n.id));
    for (const n of view.nodes) {
      if (n.parent) expect(ids.has(n.parent)).toBe(true);
    }
  });

  it("keeps only the nodes the remaining links need", () => {
    const m = model({
      actors: [
        actor({ name: "A" }),
        actor({ name: "B", group: "G2" }),
        actor({ name: "C", group: "G3" }),
        actor({ name: "D", group: "G3" }),
      ],
      groups: [
        { name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 },
        { name: "G2", perimeter: "External", sheet: "Groups", row: 0 },
        { name: "G3", perimeter: "External", sheet: "Groups", row: 0 },
      ],
      // G3 exchanges with G1 without changing anything: it must not be drawn.
      interfaces: [iface({}), iface({ flowName: "F2", providerName: "C", expectedSheet: "FX_C_HTTP" })],
      consumptions: [
        consumption({ retiredAt: "v2" }),
        consumption({ flowName: "F2", consumerName: "D", sheet: "FX_C_HTTP" }),
      ],
      fxSheetNames: ["FX_A_HTTP", "FX_C_HTTP"],
    });
    const view = buildEcartsView(at(m, 1), at(m, 2), "architecture");
    // A is named (Platform), B folded onto G2; G3 did not move, so it drops out.
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["A", "G2"]);
  });

  it("marks an edge that only exists after as an addition", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C", group: "G2", introducedAt: "v2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
      consumptions: [consumption({}), consumption({ consumerName: "C", introducedAt: "v2" })],
    });
    const view = buildEcartsView(at(m, 1), at(m, 2), "architecture");
    expect(view.edges.some((e) => e.change === "added")).toBe(true);
  });

  it("marks an edge that only existed before as a removal", () => {
    const m = model({ consumptions: [consumption({ retiredAt: "v2" })] });
    const view = buildEcartsView(at(m, 1), at(m, 2), "architecture");
    expect(view.edges.every((e) => e.change === "removed")).toBe(true);
  });

  it("leaves an unchanged edge unmarked", () => {
    const view = buildEcartsView(at(model(), 1), at(model(), 2), "architecture");
    expect(view.edges.every((e) => e.change === undefined)).toBe(true);
  });

  // Without the departure milestone's nodes, a removed line would have no box
  // left to reach and the diagram would be inconsistent.
  it("keeps the nodes a removed edge needs", () => {
    const m = model({ consumptions: [consumption({ retiredAt: "v2" })] });
    const view = buildEcartsView(at(m, 1), at(m, 2), "architecture");
    for (const e of view.edges) {
      expect(view.nodes.map((n) => n.id)).toContain(e.from);
      expect(view.nodes.map((n) => n.id)).toContain(e.to);
    }
  });
});

// Tatooine publishes Transactions, Bus (Middleware, Technical) relays it as
// trx.norm; the segment towards Naboo appears only at milestone v2.
function functionalEstate(): ParsedModel {
  return model({
    actors: [
      actor({ name: "Tatooine" }),
      actor({ name: "Bus", actorType: "Middleware" }),
      actor({ name: "Naboo" }),
    ],
    actorTypes: [
      { type: "Application", icon: "", nature: "Business", sheet: "ActorTypes", row: 0 },
      { type: "Middleware", icon: "", nature: "Technical", sheet: "ActorTypes", row: 0 },
    ],
    interfaces: [
      iface({ flowName: "Transactions", providerName: "Tatooine", expectedSheet: "FX_Tatooine_HTTP" }),
      iface({ flowName: "trx.norm", providerName: "Bus", expectedSheet: "FX_Bus_HTTP" }),
    ],
    consumptions: [
      consumption({ flowName: "Transactions", consumerName: "Bus", sheet: "FX_Tatooine_HTTP", republishedAs: "trx.norm" }),
      consumption({ flowName: "trx.norm", consumerName: "Naboo", sheet: "FX_Bus_HTTP", introducedAt: "v2" }),
    ],
    fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
  });
}

describe("calculerEcarts — mode fonctionnel", () => {
  it("compares the functional links when the mode asks for it", () => {
    // A link that exists only at the second milestone shows up as an addition,
    // with the plumbing removed.
    const changes = computeChanges(at(functionalEstate(), 1), at(functionalEstate(), 2), "functional");
    expect(changes.consumptions.ajoutes).toEqual(["Naboo → Transactions"]);
  });
});

// --- A6: the same difference, between two FILES rather than two milestones of
// one. "What has changed since January's version of the referential" is the
// question a mapping gets asked most often, and the model was implicit in the
// computation -- so the answer could only ever be about one workbook.
describe("computeChanges — two workbooks", () => {
  // Two versions of one referential, six months apart. Nothing here shares a
  // milestone: that is the normal case, and why both sides read whole.
  function january(): ParsedModel {
    return model({
      milestones: [],
      actors: [actor({ name: "A", introducedAt: "" }), actor({ name: "B", introducedAt: "" })],
      interfaces: [iface({ flowName: "Legacy batch", version: "1.0", introducedAt: "" })],
      consumptions: [consumption({ flowName: "Legacy batch", version: "1.0", consumerName: "B", introducedAt: "" })],
    });
  }

  function june(): ParsedModel {
    return model({
      milestones: [],
      actors: [actor({ name: "A", introducedAt: "" }), actor({ name: "C", introducedAt: "" })],
      interfaces: [iface({ flowName: "Claims", version: "2.0", introducedAt: "" })],
      consumptions: [consumption({ flowName: "Claims", version: "2.0", consumerName: "C", introducedAt: "" })],
    });
  }

  const whole = (m: ParsedModel) => ({ model: m, rank: null });

  it("compares two distinct models, not merely two ranks of the same one", () => {
    const c = computeChanges(whole(january()), whole(june()), "architecture");
    expect(c.interfaces.ajoutes).toContain("Claims 2.0");
    expect(c.interfaces.retires).toContain("Legacy batch 1.0");
  });

  // An actor present in only one of the two must not break the computation:
  // that is the NORMAL case when comparing two versions of a referential.
  it("bears an actor absent from one of the two workbooks", () => {
    const c = computeChanges(whole(january()), whole(june()), "architecture");
    expect(c.actors.ajoutes).toEqual(["C"]);
    expect(c.actors.retires).toEqual(["B"]);
  });

  it("names the consumption pairs that arrived and those that left", () => {
    const c = computeChanges(whole(january()), whole(june()), "architecture");
    expect(c.consumptions.ajoutes).toEqual(["C → Claims 2.0"]);
    expect(c.consumptions.retires).toEqual(["B → Legacy batch 1.0"]);
  });

  // A rank of `null` means "the whole file", with no milestone filter. Two
  // workbooks have no reason to share a milestone name, and picking one on
  // either side would state an equivalence nobody entered.
  it("reads each side whole when neither carries a rank", () => {
    const c = computeChanges(whole(january()), whole(january()), "architecture");
    expect(c.actors).toEqual({ ajoutes: [], retires: [] });
    expect(c.interfaces).toEqual({ ajoutes: [], retires: [] });
    expect(c.consumptions).toEqual({ ajoutes: [], retires: [] });
  });

  // The diagram must survive the same crossing: its nodes come from both sides,
  // and a box that exists in only one of the two workbooks is the whole point.
  it("draws the change between two workbooks", () => {
    const view = buildEcartsView(whole(january()), whole(june()), "architecture");
    expect(view.edges.map((e) => [e.from, e.to, e.change])).toEqual(
      expect.arrayContaining([
        ["A", "B", "removed"],
        ["A", "C", "added"],
      ])
    );
    expect(view.nodes.map((n) => n.id)).toEqual(expect.arrayContaining(["A", "B", "C"]));
  });
});
