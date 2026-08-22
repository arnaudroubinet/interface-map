import { describe, it, expect } from "vitest";
import { orderBy, type ContexteOrdre } from "./seriation";

const contexte = (
  groups: Record<string, string>,
  degres: Record<string, number>,
  edges: Record<string, string[]> = {}
): ContexteOrdre => ({
  groupeDe: (id) => groups[id] ?? "",
  degree: (id) => degres[id] ?? (edges[id]?.length ?? 0),
  neighbours: (id) => edges[id] ?? [],
});

describe("ordonner", () => {
  const ctx = contexte({ A: "Core", B: "Partners", C: "Core" }, { A: 3, B: 1, C: 2 });

  it("trie par nom en alphabétique", () => {
    expect(orderBy(["C", "A", "B"], "alphabetical", ctx)).toEqual(["A", "B", "C"]);
  });

  // Regrouper fait apparaître les blocs intra-groupe et inter-groupes, que
  // l'ordre alphabétique disperse.
  it("regroupe par groupe puis par nom", () => {
    expect(orderBy(["B", "C", "A"], "group", ctx)).toEqual(["A", "C", "B"]);
  });

  it("place les moyeux en tête par degré décroissant", () => {
    expect(orderBy(["B", "C", "A"], "degree", ctx)).toEqual(["A", "C", "B"]);
  });

  // À degré égal, le nom départage : sans quoi l'ordre dépendrait de celui
  // d'entrée, et deux exports du même classeur différeraient.
  it("départage par le nom à degré égal", () => {
    const equal = contexte({}, { X: 2, Y: 2, Z: 2 });
    expect(orderBy(["Z", "X", "Y"], "degree", equal)).toEqual(["X", "Y", "Z"]);
  });
});

describe("ordonner — seriation RCM", () => {
  // Deux amas qui ne se touchent pas : RCM doit les rendre contigus, sans quoi
  // la matrix ne montre aucun bloc.
  const edges = { A: ["B", "C"], B: ["A", "C"], C: ["A", "B"], X: ["Y", "Z"], Y: ["X", "Z"], Z: ["X", "Y"] };
  const ctx = contexte({}, {}, edges);

  it("rend contigus les sommets d'un même amas", () => {
    const order = orderBy(["A", "X", "B", "Y", "C", "Z"], "blocks", ctx);
    const pos = new Map(order.map((id, i) => [id, i]));
    for (const amas of [["A", "B", "C"], ["X", "Y", "Z"]]) {
      const indices = amas.map((i) => pos.get(i)!).sort((a, b) => a - b);
      expect(indices[2] - indices[0], `amas ${amas.join("")} dispersé : ${order.join(",")}`).toBe(2);
    }
  });

  it("rend tous les sommets, une fois chacun", () => {
    const ids = ["A", "B", "C", "X", "Y", "Z"];
    expect([...orderBy(ids, "blocks", ctx)].sort()).toEqual([...ids].sort());
  });

  // Un sommet isolé n'a pas de voisin : il ne doit ni disparaître ni faire
  // boucler le parcours.
  it("place les sommets isolés sans les perdre", () => {
    const seul = contexte({}, {}, { ...edges, Solo: [] });
    expect(orderBy(["A", "Solo", "B"], "blocks", seul)).toContain("Solo");
  });

  // Déterminisme : deux exécutions doivent donner le même tableau, sinon
  // l'export Excel et l'écran divergent.
  it("est déterministe", () => {
    const ids = ["A", "B", "C", "X", "Y", "Z"];
    expect(orderBy(ids, "blocks", ctx)).toEqual(orderBy([...ids].reverse(), "blocks", ctx));
  });
});
