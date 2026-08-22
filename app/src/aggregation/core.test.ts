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

// Les fabriques partagées, avec les seuls défauts propres à ce fichier : deux
// groupes G1/G2, et une consommation déjà décidée.
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
    flowTypes: [base.typeFlux()],
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

  it("marks a flow attenuated when Décision=À transformer", () => {
    const flows = buildFlowInstances(model({ consumptions: [consumption({ decision: "Transform" })] }));
    expect(flows[0].attenuated).toBe(true);
  });


  it("attaches a consumption to the interface on its own tab, not just any interface sharing its name", () => {
    // Two catalog interfaces share the name "F" but live on different tabs —
    // an already-anomalous (7.1 duplicate) but possible mid-edit state. The
    // consumption is filed under the FIRST interface's tab (FX_A_HTTP) —
    // a Map keyed by name alone (the pre-fix behaviour) always keeps the
    // LAST-inserted entry ("C"/Kafka) and would wrongly resolve to that one;
    // only a (feuille, nom du flux) lookup (§3.3) resolves to "A"/HTTP here.
    const flows = buildFlowInstances(
      model({
        flowTypes: [
          base.typeFlux({ type: "HTTP" }),
          base.typeFlux({ type: "Kafka", direction: "provider-to-consumer", rawDirection: "provider → consumer" }),
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

  // En mode fonctionnel, typeDeFlux est vidé (§4.2). Le libellé valait d'abord
  // " ×2" -- un compteur précédé d'un espace fantôme --, puis « 2 » tout court,
  // ce qui n'apprenait rien de plus. Ce sont les échanges qui portent le sens
  // dès lors que le medium a disparu.
  it("nomme les échanges quand la technologie est vide", () => {
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

describe("buildFlowInstances — filtrage par palier", () => {
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

  // Le retrait est exclu : retiré EN v2, la ligne n'y est déjà plus.
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

  // Un classeur sans aucun palier déclaré se comporte exactement comme avant.
  it("keeps everything when no rank is displayed", () => {
    expect(buildFlowInstances(model({}), null)).toHaveLength(1);
  });
});

// --- QA : le repli par (nom, version) rattachait une consommation à la
// PREMIÈRE interface portant ce nom. Deux exposants publiant le même nom
// étant deux interfaces distinctes, ce repli faisait signer un consommateur
// chez quelqu'un qu'il n'a jamais choisi. Mieux vaut ne pas résoudre : le
// contrôle de référence le dit alors clairement.
describe("résolution d'une consommation — le nom seul ne tranche pas entre deux exposants", () => {
  const twoPublishers = (feuilleConso: string) =>
    model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C" })],
      interfaces: [
        iface({ flowName: "Kashyyyk", providerName: "A", expectedSheet: "FX_A_HTTP" }),
        iface({ flowName: "Kashyyyk", providerName: "B", expectedSheet: "FX_B_HTTP" }),
      ],
      consumptions: [consumption({ flowName: "Kashyyyk", consumerName: "C", sheet: feuilleConso })],
    });

  it("résout sans hésiter quand l'onglet désigne l'exposant", () => {
    const flows = buildFlowInstances(twoPublishers("FX_B_HTTP"));
    expect(flows.map((f) => f.provider)).toEqual(["B"]);
  });

  it("ne devine pas quand l'onglet ne désigne personne", () => {
    expect(buildFlowInstances(twoPublishers("FX_Inconnu_HTTP"))).toHaveLength(0);
  });

  it("résout encore par le nom quand un seul exposant le porte", () => {
    const m = twoPublishers("FX_Inconnu_HTTP");
    const flows = buildFlowInstances({ ...m, interfaces: [m.interfaces[0]] });
    expect(flows.map((f) => f.provider)).toEqual(["A"]);
  });
});

// --- QA : en mode fonctionnel la technologie est vidée à dessein, pour que les
// traits d'une même paire fusionnent. Le compteur restait alors seul, et un
// trait annonçant « 2 » n'apprend ni ce qui circule ni pourquoi -- la vue
// métier n'avait, dans cet état, aucune valeur.
describe("libelleCellule — ce que porte un trait sans technologie", () => {
  it("nomme les échanges plutôt que de les compter", () => {
    expect(cellLabel("", 2, ["Member lookup", "Premium calculation"])).toBe("Member lookup, Premium calculation");
  });

  it("au-delà de deux, nomme les deux premiers et compte le reste", () => {
    expect(cellLabel("", 4, ["A", "B", "C", "D"])).toBe("A, B +2");
  });

  it("garde le compteur seul quand aucun nom n'est connu", () => {
    expect(cellLabel("", 3, [])).toBe("3");
  });

  it("ne change rien quand la technologie est là", () => {
    expect(cellLabel("HTTP", 2, ["A", "B"])).toBe("HTTP ×2");
    expect(cellLabel("HTTP", 1, ["A"])).toBe("HTTP");
  });
});

describe("groupFlows — les noms d'échange suivent le trait fusionné", () => {
  it("rassemble les noms des flux fusionnés, sans doublon", () => {
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

// --- Le tracé et la pointe portaient la même information. Un flux tiré --
// HTTP, déclaré « consumer → provider » -- voyait donc son TRACÉ inversé en
// plus de sa pointe : la donnée semblait remonter le tuyau, et un fournisseur
// n'avait rien qui sorte de lui. Le tracé suit désormais la donnée, du
// fournisseur vers le consommateur ; seule la pointe dit qui appelle.
describe("directedEndpoints — le tracé suit la donnée, la pointe dit l'initiative", () => {
  const estate = (direction: "provider-to-consumer" | "consumer-to-provider") =>
    model({
      actors: [actor({ name: "A" }), actor({ name: "B" })],
      flowTypes: [base.typeFlux({ direction, rawDirection: "" })],
      interfaces: [iface({ providerName: "A" })],
      consumptions: [consumption({ consumerName: "B" })],
    });

  it("va du fournisseur au consommateur, qu'il soit poussé ou tiré", () => {
    for (const direction of ["provider-to-consumer", "consumer-to-provider"] as const) {
      const g = groupFlows(buildFlowInstances(estate(direction)), identityNodeKey, true);
      expect([g[0].from, g[0].to]).toEqual(["A", "B"]);
    }
  });

  it("marque le trait comme tiré quand le consommateur prend l'initiative", () => {
    expect(groupFlows(buildFlowInstances(estate("consumer-to-provider")), identityNodeKey, true)[0].pulled).toBe(true);
    expect(groupFlows(buildFlowInstances(estate("provider-to-consumer")), identityNodeKey, true)[0].pulled).toBe(false);
  });
});

// --- Une carte des TUYAUX ou une carte des ÉCHANGES : l'étiquette ne disait
// que le protocole, et le nom de ce qui circule n'apparaissait nulle part.
describe("libelleCellule — ce qui s'écrit sur le trait", () => {
  const names = ["Policy events 1.0", "Claims 2.0"];

  it("nomme la technologie seule par défaut", () => {
    expect(cellLabel("Kafka", 2, names)).toBe("Kafka ×2");
    expect(cellLabel("Kafka", 2, names, "technology")).toBe("Kafka ×2");
  });

  it("nomme les échanges quand on le demande", () => {
    expect(cellLabel("Kafka", 2, names, "exchanges")).toBe("Policy events 1.0, Claims 2.0");
  });

  // Le compteur reste avec le tuyau : sur un trait qui fusionne cinq flux
  // dont deux sont nommés, « ×5 » est la seule chose qui dise combien il en
  // reste.
  it("nomme les deux, l'échange en tête", () => {
    expect(cellLabel("Kafka", 2, names, "both")).toBe("Policy events 1.0, Claims 2.0 — Kafka ×2");
  });

  // Au-delà de deux noms l'étiquette mangerait le dessin : le reste se compte,
  // et se lit dans l'infobulle du trait.
  it("s'arrête à deux noms et compte le reste", () => {
    expect(cellLabel("Kafka", 5, [...names, "A", "B", "C"], "exchanges")).toBe("Policy events 1.0, Claims 2.0 +3");
  });

  // La lecture fonctionnelle vide la technologie : « technology » ne peut pas
  // laisser une étiquette réduite à un compteur, qui n'apprend rien.
  it("retombe sur les échanges quand aucune technologie n'est nommée", () => {
    expect(cellLabel("", 1, ["Policy events 1.0"])).toBe("Policy events 1.0");
  });

  // Rien à nommer du tout : le compteur est alors la seule information vraie.
  it("garde le compteur quand il n'y a ni technologie ni nom", () => {
    expect(cellLabel("", 3, [], "exchanges")).toBe("3");
  });

  // « both » sans technologie ne doit pas produire un tiret orphelin.
  it("n'écrit pas de tiret quand il n'y a pas de technologie à joindre", () => {
    expect(cellLabel("", 2, names, "both")).toBe("Policy events 1.0, Claims 2.0");
  });
});

// --- Trier cette liste a été essayé comme prérequis de stabilité entre
// paliers, et mesuré : 16 % de surface en plus sur la vue détaillée pour rien,
// la stabilité venant du placement sur l'union des paliers.
describe("nodesFromEdges", () => {
  const edges = (paires: [string, string][]) =>
    paires.map(([from, to]) => ({ from, to, technology: "HTTP", count: 1, label: "HTTP", attenuated: false }));

  it("ne perd ni ne double aucun nœud", () => {
    const ids = nodesFromEdges(edges([["A", "B"], ["B", "C"], ["A", "C"]]), (id) => id, () => "actor").map((n) => n.id);
    expect(ids).toEqual(["A", "B", "C"]);
  });
});

// --- §A3 : la criticité est saisie, contrôlée et exportée depuis toujours, et
// n'était jamais dessinée. C'est pourtant la donnée la plus décisionnelle du
// classeur.
describe("groupFlows — la criticité portée par le trait", () => {
  // Un parc où B consomme la même interface plusieurs fois, chaque ligne avec
  // sa propre criticité : c'est le cas que l'agrégation doit trancher.
  const fluxAvec = (criticalities: string[]) =>
    buildFlowInstances(
      base.template({
        groups: [base.group({ name: "G" })],
        actorTypes: [base.actorType()],
        flowTypes: [base.typeFlux()],
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

  it("retient la criticité la plus forte des consommations agrégées", () => {
    const g = groupFlows(fluxAvec(["3 - Standard", "1 - Critical", "2 - Important"]), identityNodeKey, true)[0];
    expect(g.criticality).toBe("1 - Critical");
  });

  it("garde la seule criticité présente quand il n'y en a qu'une", () => {
    expect(groupFlows(fluxAvec(["2 - Important"]), identityNodeKey, true)[0].criticality).toBe("2 - Important");
  });

  // Une case vide n'est pas une criticité basse : elle n'est rien, et ne doit
  // pas écraser celle d'une autre consommation du même trait.
  it("ignore une criticité non renseignée", () => {
    expect(groupFlows(fluxAvec(["", "2 - Important"]), identityNodeKey, true)[0].criticality).toBe("2 - Important");
    expect(groupFlows(fluxAvec([""]), identityNodeKey, true)[0].criticality).toBeUndefined();
  });

  // L'ordre se lit dans le vocabulaire lui-même : en tenir une seconde liste
  // ferait diverger les deux.
  it("range une valeur hors vocabulaire après toutes les autres", () => {
    expect(groupFlows(fluxAvec(["Inconnue", "3 - Standard"]), identityNodeKey, true)[0].criticality).toBe("3 - Standard");
  });
});
