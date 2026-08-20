import { describe, it, expect } from "vitest";
import { rangDuPalier, intervalleDeVie, estVivant, palierCourant, TOUJOURS } from "./paliers";
import type { ParsedModel, Palier } from "../parsing/model";
import { VERSION_MODELE } from "../parsing/build-model";

// L'axe du temps n'avait aucun test à lui : il n'était éprouvé qu'à travers
// ses appelants, qui ne visitent pas ses cas limites.

function palier(nom: string, rang: number, statut = "Delivered"): Palier {
  return { nom, rang, libelle: "", statut, date: "", description: "", feuille: "Milestones", ligne: 0 };
}

function model(paliers: Palier[]): ParsedModel {
  return {
    acteurs: [], typesActeur: [], groupes: [], groupesAbsents: false, paliers,
    typesFlux: [], interfaces: [], consommations: [], fxSheetNames: [],
    colonnesOptionnellesAbsentes: [], versionModele: VERSION_MODELE, fichierModifie: null,
  };
}

const FRISE = model([palier("v1", 1), palier("Étape 2", 2), palier("v3", 3, "Planned")]);

describe("rangDuPalier", () => {
  it("résout un palier quelle que soit la casse, les accents et les espaces", () => {
    expect(rangDuPalier(FRISE, " V1 ")).toBe(1);
    expect(rangDuPalier(FRISE, "etape 2")).toBe(2);
    expect(rangDuPalier(FRISE, "ÉTAPE 2")).toBe(2);
  });

  it("rend undefined pour un palier inconnu ou vide", () => {
    expect(rangDuPalier(FRISE, "v9")).toBeUndefined();
    expect(rangDuPalier(FRISE, "   ")).toBeUndefined();
  });
});

describe("intervalleDeVie", () => {
  it("ouvre la borne qu'aucun palier ne nomme", () => {
    expect(intervalleDeVie(FRISE, { palierIntroduction: "", palierRetrait: "" })).toEqual(TOUJOURS);
    expect(intervalleDeVie(FRISE, { palierIntroduction: "v1", palierRetrait: "" }).fin).toBe(Infinity);
    expect(intervalleDeVie(FRISE, { palierIntroduction: "", palierRetrait: "v3" }).debut).toBe(-Infinity);
  });

  // Un palier cité mais absent de la frise laisse la borne ouverte plutôt que
  // de la résoudre au hasard -- un contrôle d'intégrité le réclame par ailleurs.
  it("laisse la borne ouverte quand le palier cité est inconnu", () => {
    expect(intervalleDeVie(FRISE, { palierIntroduction: "v9", palierRetrait: "" }).debut).toBe(-Infinity);
  });
});

describe("estVivant", () => {
  // Le retrait est EXCLU : « retiré en v3 » signifie qu'en v3 la ligne n'est
  // déjà plus là. L'introduction, elle, est incluse.
  it("inclut le palier d'arrivée et exclut celui de retrait", () => {
    const intervalle = intervalleDeVie(FRISE, { palierIntroduction: "v1", palierRetrait: "v3" });
    expect(estVivant(intervalle, 0)).toBe(false);
    expect(estVivant(intervalle, 1)).toBe(true);
    expect(estVivant(intervalle, 2)).toBe(true);
    expect(estVivant(intervalle, 3)).toBe(false);
  });
});

describe("palierCourant", () => {
  it("rend le livré de rang le plus haut", () => {
    expect(palierCourant(FRISE)?.nom).toBe("Étape 2");
  });

  it("sans aucun livré, rend le rang le plus haut déclaré", () => {
    const aucunLivre = model([palier("v1", 1, "Planned"), palier("v2", 2, "Planned")]);
    expect(palierCourant(aucunLivre)?.nom).toBe("v2");
  });

  it("rend undefined sur une frise vide", () => {
    expect(palierCourant(model([]))).toBeUndefined();
  });
});
