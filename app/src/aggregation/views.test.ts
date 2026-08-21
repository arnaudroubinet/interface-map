import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
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
import { fluxDuMode, lecture as lectureDuMode } from "./fonctionnel";
import type { Mode } from "./core";
import { VERSION_MODELE } from "../parsing/build-model";
import type { ParsedModel, Acteur, InterfaceCatalogue, Consommation } from "../parsing/model";

// Les fabriques partagées ; ce fichier ne leur ajoute que ses deux groupes et
// une consommation déjà décidée.
function acteur(o: Partial<Acteur> = {}): Acteur {
  return base.acteur({ groupe: "G1", ...o });
}
const iface = base.iface;
function conso(o: Partial<Consommation> = {}): Consommation {
  return base.conso({ statut: "Actif", decision: "Keep", ...o });
}

const baseModel: ParsedModel = base.modele({
  acteurs: [acteur({ nom: "A", groupe: "G1" }), acteur({ nom: "B", groupe: "G2" })],
  groupes: [base.groupe({ nom: "G1" }), base.groupe({ nom: "G2", perimetre: "External" })],
  typesActeur: [base.typeActeur()],
  typesFlux: [base.typeFlux()],
  interfaces: [iface()],
  consommations: [conso()],
  fxSheetNames: ["FX_A_HTTP"],
});


// Deux acteurs dans le groupe Plateforme : c'est ce qui rend visible la
// différence entre les trois granularités de la matrice.
const modelDeuxParGroupe: ParsedModel = {
  ...baseModel,
  acteurs: [acteur({ nom: "A", groupe: "G1" }), acteur({ nom: "A2", groupe: "G1" }), acteur({ nom: "B", groupe: "G2" })],
  interfaces: [iface({}), iface({ nomDuFlux: "F2", acteurExposant: "A2", feuilleAttendue: "FX_A2_HTTP" })],
  consommations: [conso({}), conso({ nomDuFlux: "F2", feuille: "FX_A2_HTTP" })],
  fxSheetNames: ["FX_A_HTTP", "FX_A2_HTTP"],
};

// Flux résolus une fois par test, comme au point d'entrée réel (app.ts) : ce
// fichier ne doit pas réinventer sa propre façon d'aller du modèle aux flux.
function flux(model: ParsedModel, mode: Mode = "architecture"): ReturnType<typeof fluxDuMode> {
  return fluxDuMode(model, null, mode);
}

// La Lecture (flux + acteurs) que reçoivent désormais les vues qui peuvent
// dessiner un acteur isolé. `rang` par défaut à `null` : la plupart des tests
// d'ici ne portent pas sur l'axe des paliers.
function lect(model: ParsedModel, mode: Mode = "architecture", rang: number | null = null): ReturnType<typeof lectureDuMode> {
  return lectureDuMode(model, rang, mode);
}

describe("buildGroupToGroupView", () => {
  it("keys nodes by groupe", () => {
    const view = buildGroupToGroupView(baseModel, lect(baseModel), { compteurs: true });
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["G1", "G2"]);
    expect(view.edges).toHaveLength(1);
  });
});

describe("buildPlatformDetailView", () => {
  it("gives a plateforme actor its own node, keeps external actors grouped", () => {
    const view = buildPlatformDetailView(baseModel, lect(baseModel), { compteurs: true });
    expect(view.nodes.find((n) => n.id === "A")?.kind).toBe("plateforme");
    expect(view.nodes.find((n) => n.id === "G2")).toBeDefined();
  });

  // Le titre promettait la tolérance à la casse et aux accents, mais le modèle
  // construit ici écrivait « Platform » à l'identique : le test passait encore
  // en retirant la normalisation de groupeEstPlateforme. Le périmètre est donc
  // écrit autrement, et le nom du groupe aussi -- il se résout par la même voie.
  it("recognizes the platform perimeter regardless of case or accents", () => {
    const model: ParsedModel = {
      ...baseModel,
      groupes: [
        { nom: "g1", perimetre: "PLATFÔRM", feuille: "Groups", ligne: 0 },
        { nom: "G2", perimetre: "External", feuille: "Groups", ligne: 0 },
      ],
    };
    const view = buildPlatformDetailView(model, lect(model), { compteurs: true });
    expect(view.nodes.find((n) => n.id === "A")?.kind).toBe("plateforme");
  });
});

describe("buildByTechnologyView", () => {
  it("keeps only flows of the selected technology, keyed by actor", () => {
    const view = buildByTechnologyView(baseModel, flux(baseModel), "HTTP", { compteurs: true });
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
  });

  it("returns no edges for an unused technology", () => {
    const view = buildByTechnologyView(baseModel, flux(baseModel), "Kafka", { compteurs: true });
    expect(view.edges).toHaveLength(0);
  });
});

describe("buildByActorView", () => {
  it("includes the selected actor and its one-hop neighbours, without dedup", () => {
    const view = buildByActorView(baseModel, flux(baseModel), "A", {});
    expect(view.nodes.find((n) => n.id === "A")?.kind).toBe("acteur-selectionne");
    expect(view.nodes.find((n) => n.id === "B")?.kind).toBe("acteur");
    expect(view.edges[0].label).toBe("F");
  });

  it("keeps self-loops visible", () => {
    const model = { ...baseModel, consommations: [conso({ acteurConsommateur: "A" })] };
    const view = buildByActorView(model, flux(model), "A", {});
    expect(view.edges).toHaveLength(1);
  });
});

describe("buildMatrixView", () => {
  // La matrice dit « qui alimente qui », comme les schémas et comme le mode
  // fonctionnel : la ligne est le FOURNISSEUR, quelle que soit la technologie.
  // Elle portait autrefois le sens de l'appel, si bien qu'un flux HTTP y
  // apparaissait à l'envers d'un flux Kafka entre les deux mêmes acteurs.
  it("keeps a row only for what provides and a column only for what consumes", () => {
    const matrix = buildMatrixView(baseModel, lect(baseModel), { mode: "architecture" });
    expect(matrix.lignes.map((l) => l.acteur)).toEqual(["A"]);
    expect(matrix.colonnes).toEqual(["B"]);
    expect(matrix.lignes[0].cellules.get("B")).toEqual([{ technologie: "HTTP", count: 1, atténué: false, noms: ["F"] }]);
  });

  it("judges each axis on its own: what both emits and receives keeps a row and a column", () => {
    const model: ParsedModel = {
      ...modelDeuxParGroupe,
      // A expose F (donc reçoit de B) et consomme F2 (donc émet vers B).
      interfaces: [iface({}), iface({ nomDuFlux: "F2", acteurExposant: "B", feuilleAttendue: "FX_A2_HTTP" })],
      consommations: [conso({}), conso({ nomDuFlux: "F2", feuille: "FX_A2_HTTP", acteurConsommateur: "A" })],
    };
    const matrix = buildMatrixView(model, lect(model), { mode: "architecture" });
    expect(matrix.lignes.map((l) => l.acteur)).toEqual(["A", "B"]);
    expect(matrix.colonnes).toEqual(["A", "B"]);
  });

  it("keeps self-loop cells (unlike graphical views)", () => {
    const model = { ...baseModel, consommations: [conso({ acteurConsommateur: "A" })] };
    const matrix = buildMatrixView(model, lect(model), { mode: "architecture" });
    const ligneA = matrix.lignes.find((l) => l.acteur === "A")!;
    expect(ligneA.cellules.get("A")).toBeDefined();
  });

  it("collapses actors onto their groupe when granularité is 'groupe'", () => {
    const matrix = buildMatrixView(modelDeuxParGroupe, lect(modelDeuxParGroupe), { mode: "architecture", granularite: "groupe" });
    expect(matrix.lignes.map((l) => l.acteur)).toEqual(["G1"]);
    expect(matrix.colonnes).toEqual(["G2"]);
    const ligneG1 = matrix.lignes.find((l) => l.acteur === "G1")!;
    expect(ligneG1.cellules.get("G2")).toEqual([{ technologie: "HTTP", count: 2, atténué: false, noms: ["F", "F2"] }]);
  });

  it("details plateforme actors and collapses the rest when granularité is 'plateforme'", () => {
    const matrix = buildMatrixView(modelDeuxParGroupe, lect(modelDeuxParGroupe), { mode: "architecture", granularite: "plateforme" });
    expect(matrix.lignes.map((l) => l.acteur)).toEqual(["A", "A2"]);
    expect(matrix.colonnes).toEqual(["G2"]);
    expect(matrix.lignes.find((l) => l.acteur === "A")!.cellules.get("G2")).toHaveLength(1);
    expect(matrix.lignes.find((l) => l.acteur === "A2")!.cellules.get("G2")).toHaveLength(1);
  });

  it("puts an intra-groupe flow on the diagonal when granularité is 'groupe'", () => {
    const model: ParsedModel = {
      ...modelDeuxParGroupe,
      consommations: [conso({ nomDuFlux: "F", acteurConsommateur: "A2" })],
    };
    const matrix = buildMatrixView(model, lect(model), { mode: "architecture", granularite: "groupe" });
    const ligneG1 = matrix.lignes.find((l) => l.acteur === "G1")!;
    expect(ligneG1.cellules.get("G1")).toBeDefined();
  });

  it("hides an externe groupe wholesale when granularité is 'groupe'", () => {
    const matrix = buildMatrixView(modelDeuxParGroupe, lect(modelDeuxParGroupe), {
      mode: "architecture",
      granularite: "groupe",
      masquerExternes: true,
    });
    expect(matrix.colonnes).toEqual([]);
    expect(matrix.lignes).toEqual([]);
  });

  it("masks a whole groupe by its own name when granularité is 'groupe'", () => {
    const matrix = buildMatrixView(modelDeuxParGroupe, lect(modelDeuxParGroupe), {
      mode: "architecture",
      granularite: "groupe",
      acteursMasques: ["G1"],
    });
    expect(matrix.colonnes).toEqual([]);
    expect(matrix.lignes).toEqual([]);
  });
});

describe("optionsFiltreMatrice", () => {
  it("lists actors when granularité is 'acteur'", () => {
    expect(optionsFiltreMatrice(modelDeuxParGroupe, flux(modelDeuxParGroupe), { granularite: "acteur" })).toEqual(["A", "A2", "B"]);
  });

  it("lists groupes when granularité is 'groupe'", () => {
    expect(optionsFiltreMatrice(modelDeuxParGroupe, flux(modelDeuxParGroupe), { granularite: "groupe" })).toEqual(["G1", "G2"]);
  });

  it("drops externe groupes when the switch is on", () => {
    expect(
      optionsFiltreMatrice(modelDeuxParGroupe, flux(modelDeuxParGroupe), { granularite: "groupe", masquerExternes: true })
    ).toEqual(["G1"]);
  });
});

describe("buildByActorView — version au libellé", () => {
  const modelVersionne: ParsedModel = {
    ...baseModel,
    interfaces: [iface({ version: "1.0" })],
    consommations: [conso({ version: "1.0" })],
  };

  it("nomme le contrat exposé avec sa version", () => {
    const view = buildByActorView(modelVersionne, flux(modelVersionne), "A", {});
    expect(view.edges[0].label).toBe("F 1.0");
  });

  // Un classeur qui ne versionne pas ne doit pas se mettre à afficher un
  // espace en trop derrière chaque nom.
  it("s'en tient au nom quand la version est vide", () => {
    const view = buildByActorView(baseModel, flux(baseModel), "A", {});
    expect(view.edges[0].label).toBe("F");
  });

  // Le rattachement tolère la casse et les espaces, mais le libellé affiche
  // l'orthographe du CATALOGUE : c'est le contrat exposé qu'on désigne, pas la
  // façon dont un consommateur l'a recopié.
  it("affiche l'orthographe du catalogue, pas celle saisie côté consommation", () => {
    const model: ParsedModel = {
      ...baseModel,
      interfaces: [iface({ version: "V2 " })],
      consommations: [conso({ version: "v2" })],
    };
    const view = buildByActorView(model, flux(model), "A", {});
    expect(view.edges[0].label).toBe("F V2");
  });
});

describe("mode fonctionnel", () => {
  // Tatooine expose Transactions ; Bus (Middleware, Technical) la relaie sous
  // trx.norm vers Naboo : la chaîne fonctionnelle relie Tatooine à
  // Naboo, Bus retiré.
  function parc(): ParsedModel {
    return {
      acteurs: [
        acteur({ nom: "Tatooine", typeActeur: "Application", groupe: "Socle" }),
        acteur({ nom: "Bus", typeActeur: "Middleware", groupe: "Socle" }),
        acteur({ nom: "Naboo", typeActeur: "Application", groupe: "Finance" }),
      ],
      groupes: [
        { nom: "Socle", perimetre: "Platform", feuille: "Groups", ligne: 0 },
        { nom: "Finance", perimetre: "External", feuille: "Groups", ligne: 0 },
      ],
      groupesAbsents: false,
      typesActeur: [
        { type: "Application", icone: "", nature: "Business", feuille: "ActorTypes", ligne: 0 },
        { type: "Middleware", icone: "", nature: "Technical", feuille: "ActorTypes", ligne: 0 },
      ],
      paliers: [],
      typesFlux: [
        base.typeFlux({ type: "HTTP" }),
      ],
      interfaces: [
        iface({ nomDuFlux: "Transactions", acteurExposant: "Tatooine", feuilleAttendue: "FX_Tatooine_HTTP" }),
        iface({ nomDuFlux: "trx.norm", acteurExposant: "Bus", feuilleAttendue: "FX_Bus_HTTP" }),
      ],
      consommations: [
        conso({ nomDuFlux: "Transactions", acteurConsommateur: "Bus", feuille: "FX_Tatooine_HTTP", republiePar: "trx.norm" }),
        conso({ nomDuFlux: "trx.norm", acteurConsommateur: "Naboo", feuille: "FX_Bus_HTTP" }),
      ],
      fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
      colonnesOptionnellesAbsentes: [],
      versionModele: VERSION_MODELE,
      fichierModifie: null,
    };
  }

  const options = (mode: Mode) => ({ compteurs: true, mode });

  it("laisse le mode architecture inchangé", () => {
    const m = parc();
    const vue = buildPlatformDetailView(m, lect(m, "architecture"), options("architecture"));
    expect(vue.nodes.map((n) => n.id)).toContain("Bus");
  });

  it("retire l'acteur technique en mode fonctionnel", () => {
    const m = parc();
    const vue = buildPlatformDetailView(m, lect(m, "fonctionnel"), options("fonctionnel"));
    expect(vue.nodes.map((n) => n.id)).not.toContain("Bus");
  });

  it("relie la source au consommateur en mode fonctionnel", () => {
    const m = parc();
    const vue = buildPlatformDetailView(m, lect(m, "fonctionnel"), options("fonctionnel"));
    expect(vue.edges).toHaveLength(1);
    expect([vue.edges[0].from, vue.edges[0].to]).toEqual(["Tatooine", "Finance"]);
  });

  // Sans technologie, deux échanges entre les mêmes applications fusionnent en
  // un seul trait, quel que soit le médium qui les portait.
  it("fusionne les traits sans distinguer les technologies", () => {
    const m = parc();
    m.interfaces.push(iface({ nomDuFlux: "Autre", acteurExposant: "Tatooine", typeDeFlux: "Kafka", feuilleAttendue: "FX_Tatooine_Kafka" }));
    m.consommations.push(conso({ nomDuFlux: "Autre", acteurConsommateur: "Naboo", feuille: "FX_Tatooine_Kafka" }));
    m.typesFlux.push(base.typeFlux({ type: "Kafka", sensRepresentation: "exposant-consommateur", sensRepresentationBrut: "provider → consumer" }));
    m.fxSheetNames.push("FX_Tatooine_Kafka");
    const vue = buildPlatformDetailView(m, lect(m, "fonctionnel"), options("fonctionnel"));
    expect(vue.edges).toHaveLength(1);
    expect(vue.edges[0].count).toBe(2);
  });

  // La matrice est la seule vue où la cellule montre encore la technologie :
  // en fonctionnel elle doit se vider comme partout ailleurs, et le rendu
  // (matrix-table.ts) n'a de sens que si cette donnée lui arrive bien vide.
  it("vide la technologie des cellules de la matrice en mode fonctionnel", () => {
    const m = parc();
    // Tatooine fournit, le Bus consomme : la ligne est donc celle du fournisseur,
    // même en HTTP où c'est le Bus qui passe l'appel.
    const architecture = buildMatrixView(m, lect(m, "architecture"), { mode: "architecture" });
    const ligneTatooineArchi = architecture.lignes.find((l) => l.acteur === "Tatooine")!;
    expect(ligneTatooineArchi.cellules.get("Bus")).toEqual([{ technologie: "HTTP", count: 1, atténué: false, noms: ["Transactions"] }]);

    const fonctionnel = buildMatrixView(m, lect(m, "fonctionnel"), { mode: "fonctionnel" });
    expect(fonctionnel.lignes.map((l) => l.acteur)).not.toContain("Bus");
    const ligneTatooine = fonctionnel.lignes.find((l) => l.acteur === "Tatooine")!;
    expect(ligneTatooine.cellules.get("Naboo")).toEqual([{ technologie: "", count: 1, atténué: false, noms: ["Transactions"] }]);
  });

  // Une technologie vide n'en est pas une : la proposer comme filtre produit
  // une case sans étiquette, qui vide tout le schéma en un clic sans rien
  // expliquer.
  it("ne propose aucune technologie à filtrer en mode fonctionnel", () => {
    const m = parc();
    const options = optionsFiltreActeur(flux(m, "fonctionnel"), "Tatooine");
    expect(options.technologies).toEqual([]);
  });

  // §5.2 : un acteur métier devenu isolé -- dont les échanges passaient tous
  // par des chaînes coupées -- reste affiché, seul. Le faire disparaître
  // retirerait de l'information sans le dire.
  describe("acteur métier isolé", () => {
    it("reste affiché, à travers son groupe, en groupe à groupe", () => {
      const m = parc();
      m.acteurs.push(acteur({ nom: "Isolé", typeActeur: "Application", groupe: "Ops" }));
      m.groupes.push({ nom: "Ops", perimetre: "External", feuille: "Groups", ligne: 0 });
      const vue = buildGroupToGroupView(m, lect(m, "fonctionnel"), options("fonctionnel"));
      expect(vue.nodes.map((n) => n.id)).toContain("Ops");
    });

    it("garde son propre nœud en plateforme détaillée quand c'est un composant de la plateforme", () => {
      const m = parc();
      m.acteurs.push(acteur({ nom: "Isolé", typeActeur: "Application", groupe: "Socle" }));
      const vue = buildPlatformDetailView(m, lect(m, "fonctionnel"), options("fonctionnel"));
      const noeud = vue.nodes.find((n) => n.id === "Isolé");
      expect(noeud?.kind).toBe("plateforme");
    });

    it("reste affiché en plateforme seule quand c'est un composant de la plateforme", () => {
      const m = parc();
      m.acteurs.push(acteur({ nom: "Isolé", typeActeur: "Application", groupe: "Socle" }));
      const vue = buildPlatformOnlyView(m, lect(m, "fonctionnel"), options("fonctionnel"));
      expect(vue.nodes.map((n) => n.id)).toContain("Isolé");
    });

    it("garde une ligne vide dans la matrice", () => {
      const m = parc();
      m.acteurs.push(acteur({ nom: "Isolé", typeActeur: "Application", groupe: "Ops" }));
      m.groupes.push({ nom: "Ops", perimetre: "External", feuille: "Groups", ligne: 0 });
      const matrix = buildMatrixView(m, lect(m, "fonctionnel"), { mode: "fonctionnel" });
      const ligne = matrix.lignes.find((l) => l.acteur === "Isolé");
      expect(ligne).toBeDefined();
      expect(ligne?.cellules.size).toBe(0);
    });

    // Un acteur isolé retiré au palier affiché n'est plus un acteur métier
    // isolé : il n'est plus DU TOUT sur la carte. §5.2 garde sa boîte tant
    // qu'il vit, pas au-delà.
    describe("retiré à un palier", () => {
      const paliers = [
        { nom: "v1", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
        { nom: "v2", rang: 2, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
      ];
      function avecIsoléRetiré(): ParsedModel {
        const m = parc();
        m.paliers = paliers;
        m.acteurs.push(
          acteur({ nom: "Isolé", typeActeur: "Application", groupe: "Socle", palierIntroduction: "v1", palierRetrait: "v2" })
        );
        return m;
      }

      it("garde sa boîte au palier où il vit encore", () => {
        const m = avecIsoléRetiré();
        const vue = buildPlatformDetailView(m, lect(m, "fonctionnel", 1), options("fonctionnel"));
        expect(vue.nodes.map((n) => n.id)).toContain("Isolé");
      });

      it("perd sa boîte en plateforme détaillée au palier où il est retiré", () => {
        const m = avecIsoléRetiré();
        const vue = buildPlatformDetailView(m, lect(m, "fonctionnel", 2), options("fonctionnel"));
        expect(vue.nodes.map((n) => n.id)).not.toContain("Isolé");
      });

      it("perd sa boîte en plateforme seule au palier où il est retiré", () => {
        const m = avecIsoléRetiré();
        const vue = buildPlatformOnlyView(m, lect(m, "fonctionnel", 2), options("fonctionnel"));
        expect(vue.nodes.map((n) => n.id)).not.toContain("Isolé");
      });

      it("perd sa ligne de matrice au palier où il est retiré", () => {
        const m = avecIsoléRetiré();
        const matrix = buildMatrixView(m, lect(m, "fonctionnel", 2), { mode: "fonctionnel" });
        expect(matrix.lignes.map((l) => l.acteur)).not.toContain("Isolé");
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
      acteurs: [acteur({ nom: "A", groupe: "G1" }), acteur({ nom: "C", groupe: "G1" }), acteur({ nom: "B", groupe: "G2" })],
    };
    const view = buildPlatformDetailView(m, lect(m), { compteurs: true });
    expect(view.nodes.find((n) => n.kind === "frontiere")?.label).toBe("Platform");
  });
});
