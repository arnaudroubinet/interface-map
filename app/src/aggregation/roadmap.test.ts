import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { buildRoadmap } from "./roadmap";
import type { ParsedModel } from "../parsing/model";

function estate(overrides: Partial<ParsedModel> = {}): ParsedModel {
  return base.template({
    milestones: [
      base.milestone({ name: "v1", rank: 1 }),
      base.milestone({ name: "v2", rank: 2 }),
      base.milestone({ name: "v3", rank: 3 }),
    ],
    groups: [base.group({ name: "G" })],
    actorTypes: [base.actorType()],
    flowTypes: [base.typeFlux()],
    fxSheetNames: ["FX_A_HTTP"],
    actors: [base.actor({ name: "A", group: "G", introducedAt: "v1" })],
    interfaces: [
      base.iface({ flowName: "Member lookup", version: "1.0", providerName: "A", expectedSheet: "FX_A_HTTP", introducedAt: "v1", retiredAt: "v3" }),
      base.iface({ flowName: "Member lookup", version: "2.0", providerName: "A", expectedSheet: "FX_A_HTTP", introducedAt: "v2" }),
    ],
    consumptions: [],
    ...overrides,
  });
}

describe("construireFrise", () => {
  it("rend un segment par ligne, borné par ses paliers", () => {
    const f = buildRoadmap(estate(), "interfaces");
    expect(f.segments.find((s) => s.label === "Member lookup 1.0")).toMatchObject({ start: 1, end: 3 });
  });

  // Une ligne sans palier de retrait court jusqu'au bout : il faut le DESSINER
  // comme tel, l'arrêter au dernier palier connu dirait qu'elle y meurt.
  it("marque comme ouverte à droite une ligne sans palier de retrait", () => {
    const f = buildRoadmap(estate(), "interfaces");
    expect(f.segments.find((s) => s.label === "Member lookup 2.0")?.openRight).toBe(true);
    expect(f.segments.find((s) => s.label === "Member lookup 1.0")?.openRight).toBe(false);
  });

  // Symétriquement : une ligne sans palier d'arrivée vient d'avant l'axe.
  it("marque comme ouverte à gauche une ligne sans palier d'arrivée", () => {
    const m = estate();
    m.interfaces[0].introducedAt = "";
    expect(buildRoadmap(m, "interfaces").segments[0].openLeft).toBe(true);
  });

  // Le recouvrement de deux versions est exactement ce qu'on vient voir.
  it("laisse voir deux versions qui coexistent", () => {
    const [un, deux] = buildRoadmap(estate(), "interfaces").segments;
    expect(Math.max(un.start, deux.start)).toBeLessThan(Math.min(un.end, deux.end));
  });

  it("range les lignes par rattachement puis par arrivée", () => {
    const m = estate();
    m.interfaces.push(
      base.iface({ flowName: "Autre", providerName: "Zeffo", expectedSheet: "FX_A_HTTP", introducedAt: "v1" })
    );
    expect(buildRoadmap(m, "interfaces").segments.map((s) => s.label)).toEqual([
      "Member lookup 1.0",
      "Member lookup 2.0",
      "Autre",
    ]);
  });

  it("rend aussi la frise des acteurs", () => {
    expect(buildRoadmap(estate(), "actors").segments.map((s) => s.label)).toEqual(["A"]);
  });

  // Un classeur sans palier n'a pas d'axe : la frise est vide plutôt que
  // fausse.
  it("ne rend rien quand le classeur ne déclare aucun palier", () => {
    expect(buildRoadmap(estate({ milestones: [] }), "interfaces").segments).toEqual([]);
  });
});
