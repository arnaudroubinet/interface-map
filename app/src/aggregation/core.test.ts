import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import {
  buildFlowInstances,
  groupFlows,
  cellLabel,
  aggregateEdges,
  nodesFromEdges,
  identityNodeKey,
  groupNodeKey,
} from "./core";
import { SCHEMA_VERSION } from "../parsing/build-model";
import type { ParsedModel, Actor, InterfaceCatalogue, Consumption } from "../parsing/model";

// The shared factories, with only the defaults particular to this file: two
// groups G1/G2, and a consumption already decided.
function actor(o: Partial<Actor> = {}): Actor {
  return base.actor({ group: "G1", ...o });
}
const iface = base.iface;
function consumption(o: Partial<Consumption> = {}): Consumption {
  return base.consumption({ legacyStatus: "Actif", decision: "Keep", ...o });
}
function model(o: Partial<ParsedModel> = {}): ParsedModel {
  return base.template({
    actors: [actor({ name: "A", group: "G1" }), actor({ name: "B", group: "G2" })],
    groups: [base.group({ name: "G1" }), base.group({ name: "G2", perimeter: "External" })],
    actorTypes: [base.actorType()],
    flowTypes: [base.flowType()],
    interfaces: [iface()],
    consumptions: [consumption()],
    fxSheetNames: ["FX_A_HTTP"],
    ...o,
  });
}

describe("buildFlowInstances", () => {
  it("joins interfaces and consumptions and resolves direction", () => {
    const flows = buildFlowInstances(model({}));
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ provider: "A", consumer: "B", direction: "consumer-to-provider" });
  });

  it("skips a consumption whose flow name has no matching interface", () => {
    const flows = buildFlowInstances(model({ consumptions: [consumption({ flowName: "Fantome" })] }));
    expect(flows).toHaveLength(0);
  });







  it("attaches a consumption to the version it declares, not to another version of the same flux", () => {
    const flows = buildFlowInstances(
      model({
        interfaces: [iface({ version: "1.0" }), iface({ version: "2.0", legacyState: "Retiré" })],
        consumptions: [consumption({ version: "1.0" })],
      })
    );
    expect(flows).toHaveLength(1);
    expect(flows[0].interfaceName).toBe("F");
  });

  it("marks a flow dimmed when Decision=Transform", () => {
    const flows = buildFlowInstances(model({ consumptions: [consumption({ decision: "Transform" })] }));
    expect(flows[0].attenuated).toBe(true);
  });


  it("attaches a consumption to the interface on its own tab, not just any interface sharing its name", () => {
    // Two catalog interfaces share the name "F" but live on different tabs —
    // an already-anomalous (7.1 duplicate) but possible mid-edit state. The
    // consumption is filed under the FIRST interface's tab (FX_A_HTTP) —
    // a Map keyed by name alone (the pre-fix behaviour) always keeps the
    // LAST-inserted entry ("C"/Kafka) and would wrongly resolve to that one;
    // only a (sheet, flow name) lookup (§3.3) resolves to "A"/HTTP here.
    const flows = buildFlowInstances(
      model({
        flowTypes: [
          base.flowType({ type: "HTTP" }),
          base.flowType({ type: "Kafka", direction: "provider-to-consumer", rawDirection: "provider → consumer" }),
        ],
        interfaces: [
          iface({ flowName: "F", providerName: "A", flowType: "HTTP", expectedSheet: "FX_A_HTTP" }),
          iface({ flowName: "F", providerName: "C", flowType: "Kafka", expectedSheet: "FX_C_Kafka" }),
        ],
        actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C" })],
        consumptions: [consumption({ flowName: "F", sheet: "FX_A_HTTP", consumerName: "B" })],
      })
    );
    expect(flows).toHaveLength(1);
    expect(flows[0]).toMatchObject({ provider: "A", flowType: "HTTP" });
  });
});

describe("groupFlows", () => {
  it("deduplicates by (from, to, technologie) and counts consumptions", () => {
    const flows = buildFlowInstances(
      model({
        interfaces: [iface({ flowName: "F1" }), iface({ flowName: "F2" })],
        consumptions: [consumption({ flowName: "F1" }), consumption({ flowName: "F2" })],
      })
    );
    const groups = groupFlows(flows, identityNodeKey, true);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it("masks self-loops when maskLoops is true", () => {
    const flows = buildFlowInstances(model({ consumptions: [consumption({ consumerName: "A" })] }));
    expect(groupFlows(flows, identityNodeKey, true)).toHaveLength(0);
  });

  it("keeps self-loops when maskLoops is false", () => {
    const flows = buildFlowInstances(model({ consumptions: [consumption({ consumerName: "A" })] }));
    expect(groupFlows(flows, identityNodeKey, false)).toHaveLength(1);
  });


  it("marks a group attenuated only when every merged flow is attenuated", () => {
    const flows = buildFlowInstances(
      model({
        interfaces: [iface({ flowName: "F1" }), iface({ flowName: "F2" })],
        consumptions: [consumption({ flowName: "F1", decision: "Transform" }), consumption({ flowName: "F2", decision: "Keep" })],
      })
    );
    expect(groupFlows(flows, identityNodeKey, true)[0].attenuated).toBe(false);
  });

  it("never merges opposite-direction flows into one bidirectional edge", () => {
    const flows = buildFlowInstances(
      model({
        interfaces: [iface({ flowName: "F1", providerName: "A" }), iface({ flowName: "F2", providerName: "B" })],
        consumptions: [consumption({ flowName: "F1", consumerName: "B" }), consumption({ flowName: "F2", consumerName: "A" })],
      })
    );
    const groups = groupFlows(flows, identityNodeKey, true);
    expect(groups).toHaveLength(2);
    expect(groups.some((g) => g.from === "B" && g.to === "A")).toBe(true);
    expect(groups.some((g) => g.from === "A" && g.to === "B")).toBe(true);
  });
});

describe("aggregateEdges", () => {
  it("shows the counter in the label only when compteurs is on and count > 1", () => {
    const flows = buildFlowInstances(
      model({
        interfaces: [iface({ flowName: "F1" }), iface({ flowName: "F2" })],
        consumptions: [consumption({ flowName: "F1" }), consumption({ flowName: "F2" })],
      })
    );
    const withCounter = aggregateEdges(flows, identityNodeKey, { counters: true }, true);
    const withoutCounter = aggregateEdges(flows, identityNodeKey, { counters: false }, true);
    expect(withCounter[0].label).toBe("HTTP ×2");
    expect(withoutCounter[0].label).toBe("HTTP");
  });

  // In functional mode, flowType is emptied (§4.2). The label first read " ×2"
  // -- a counter preceded by a phantom space -- then plain "2", which taught
  // nothing more. It is the exchanges that carry the meaning once the medium
  // is gone.
  it("names the exchanges when the technology is empty", () => {
    const flow = (flowName: string): ReturnType<typeof buildFlowInstances>[number] => ({
      interfaceName: flowName,
      version: "",
      flowType: "",
      provider: "A",
      consumer: "B",
      direction: "provider-to-consumer",
      attenuated: false,
      iface: iface({ flowName }),
      consumption: consumption({ flowName }),
    });
    const edges = aggregateEdges([flow("F1"), flow("F2")], identityNodeKey, { counters: true }, true);
    expect(edges[0].label).toBe("F1, F2");
    expect(edges[0].names).toEqual(["F1", "F2"]);
  });
});

describe("groupNodeKey", () => {
  it("resolves an actor to its groupe", () => {
    const key = groupNodeKey(model({}));
    expect(key("A")).toBe("G1");
    expect(key("B")).toBe("G2");
  });

  it("resolves an actor with no groupe to the empty sentinel", () => {
    const key = groupNodeKey(model({ actors: [actor({ name: "A", group: "" }), actor({ name: "B" })] }));
    expect(key("A")).toBe("");
  });
});

describe("groupFlows — groupe vide", () => {
  it("excludes a flow whose actor has no groupe from an aggregated view (§7.4)", () => {
    const withoutGroup = model({ actors: [actor({ name: "A", group: "" }), actor({ name: "B" })] });
    const flows = buildFlowInstances(withoutGroup);
    expect(groupFlows(flows, groupNodeKey(withoutGroup), true)).toHaveLength(0);
  });
});

describe("nodesFromEdges", () => {
  it("builds one node per distinct endpoint", () => {
    const nodes = nodesFromEdges(
      [{ from: "G1", to: "G2", technology: "HTTP", count: 1, attenuated: false, pulled: false, names: [] }],
      (id) => id,
      () => "group"
    );
    expect(nodes.map((n) => n.id).sort()).toEqual(["G1", "G2"]);
  });
});

describe("buildFlowInstances — filtering by milestone", () => {
  const milestones = [
    { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
    { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
    { name: "v3", rank: 3, label: "", status: "Planned", date: "", description: "", sheet: "Milestones", row: 0 },
  ];

  it("keeps a flow whose whole chain is alive at the rank", () => {
    const m = model({
      milestones,
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [consumption({ introducedAt: "v1" })],
    });
    expect(buildFlowInstances(m, 2)).toHaveLength(1);
  });

  it("drops a flow whose interface is not born yet", () => {
    const m = model({
      milestones,
      interfaces: [iface({ introducedAt: "v3" })],
      consumptions: [consumption({ introducedAt: "v3" })],
    });
    expect(buildFlowInstances(m, 2)).toHaveLength(0);
  });

  // The retirement is exclusive: retired AT v2, the row is already gone there.
  it("drops a flow retired at the very rank displayed", () => {
    const m = model({
      milestones,
      interfaces: [iface({ introducedAt: "v1", retiredAt: "v2" })],
      consumptions: [consumption({ introducedAt: "v1" })],
    });
    expect(buildFlowInstances(m, 2)).toHaveLength(0);
    expect(buildFlowInstances(m, 1)).toHaveLength(1);
  });

  it("drops a flow whose consumer has left, interface still alive", () => {
    const m = model({
      milestones,
      actors: [actor({ name: "A", introducedAt: "v1" }), actor({ name: "B", introducedAt: "v1", retiredAt: "v2" })],
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [consumption({ introducedAt: "v1" })],
    });
    expect(buildFlowInstances(m, 2)).toHaveLength(0);
  });

  it("drops a flow whose exposant has left", () => {
    const m = model({
      milestones,
      actors: [actor({ name: "A", introducedAt: "v1", retiredAt: "v2" }), actor({ name: "B", introducedAt: "v1" })],
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [consumption({ introducedAt: "v1" })],
    });
    expect(buildFlowInstances(m, 2)).toHaveLength(0);
  });

  // A workbook with no milestone declared behaves exactly as before.
  it("keeps everything when no rank is displayed", () => {
    expect(buildFlowInstances(model({}), null)).toHaveLength(1);
  });
});

// --- QA: the (name, version) fallback attached a consumption to the FIRST
// interface carrying that name. Two publishers publishing the same name being
// two distinct interfaces, that fallback had a consumer sign with someone it
// never chose. Better not to resolve: the reference check then says so
// plainly.
describe("resolving a consumption — the name alone does not decide between two publishers", () => {
  const twoPublishers = (consumptionSheet: string) =>
    model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C" })],
      interfaces: [
        iface({ flowName: "Kashyyyk", providerName: "A", expectedSheet: "FX_A_HTTP" }),
        iface({ flowName: "Kashyyyk", providerName: "B", expectedSheet: "FX_B_HTTP" }),
      ],
      consumptions: [consumption({ flowName: "Kashyyyk", consumerName: "C", sheet: consumptionSheet })],
    });

  it("resolves without hesitation when the sheet names the publisher", () => {
    const flows = buildFlowInstances(twoPublishers("FX_B_HTTP"));
    expect(flows.map((f) => f.provider)).toEqual(["B"]);
  });

  it("does not guess when the sheet names nobody", () => {
    expect(buildFlowInstances(twoPublishers("FX_Inconnu_HTTP"))).toHaveLength(0);
  });

  it("still resolves by name when a single publisher carries it", () => {
    const m = twoPublishers("FX_Inconnu_HTTP");
    const flows = buildFlowInstances({ ...m, interfaces: [m.interfaces[0]] });
    expect(flows.map((f) => f.provider)).toEqual(["A"]);
  });
});

// --- QA: in functional mode the technology is emptied on purpose, so that the
// lines of one pair merge. The counter was then left alone, and a line
// announcing "2" teaches neither what travels nor why -- the business view had,
// in that state, no value at all.
describe("cellLabel — what a line with no technology carries", () => {
  it("names the exchanges rather than counting them", () => {
    expect(cellLabel("", 2, ["Member lookup", "Premium calculation"])).toBe("Member lookup, Premium calculation");
  });

  it("beyond two, names the first two and counts the rest", () => {
    expect(cellLabel("", 4, ["A", "B", "C", "D"])).toBe("A, B +2");
  });

  it("keeps the counter alone when no name is known", () => {
    expect(cellLabel("", 3, [])).toBe("3");
  });

  it("changes nothing when the technology is there", () => {
    expect(cellLabel("HTTP", 2, ["A", "B"])).toBe("HTTP ×2");
    expect(cellLabel("HTTP", 1, ["A"])).toBe("HTTP");
  });
});

describe("groupFlows — the exchange names follow the merged line", () => {
  it("gathers the merged flows' names, without duplicates", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B" })],
      interfaces: [iface({ flowName: "F1" }), iface({ flowName: "F2", row: 1 })],
      consumptions: [
        consumption({ flowName: "F1", consumerName: "B" }),
        consumption({ flowName: "F2", consumerName: "B" }),
      ],
    });
    const groups = groupFlows(buildFlowInstances(m), identityNodeKey, true);
    expect(groups).toHaveLength(1);
    expect(groups[0].names.sort()).toEqual(["F1", "F2"]);
  });
});

// --- The line and the arrowhead carried the same information. A pulled flow --
// HTTP, declared "consumer → provider" -- therefore had its LINE reversed as
// well as its head: the data seemed to climb back up the pipe, and a provider
// had nothing coming out of it. The line now follows the data, from provider to
// consumer; only the head says who calls.
describe("directedEndpoints — the line follows the data, the head says the initiative", () => {
  const estate = (direction: "provider-to-consumer" | "consumer-to-provider") =>
    model({
      actors: [actor({ name: "A" }), actor({ name: "B" })],
      flowTypes: [base.flowType({ direction, rawDirection: "" })],
      interfaces: [iface({ providerName: "A" })],
      consumptions: [consumption({ consumerName: "B" })],
    });

  it("goes from provider to consumer, whether pushed or pulled", () => {
    for (const direction of ["provider-to-consumer", "consumer-to-provider"] as const) {
      const g = groupFlows(buildFlowInstances(estate(direction)), identityNodeKey, true);
      expect([g[0].from, g[0].to]).toEqual(["A", "B"]);
    }
  });

  it("marks the line as pulled when the consumer takes the initiative", () => {
    expect(groupFlows(buildFlowInstances(estate("consumer-to-provider")), identityNodeKey, true)[0].pulled).toBe(true);
    expect(groupFlows(buildFlowInstances(estate("provider-to-consumer")), identityNodeKey, true)[0].pulled).toBe(false);
  });
});

// --- A map of PIPES or a map of EXCHANGES: the label said nothing but the
// protocol, and the name of what travels appeared nowhere.
describe("cellLabel — what is written on the line", () => {
  const names = ["Policy events 1.0", "Claims 2.0"];

  it("names the technology alone by default", () => {
    expect(cellLabel("Kafka", 2, names)).toBe("Kafka ×2");
    expect(cellLabel("Kafka", 2, names, "technology")).toBe("Kafka ×2");
  });

  it("names the exchanges when asked to", () => {
    expect(cellLabel("Kafka", 2, names, "exchanges")).toBe("Policy events 1.0, Claims 2.0");
  });

  // The counter stays with the pipe: on a line merging five flows of which
  // two are named, "×5" is the only thing that says how many there are
  // reste.
  it("names both, the exchange first", () => {
    expect(cellLabel("Kafka", 2, names, "both")).toBe("Policy events 1.0, Claims 2.0 — Kafka ×2");
  });

  // Beyond two names the label would eat the drawing: the rest is counted, and
  // reads in the line's tooltip.
  it("stops at two names and counts the rest", () => {
    expect(cellLabel("Kafka", 5, [...names, "A", "B", "C"], "exchanges")).toBe("Policy events 1.0, Claims 2.0 +3");
  });

  // The functional reading empties the technology: "technology" cannot leave a
  // label reduced to a counter, which teaches nothing.
  it("falls back to the exchanges when no technology is named", () => {
    expect(cellLabel("", 1, ["Policy events 1.0"])).toBe("Policy events 1.0");
  });

  // Nothing to name at all: the counter is then the only true information.
  it("keeps the counter when there is neither technology nor name", () => {
    expect(cellLabel("", 3, [], "exchanges")).toBe("3");
  });

  // "both" with no technology must not produce an orphan dash.
  it("writes no dash when there is no technology to join", () => {
    expect(cellLabel("", 2, names, "both")).toBe("Policy events 1.0, Claims 2.0");
  });
});

// --- Sorting this list was tried as a prerequisite for milestone-to-milestone
// stability, and measured: 16% more area on the detailed view for nothing, the
// stability coming from laying out over the union of milestones.
describe("nodesFromEdges", () => {
  const edges = (paires: [string, string][]) =>
    paires.map(([from, to]) => ({ from, to, technology: "HTTP", count: 1, label: "HTTP", attenuated: false }));

  it("neither loses nor duplicates any node", () => {
    const ids = nodesFromEdges(edges([["A", "B"], ["B", "C"], ["A", "C"]]), (id) => id, () => "actor").map((n) => n.id);
    expect(ids).toEqual(["A", "B", "C"]);
  });
});

// --- §A3: criticality has been entered, checked and exported since day one,
// and was never drawn. It is nonetheless the most decision-bearing field of the
// classeur.
describe("groupFlows — the criticality the line carries", () => {
  // An estate where B consumes the same interface several times, each row with
  // its own criticality: that is the case the aggregation must settle.
  const flowsWith = (criticalities: string[]) =>
    buildFlowInstances(
      base.template({
        groups: [base.group({ name: "G" })],
        actorTypes: [base.actorType()],
        flowTypes: [base.flowType()],
        fxSheetNames: ["FX_A_HTTP"],
        actors: [base.actor({ name: "A" }), base.actor({ name: "B" })],
        interfaces: criticalities.map((_, i) =>
          base.iface({ flowName: `F${i}`, providerName: "A", expectedSheet: "FX_A_HTTP" })
        ),
        consumptions: criticalities.map((criticality, i) =>
          base.consumption({ flowName: `F${i}`, consumerName: "B", sheet: "FX_A_HTTP", criticality })
        ),
      })
    );

  it("keeps the strongest criticality of the aggregated consumptions", () => {
    const g = groupFlows(flowsWith(["3 - Standard", "1 - Critical", "2 - Important"]), identityNodeKey, true)[0];
    expect(g.criticality).toBe("1 - Critical");
  });

  it("keeps the one criticality present when there is only one", () => {
    expect(groupFlows(flowsWith(["2 - Important"]), identityNodeKey, true)[0].criticality).toBe("2 - Important");
  });

  // An empty cell is not a low criticality: it is nothing, and must not crush
  // another consumption's on the same line.
  it("ignores a criticality that is not filled in", () => {
    expect(groupFlows(flowsWith(["", "2 - Important"]), identityNodeKey, true)[0].criticality).toBe("2 - Important");
    expect(groupFlows(flowsWith([""]), identityNodeKey, true)[0].criticality).toBeUndefined();
  });

  // The order is read from the vocabulary itself: keeping a second list would
  // make the two drift apart.
  it("files a value outside the vocabulary after all the others", () => {
    expect(groupFlows(flowsWith(["Inconnue", "3 - Standard"]), identityNodeKey, true)[0].criticality).toBe("3 - Standard");
  });
});
