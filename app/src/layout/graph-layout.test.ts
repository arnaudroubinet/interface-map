import { describe, it, expect } from "vitest";
import { restreindreLayout, computeLayout, lignesDescription, truncatedName, LARGEUR_NOEUD } from "./graph-layout";
import type { GraphNode, GraphEdge } from "../aggregation/core";
import type { LayoutResult } from "./graph-layout";

describe("computeLayout", () => {
  it("positions two connected nodes with finite coordinates", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }];

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
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
      { from: "A", to: "B", technology: "Kafka", count: 1, label: "Kafka", attenuated: false },
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
  const chain = async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "actor" },
      { id: "B", label: "B", kind: "actor" },
      { id: "C", label: "C", kind: "actor" },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
      { from: "B", to: "C", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
    ];
    return computeLayout(nodes, edges);
  };

  // Le sens de lecture du produit entier : la donnée va vers la droite.
  it("place une chaîne de gauche à droite", async () => {
    const l = await chain();
    const x = (id: string) => l.nodes.find((n) => n.id === id)!.x;
    expect(x("A")).toBeLessThan(x("B"));
    expect(x("B")).toBeLessThan(x("C"));
  });

  it("ne l'empile pas verticalement", async () => {
    const l = await chain();
    const n = (id: string) => l.nodes.find((x) => x.id === id)!;
    // l'écart horizontal domine : c'est ce qui distingue RIGHT de DOWN.
    expect(Math.abs(n("C").x - n("A").x)).toBeGreaterThan(Math.abs(n("C").y - n("A").y));
  });

  // x et y sont le CENTRE de la boîte, pas son coin. Lu comme un coin, chaque
  // boîte se décale d'une demi-largeur -- le défaut qui avait déplacé 93 boîtes
  // dans l'export draw.io.
  it("exprime la position au centre de la boîte, pas au coin", async () => {
    const l = await chain();
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
      { id: "cadre", label: "Cadre", kind: "boundary" },
      { id: "A", label: "A", kind: "actor", parent: "cadre" },
      { id: "B", label: "B", kind: "actor", parent: "cadre" },
      { id: "dehors", label: "Dehors", kind: "actor" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "dehors", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }];
    const l = await computeLayout(nodes, edges);
    const frame = l.nodes.find((n) => n.id === "cadre")!;
    for (const id of ["A", "B"]) {
      const e = l.nodes.find((n) => n.id === id)!;
      expect(e.x - e.width / 2).toBeGreaterThanOrEqual(frame.x - frame.width / 2 - 1);
      expect(e.x + e.width / 2).toBeLessThanOrEqual(frame.x + frame.width / 2 + 1);
      expect(e.y - e.height / 2).toBeGreaterThanOrEqual(frame.y - frame.height / 2 - 1);
      expect(e.y + e.height / 2).toBeLessThanOrEqual(frame.y + frame.height / 2 + 1);
    }
  });
});

// --- Deux constantes de mise en page que rien ne gardait, et qui décident de
// ce qui tient dans une boîte. Mesuré par mutation : doubler le nombre de
// lignes de description, ou diviser par deux la largeur d'un caractère, ne
// faisait tomber aucun test — alors que les deux font déborder le dessin.
describe("ce qui tient dans une boîte", () => {
  it("plafonne la description à trois lignes, la dernière abrégée", () => {
    const long = "un texte assez long pour occuper plusieurs lignes dans une boîte étroite "
      + "et déborder largement de ce que la maquette prévoit pour une description";
    const rows = lignesDescription(long);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows[rows.length - 1]).toMatch(/…$/);
  });

  it("tronque un nom à ce qui tient réellement dans la largeur de la boîte", () => {
    const long = "Plateforme de règlement-livraison interbancaire et conservation";
    const truncated = truncatedName(long);
    // La largeur estimée du nom, icône comprise, doit tenir dans la boîte :
    // c'est la seule chose qui compte, et elle dépend des deux constantes.
    expect(truncated.length * 8.2 + 25).toBeLessThanOrEqual(LARGEUR_NOEUD);
    expect(truncated).toMatch(/…$/);
  });

  it("laisse intact un nom qui tient déjà", () => {
    expect(truncatedName("Tatooine")).toBe("Tatooine");
  });
});

// --- §2.4 : le placement est calculé UNE FOIS sur l'union de tous les paliers,
// puis restreint. C'est ce qui rend la stabilité exacte plutôt qu'approchée --
// mesuré, aucun réglage interactif d'ELK n'y parvient : sur une planche à
// frontière, le mode interactif ne reproduit même pas son propre résultat.
describe("restreindreLayout", () => {
  const union = (): LayoutResult => ({
    width: 100,
    height: 100,
    nodes: [
      { id: "A", label: "A", kind: "actor", x: 10, y: 10, width: 40, height: 20 },
      { id: "B", label: "B", kind: "actor", x: 60, y: 10, width: 40, height: 20 },
      { id: "Tardif", label: "Tardif", kind: "actor", x: 60, y: 60, width: 40, height: 20 },
    ],
    edges: [
      { from: "A", to: "B", technology: "HTTP", count: 3, label: "HTTP ×3", attenuated: false, points: [{ x: 0, y: 0 }] },
      { from: "A", to: "Tardif", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, points: [{ x: 0, y: 0 }] },
    ],
  });

  const auPalier = {
    nodes: [
      { id: "A", label: "A", kind: "actor" as const },
      { id: "B", label: "B", kind: "actor" as const },
    ],
    edges: [{ from: "A", to: "B", technology: "HTTP", count: 2, label: "HTTP ×2", attenuated: false }],
  };

  it("ne garde que les nœuds et arêtes du palier", () => {
    const restreint = restreindreLayout(union(), auPalier);
    expect(restreint.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    expect(restreint.edges).toHaveLength(1);
  });

  // Le point qui justifie tout : les positions ne sont PAS recalculées.
  it("laisse chaque boîte exactement où l'union l'a posée", () => {
    const restreint = restreindreLayout(union(), auPalier);
    expect(restreint.nodes.map((n) => [n.x, n.y])).toEqual([[10, 10], [60, 10]]);
    expect([restreint.width, restreint.height]).toEqual([100, 100]);
  });

  // Le libellé, lui, appartient au PALIER : « HTTP ×3 » sur l'union n'est pas
  // ce qu'on lit à un palier où deux flux seulement sont vivants.
  it("reprend du palier le libellé et le compteur, pas ceux de l'union", () => {
    const edge = restreindreLayout(union(), auPalier).edges[0];
    expect([edge.label, edge.count]).toEqual(["HTTP ×2", 2]);
  });

  // La frontière de plateforme n'est pas un acteur : elle n'apparaît dans
  // aucune vue de palier, et la perdre ferait disparaître le cadre.
  it("garde la frontière de plateforme, qu'aucune vue ne liste", () => {
    const avecFrontiere = union();
    avecFrontiere.nodes.push({ id: "__frontiere__", label: "Platform", kind: "boundary", x: 0, y: 0, width: 100, height: 100 });
    expect(restreindreLayout(avecFrontiere, auPalier).nodes.map((n) => n.id)).toContain("__frontiere__");
  });
});
