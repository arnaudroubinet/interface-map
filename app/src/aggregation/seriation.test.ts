import { describe, it, expect } from "vitest";
import { ordonner, type ContexteOrdre } from "./seriation";

const contexte = (
  groupes: Record<string, string>,
  degres: Record<string, number>,
  arêtes: Record<string, string[]> = {}
): ContexteOrdre => ({
  groupeDe: (id) => groupes[id] ?? "",
  degre: (id) => degres[id] ?? (arêtes[id]?.length ?? 0),
  voisins: (id) => arêtes[id] ?? [],
});

describe("ordonner", () => {
  const ctx = contexte({ A: "Core", B: "Partners", C: "Core" }, { A: 3, B: 1, C: 2 });

  it("trie par nom en alphabétique", () => {
    expect(ordonner(["C", "A", "B"], "alphabetique", ctx)).toEqual(["A", "B", "C"]);
  });

  // Regrouper fait apparaître les blocs intra-groupe et inter-groupes, que
  // l'ordre alphabétique disperse.
  it("regroupe par groupe puis par nom", () => {
    expect(ordonner(["B", "C", "A"], "groupe", ctx)).toEqual(["A", "C", "B"]);
  });

  it("place les moyeux en tête par degré décroissant", () => {
    expect(ordonner(["B", "C", "A"], "degre", ctx)).toEqual(["A", "C", "B"]);
  });

  // À degré égal, le nom départage : sans quoi l'ordre dépendrait de celui
  // d'entrée, et deux exports du même classeur différeraient.
  it("départage par le nom à degré égal", () => {
    const égaux = contexte({}, { X: 2, Y: 2, Z: 2 });
    expect(ordonner(["Z", "X", "Y"], "degre", égaux)).toEqual(["X", "Y", "Z"]);
  });
});

describe("ordonner — seriation RCM", () => {
  // Deux amas qui ne se touchent pas : RCM doit les rendre contigus, sans quoi
  // la matrice ne montre aucun bloc.
  const arêtes = { A: ["B", "C"], B: ["A", "C"], C: ["A", "B"], X: ["Y", "Z"], Y: ["X", "Z"], Z: ["X", "Y"] };
  const ctx = contexte({}, {}, arêtes);

  it("rend contigus les sommets d'un même amas", () => {
    const ordre = ordonner(["A", "X", "B", "Y", "C", "Z"], "blocs", ctx);
    const pos = new Map(ordre.map((id, i) => [id, i]));
    for (const amas of [["A", "B", "C"], ["X", "Y", "Z"]]) {
      const indices = amas.map((i) => pos.get(i)!).sort((a, b) => a - b);
      expect(indices[2] - indices[0], `amas ${amas.join("")} dispersé : ${ordre.join(",")}`).toBe(2);
    }
  });

  it("rend tous les sommets, une fois chacun", () => {
    const ids = ["A", "B", "C", "X", "Y", "Z"];
    expect([...ordonner(ids, "blocs", ctx)].sort()).toEqual([...ids].sort());
  });

  // Un sommet isolé n'a pas de voisin : il ne doit ni disparaître ni faire
  // boucler le parcours.
  it("place les sommets isolés sans les perdre", () => {
    const seul = contexte({}, {}, { ...arêtes, Solo: [] });
    expect(ordonner(["A", "Solo", "B"], "blocs", seul)).toContain("Solo");
  });

  // Déterminisme : deux exécutions doivent donner le même tableau, sinon
  // l'export Excel et l'écran divergent.
  it("est déterministe", () => {
    const ids = ["A", "B", "C", "X", "Y", "Z"];
    expect(ordonner(ids, "blocs", ctx)).toEqual(ordonner([...ids].reverse(), "blocs", ctx));
  });
});
