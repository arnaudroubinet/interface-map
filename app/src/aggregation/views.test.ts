import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { buildFlowInstances, groupFlows, identityNodeKey } from "./core";
import { toutesLesPlanches } from "./boards";
import { computeLayout } from "../layout/graph-layout";
import { buildDrawio } from "../export/drawio-export";
import {
  buildGroupToGroupView,
  buildPlatformDetailView,
  buildPlatformOnlyView,
  buildByTechnologyView,
  buildByActorView,
  buildMatrixView,
  optionsFiltreMatrice,
  optionsFiltreActeur,
} from "./views";
import { flowsForReading, reading as lectureDuMode } from "./reading";
import type { Mode } from "./core";
import { VERSION_MODELE } from "../parsing/build-model";
import type { ParsedModel, Actor, InterfaceCatalogue, Consumption } from "../parsing/model";

// Les fabriques partagées ; ce fichier ne leur ajoute que ses deux groupes et
// une consommation déjà décidée.
function actor(o: Partial<Actor> = {}): Actor {
  return base.actor({ group: "G1", ...o });
}
const iface = base.iface;
function conso(o: Partial<Consumption> = {}): Consumption {
  return base.conso({ legacyStatus: "Actif", decision: "Keep", ...o });
}

const baseModel: ParsedModel = base.template({
  actors: [actor({ name: "A", group: "G1" }), actor({ name: "B", group: "G2" })],
  groups: [base.group({ name: "G1" }), base.group({ name: "G2", perimeter: "External" })],
  actorTypes: [base.actorType()],
  flowTypes: [base.typeFlux()],
  interfaces: [iface()],
  consumptions: [conso()],
  fxSheetNames: ["FX_A_HTTP"],
});


// Deux acteurs dans le groupe Plateforme : c'est ce qui rend visible la
// différence entre les trois granularités de la matrix.
const modelDeuxParGroupe: ParsedModel = {
  ...baseModel,
  actors: [actor({ name: "A", group: "G1" }), actor({ name: "A2", group: "G1" }), actor({ name: "B", group: "G2" })],
  interfaces: [iface({}), iface({ flowName: "F2", providerName: "A2", expectedSheet: "FX_A2_HTTP" })],
  consumptions: [conso({}), conso({ flowName: "F2", sheet: "FX_A2_HTTP" })],
  fxSheetNames: ["FX_A_HTTP", "FX_A2_HTTP"],
};

// Flux résolus une fois par test, comme au point d'entrée réel (app.ts) : ce
// fichier ne doit pas réinventer sa propre façon d'aller du modèle aux flux.
function flows(model: ParsedModel, mode: Mode = "architecture"): ReturnType<typeof flowsForReading> {
  return flowsForReading(model, null, mode);
}

// La Lecture (flux + acteurs) que reçoivent désormais les vues qui peuvent
// dessiner un acteur isolé. `rang` par défaut à `null` : la plupart des tests
// d'ici ne portent pas sur l'axe des paliers.
function lect(model: ParsedModel, mode: Mode = "architecture", rank: number | null = null): ReturnType<typeof lectureDuMode> {
  return lectureDuMode(model, rank, mode);
}

describe("buildGroupToGroupView", () => {
  it("keys nodes by groupe", () => {
    const view = buildGroupToGroupView(baseModel, lect(baseModel), { counters: true });
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["G1", "G2"]);
    expect(view.edges).toHaveLength(1);
  });
});

describe("buildPlatformDetailView", () => {
  it("gives a plateforme actor its own node, keeps external actors grouped", () => {
    const view = buildPlatformDetailView(baseModel, lect(baseModel), { counters: true });
    expect(view.nodes.find((n) => n.id === "A")?.kind).toBe("platform");
    expect(view.nodes.find((n) => n.id === "G2")).toBeDefined();
  });

  // Le titre promettait la tolérance à la casse et aux accents, mais le modèle
  // construit ici écrivait « Platform » à l'identique : le test passait encore
  // en retirant la normalisation de groupeEstPlateforme. Le périmètre est donc
  // écrit autrement, et le nom du groupe aussi -- il se résout par la même voie.
  it("recognizes the platform perimeter regardless of case or accents", () => {
    const model: ParsedModel = {
      ...baseModel,
      groups: [
        { name: "g1", perimeter: "PLATFÔRM", sheet: "Groups", row: 0 },
        { name: "G2", perimeter: "External", sheet: "Groups", row: 0 },
      ],
    };
    const view = buildPlatformDetailView(model, lect(model), { counters: true });
    expect(view.nodes.find((n) => n.id === "A")?.kind).toBe("platform");
  });
});

describe("buildByTechnologyView", () => {
  it("keeps only flows of the selected technology, keyed by actor", () => {
    const view = buildByTechnologyView(baseModel, flows(baseModel), "HTTP", { counters: true });
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
  });

  it("returns no edges for an unused technology", () => {
    const view = buildByTechnologyView(baseModel, flows(baseModel), "Kafka", { counters: true });
    expect(view.edges).toHaveLength(0);
  });
});

describe("buildByActorView", () => {
  it("includes the selected actor and its one-hop neighbours, without dedup", () => {
    const view = buildByActorView(baseModel, flows(baseModel), "A", {});
    expect(view.nodes.find((n) => n.id === "A")?.kind).toBe("focus-actor");
    expect(view.nodes.find((n) => n.id === "B")?.kind).toBe("actor");
    expect(view.edges[0].label).toBe("F");
  });

  it("keeps self-loops visible", () => {
    const model = { ...baseModel, consumptions: [conso({ consumerName: "A" })] };
    const view = buildByActorView(model, flows(model), "A", {});
    expect(view.edges).toHaveLength(1);
  });
});

describe("buildMatrixView", () => {
  // La matrix dit « qui alimente qui », comme les schémas et comme le mode
  // fonctionnel : la ligne est le FOURNISSEUR, quelle que soit la technologie.
  // Elle portait autrefois le sens de l'appel, si bien qu'un flux HTTP y
  // apparaissait à l'envers d'un flux Kafka entre les deux mêmes acteurs.
  it("keeps a row only for what provides and a column only for what consumes", () => {
    const matrix = buildMatrixView(baseModel, lect(baseModel), { mode: "architecture" });
    expect(matrix.rows.map((l) => l.actor)).toEqual(["A"]);
    expect(matrix.columns).toEqual(["B"]);
    expect(matrix.rows[0].cellules.get("B")).toEqual([{ technology: "HTTP", count: 1, attenuated: false, names: ["F"] }]);
  });

  it("judges each axis on its own: what both emits and receives keeps a row and a column", () => {
    const model: ParsedModel = {
      ...modelDeuxParGroupe,
      // A expose F (donc reçoit de B) et consomme F2 (donc émet vers B).
      interfaces: [iface({}), iface({ flowName: "F2", providerName: "B", expectedSheet: "FX_A2_HTTP" })],
      consumptions: [conso({}), conso({ flowName: "F2", sheet: "FX_A2_HTTP", consumerName: "A" })],
    };
    const matrix = buildMatrixView(model, lect(model), { mode: "architecture" });
    expect(matrix.rows.map((l) => l.actor)).toEqual(["A", "B"]);
    expect(matrix.columns).toEqual(["A", "B"]);
  });

  it("keeps self-loop cells (unlike graphical views)", () => {
    const model = { ...baseModel, consumptions: [conso({ consumerName: "A" })] };
    const matrix = buildMatrixView(model, lect(model), { mode: "architecture" });
    const ligneA = matrix.rows.find((l) => l.actor === "A")!;
    expect(ligneA.cellules.get("A")).toBeDefined();
  });

  it("collapses actors onto their groupe when granularité is 'group'", () => {
    const matrix = buildMatrixView(modelDeuxParGroupe, lect(modelDeuxParGroupe), { mode: "architecture", granularite: "group" });
    expect(matrix.rows.map((l) => l.actor)).toEqual(["G1"]);
    expect(matrix.columns).toEqual(["G2"]);
    const ligneG1 = matrix.rows.find((l) => l.actor === "G1")!;
    expect(ligneG1.cellules.get("G2")).toEqual([{ technology: "HTTP", count: 2, attenuated: false, names: ["F", "F2"] }]);
  });

  it("details plateforme actors and collapses the rest when granularité is 'platform'", () => {
    const matrix = buildMatrixView(modelDeuxParGroupe, lect(modelDeuxParGroupe), { mode: "architecture", granularite: "platform" });
    expect(matrix.rows.map((l) => l.actor)).toEqual(["A", "A2"]);
    expect(matrix.columns).toEqual(["G2"]);
    expect(matrix.rows.find((l) => l.actor === "A")!.cellules.get("G2")).toHaveLength(1);
    expect(matrix.rows.find((l) => l.actor === "A2")!.cellules.get("G2")).toHaveLength(1);
  });

  it("puts an intra-groupe flow on the diagonal when granularité is 'group'", () => {
    const model: ParsedModel = {
      ...modelDeuxParGroupe,
      consumptions: [conso({ flowName: "F", consumerName: "A2" })],
    };
    const matrix = buildMatrixView(model, lect(model), { mode: "architecture", granularite: "group" });
    const ligneG1 = matrix.rows.find((l) => l.actor === "G1")!;
    expect(ligneG1.cellules.get("G1")).toBeDefined();
  });

  it("hides an externe groupe wholesale when granularité is 'group'", () => {
    const matrix = buildMatrixView(modelDeuxParGroupe, lect(modelDeuxParGroupe), {
      mode: "architecture",
      granularite: "group",
      masquerExternes: true,
    });
    expect(matrix.columns).toEqual([]);
    expect(matrix.rows).toEqual([]);
  });

  it("masks a whole groupe by its own name when granularité is 'group'", () => {
    const matrix = buildMatrixView(modelDeuxParGroupe, lect(modelDeuxParGroupe), {
      mode: "architecture",
      granularite: "group",
      hiddenActors: ["G1"],
    });
    expect(matrix.columns).toEqual([]);
    expect(matrix.rows).toEqual([]);
  });
});

describe("optionsFiltreMatrice", () => {
  it("lists actors when granularité is 'actor'", () => {
    expect(optionsFiltreMatrice(modelDeuxParGroupe, flows(modelDeuxParGroupe), { granularite: "actor" })).toEqual(["A", "A2", "B"]);
  });

  it("lists groupes when granularité is 'group'", () => {
    expect(optionsFiltreMatrice(modelDeuxParGroupe, flows(modelDeuxParGroupe), { granularite: "group" })).toEqual(["G1", "G2"]);
  });

  it("drops externe groupes when the switch is on", () => {
    expect(
      optionsFiltreMatrice(modelDeuxParGroupe, flows(modelDeuxParGroupe), { granularite: "group", masquerExternes: true })
    ).toEqual(["G1"]);
  });
});

describe("buildByActorView — version au libellé", () => {
  const modelVersionne: ParsedModel = {
    ...baseModel,
    interfaces: [iface({ version: "1.0" })],
    consumptions: [conso({ version: "1.0" })],
  };

  it("nomme le contrat exposé avec sa version", () => {
    const view = buildByActorView(modelVersionne, flows(modelVersionne), "A", {});
    expect(view.edges[0].label).toBe("F 1.0");
  });

  // Un classeur qui ne versionne pas ne doit pas se mettre à afficher un
  // espace en trop derrière chaque nom.
  it("s'en tient au nom quand la version est vide", () => {
    const view = buildByActorView(baseModel, flows(baseModel), "A", {});
    expect(view.edges[0].label).toBe("F");
  });

  // Le rattachement tolère la casse et les espaces, mais le libellé affiche
  // l'orthographe du CATALOGUE : c'est le contrat exposé qu'on désigne, pas la
  // façon dont un consommateur l'a recopié.
  it("affiche l'orthographe du catalogue, pas celle saisie côté consommation", () => {
    const model: ParsedModel = {
      ...baseModel,
      interfaces: [iface({ version: "V2 " })],
      consumptions: [conso({ version: "v2" })],
    };
    const view = buildByActorView(model, flows(model), "A", {});
    expect(view.edges[0].label).toBe("F V2");
  });
});

describe("mode fonctionnel", () => {
  // Tatooine expose Transactions ; Bus (Middleware, Technical) la relaie sous
  // trx.norm vers Naboo : la chaîne fonctionnelle relie Tatooine à
  // Naboo, Bus retiré.
  function estate(): ParsedModel {
    return {
      actors: [
        actor({ name: "Tatooine", actorType: "Application", group: "Socle" }),
        actor({ name: "Bus", actorType: "Middleware", group: "Socle" }),
        actor({ name: "Naboo", actorType: "Application", group: "Finance" }),
      ],
      groups: [
        { name: "Socle", perimeter: "Platform", sheet: "Groups", row: 0 },
        { name: "Finance", perimeter: "External", sheet: "Groups", row: 0 },
      ],
      groupsSheetMissing: false,
      actorTypes: [
        { type: "Application", icon: "", nature: "Business", sheet: "ActorTypes", row: 0 },
        { type: "Middleware", icon: "", nature: "Technical", sheet: "ActorTypes", row: 0 },
      ],
      milestones: [],
      flowTypes: [
        base.typeFlux({ type: "HTTP" }),
      ],
      interfaces: [
        iface({ flowName: "Transactions", providerName: "Tatooine", expectedSheet: "FX_Tatooine_HTTP" }),
        iface({ flowName: "trx.norm", providerName: "Bus", expectedSheet: "FX_Bus_HTTP" }),
      ],
      consumptions: [
        conso({ flowName: "Transactions", consumerName: "Bus", sheet: "FX_Tatooine_HTTP", republishedAs: "trx.norm" }),
        conso({ flowName: "trx.norm", consumerName: "Naboo", sheet: "FX_Bus_HTTP" }),
      ],
      fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
      missingOptionalColumns: [],
      schemaVersion: VERSION_MODELE,
      savedAt: null,
    };
  }

  const options = (mode: Mode) => ({ counters: true, mode });

  it("laisse le mode architecture inchangé", () => {
    const m = estate();
    const view = buildPlatformDetailView(m, lect(m, "architecture"), options("architecture"));
    expect(view.nodes.map((n) => n.id)).toContain("Bus");
  });

  it("retire l'acteur technique en mode fonctionnel", () => {
    const m = estate();
    const view = buildPlatformDetailView(m, lect(m, "functional"), options("functional"));
    expect(view.nodes.map((n) => n.id)).not.toContain("Bus");
  });

  it("relie la source au consommateur en mode fonctionnel", () => {
    const m = estate();
    const view = buildPlatformDetailView(m, lect(m, "functional"), options("functional"));
    expect(view.edges).toHaveLength(1);
    expect([view.edges[0].from, view.edges[0].to]).toEqual(["Tatooine", "Finance"]);
  });

  // Sans technologie, deux échanges entre les mêmes applications fusionnent en
  // un seul trait, quel que soit le médium qui les portait.
  it("fusionne les traits sans distinguer les technologies", () => {
    const m = estate();
    m.interfaces.push(iface({ flowName: "Autre", providerName: "Tatooine", flowType: "Kafka", expectedSheet: "FX_Tatooine_Kafka" }));
    m.consumptions.push(conso({ flowName: "Autre", consumerName: "Naboo", sheet: "FX_Tatooine_Kafka" }));
    m.flowTypes.push(base.typeFlux({ type: "Kafka", direction: "provider-to-consumer", rawDirection: "provider → consumer" }));
    m.fxSheetNames.push("FX_Tatooine_Kafka");
    const view = buildPlatformDetailView(m, lect(m, "functional"), options("functional"));
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0].count).toBe(2);
  });

  // La matrix est la seule vue où la cellule montre encore la technologie :
  // en fonctionnel elle doit se vider comme partout ailleurs, et le rendu
  // (matrix-table.ts) n'a de sens que si cette donnée lui arrive bien vide.
  it("vide la technologie des cellules de la matrix en mode fonctionnel", () => {
    const m = estate();
    // Tatooine fournit, le Bus consomme : la ligne est donc celle du fournisseur,
    // même en HTTP où c'est le Bus qui passe l'appel.
    const architecture = buildMatrixView(m, lect(m, "architecture"), { mode: "architecture" });
    const ligneTatooineArchi = architecture.rows.find((l) => l.actor === "Tatooine")!;
    expect(ligneTatooineArchi.cellules.get("Bus")).toEqual([{ technology: "HTTP", count: 1, attenuated: false, names: ["Transactions"] }]);

    const fonctionnel = buildMatrixView(m, lect(m, "functional"), { mode: "functional" });
    expect(fonctionnel.rows.map((l) => l.actor)).not.toContain("Bus");
    const ligneTatooine = fonctionnel.rows.find((l) => l.actor === "Tatooine")!;
    expect(ligneTatooine.cellules.get("Naboo")).toEqual([{ technology: "", count: 1, attenuated: false, names: ["Transactions"] }]);
  });

  // Une technologie vide n'en est pas une : la proposer comme filtre produit
  // une case sans étiquette, qui vide tout le schéma en un clic sans rien
  // expliquer.
  it("ne propose aucune technologie à filtrer en mode fonctionnel", () => {
    const m = estate();
    const options = optionsFiltreActeur(flows(m, "functional"), "Tatooine");
    expect(options.technologies).toEqual([]);
  });

  // §5.2 : un acteur métier devenu isolé -- dont les échanges passaient tous
  // par des chaînes coupées -- reste affiché, seul. Le faire disparaître
  // retirerait de l'information sans le dire.
  describe("acteur métier isolé", () => {
    it("reste affiché, à travers son groupe, en groupe à groupe", () => {
      const m = estate();
      m.actors.push(actor({ name: "Isolé", actorType: "Application", group: "Ops" }));
      m.groups.push({ name: "Ops", perimeter: "External", sheet: "Groups", row: 0 });
      const view = buildGroupToGroupView(m, lect(m, "functional"), options("functional"));
      expect(view.nodes.map((n) => n.id)).toContain("Ops");
    });

    it("garde son propre nœud en plateforme détaillée quand c'est un composant de la plateforme", () => {
      const m = estate();
      m.actors.push(actor({ name: "Isolé", actorType: "Application", group: "Socle" }));
      const view = buildPlatformDetailView(m, lect(m, "functional"), options("functional"));
      const node = view.nodes.find((n) => n.id === "Isolé");
      expect(node?.kind).toBe("platform");
    });

    it("reste affiché en plateforme seule quand c'est un composant de la plateforme", () => {
      const m = estate();
      m.actors.push(actor({ name: "Isolé", actorType: "Application", group: "Socle" }));
      const view = buildPlatformOnlyView(m, lect(m, "functional"), options("functional"));
      expect(view.nodes.map((n) => n.id)).toContain("Isolé");
    });

    it("garde une ligne vide dans la matrix", () => {
      const m = estate();
      m.actors.push(actor({ name: "Isolé", actorType: "Application", group: "Ops" }));
      m.groups.push({ name: "Ops", perimeter: "External", sheet: "Groups", row: 0 });
      const matrix = buildMatrixView(m, lect(m, "functional"), { mode: "functional" });
      const row = matrix.rows.find((l) => l.actor === "Isolé");
      expect(row).toBeDefined();
      expect(row?.cellules.size).toBe(0);
    });

    // Un acteur isolé retiré au palier affiché n'est plus un acteur métier
    // isolé : il n'est plus DU TOUT sur la carte. §5.2 garde sa boîte tant
    // qu'il vit, pas au-delà.
    describe("retiré à un palier", () => {
      const milestones = [
        { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
        { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
      ];
      function withIsolatedRetired(): ParsedModel {
        const m = estate();
        m.milestones = milestones;
        m.actors.push(
          actor({ name: "Isolé", actorType: "Application", group: "Socle", introducedAt: "v1", retiredAt: "v2" })
        );
        return m;
      }

      it("garde sa boîte au palier où il vit encore", () => {
        const m = withIsolatedRetired();
        const view = buildPlatformDetailView(m, lect(m, "functional", 1), options("functional"));
        expect(view.nodes.map((n) => n.id)).toContain("Isolé");
      });

      it("perd sa boîte en plateforme détaillée au palier où il est retiré", () => {
        const m = withIsolatedRetired();
        const view = buildPlatformDetailView(m, lect(m, "functional", 2), options("functional"));
        expect(view.nodes.map((n) => n.id)).not.toContain("Isolé");
      });

      it("perd sa boîte en plateforme seule au palier où il est retiré", () => {
        const m = withIsolatedRetired();
        const view = buildPlatformOnlyView(m, lect(m, "functional", 2), options("functional"));
        expect(view.nodes.map((n) => n.id)).not.toContain("Isolé");
      });

      it("perd sa ligne de matrix au palier où il est retiré", () => {
        const m = withIsolatedRetired();
        const matrix = buildMatrixView(m, lect(m, "functional", 2), { mode: "functional" });
        expect(matrix.rows.map((l) => l.actor)).not.toContain("Isolé");
      });
    });
  });
});

// --- Le cadre de la plateforme portait « Plateforme » en français dans une
// interface entièrement anglaise, reste d'avant la traduction. Aucun test ne le
// regardait, d'où sa survie.
describe("frontière de la plateforme", () => {
  // Le cadre n'existe qu'à partir de deux composants de plateforme : en dessous
  // il n'apporterait rien.
  it("porte son nom dans la langue de l'interface", () => {
    const m: ParsedModel = {
      ...baseModel,
      actors: [actor({ name: "A", group: "G1" }), actor({ name: "C", group: "G1" }), actor({ name: "B", group: "G2" })],
    };
    const view = buildPlatformDetailView(m, lect(m), { counters: true });
    expect(view.nodes.find((n) => n.kind === "boundary")?.label).toBe("Platform");
  });
});

// --- QA : le trait suit la DONNÉE, du fournisseur vers le consommateur, et la
// pointe dit qui appelle. buildByActorView fabrique ses arêtes sans passer par
// groupFlows : elle avait gardé l'ancienne convention et inversait le trait
// sur un flux tiré. Ces planches partent dans le fichier draw.io -- un seul
// fichier racontait donc deux architectures selon l'onglet ouvert.
// ---------------------------------------------------------------------------
// 1. Le sens du trait, dans la vue « By actor » et dans les onglets draw.io
//    qu'elle produit.
// ---------------------------------------------------------------------------

const pulledEstate = () =>
  base.template({
    actors: [base.actor({ name: "Fournisseur" }), base.actor({ name: "Consommateur" })],
    groups: [base.group({ name: "G" })],
    actorTypes: [base.actorType()],
    // HTTP est tiré : « consumer → provider ».
    flowTypes: [base.typeFlux({ type: "HTTP", direction: "consumer-to-provider" })],
    interfaces: [base.iface({ flowName: "F", providerName: "Fournisseur" })],
    consumptions: [base.conso({ flowName: "F", consumerName: "Consommateur" })],
  });

describe("le trait va du fournisseur au consommateur, partout", () => {
  it("les vues agrégées et la matrix suivent la donnée", () => {
    const m = pulledEstate();
    const g = groupFlows(buildFlowInstances(m), identityNodeKey, true)[0];
    expect([g.from, g.to, g.pulled]).toEqual(["Fournisseur", "Consommateur", true]);
    const mat = buildMatrixView(m, lectureDuMode(m, null, "architecture"), { mode: "architecture" });
    expect(mat.rows.map((l) => l.actor)).toEqual(["Fournisseur"]);
  });

  it("la vue « By actor » aussi, alors qu'elle fabrique ses arêtes elle-même", () => {
    const m = pulledEstate();
    const edge = buildByActorView(m, buildFlowInstances(m), "Fournisseur", {}).edges[0];
    expect([edge.from, edge.to, edge.pulled]).toEqual(["Fournisseur", "Consommateur", true]);
  });

  it("toutes les planches d'un même fichier draw.io racontent la même architecture", async () => {
    const m = pulledEstate();
    const placed = [];
    for (const p of toutesLesPlanches(m, null, "architecture")) {
      placed.push({ title: p.title, actor: p.actor, layout: await computeLayout(p.nodes, p.edges) });
    }
    const xml = buildDrawio(placed, () => "#000");
    const direction = xml
      .split("<diagram ")
      .slice(1)
      .map((page) => {
        const title = /name="([^"]+)"/.exec(page)![1];
        const edge = /<mxCell id="[^"]*_e0"[^>]*source="([^"]*)" target="([^"]*)"/.exec(page);
        return edge ? `${title} : ${edge[1].replace(/^p\d+_/, "")} → ${edge[2].replace(/^p\d+_/, "")}` : null;
      })
      .filter((x): x is string => x !== null);
    expect(direction.every((s) => s.includes("Fournisseur → Consommateur"))).toBe(true);
  });
});

// --- QA : la criticité se perdait entre l'agrégation et le rendu. Le réglage
// « épaisseur par criticité » était donc coché et sans effet -- un réglage qui
// ne fait rien est pire qu'un réglage absent.
describe("les vues transportent la criticité jusqu'au trait", () => {
  const estate = () =>
    base.template({
      groups: [{ name: "Socle", perimeter: "Platform", sheet: "Groups", row: 0 }],
      actorTypes: [base.actorType()],
      flowTypes: [base.typeFlux()],
      fxSheetNames: ["FX_A_HTTP"],
      actors: [base.actor({ name: "A", group: "Socle" }), base.actor({ name: "B", group: "Socle" })],
      interfaces: [base.iface({ flowName: "F", providerName: "A", expectedSheet: "FX_A_HTTP" })],
      consumptions: [
        base.conso({ flowName: "F", consumerName: "B", sheet: "FX_A_HTTP", criticality: "1 - Critical" }),
      ],
    });

  it("la porte à travers les vues agrégées", () => {
    const m = estate();
    const view = buildPlatformDetailView(m, lectureDuMode(m, null, "architecture"), { counters: true });
    expect(view.edges[0].criticality).toBe("1 - Critical");
  });

  // Cette vue fabrique ses arêtes elle-même, sans passer par l'agrégation :
  // c'est exactement là qu'un champ nouveau se perd.
  it("la porte aussi dans la vue par acteur, qui fabrique ses arêtes à part", () => {
    const m = estate();
    const view = buildByActorView(m, lectureDuMode(m, null, "architecture").flows, "A", {});
    expect(view.edges[0].criticality).toBe("1 - Critical");
  });
});
