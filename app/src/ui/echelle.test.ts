import { describe, it, expect } from "vitest";
import { conseilDEchelle } from "./echelle";

describe("conseilDEchelle", () => {
  // Sur le classeur d'exemple : |V| = 15, d = 27/225 = 0,12. Aucun bandeau, et
  // c'est le bon comportement -- un avertissement qui crie sur un petit parc
  // apprend surtout à être ignoré.
  it("se tait sur une planche que le nœud-lien sert bien", () => {
    expect(conseilDEchelle(15, 27)).toBeNull();
  });

  it("se tait encore au seuil, et parle juste au-dessus", () => {
    expect(conseilDEchelle(20, 400)).toBeNull();
    expect(conseilDEchelle(21, 400)).not.toBeNull();
  });

  // Grande ET dense : la matrice lit mieux.
  it("suggère la matrice sur une planche grande et dense", () => {
    const c = conseilDEchelle(47, 400);
    expect(c?.vues).toContain("matrice");
    expect(c?.message).toContain("47 components and 400 flows");
  });

  // Grande mais creuse : le nœud-lien reste meilleur, c'est la SURFACE qui
  // gêne -- donc on oriente vers la vue par acteur, pas vers la matrice.
  it("suggère la vue par acteur sur une planche grande et creuse", () => {
    const c = conseilDEchelle(47, 60);
    expect(c?.vues).toEqual(["par-acteur"]);
    expect(c?.message).toContain("By-actor");
  });
});
