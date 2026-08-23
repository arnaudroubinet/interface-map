import { describe, it, expect } from "vitest";
import { restrictLayout, computeLayout, descriptionLines, truncatedName, NODE_WIDTH } from "./graph-layout";
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

// --- The layout's invariants, which nothing guarded. Measured: switching
// elk.direction from RIGHT to DOWN turns the whole product on its side and not
// one of the 617 tests failed. Yet the reading of the diagrams depends on that
// direction -- a line leaves by the provider's right -- and all the exported
// geometry depends on the centre convention.
describe("computeLayout — the layout's invariants", () => {
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

  // The whole product's reading direction: the data goes to the right.
  it("lays a chain out from left to right", async () => {
    const l = await chain();
    const x = (id: string) => l.nodes.find((n) => n.id === id)!.x;
    expect(x("A")).toBeLessThan(x("B"));
    expect(x("B")).toBeLessThan(x("C"));
  });

  it("does not stack it vertically", async () => {
    const l = await chain();
    const n = (id: string) => l.nodes.find((x) => x.id === id)!;
    // the horizontal gap dominates: that is what tells RIGHT from DOWN.
    expect(Math.abs(n("C").x - n("A").x)).toBeGreaterThan(Math.abs(n("C").y - n("A").y));
  });

  // x and y are the box's CENTRE, not its corner. Read as a corner, every box
  // shifts by half a width -- the defect that had moved 93 boxes in the draw.io
  // export.
  it("expresses the position at the box's centre, not at its corner", async () => {
    const l = await chain();
    for (const n of l.nodes) {
      expect(n.x - n.width / 2).toBeGreaterThanOrEqual(-1);
      expect(n.y - n.height / 2).toBeGreaterThanOrEqual(-1);
      expect(n.x + n.width / 2).toBeLessThanOrEqual(l.width + 1);
      expect(n.y + n.height / 2).toBeLessThanOrEqual(l.height + 1);
    }
  });

  // A container's child is expressed in the SAME frame as its parent: that is
  // what lets the renderers draw it with no conversion, and lets the draw.io
  // export subtract the parent's origin from it.
  it("keeps a child within its container's bounds", async () => {
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

// --- Two layout constants nothing guarded, and which decide what fits in a
// box. Measured by mutation: doubling the number of description lines, or
// halving a character's width, made no test fail — although both make the
// drawing overflow.
describe("what fits in a box", () => {
  it("caps the description at three lines, the last abbreviated", () => {
    const long = "un texte assez long pour occuper plusieurs lignes dans une boîte étroite "
      + "et déborder largement de ce que la maquette prévoit pour une description";
    const rows = descriptionLines(long);
    expect(rows.length).toBeLessThanOrEqual(3);
    expect(rows[rows.length - 1]).toMatch(/…$/);
  });

  it("truncates a name to what really fits the box's width", () => {
    const long = "Plateforme de règlement-livraison interbancaire et conservation";
    const truncated = truncatedName(long);
    // The name's estimated width, icon included, must fit in the box: that is the
    // only thing that matters, and it depends on both constants.
    expect(truncated.length * 8.2 + 25).toBeLessThanOrEqual(NODE_WIDTH);
    expect(truncated).toMatch(/…$/);
  });

  it("leaves a name that already fits untouched", () => {
    expect(truncatedName("Tatooine")).toBe("Tatooine");
  });
});

// --- §2.4: the layout is computed ONCE over the union of all milestones, then
// restricted. That is what makes the stability exact rather than approximate --
// measured, no interactive ELK setting achieves it: on a board with a boundary,
// interactive mode does not even reproduce its own result.
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

  const atMilestone = {
    nodes: [
      { id: "A", label: "A", kind: "actor" as const },
      { id: "B", label: "B", kind: "actor" as const },
    ],
    edges: [{ from: "A", to: "B", technology: "HTTP", count: 2, label: "HTTP ×2", attenuated: false }],
  };

  it("keeps only the milestone's nodes and edges", () => {
    const restricted = restrictLayout(union(), atMilestone);
    expect(restricted.nodes.map((n) => n.id)).toEqual(["A", "B"]);
    expect(restricted.edges).toHaveLength(1);
  });

  // The point that justifies everything: the positions are NOT recomputed.
  it("leaves every box exactly where the union put it", () => {
    const restricted = restrictLayout(union(), atMilestone);
    expect(restricted.nodes.map((n) => [n.x, n.y])).toEqual([[10, 10], [60, 10]]);
    expect([restricted.width, restricted.height]).toEqual([100, 100]);
  });

  // The label, for its part, belongs to the MILESTONE: "HTTP ×3" on the union is
  // not what one reads at a milestone where only two flows are alive.
  it("takes the label and the counter from the milestone, not from the union", () => {
    const edge = restrictLayout(union(), atMilestone).edges[0];
    expect([edge.label, edge.count]).toEqual(["HTTP ×2", 2]);
  });

  // The platform boundary is not an actor: it appears in no milestone view, and
  // losing it would make the frame disappear.
  it("keeps the platform boundary, which no view lists", () => {
    const withBoundary = union();
    withBoundary.nodes.push({ id: "__boundary__", label: "Platform", kind: "boundary", x: 0, y: 0, width: 100, height: 100 });
    expect(restrictLayout(withBoundary, atMilestone).nodes.map((n) => n.id)).toContain("__boundary__");
  });
});

// --- A5: the by-actor board is the C4 context view, and its title block now
// ASSERTS that the inbound sits on the left and the outbound on the right. That
// is a property of elk.direction RIGHT applied to edges drawn provider →
// consumer -- not a wish. A claim a diagram makes about itself is worth a test:
// flip elk.direction to DOWN and the title block starts lying, in the one place
// a reader has no way to check.
describe("computeLayout — what the by-actor title block claims", () => {
  it("puts what feeds the focus on its left and what it feeds on its right", async () => {
    const nodes: GraphNode[] = [
      { id: "Upstream", label: "Upstream", kind: "actor" },
      { id: "Focus", label: "Focus", kind: "focus-actor" },
      { id: "Downstream", label: "Downstream", kind: "actor" },
    ];
    // Both edges follow the DATA, provider to consumer: Focus consumes from
    // Upstream and supplies Downstream.
    const edges: GraphEdge[] = [
      { from: "Upstream", to: "Focus", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
      { from: "Focus", to: "Downstream", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
    ];

    const layout = await computeLayout(nodes, edges);
    const x = (id: string) => layout.nodes.find((n) => n.id === id)!.x;

    expect(x("Upstream")).toBeLessThan(x("Focus"));
    expect(x("Focus")).toBeLessThan(x("Downstream"));
  });

  // A pulled flow does not change the line's direction -- only the arrowhead's
  // end. So it must not change which side of the focus the neighbour lands on,
  // which is the half of the claim a reader is most likely to doubt.
  it("does not let a pulled flow move a neighbour to the other side", async () => {
    const nodes: GraphNode[] = [
      { id: "Upstream", label: "Upstream", kind: "actor" },
      { id: "Focus", label: "Focus", kind: "focus-actor" },
    ];
    const edges: GraphEdge[] = [
      { from: "Upstream", to: "Focus", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, pulled: true },
    ];

    const layout = await computeLayout(nodes, edges);
    const x = (id: string) => layout.nodes.find((n) => n.id === id)!.x;

    expect(x("Upstream")).toBeLessThan(x("Focus"));
  });
});
