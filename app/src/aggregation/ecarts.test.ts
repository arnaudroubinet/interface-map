import { describe, it, expect } from "vitest";
import { calculerEcarts, buildEcartsView } from "./ecarts";
import { VERSION_MODELE } from "../parsing/build-model";
import type { ParsedModel, Acteur, InterfaceCatalogue, Consommation } from "../parsing/model";

function acteur(o: Partial<Acteur>): Acteur {
  return { nom: "A", groupe: "G1", typeActeur: "Application", responsable: "", description: "", commentaires: "", palierIntroduction: "v1", palierRetrait: "", feuille: "Actors", ligne: 0, ...o };
}
function iface(o: Partial<InterfaceCatalogue>): InterfaceCatalogue {
  return { nomDuFlux: "F", version: "", etat: "", acteurExposant: "A", typeDeFlux: "HTTP", description: "", lienContrat: "", referenceContrat: "", commentaires: "", aConfirmer: false, feuilleAttendue: "FX_A_HTTP", relais: "", palierIntroduction: "v1", palierRetrait: "", feuille: "Interfaces", ligne: 0, ...o };
}
function conso(o: Partial<Consommation>): Consommation {
  return { nomDuFlux: "F", version: "", acteurConsommateur: "B", usage: "", criticite: "", statut: "Actif", decision: "Keep", republiePar: "", commentaires: "", feuille: "FX_A_HTTP", palierIntroduction: "v1", palierRetrait: "", ligne: 0, ...o };
}

const paliers = [
  { nom: "v1", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
  { nom: "v2", rang: 2, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
];

function model(o: Partial<ParsedModel> = {}): ParsedModel {
  return {
    acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" })],
    groupes: [{ nom: "G1", perimetre: "Platform", feuille: "Groups", ligne: 0 }],
    groupesAbsents: false,
    typesActeur: [],
    paliers,
    typesFlux: [{ type: "HTTP", sensRepresentation: "consommateur-exposant", sensRepresentationBrut: "", couleur: "", description: "", feuille: "FlowTypes", ligne: 0 }],
    interfaces: [iface({})],
    consommations: [conso({})],
    fxSheetNames: ["FX_A_HTTP"],
    colonnesOptionnellesAbsentes: [],
    versionModele: VERSION_MODELE,
    fichierModifie: null,
    ...o,
  };
}

describe("calculerEcarts", () => {
  it("says nothing changed between two ranks when nothing moved", () => {
    const e = calculerEcarts(model(), 1, 2, "architecture");
    expect(e.acteurs).toEqual({ ajoutes: [], retires: [] });
    expect(e.interfaces).toEqual({ ajoutes: [], retires: [] });
    expect(e.consommations).toEqual({ ajoutes: [], retires: [] });
  });

  it("names an acteur that arrives", () => {
    const m = model({ acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" }), acteur({ nom: "C", palierIntroduction: "v2" })] });
    expect(calculerEcarts(m, 1, 2, "architecture").acteurs.ajoutes).toEqual(["C"]);
  });

  it("names an acteur that leaves", () => {
    const m = model({ acteurs: [acteur({ nom: "A" }), acteur({ nom: "B", palierRetrait: "v2" })] });
    expect(calculerEcarts(m, 1, 2, "architecture").acteurs.retires).toEqual(["B"]);
  });

  it("names an interface that arrives, with its version", () => {
    const m = model({
      interfaces: [iface({}), iface({ version: "2.0", palierIntroduction: "v2" })],
    });
    expect(calculerEcarts(m, 1, 2, "architecture").interfaces.ajoutes).toEqual(["F 2.0"]);
  });

  it("names a consumption by the pair it creates", () => {
    const m = model({
      acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" }), acteur({ nom: "C" })],
      consommations: [conso({}), conso({ acteurConsommateur: "C", palierIntroduction: "v2" })],
    });
    expect(calculerEcarts(m, 1, 2, "architecture").consommations.ajoutes).toEqual(["C → F"]);
  });

  // Lire l'écart à l'envers doit donner l'inverse, sans quoi le sens de
  // lecture des deux sélecteurs serait ambigu.
  it("reads backwards as the mirror of forwards", () => {
    const m = model({ acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" }), acteur({ nom: "C", palierIntroduction: "v2" })] });
    expect(calculerEcarts(m, 2, 1, "architecture").acteurs.retires).toEqual(["C"]);
  });
});

describe("buildEcartsView", () => {
  // Le vrai apport du schéma : un lien qui existe des deux côtés mais dont le
  // volume a changé. Le marquage binaire le laissait passer en silence.
  it("labels a link whose volume dropped with the delta, not with its count", () => {
    const m = model({
      acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" }), acteur({ nom: "C", groupe: "G2" })],
      groupes: [{ nom: "G1", perimetre: "Platform", feuille: "Groups", ligne: 0 }, { nom: "G2", perimetre: "External", feuille: "Groups", ligne: 0 }],
      consommations: [
        conso({ acteurConsommateur: "B" }),
        conso({ acteurConsommateur: "C", palierRetrait: "v2" }),
      ],
    });
    const arête = buildEcartsView(m, 1, 2, "architecture").edges[0];
    expect(arête.label).toBe("−1");
    expect(arête.ecart).toBe("retrait");
  });

  it("labels a link whose volume grew with a signed delta", () => {
    const m = model({
      acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" }), acteur({ nom: "C", groupe: "G2", palierIntroduction: "v2" })],
      groupes: [{ nom: "G1", perimetre: "Platform", feuille: "Groups", ligne: 0 }, { nom: "G2", perimetre: "External", feuille: "Groups", ligne: 0 }],
      consommations: [conso({}), conso({ acteurConsommateur: "C", palierIntroduction: "v2" })],
    });
    const arête = buildEcartsView(m, 1, 2, "architecture").edges[0];
    expect(arête.label).toBe("+1");
    expect(arête.ecart).toBe("ajout");
  });

  // Le schéma ne montre QUE l'écart : mêler les liens inchangés au reste
  // noierait les quelques traits qui portent l'information.
  it("drops an unchanged link entirely", () => {
    const m = model({
      acteurs: [acteur({ nom: "A" }), acteur({ nom: "B", groupe: "G2" })],
      groupes: [{ nom: "G1", perimetre: "Platform", feuille: "Groups", ligne: 0 }, { nom: "G2", perimetre: "External", feuille: "Groups", ligne: 0 }],
    });
    expect(buildEcartsView(m, 1, 2, "architecture").edges).toEqual([]);
  });

  // La base est « plateforme détaillée » : on veut savoir QUEL composant a
  // gagné ou perdu un flux, pas seulement quel groupe.
  it("names the platform components rather than collapsing them into their group", () => {
    const m = model({
      acteurs: [acteur({ nom: "A" }), acteur({ nom: "B", groupe: "G2" })],
      groupes: [{ nom: "G1", perimetre: "Platform", feuille: "Groups", ligne: 0 }, { nom: "G2", perimetre: "External", feuille: "Groups", ligne: 0 }],
      consommations: [conso({ palierRetrait: "v2" })],
    });
    const vue = buildEcartsView(m, 1, 2, "architecture");
    // A est dans le groupe Plateforme : il est nommé, pas replié en « G1 ».
    expect(vue.nodes.map((n) => n.id)).toContain("A");
    expect(vue.nodes.map((n) => n.id)).not.toContain("G1");
  });

  // La frontière est un nœud parent : élaguer ses enfants sans elle laisserait
  // des nœuds pointant vers un conteneur absent.
  it("never leaves a node pointing at a frontière it dropped", () => {
    const m = model({
      acteurs: [acteur({ nom: "A" }), acteur({ nom: "B", groupe: "G2" })],
      groupes: [{ nom: "G1", perimetre: "Platform", feuille: "Groups", ligne: 0 }, { nom: "G2", perimetre: "External", feuille: "Groups", ligne: 0 }],
      consommations: [conso({ palierRetrait: "v2" })],
    });
    const vue = buildEcartsView(m, 1, 2, "architecture");
    const ids = new Set(vue.nodes.map((n) => n.id));
    for (const n of vue.nodes) {
      if (n.parent) expect(ids.has(n.parent)).toBe(true);
    }
  });

  it("keeps only the nodes the remaining links need", () => {
    const m = model({
      acteurs: [
        acteur({ nom: "A" }),
        acteur({ nom: "B", groupe: "G2" }),
        acteur({ nom: "C", groupe: "G3" }),
        acteur({ nom: "D", groupe: "G3" }),
      ],
      groupes: [
        { nom: "G1", perimetre: "Platform", feuille: "Groups", ligne: 0 },
        { nom: "G2", perimetre: "External", feuille: "Groups", ligne: 0 },
        { nom: "G3", perimetre: "External", feuille: "Groups", ligne: 0 },
      ],
      // G3 échange avec G1 sans rien changer : il ne doit pas être dessiné.
      interfaces: [iface({}), iface({ nomDuFlux: "F2", acteurExposant: "C", feuilleAttendue: "FX_C_HTTP" })],
      consommations: [
        conso({ palierRetrait: "v2" }),
        conso({ nomDuFlux: "F2", acteurConsommateur: "D", feuille: "FX_C_HTTP" }),
      ],
      fxSheetNames: ["FX_A_HTTP", "FX_C_HTTP"],
    });
    const vue = buildEcartsView(m, 1, 2, "architecture");
    // A est nommé (Plateforme), B replié sur G2 ; G3 n'a pas bougé, il sort.
    expect(vue.nodes.map((n) => n.id).sort()).toEqual(["A", "G2"]);
  });

  it("marks an edge that only exists after as an addition", () => {
    const m = model({
      acteurs: [acteur({ nom: "A" }), acteur({ nom: "B" }), acteur({ nom: "C", groupe: "G2", palierIntroduction: "v2" })],
      groupes: [{ nom: "G1", perimetre: "Platform", feuille: "Groups", ligne: 0 }, { nom: "G2", perimetre: "External", feuille: "Groups", ligne: 0 }],
      consommations: [conso({}), conso({ acteurConsommateur: "C", palierIntroduction: "v2" })],
    });
    const vue = buildEcartsView(m, 1, 2, "architecture");
    expect(vue.edges.some((e) => e.ecart === "ajout")).toBe(true);
  });

  it("marks an edge that only existed before as a removal", () => {
    const m = model({ consommations: [conso({ palierRetrait: "v2" })] });
    const vue = buildEcartsView(m, 1, 2, "architecture");
    expect(vue.edges.every((e) => e.ecart === "retrait")).toBe(true);
  });

  it("leaves an unchanged edge unmarked", () => {
    const vue = buildEcartsView(model(), 1, 2, "architecture");
    expect(vue.edges.every((e) => e.ecart === undefined)).toBe(true);
  });

  // Sans les nœuds du palier de départ, un trait retiré n'aurait plus de boîte
  // où aboutir et le schéma serait incohérent.
  it("keeps the nodes a removed edge needs", () => {
    const m = model({ consommations: [conso({ palierRetrait: "v2" })] });
    const vue = buildEcartsView(m, 1, 2, "architecture");
    for (const e of vue.edges) {
      expect(vue.nodes.map((n) => n.id)).toContain(e.from);
      expect(vue.nodes.map((n) => n.id)).toContain(e.to);
    }
  });
});

// Tatooine expose Transactions, Bus (Middleware, Technical) la relaie sous
// trx.norm ; le segment vers Naboo n'apparaît qu'au palier v2.
function parcFonctionnel(): ParsedModel {
  return model({
    acteurs: [
      acteur({ nom: "Tatooine" }),
      acteur({ nom: "Bus", typeActeur: "Middleware" }),
      acteur({ nom: "Naboo" }),
    ],
    typesActeur: [
      { type: "Application", icone: "", nature: "Business", feuille: "ActorTypes", ligne: 0 },
      { type: "Middleware", icone: "", nature: "Technical", feuille: "ActorTypes", ligne: 0 },
    ],
    interfaces: [
      iface({ nomDuFlux: "Transactions", acteurExposant: "Tatooine", feuilleAttendue: "FX_Tatooine_HTTP" }),
      iface({ nomDuFlux: "trx.norm", acteurExposant: "Bus", feuilleAttendue: "FX_Bus_HTTP" }),
    ],
    consommations: [
      conso({ nomDuFlux: "Transactions", acteurConsommateur: "Bus", feuille: "FX_Tatooine_HTTP", republiePar: "trx.norm" }),
      conso({ nomDuFlux: "trx.norm", acteurConsommateur: "Naboo", feuille: "FX_Bus_HTTP", palierIntroduction: "v2" }),
    ],
    fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
  });
}

describe("calculerEcarts — mode fonctionnel", () => {
  it("compare les liens fonctionnels quand le mode le demande", () => {
    // Un lien qui n'existe qu'au second palier apparaît comme un ajout, la
    // plomberie retirée.
    const ecarts = calculerEcarts(parcFonctionnel(), 1, 2, "fonctionnel");
    expect(ecarts.consommations.ajoutes).toEqual(["Naboo → Transactions"]);
  });
});
