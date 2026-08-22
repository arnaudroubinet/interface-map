import { describe, it, expect } from "vitest";
import { libelléCartouche, descriptionAccessible, type ContexteSchema } from "./cartouche";

const ctx = (o: Partial<ContexteSchema> = {}): ContexteSchema => ({
  titre: "Platform detail",
  lecture: "architecture",
  palier: "v2",
  source: "carto.xlsx",
  date: "2026-08-22",
  composants: 12,
  flux: 24,
  technologies: 5,
  ...o,
});

describe("libelléCartouche", () => {
  it("dit la vue, la lecture et le palier sur la première ligne", () => {
    expect(libelléCartouche(ctx()).titre).toBe("Platform detail — architecture reading, milestone v2");
  });

  // Un classeur sans palier ne doit pas afficher « milestone null ».
  it("tait le palier quand le classeur n'en déclare aucun", () => {
    expect(libelléCartouche(ctx({ palier: null })).titre).toBe("Platform detail — architecture reading");
  });

  it("dit la source, les comptes et la date sur la seconde ligne", () => {
    expect(libelléCartouche(ctx()).sousTitre).toBe("carto.xlsx · 12 components, 24 flows · 2026-08-22");
  });

  // Le singulier compte : « 1 components » signale un texte fabriqué à la main.
  it("accorde le singulier", () => {
    expect(libelléCartouche(ctx({ composants: 1, flux: 1 })).sousTitre).toContain("1 component, 1 flow");
  });
});

describe("descriptionAccessible", () => {
  // Ce que lit un lecteur d'écran : les comptes ET la convention de lecture,
  // qu'aucun texte du schéma ne porte par ailleurs.
  it("énonce les comptes puis la convention de lecture", () => {
    const d = descriptionAccessible(ctx());
    expect(d).toContain("12 components, 24 flows, 5 technologies");
    expect(d).toContain("Line = data, provider to consumer");
    expect(d).toContain("Arrowhead = who calls");
  });

  // « 1 technologys » est le genre de faute qu'un pluriel naïf produit.
  it("accorde le pluriel irrégulier de technology", () => {
    expect(descriptionAccessible(ctx({ technologies: 1 }))).toContain("1 technology.");
  });
});
