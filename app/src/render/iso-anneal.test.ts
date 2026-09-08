import { describe, it, expect } from "vitest";
import { annealPlacement, placementIsValid, reframed } from "./iso-anneal";
import { routeConnectors, crossingsOf } from "./iso-routing";
import type { FossflowView, FossflowConnector } from "../export/fossflow-json";

const between = (from: string, to: string, color: string): FossflowConnector => ({
  id: `${from}-${to}-${color}`,
  color,
  anchors: [
    { id: "a", ref: { item: from } },
    { id: "b", ref: { item: to } },
  ],
});

// A platform of four around a hub, two partners outside, and enough chords
// for the greedy placement to leave the routes something to untangle.
function board(): FossflowView {
  return {
    id: "v",
    name: "v",
    items: [
      { id: "hub", tile: { x: 0, y: 0 }, parent: "P" },
      { id: "a", tile: { x: 4, y: 0 }, parent: "P" },
      { id: "b", tile: { x: 0, y: 4 }, parent: "P" },
      { id: "c", tile: { x: -4, y: 0 }, parent: "P" },
      { id: "d", tile: { x: 0, y: -4 }, parent: "P" },
      { id: "x", tile: { x: 8, y: 8 } },
      { id: "y", tile: { x: -8, y: -8 } },
    ],
    connectors: [
      between("a", "c", "red"),
      between("b", "d", "red"),
      between("a", "b", "blue"),
      between("c", "d", "blue"),
      between("x", "c", "green"),
      between("y", "a", "green"),
      between("hub", "x", "http"),
      between("hub", "y", "http"),
    ],
    rectangles: [{ id: "z", from: { x: -5, y: -5 }, to: { x: 5, y: 5 }, parent: "P" }],
    textBoxes: [{ id: "zl", tile: { x: 5, y: 5 }, content: "Platform", parent: "P" }],
  };
}

describe("annealPlacement", () => {
  it("never hands back a worse board than it was given", async () => {
    const start = crossingsOf(routeConnectors(board()));
    const result = await annealPlacement(board(), { iterations: 150, seed: 7, yieldEvery: 1000 });
    expect(result.crossings).toBeLessThanOrEqual(start);
    if (!result.improved) expect(result.view.items.map((i) => i.tile)).toEqual(board().items.map((i) => i.tile));
  });

  it("is repeatable: same seed, same budget, same seats", async () => {
    const one = await annealPlacement(board(), { iterations: 150, seed: 3, yieldEvery: 1000 });
    const two = await annealPlacement(board(), { iterations: 150, seed: 3, yieldEvery: 1000 });
    expect(one.view.items).toEqual(two.view.items);
    expect(one.evaluated).toBe(two.evaluated);
  });

  it("keeps the spacing and the walls whatever the walk tried", async () => {
    const result = await annealPlacement(board(), { iterations: 200, seed: 11, yieldEvery: 1000 });
    expect(placementIsValid(result.view.items)).toBe(true);
    // The strangers stay out of the platform's frame.
    const frame = result.view.rectangles[0];
    for (const id of ["x", "y"]) {
      const t = result.view.items.find((i) => i.id === id)!.tile;
      const inside = t.x >= frame.from.x && t.x <= frame.to.x && t.y >= frame.from.y && t.y <= frame.to.y;
      expect(inside).toBe(false);
    }
  });
});

describe("placementIsValid", () => {
  it("refuses two drawings closer than the spacing, and a stranger inside a frame", () => {
    expect(placementIsValid([{ id: "a", tile: { x: 0, y: 0 } }, { id: "b", tile: { x: 3, y: 0 } }])).toBe(false);
    expect(
      placementIsValid([
        { id: "m1", tile: { x: 0, y: 0 }, parent: "P" },
        { id: "m2", tile: { x: 8, y: 8 }, parent: "P" },
        { id: "s", tile: { x: 4, y: 4 } },
      ])
    ).toBe(false);
    expect(placementIsValid([{ id: "a", tile: { x: 0, y: 0 } }, { id: "b", tile: { x: 4, y: 0 } }])).toBe(true);
  });
});

describe("reframed", () => {
  it("moves a boundary's frame and name with its members", () => {
    const view = board();
    view.items.find((i) => i.id === "a")!.tile = { x: 12, y: 0 };
    const r = reframed(view).rectangles[0];
    expect(r.to.x).toBe(13);
    expect(reframed(view).textBoxes[0].tile).toEqual({ x: 13, y: 5 });
  });
});

// A search for a board nobody looks at any more must stop: six view changes
// used to leave six searches fighting over the event loop.
describe("annealPlacement — stopping", () => {
  it("stops at the first yield once asked to, and hands the board back untouched", async () => {
    const view = {
      id: "v", name: "v", rectangles: [], textBoxes: [],
      // Two diagonals of a square: they cross, so the search has something to do.
      items: [{ id: "a", tile: { x: 0, y: 0 } }, { id: "b", tile: { x: 4, y: 0 } }, { id: "c", tile: { x: 0, y: 4 } }, { id: "d", tile: { x: 4, y: 4 } }],
      connectors: [
        { id: "c1", color: "k", anchors: [{ id: "a1", ref: { item: "a" } }, { id: "a2", ref: { item: "d" } }] },
        { id: "c2", color: "k", anchors: [{ id: "a3", ref: { item: "b" } }, { id: "a4", ref: { item: "c" } }] },
      ],
    } as unknown as Parameters<typeof annealPlacement>[0];
    const result = await annealPlacement(view, { iterations: 500, yieldEvery: 3, shouldStop: () => true });
    expect(result.stopped).toBe(true);
    expect(result.improved).toBe(false);
    expect(result.evaluated).toBeLessThan(500);
    expect(result.view.items.map((i) => i.tile)).toEqual(view.items.map((i) => i.tile));
  });
});
