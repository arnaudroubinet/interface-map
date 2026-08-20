import { describe, it, expect } from "vitest";
import { computeLayout } from "./graph-layout";
import type { GraphNode, GraphEdge } from "../aggregation/core";

describe("computeLayout", () => {
  it("positions two connected nodes with finite coordinates", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "groupe" },
      { id: "B", label: "B", kind: "groupe" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technologie: "HTTP", count: 1, label: "HTTP", atténué: false }];

    const layout = await computeLayout(nodes, edges);

    expect(layout.nodes).toHaveLength(2);
    for (const n of layout.nodes) {
      expect(Number.isFinite(n.x)).toBe(true);
      expect(Number.isFinite(n.y)).toBe(true);
      expect(n.width).toBeGreaterThan(0);
      expect(n.height).toBeGreaterThan(0);
    }
    expect(layout.edges).toHaveLength(1);
    expect(layout.edges[0].points.length).toBeGreaterThan(0);
    expect(layout.width).toBeGreaterThan(0);
    expect(layout.height).toBeGreaterThan(0);
  });

  it("supports two distinct edges between the same pair of nodes (multigraph)", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "groupe" },
      { id: "B", label: "B", kind: "groupe" },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "B", technologie: "HTTP", count: 1, label: "HTTP", atténué: false },
      { from: "A", to: "B", technologie: "Kafka", count: 1, label: "Kafka", atténué: false },
    ];

    const layout = await computeLayout(nodes, edges);

    expect(layout.edges).toHaveLength(2);
  });

  it("handles an empty graph", async () => {
    const layout = await computeLayout([], []);
    expect(layout.nodes).toHaveLength(0);
    expect(layout.edges).toHaveLength(0);
  });
});

// --- Les invariants du placement, qui n'étaient gardés par rien. Mesuré : en
// faisant passer elk.direction de RIGHT à DOWN, tout le produit se retourne et
// pas un des 617 tests ne tombait. Or c'est de ce sens que dépend la lecture
// des schémas -- un trait sort par la droite du fournisseur -- et de la
// convention du centre que dépend toute la géométrie exportée.
describe("computeLayout — les invariants du placement", () => {
  const chaine = async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "acteur" },
      { id: "B", label: "B", kind: "acteur" },
      { id: "C", label: "C", kind: "acteur" },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "B", technologie: "HTTP", count: 1, label: "HTTP", atténué: false },
      { from: "B", to: "C", technologie: "HTTP", count: 1, label: "HTTP", atténué: false },
    ];
    return computeLayout(nodes, edges);
  };

  // Le sens de lecture du produit entier : la donnée va vers la droite.
  it("place une chaîne de gauche à droite", async () => {
    const l = await chaine();
    const x = (id: string) => l.nodes.find((n) => n.id === id)!.x;
    expect(x("A")).toBeLessThan(x("B"));
    expect(x("B")).toBeLessThan(x("C"));
  });

  it("ne l'empile pas verticalement", async () => {
    const l = await chaine();
    const n = (id: string) => l.nodes.find((x) => x.id === id)!;
    // l'écart horizontal domine : c'est ce qui distingue RIGHT de DOWN.
    expect(Math.abs(n("C").x - n("A").x)).toBeGreaterThan(Math.abs(n("C").y - n("A").y));
  });

  // x et y sont le CENTRE de la boîte, pas son coin. Lu comme un coin, chaque
  // boîte se décale d'une demi-largeur -- le défaut qui avait déplacé 93 boîtes
  // dans l'export draw.io.
  it("exprime la position au centre de la boîte, pas au coin", async () => {
    const l = await chaine();
    for (const n of l.nodes) {
      expect(n.x - n.width / 2).toBeGreaterThanOrEqual(-1);
      expect(n.y - n.height / 2).toBeGreaterThanOrEqual(-1);
      expect(n.x + n.width / 2).toBeLessThanOrEqual(l.width + 1);
      expect(n.y + n.height / 2).toBeLessThanOrEqual(l.height + 1);
    }
  });

  // Un enfant de conteneur est exprimé dans le MÊME repère que son parent :
  // c'est ce qui permet aux rendus de le dessiner sans conversion, et à
  // l'export draw.io d'en retrancher l'origine du parent.
  it("garde un enfant dans les bornes de son conteneur", async () => {
    const nodes: GraphNode[] = [
      { id: "cadre", label: "Cadre", kind: "frontiere" },
      { id: "A", label: "A", kind: "acteur", parent: "cadre" },
      { id: "B", label: "B", kind: "acteur", parent: "cadre" },
      { id: "dehors", label: "Dehors", kind: "acteur" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "dehors", technologie: "HTTP", count: 1, label: "HTTP", atténué: false }];
    const l = await computeLayout(nodes, edges);
    const cadre = l.nodes.find((n) => n.id === "cadre")!;
    for (const id of ["A", "B"]) {
      const e = l.nodes.find((n) => n.id === id)!;
      expect(e.x - e.width / 2).toBeGreaterThanOrEqual(cadre.x - cadre.width / 2 - 1);
      expect(e.x + e.width / 2).toBeLessThanOrEqual(cadre.x + cadre.width / 2 + 1);
      expect(e.y - e.height / 2).toBeGreaterThanOrEqual(cadre.y - cadre.height / 2 - 1);
      expect(e.y + e.height / 2).toBeLessThanOrEqual(cadre.y + cadre.height / 2 + 1);
    }
  });
});
