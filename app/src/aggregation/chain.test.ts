import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { availableChains, buildChainView } from "./chain";
import type { ParsedModel } from "../parsing/model";

// Boreal publie sur Kafka, l'ESB relaie, un consommateur métier reçoit. Trois
// maillons, deux technologies, et trois NOMS différents : c'est exactement ce
// que la lecture fonctionnelle efface et que la vue Chaîne est venue montrer.
function threeHopEstate(overrides: Partial<ParsedModel> = {}): ParsedModel {
  return base.template({
    groups: [base.group({ name: "G" })],
    actorTypes: [base.actorType({ nature: "Business" }), base.actorType({ type: "Infra", nature: "Technical" })],
    flowTypes: [base.typeFlux({ type: "Kafka" }), base.typeFlux({ type: "HTTP" })],
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
      base.conso({ flowName: "Policy events", consumerName: "Kafka", sheet: "FX_Boreal_Kafka", republishedAs: "Policy stream" }),
      base.conso({ flowName: "Policy stream", consumerName: "ESB", sheet: "FX_Kafka_Kafka", republishedAs: "Policy feed" }),
      base.conso({ flowName: "Policy feed", consumerName: "Onderon", sheet: "FX_ESB_HTTP" }),
    ],
    ...overrides,
  });
}

describe("chainesDisponibles", () => {
  it("rend un maillon par segment, dans l'ordre du parcours", () => {
    const [chain] = availableChains(threeHopEstate(), null);
    expect(chain.hops.map((m) => [m.provider, m.consumer])).toEqual([
      ["Boreal", "Kafka"],
      ["Kafka", "ESB"],
      ["ESB", "Onderon"],
    ]);
  });

  // Le nom sous lequel l'échange circule CHANGE en route : c'est ce qu'on vient
  // voir, et ce que le lien fonctionnel rabattu ne dit pas.
  it("porte sur chaque maillon le nom et la technologie de CE segment", () => {
    const [chain] = availableChains(threeHopEstate(), null);
    expect(chain.hops.map((m) => m.interfaceName)).toEqual(["Policy events", "Policy stream", "Policy feed"]);
    expect(chain.hops.map((m) => m.technology)).toEqual(["Kafka", "Kafka", "HTTP"]);
  });

  it("se nomme par ses deux bouts et l'échange reçu", () => {
    expect(availableChains(threeHopEstate(), null)[0].label).toBe("Boreal → Onderon : Policy feed");
  });

  // Un lien direct est une chaîne d'UN maillon : pas un cas particulier.
  it("rend un seul maillon pour un lien direct", () => {
    const direct = base.template({
      groups: [base.group({ name: "G" })],
      actorTypes: [base.actorType()],
      flowTypes: [base.typeFlux()],
      fxSheetNames: ["FX_A_HTTP"],
      actors: [base.actor({ name: "A" }), base.actor({ name: "B" })],
      interfaces: [base.iface({ flowName: "F", providerName: "A", expectedSheet: "FX_A_HTTP" })],
      consumptions: [base.conso({ flowName: "F", consumerName: "B", sheet: "FX_A_HTTP" })],
    });
    expect(availableChains(direct, null)[0].hops).toHaveLength(1);
  });

  // L'atténuation se marque À L'ENDROIT où elle a lieu, pas globalement : c'est
  // toute la valeur de la vue face au lien rabattu, qui ne dit que « quelque
  // part sur le trajet ».
  it("marque le maillon qui transforme, et lui seul", () => {
    const estate = threeHopEstate();
    estate.consumptions[1].decision = "Transform";
    const [chain] = availableChains(estate, null);
    expect(chain.hops.map((m) => m.attenuated)).toEqual([false, true, false]);
  });

  // Une chaîne coupée ne produit aucun lien fonctionnel : elle n'a donc pas de
  // trajet à proposer, et le rapport d'intégrité la signale par ailleurs.
  it("ne propose rien quand la chaîne est coupée", () => {
    const estate = threeHopEstate();
    estate.consumptions[0].republishedAs = "";
    expect(availableChains(estate, null)).toEqual([]);
  });
});

describe("buildChainView", () => {
  it("dessine un nœud par acteur traversé et un trait par maillon", () => {
    const view = buildChainView(threeHopEstate(), availableChains(threeHopEstate(), null)[0]);
    expect(view.nodes.map((n) => n.id)).toEqual(["Boreal", "Kafka", "ESB", "Onderon"]);
    expect(view.edges).toHaveLength(3);
  });

  // Les deux bouts sont ce qu'on est venu voir ; ce qu'il y a entre eux est la
  // plomberie qu'on traverse.
  it("met en avant les deux bouts et marque la plomberie du milieu", () => {
    const view = buildChainView(threeHopEstate(), availableChains(threeHopEstate(), null)[0]);
    expect(view.nodes.map((n) => n.kind)).toEqual(["focus-actor", "actor", "actor", "focus-actor"]);
    expect(view.nodes.map((n) => n.technique)).toEqual([undefined, true, true, undefined]);
  });

  it("écrit sur chaque trait le nom porté à cet endroit", () => {
    const view = buildChainView(threeHopEstate(), availableChains(threeHopEstate(), null)[0]);
    expect(view.edges.map((e) => e.label)).toEqual(["Policy events", "Policy stream", "Policy feed"]);
  });
});
