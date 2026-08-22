import { describe, it, expect } from "vitest";
import { rankOfMilestone, lifespanOf, isLiveAt, currentMilestone, TOUJOURS } from "./milestones";
import type { ParsedModel, Milestone } from "../parsing/model";
import { VERSION_MODELE } from "../parsing/build-model";

// L'axe du temps n'avait aucun test à lui : il n'était éprouvé qu'à travers
// ses appelants, qui ne visitent pas ses cas limites.

function milestone(name: string, rank: number, statut = "Delivered"): Milestone {
  return { name, rank, label: "", statut, date: "", description: "", sheet: "Milestones", row: 0 };
}

function model(milestones: Milestone[]): ParsedModel {
  return {
    actors: [], typesActeur: [], groups: [], groupesAbsents: false, milestones,
    flowTypes: [], interfaces: [], consumptions: [], fxSheetNames: [],
    colonnesOptionnellesAbsentes: [], versionModele: VERSION_MODELE, fichierModifie: null,
  };
}

const FRISE = model([milestone("v1", 1), milestone("Étape 2", 2), milestone("v3", 3, "Planned")]);

describe("rangDuPalier", () => {
  it("résout un palier quelle que soit la casse, les accents et les espaces", () => {
    expect(rankOfMilestone(FRISE, " V1 ")).toBe(1);
    expect(rankOfMilestone(FRISE, "etape 2")).toBe(2);
    expect(rankOfMilestone(FRISE, "ÉTAPE 2")).toBe(2);
  });

  it("rend undefined pour un palier inconnu ou vide", () => {
    expect(rankOfMilestone(FRISE, "v9")).toBeUndefined();
    expect(rankOfMilestone(FRISE, "   ")).toBeUndefined();
  });
});

describe("intervalleDeVie", () => {
  it("ouvre la borne qu'aucun palier ne nomme", () => {
    expect(lifespanOf(FRISE, { introducedAt: "", retiredAt: "" })).toEqual(TOUJOURS);
    expect(lifespanOf(FRISE, { introducedAt: "v1", retiredAt: "" }).end).toBe(Infinity);
    expect(lifespanOf(FRISE, { introducedAt: "", retiredAt: "v3" }).start).toBe(-Infinity);
  });

  // Un palier cité mais absent de la frise laisse la borne ouverte plutôt que
  // de la résoudre au hasard -- un contrôle d'intégrité le réclame par ailleurs.
  it("laisse la borne ouverte quand le palier cité est inconnu", () => {
    expect(lifespanOf(FRISE, { introducedAt: "v9", retiredAt: "" }).start).toBe(-Infinity);
  });
});

describe("estVivant", () => {
  // Le retrait est EXCLU : « retiré en v3 » signifie qu'en v3 la ligne n'est
  // déjà plus là. L'introduction, elle, est incluse.
  it("inclut le palier d'arrivée et exclut celui de retrait", () => {
    const interval = lifespanOf(FRISE, { introducedAt: "v1", retiredAt: "v3" });
    expect(isLiveAt(interval, 0)).toBe(false);
    expect(isLiveAt(interval, 1)).toBe(true);
    expect(isLiveAt(interval, 2)).toBe(true);
    expect(isLiveAt(interval, 3)).toBe(false);
  });
});

describe("palierCourant", () => {
  it("rend le livré de rang le plus haut", () => {
    expect(currentMilestone(FRISE)?.name).toBe("Étape 2");
  });

  it("sans aucun livré, rend le rang le plus haut déclaré", () => {
    const aucunLivre = model([milestone("v1", 1, "Planned"), milestone("v2", 2, "Planned")]);
    expect(currentMilestone(aucunLivre)?.name).toBe("v2");
  });

  it("rend undefined sur une frise vide", () => {
    expect(currentMilestone(model([]))).toBeUndefined();
  });
});
