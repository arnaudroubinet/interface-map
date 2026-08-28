import { describe, it, expect } from "vitest";
import { routeConnectors, type TilePoint } from "./iso-routing";
import type { FossflowView, FossflowConnector } from "../export/fossflow-json";

function view(items: { id: string; tile: TilePoint }[], connectors: Partial<FossflowConnector>[]): FossflowView {
  return {
    id: "v",
    name: "v",
    items,
    connectors: connectors.map((c, i) => ({
      id: c.id ?? `c${i + 1}`,
      anchors: c.anchors!,
      ...c,
    })) as FossflowConnector[],
    rectangles: [],
    textBoxes: [],
  };
}

const between = (from: string, to: string): Partial<FossflowConnector> => ({
  anchors: [
    { id: "a", ref: { item: from } },
    { id: "b", ref: { item: to } },
  ],
});

describe("routeConnectors", () => {
  it("routes an aligned pair straight", () => {
    const routes = routeConnectors(
      view(
        [
          { id: "a", tile: { x: 0, y: 0 } },
          { id: "b", tile: { x: 4, y: 0 } },
        ],
        [between("a", "b")]
      )
    );
    expect(routes.get("c1")).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });

  it("goes around an occupied tile rather than through the drawing on it", () => {
    const routes = routeConnectors(
      view(
        [
          { id: "a", tile: { x: 0, y: 0 } },
          { id: "wall", tile: { x: 2, y: 0 } },
          { id: "b", tile: { x: 4, y: 0 } },
        ],
        [between("a", "b")]
      )
    );
    const route = routes.get("c1")!;
    // A detour has turns; and no point of it sits on the occupied tile.
    expect(route.length).toBeGreaterThan(2);
    expect(route.some((p) => p.x === 2 && p.y === 0)).toBe(false);
  });

  it("deals a lane to each route sharing a corridor: none runs on top of another", () => {
    const routes = routeConnectors(
      view(
        [
          { id: "a", tile: { x: 0, y: 0 } },
          { id: "b", tile: { x: 6, y: 0 } },
        ],
        [between("a", "b"), between("a", "b"), between("b", "a")]
      )
    );
    const rows = [...routes.values()].map((route) => route[0].y);
    expect(new Set(rows).size).toBe(3);
    // The lanes stay INSIDE the corridor: under a half-tile from its centre.
    for (const y of rows) expect(Math.abs(y)).toBeLessThan(0.5);
  });

  it("gives the same routes for the same board, render after render", () => {
    const build = () =>
      routeConnectors(
        view(
          [
            { id: "a", tile: { x: 0, y: 0 } },
            { id: "wall", tile: { x: 2, y: 1 } },
            { id: "b", tile: { x: 4, y: 2 } },
          ],
          [between("a", "b"), between("b", "a")]
        )
      );
    expect(build()).toEqual(build());
  });
});
