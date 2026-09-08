import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { availableChains, buildChainView } from "./chain";
import type { ParsedModel } from "../parsing/model";

// Boreal publishes over Kafka, the ESB relays, a business consumer receives.
// Three hops, two technologies, and three different NAMES: exactly what the
// functional reading erases and what the Chain view came to show.
function threeHopEstate(overrides: Partial<ParsedModel> = {}): ParsedModel {
  return base.template({
    groups: [base.group({ name: "G" })],
    actorTypes: [base.actorType({ nature: "Business" }), base.actorType({ type: "Infra", nature: "Technical" })],
    flowTypes: [base.flowType({ type: "Kafka" }), base.flowType({ type: "HTTP" })],
    actors: [
      base.actor({ name: "Boreal" }),
      base.actor({ name: "Kafka", actorType: "Infra" }),
      base.actor({ name: "ESB", actorType: "Infra" }),
      base.actor({ name: "Onderon" }),
    ],
    fxSheetNames: ["FX_Boreal_Kafka", "FX_Kafka_Kafka", "FX_ESB_HTTP"],
    interfaces: [
      base.iface({ flowName: "Policy events", providerName: "Boreal", flowType: "Kafka", expectedSheet: "FX_Boreal_Kafka" }),
      base.iface({ flowName: "Policy stream", providerName: "Kafka", flowType: "Kafka", expectedSheet: "FX_Kafka_Kafka" }),
      base.iface({ flowName: "Policy feed", providerName: "ESB", flowType: "HTTP", expectedSheet: "FX_ESB_HTTP" }),
    ],
    consumptions: [
      base.consumption({ flowName: "Policy events", consumerName: "Kafka", sheet: "FX_Boreal_Kafka", republishedAs: "Policy stream" }),
      base.consumption({ flowName: "Policy stream", consumerName: "ESB", sheet: "FX_Kafka_Kafka", republishedAs: "Policy feed" }),
      base.consumption({ flowName: "Policy feed", consumerName: "Onderon", sheet: "FX_ESB_HTTP" }),
    ],
    ...overrides,
  });
}

describe("availableChains", () => {
  it("returns one hop per segment, in walking order", () => {
    const [chain] = availableChains(threeHopEstate(), null);
    expect(chain.hops.map((m) => [m.provider, m.consumer])).toEqual([
      ["Boreal", "Kafka"],
      ["Kafka", "ESB"],
      ["ESB", "Onderon"],
    ]);
  });

  // The name the exchange travels under CHANGES on the way: that is what one
  // comes to see, and what the folded functional link does not say.
  it("carries on each hop the name and technology of THAT segment", () => {
    const [chain] = availableChains(threeHopEstate(), null);
    expect(chain.hops.map((m) => m.interfaceName)).toEqual(["Policy events", "Policy stream", "Policy feed"]);
    expect(chain.hops.map((m) => m.technology)).toEqual(["Kafka", "Kafka", "HTTP"]);
  });

  it("is named by its two ends and the exchange received", () => {
    expect(availableChains(threeHopEstate(), null)[0].label).toBe("Boreal → Onderon : Policy feed");
  });

  // A direct link is a ONE-hop chain: not a special case.
  it("returns a single hop for a direct link", () => {
    const direct = base.template({
      groups: [base.group({ name: "G" })],
      actorTypes: [base.actorType()],
      flowTypes: [base.flowType()],
      fxSheetNames: ["FX_A_HTTP"],
      actors: [base.actor({ name: "A" }), base.actor({ name: "B" })],
      interfaces: [base.iface({ flowName: "F", providerName: "A", expectedSheet: "FX_A_HTTP" })],
      consumptions: [base.consumption({ flowName: "F", consumerName: "B", sheet: "FX_A_HTTP" })],
    });
    expect(availableChains(direct, null)[0].hops).toHaveLength(1);
  });

  // The dimming is marked AT THE PLACE it happens, not globally: that is the
  // whole value of the view against the folded link, which says only
  // "somewhere along the way".
  it("marks the hop that transforms, and it alone", () => {
    const estate = threeHopEstate();
    estate.consumptions[1].decision = "Transform";
    const [chain] = availableChains(estate, null);
    expect(chain.hops.map((m) => m.attenuated)).toEqual([false, true, false]);
  });

  // A broken chain produces no functional link: it therefore has no route to
  // offer, and the integrity report reports it separately.
  it("offers nothing when the chain is broken", () => {
    const estate = threeHopEstate();
    estate.consumptions[0].republishedAs = "";
    expect(availableChains(estate, null)).toEqual([]);
  });
});

// A chain crosses technologies of opposite conventions, and the view exists to
// show each hop as it is: a pulled hop keeps its head at the provider's end.
// Without it every hop drew as a push -- the one convention the README calls
// non-negotiable, broken on the one view that follows a flow end to end.
describe("availableChains — who takes the initiative on each hop", () => {
  const estate = () =>
    threeHopEstate({
      flowTypes: [
        base.flowType({ type: "Kafka", direction: "provider-to-consumer" }),
        base.flowType({ type: "HTTP", direction: "consumer-to-provider" }),
      ],
    });

  it("marks the pulled hops, and only them", () => {
    const [chain] = availableChains(estate(), null);
    expect(chain.hops.map((m) => m.pulled)).toEqual([false, false, true]);
  });

  it("carries the mark onto the drawn lines", () => {
    const model = estate();
    const [chain] = availableChains(model, null);
    expect(buildChainView(model, chain).edges.map((e) => e.pulled)).toEqual([false, false, true]);
  });
});

describe("buildChainView", () => {
  it("draws one node per actor crossed and one line per hop", () => {
    const view = buildChainView(threeHopEstate(), availableChains(threeHopEstate(), null)[0]);
    expect(view.nodes.map((n) => n.id)).toEqual(["Boreal", "Kafka", "ESB", "Onderon"]);
    expect(view.edges).toHaveLength(3);
  });

  // The two ends are what one came to see; what lies between them is the
  // plomberie qu'on traverse.
  it("brings the two ends forward and marks the plumbing in between", () => {
    const view = buildChainView(threeHopEstate(), availableChains(threeHopEstate(), null)[0]);
    expect(view.nodes.map((n) => n.kind)).toEqual(["focus-actor", "actor", "actor", "focus-actor"]);
    expect(view.nodes.map((n) => n.technical)).toEqual([undefined, true, true, undefined]);
  });

  it("writes on each line the name carried at that point", () => {
    const view = buildChainView(threeHopEstate(), availableChains(threeHopEstate(), null)[0]);
    expect(view.edges.map((e) => e.label)).toEqual(["Policy events", "Policy stream", "Policy feed"]);
  });
});
