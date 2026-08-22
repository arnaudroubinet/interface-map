import { describe, it, expect } from "vitest";
import { ratioDeContraste, assombrirJusquA } from "./contrast";
import { styleDuNoeud } from "./node-styles";

describe("ratioDeContraste", () => {
  // Les bornes de la formule WCAG : elles cadrent tout le reste.
  it("donne 21 entre le noir et le blanc, et 1 entre une couleur et elle-même", () => {
    expect(ratioDeContraste("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(ratioDeContraste("#3a7bd5", "#3a7bd5")).toBeCloseTo(1, 5);
  });

  it("est symétrique", () => {
    expect(ratioDeContraste("#0E7DAD", "#ffffff")).toBeCloseTo(ratioDeContraste("#ffffff", "#0E7DAD"), 5);
  });

  // Valeurs de référence recalculées à la main : ce sont elles qui justifient
  // tout le reste de la correction.
  it("retrouve les valeurs mesurées sur les couleurs du produit", () => {
    expect(ratioDeContraste("#ffffff", "#23A2D9")).toBeCloseTo(2.9, 2);
    expect(ratioDeContraste("#cccccc", "#23A2D9")).toBeCloseTo(1.81, 2);
    expect(ratioDeContraste("#ffffff", "#0E7DAD")).toBeCloseTo(4.61, 2);
  });
});

describe("assombrirJusquA", () => {
  it("assombrit une couleur trop claire jusqu'à atteindre la cible sur blanc", () => {
    expect(ratioDeContraste(assombrirJusquA("#eda100", 4.5), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  // Une couleur déjà conforme ne doit pas bouger : la corriger changerait une
  // teinte que le classeur a délibérément choisie.
  it("laisse intacte une couleur qui passe déjà", () => {
    expect(assombrirJusquA("#4a3aa7", 4.5)).toBe("#4a3aa7");
  });

  // On assombrit, on ne redéfinit pas : un jaune reste un jaune.
  it("garde la teinte en ne touchant qu'à la clarté", () => {
    const corrected = assombrirJusquA("#ffee00", 3);
    const [r, v, b] = [1, 3, 5].map((i) => parseInt(corrected.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(b);
    expect(v).toBeGreaterThan(b);
  });
});

describe("styleDuNoeud — chaque fond porte son texte", () => {
  // Le texte des boîtes est TOUJOURS blanc (texteClair). Chaque fond doit donc
  // le supporter, sans exception : c'est 100 % des schémas produits.
  it("laisse le blanc lisible sur tous les fonds", () => {
    const cas = [
      { kind: "actor", external: false },
      { kind: "actor", external: true },
      { kind: "platform", external: false },
      { kind: "focus-actor", external: false },
    ] as const;
    for (const c of cas) {
      const style = styleDuNoeud(c);
      expect(ratioDeContraste("#ffffff", style.fill), `fill ${style.fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // La bordure doit rester distinguable de son fond : elle porte l'épaisseur
  // qui signale l'acteur sélectionné.
  it("garde la bordure distinguable de son fond", () => {
    for (const c of [{ kind: "actor", external: false }, { kind: "platform", external: false }] as const) {
      const style = styleDuNoeud(c);
      expect(ratioDeContraste(style.stroke, style.fill)).toBeGreaterThan(1.1);
    }
  });
});
