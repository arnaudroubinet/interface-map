import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { construireFrise } from "./frise";
import type { ParsedModel } from "../parsing/model";

function parc(overrides: Partial<ParsedModel> = {}): ParsedModel {
  return base.modele({
    paliers: [
      base.palier({ nom: "v1", rang: 1 }),
      base.palier({ nom: "v2", rang: 2 }),
      base.palier({ nom: "v3", rang: 3 }),
    ],
    groupes: [base.groupe({ nom: "G" })],
    typesActeur: [base.typeActeur()],
    typesFlux: [base.typeFlux()],
    fxSheetNames: ["FX_A_HTTP"],
    acteurs: [base.acteur({ nom: "A", groupe: "G", palierIntroduction: "v1" })],
    interfaces: [
      base.iface({ nomDuFlux: "Member lookup", version: "1.0", acteurExposant: "A", feuilleAttendue: "FX_A_HTTP", palierIntroduction: "v1", palierRetrait: "v3" }),
      base.iface({ nomDuFlux: "Member lookup", version: "2.0", acteurExposant: "A", feuilleAttendue: "FX_A_HTTP", palierIntroduction: "v2" }),
    ],
    consommations: [],
    ...overrides,
  });
}

describe("construireFrise", () => {
  it("rend un segment par ligne, borné par ses paliers", () => {
    const f = construireFrise(parc(), "interfaces");
    expect(f.segments.find((s) => s.libellé === "Member lookup 1.0")).toMatchObject({ debut: 1, fin: 3 });
  });

  // Une ligne sans palier de retrait court jusqu'au bout : il faut le DESSINER
  // comme tel, l'arrêter au dernier palier connu dirait qu'elle y meurt.
  it("marque comme ouverte à droite une ligne sans palier de retrait", () => {
    const f = construireFrise(parc(), "interfaces");
    expect(f.segments.find((s) => s.libellé === "Member lookup 2.0")?.ouvertADroite).toBe(true);
    expect(f.segments.find((s) => s.libellé === "Member lookup 1.0")?.ouvertADroite).toBe(false);
  });

  // Symétriquement : une ligne sans palier d'arrivée vient d'avant l'axe.
  it("marque comme ouverte à gauche une ligne sans palier d'arrivée", () => {
    const m = parc();
    m.interfaces[0].palierIntroduction = "";
    expect(construireFrise(m, "interfaces").segments[0].ouvertAGauche).toBe(true);
  });

  // Le recouvrement de deux versions est exactement ce qu'on vient voir.
  it("laisse voir deux versions qui coexistent", () => {
    const [un, deux] = construireFrise(parc(), "interfaces").segments;
    expect(Math.max(un.debut, deux.debut)).toBeLessThan(Math.min(un.fin, deux.fin));
  });

  it("range les lignes par rattachement puis par arrivée", () => {
    const m = parc();
    m.interfaces.push(
      base.iface({ nomDuFlux: "Autre", acteurExposant: "Zeffo", feuilleAttendue: "FX_A_HTTP", palierIntroduction: "v1" })
    );
    expect(construireFrise(m, "interfaces").segments.map((s) => s.libellé)).toEqual([
      "Member lookup 1.0",
      "Member lookup 2.0",
      "Autre",
    ]);
  });

  it("rend aussi la frise des acteurs", () => {
    expect(construireFrise(parc(), "acteurs").segments.map((s) => s.libellé)).toEqual(["A"]);
  });

  // Un classeur sans palier n'a pas d'axe : la frise est vide plutôt que
  // fausse.
  it("ne rend rien quand le classeur ne déclare aucun palier", () => {
    expect(construireFrise(parc({ paliers: [] }), "interfaces").segments).toEqual([]);
  });
});
