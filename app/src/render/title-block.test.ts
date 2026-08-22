import { describe, it, expect } from "vitest";
import { titleBlockText, descriptionAccessible, type ContexteSchema } from "./title-block";

const ctx = (o: Partial<ContexteSchema> = {}): ContexteSchema => ({
  title: "Platform detail",
  reading: "architecture",
  milestone: "v2",
  source: "carto.xlsx",
  date: "2026-08-22",
  composants: 12,
  flows: 24,
  technologies: 5,
  ...o,
});

describe("libelléCartouche", () => {
  it("dit la vue, la lecture et le palier sur la première ligne", () => {
    expect(titleBlockText(ctx()).title).toBe("Platform detail — architecture reading, milestone v2");
  });

  // Un classeur sans palier ne doit pas afficher « milestone null ».
  it("tait le palier quand le classeur n'en déclare aucun", () => {
    expect(titleBlockText(ctx({ milestone: null })).title).toBe("Platform detail — architecture reading");
  });

  it("dit la source, les comptes et la date sur la seconde ligne", () => {
    expect(titleBlockText(ctx()).subtitle).toBe("carto.xlsx · 12 components, 24 flows · 2026-08-22");
  });

  // Le singulier compte : « 1 components » signale un texte fabriqué à la main.
  it("accorde le singulier", () => {
    expect(titleBlockText(ctx({ composants: 1, flows: 1 })).subtitle).toContain("1 component, 1 flow");
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

// --- QA : la frise compte des lignes et des paliers, pas des boîtes et des
// traits. Son cartouche annonçait « 0 component, 0 flow » sur dix-sept lignes.
describe("libelléCartouche — ce que la planche compte", () => {
  it("laisse une planche dire ce qu'elle compte, quand les boîtes n'ont pas de sens", () => {
    const c = { ...ctx(), composants: 0, flows: 0, detail: "17 interfaces, 3 milestones" };
    expect(titleBlockText(c).subtitle).toContain("17 interfaces, 3 milestones");
    expect(titleBlockText(c).subtitle).not.toContain("0 component");
  });

  it("garde les comptes ordinaires quand rien ne les remplace", () => {
    expect(titleBlockText(ctx()).subtitle).toContain("12 components, 24 flows");
  });

  it("reprend le même détail dans la description accessible", () => {
    expect(descriptionAccessible({ ...ctx(), detail: "17 interfaces, 3 milestones" })).toContain("17 interfaces");
  });
});
