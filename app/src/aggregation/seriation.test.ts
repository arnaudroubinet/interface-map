import { describe, it, expect } from "vitest";
import { orderBy, type OrderContext } from "./seriation";

const context = (
  groups: Record<string, string>,
  degres: Record<string, number>,
  edges: Record<string, string[]> = {}
): OrderContext => ({
  groupOf: (id) => groups[id] ?? "",
  degree: (id) => degres[id] ?? (edges[id]?.length ?? 0),
  neighbours: (id) => edges[id] ?? [],
});

describe("ordonner", () => {
  const ctx = context({ A: "Core", B: "Partners", C: "Core" }, { A: 3, B: 1, C: 2 });

  it("sorts by name in alphabetical order", () => {
    expect(orderBy(["C", "A", "B"], "alphabetical", ctx)).toEqual(["A", "B", "C"]);
  });

  // Grouping brings out the intra-group and inter-group blocks that the
  // alphabetical order scatters.
  it("groups by group then by name", () => {
    expect(orderBy(["B", "C", "A"], "group", ctx)).toEqual(["A", "C", "B"]);
  });

  it("puts the hubs first, by decreasing degree", () => {
    expect(orderBy(["B", "C", "A"], "degree", ctx)).toEqual(["A", "C", "B"]);
  });

  // At equal degree the name breaks the tie: otherwise the order would depend on
  // the input order, and two exports of the same workbook would differ.
  it("breaks the tie by name at equal degree", () => {
    const equal = context({}, { X: 2, Y: 2, Z: 2 });
    expect(orderBy(["Z", "X", "Y"], "degree", equal)).toEqual(["X", "Y", "Z"]);
  });
});

describe("ordonner — seriation RCM", () => {
  // Two clusters that do not touch: RCM must make them contiguous, failing which
  // the matrix shows no block at all.
  const edges = { A: ["B", "C"], B: ["A", "C"], C: ["A", "B"], X: ["Y", "Z"], Y: ["X", "Z"], Z: ["X", "Y"] };
  const ctx = context({}, {}, edges);

  it("makes the vertices of one cluster contiguous", () => {
    const order = orderBy(["A", "X", "B", "Y", "C", "Z"], "blocks", ctx);
    const pos = new Map(order.map((id, i) => [id, i]));
    for (const cluster of [["A", "B", "C"], ["X", "Y", "Z"]]) {
      const indices = cluster.map((i) => pos.get(i)!).sort((a, b) => a - b);
      expect(indices[2] - indices[0], `cluster ${cluster.join("")} scattered: ${order.join(",")}`).toBe(2);
    }
  });

  it("returns every vertex, once each", () => {
    const ids = ["A", "B", "C", "X", "Y", "Z"];
    expect([...orderBy(ids, "blocks", ctx)].sort()).toEqual([...ids].sort());
  });

  // An isolated vertex has no neighbour: it must neither disappear nor make the
  // walk loop.
  it("places the isolated vertices without losing them", () => {
    const alone = context({}, {}, { ...edges, Solo: [] });
    expect(orderBy(["A", "Solo", "B"], "blocks", alone)).toContain("Solo");
  });

  // Determinism: two runs must give the same array, otherwise the Excel export
  // and the screen drift apart.
  it("is deterministic", () => {
    const ids = ["A", "B", "C", "X", "Y", "Z"];
    expect(orderBy(ids, "blocks", ctx)).toEqual(orderBy([...ids].reverse(), "blocks", ctx));
  });
});
