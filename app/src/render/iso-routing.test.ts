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
    expect(routes.get("c1")!.points).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
    expect(routes.get("c1")!.drawsHead).toBe(true);
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
    const route = routes.get("c1")!.points;
    // A detour has turns; and no point of it sits on the occupied tile.
    expect(route.length).toBeGreaterThan(2);
    expect(route.some((p) => p.x === 2 && p.y === 0)).toBe(false);
  });

  it("keeps off a neighbouring drawing's footprint, not just its tile", () => {
    // The wall stands one tile off the straight line -- but its icon's flank
    // covers that line's tile, and a route through it would run under the
    // drawing. The detour must skip the flank too.
    const routes = routeConnectors(
      view(
        [
          { id: "a", tile: { x: 0, y: 0 } },
          { id: "wall", tile: { x: 4, y: 1 } },
          { id: "b", tile: { x: 8, y: 0 } },
        ],
        [between("a", "b")]
      )
    );
    const route = routes.get("c1")!.points;
    expect(route.length).toBeGreaterThan(2);
    expect(route.some((p) => Math.round(p.x) === 4 && Math.round(p.y) === 0)).toBe(false);
  });

  it("picks, of two elbows of equal length, the one that cuts no route already drawn", () => {
    // A first flow runs along row 0. The second has two L-shaped paths of the
    // same length: one bends at (2,-4) and climbs column 2 THROUGH row 0 where
    // the first flow runs; the other bends at (10,4) and never meets it.
    const routes = routeConnectors(
      view(
        [
          { id: "x", tile: { x: 0, y: 0 } },
          { id: "y", tile: { x: 8, y: 0 } },
          { id: "a", tile: { x: 2, y: 4 } },
          { id: "b", tile: { x: 10, y: -4 } },
        ],
        [
          { ...between("x", "y"), color: "red" },
          { ...between("a", "b"), color: "blue" },
        ]
      )
    );
    const second = routes.get("c2")!.points;
    expect(second.some((p) => Math.round(p.x) === 2 && Math.round(p.y) === 0)).toBe(false);
  });

  it("deals a lane per trunk sharing a corridor: none runs on top of another", () => {
    // Three DISTINCT trunks -- three colours -- between the same two seats.
    const routes = routeConnectors(
      view(
        [
          { id: "a", tile: { x: 0, y: 0 } },
          { id: "b", tile: { x: 6, y: 0 } },
        ],
        [
          { ...between("a", "b"), color: "red" },
          { ...between("a", "b"), color: "blue" },
          { ...between("b", "a"), color: "green" },
        ]
      )
    );
    const rows = [...routes.values()].map((route) => route.points[0].y);
    expect(new Set(rows).size).toBe(3);
    // The lanes stay INSIDE the corridor: under a half-tile from its centre.
    for (const y of rows) expect(Math.abs(y)).toBeLessThan(0.5);
  });

  it("welds one technology's flows into a trunk: one lane, one head", () => {
    // Same colour, same target: the two flows share their lane -- identical
    // polylines -- and only the first draws the head both would have drawn.
    const routes = routeConnectors(
      view(
        [
          { id: "a", tile: { x: 0, y: 0 } },
          { id: "b", tile: { x: 6, y: 0 } },
        ],
        [
          { ...between("a", "b"), color: "red" },
          { ...between("a", "b"), color: "red" },
        ]
      )
    );
    expect(routes.get("c1")!.points).toEqual(routes.get("c2")!.points);
    expect(routes.get("c1")!.drawsHead).toBe(true);
    expect(routes.get("c2")!.drawsHead).toBe(false);
  });

  it("keeps a head on a trunk member arriving from another side", () => {
    // Two flows of one colour into b, one from the west, one from the south:
    // their last corridors differ, so a single head would leave the second
    // line reading as unfinished.
    const routes = routeConnectors(
      view(
        [
          { id: "a", tile: { x: 0, y: 0 } },
          { id: "c", tile: { x: 6, y: 6 } },
          { id: "b", tile: { x: 6, y: 0 } },
        ],
        [
          { ...between("a", "b"), color: "red" },
          { ...between("c", "b"), color: "red" },
        ]
      )
    );
    expect(routes.get("c1")!.drawsHead).toBe(true);
    expect(routes.get("c2")!.drawsHead).toBe(true);
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
