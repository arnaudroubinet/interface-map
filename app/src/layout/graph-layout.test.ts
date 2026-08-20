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
