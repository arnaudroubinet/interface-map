import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { calculerEcarts, buildEcartsView } from "./changes";
import { VERSION_MODELE } from "../parsing/build-model";
import type { ParsedModel, Actor, InterfaceCatalogue, Consumption } from "../parsing/model";

// Tout est daté v1 dans ce fichier : c'est entre deux paliers qu'il compare.
function actor(o: Partial<Actor> = {}): Actor {
  return base.actor({ group: "G1", introducedAt: "v1", ...o });
}
function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return base.iface({ introducedAt: "v1", ...o });
}
function conso(o: Partial<Consumption> = {}): Consumption {
  return base.conso({ legacyStatus: "Actif", decision: "Keep", introducedAt: "v1", ...o });
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
    flowTypes: [base.typeFlux({ type: "HTTP", rawDirection: "" })],
    interfaces: [iface({})],
    consumptions: [conso({})],
    fxSheetNames: ["FX_A_HTTP"],
    missingOptionalColumns: [],
    schemaVersion: VERSION_MODELE,
    savedAt: null,
    ...o,
  };
}

describe("calculerEcarts", () => {
  it("says nothing changed between two ranks when nothing moved", () => {
    const e = calculerEcarts(model(), 1, 2, "architecture");
    expect(e.actors).toEqual({ ajoutes: [], retires: [] });
    expect(e.interfaces).toEqual({ ajoutes: [], retires: [] });
    expect(e.consumptions).toEqual({ ajoutes: [], retires: [] });
  });

  it("names an acteur that arrives", () => {
    const m = model({ actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C", introducedAt: "v2" })] });
    expect(calculerEcarts(m, 1, 2, "architecture").actors.ajoutes).toEqual(["C"]);
  });

  it("names an acteur that leaves", () => {
    const m = model({ actors: [actor({ name: "A" }), actor({ name: "B", retiredAt: "v2" })] });
    expect(calculerEcarts(m, 1, 2, "architecture").actors.retires).toEqual(["B"]);
  });

  it("names an interface that arrives, with its version", () => {
    const m = model({
      interfaces: [iface({}), iface({ version: "2.0", introducedAt: "v2" })],
    });
    expect(calculerEcarts(m, 1, 2, "architecture").interfaces.ajoutes).toEqual(["F 2.0"]);
  });

  it("names a consumption by the pair it creates", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C" })],
      consumptions: [conso({}), conso({ consumerName: "C", introducedAt: "v2" })],
    });
    expect(calculerEcarts(m, 1, 2, "architecture").consumptions.ajoutes).toEqual(["C → F"]);
  });

  // Lire l'écart à l'envers doit donner l'inverse, sans quoi le sens de
  // lecture des deux sélecteurs serait ambigu.
  it("reads backwards as the mirror of forwards", () => {
    const m = model({ actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C", introducedAt: "v2" })] });
    expect(calculerEcarts(m, 2, 1, "architecture").actors.retires).toEqual(["C"]);
  });
});

describe("buildEcartsView", () => {
  // Le vrai apport du schéma : un lien qui existe des deux côtés mais dont le
  // volume a changé. Le marquage binaire le laissait passer en silence.
  it("labels a link whose volume dropped with the delta, not with its count", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C", group: "G2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
      consumptions: [
        conso({ consumerName: "B" }),
        conso({ consumerName: "C", retiredAt: "v2" }),
      ],
    });
    const edge = buildEcartsView(m, 1, 2, "architecture").edges[0];
    expect(edge.label).toBe("−1");
    expect(edge.ecart).toBe("removed");
  });

  it("labels a link whose volume grew with a signed delta", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C", group: "G2", introducedAt: "v2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
      consumptions: [conso({}), conso({ consumerName: "C", introducedAt: "v2" })],
    });
    const edge = buildEcartsView(m, 1, 2, "architecture").edges[0];
    expect(edge.label).toBe("+1");
    expect(edge.ecart).toBe("added");
  });

  // Le schéma ne montre QUE l'écart : mêler les liens inchangés au reste
  // noierait les quelques traits qui portent l'information.
  it("drops an unchanged link entirely", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B", group: "G2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
    });
    expect(buildEcartsView(m, 1, 2, "architecture").edges).toEqual([]);
  });

  // La base est « plateforme détaillée » : on veut savoir QUEL composant a
  // gagné ou perdu un flux, pas seulement quel groupe.
  it("names the platform components rather than collapsing them into their group", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B", group: "G2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
      consumptions: [conso({ retiredAt: "v2" })],
    });
    const view = buildEcartsView(m, 1, 2, "architecture");
    // A est dans le groupe Plateforme : il est nommé, pas replié en « G1 ».
    expect(view.nodes.map((n) => n.id)).toContain("A");
    expect(view.nodes.map((n) => n.id)).not.toContain("G1");
  });

  // La frontière est un nœud parent : élaguer ses enfants sans elle laisserait
  // des nœuds pointant vers un conteneur absent.
  it("never leaves a node pointing at a frontière it dropped", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B", group: "G2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
      consumptions: [conso({ retiredAt: "v2" })],
    });
    const view = buildEcartsView(m, 1, 2, "architecture");
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
      // G3 échange avec G1 sans rien changer : il ne doit pas être dessiné.
      interfaces: [iface({}), iface({ flowName: "F2", providerName: "C", expectedSheet: "FX_C_HTTP" })],
      consumptions: [
        conso({ retiredAt: "v2" }),
        conso({ flowName: "F2", consumerName: "D", sheet: "FX_C_HTTP" }),
      ],
      fxSheetNames: ["FX_A_HTTP", "FX_C_HTTP"],
    });
    const view = buildEcartsView(m, 1, 2, "architecture");
    // A est nommé (Plateforme), B replié sur G2 ; G3 n'a pas bougé, il sort.
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["A", "G2"]);
  });

  it("marks an edge that only exists after as an addition", () => {
    const m = model({
      actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "C", group: "G2", introducedAt: "v2" })],
      groups: [{ name: "G1", perimeter: "Platform", sheet: "Groups", row: 0 }, { name: "G2", perimeter: "External", sheet: "Groups", row: 0 }],
      consumptions: [conso({}), conso({ consumerName: "C", introducedAt: "v2" })],
    });
    const view = buildEcartsView(m, 1, 2, "architecture");
    expect(view.edges.some((e) => e.ecart === "added")).toBe(true);
  });

  it("marks an edge that only existed before as a removal", () => {
    const m = model({ consumptions: [conso({ retiredAt: "v2" })] });
    const view = buildEcartsView(m, 1, 2, "architecture");
    expect(view.edges.every((e) => e.ecart === "removed")).toBe(true);
  });

  it("leaves an unchanged edge unmarked", () => {
    const view = buildEcartsView(model(), 1, 2, "architecture");
    expect(view.edges.every((e) => e.ecart === undefined)).toBe(true);
  });

  // Sans les nœuds du palier de départ, un trait retiré n'aurait plus de boîte
  // où aboutir et le schéma serait incohérent.
  it("keeps the nodes a removed edge needs", () => {
    const m = model({ consumptions: [conso({ retiredAt: "v2" })] });
    const view = buildEcartsView(m, 1, 2, "architecture");
    for (const e of view.edges) {
      expect(view.nodes.map((n) => n.id)).toContain(e.from);
      expect(view.nodes.map((n) => n.id)).toContain(e.to);
    }
  });
});

// Tatooine expose Transactions, Bus (Middleware, Technical) la relaie sous
// trx.norm ; le segment vers Naboo n'apparaît qu'au palier v2.
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
      conso({ flowName: "Transactions", consumerName: "Bus", sheet: "FX_Tatooine_HTTP", republishedAs: "trx.norm" }),
      conso({ flowName: "trx.norm", consumerName: "Naboo", sheet: "FX_Bus_HTTP", introducedAt: "v2" }),
    ],
    fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
  });
}

describe("calculerEcarts — mode fonctionnel", () => {
  it("compare les liens fonctionnels quand le mode le demande", () => {
    // Un lien qui n'existe qu'au second palier apparaît comme un ajout, la
    // plomberie retirée.
    const changes = calculerEcarts(functionalEstate(), 1, 2, "functional");
    expect(changes.consumptions.ajoutes).toEqual(["Naboo → Transactions"]);
  });
});
