import { describe, it, expect } from "vitest";
import type { LayoutResult } from "../layout/graph-layout";
import { modelToFossflow, fossflowJson, continuousTile, type FossflowModel } from "./fossflow-json";

function layout(o: Partial<LayoutResult> = {}): LayoutResult {
  return {
    nodes: [
      { id: "A", label: "A", kind: "actor", subtitle: "Application", description: "Un texte", x: 0, y: 0, width: 240, height: 120 },
      { id: "B", label: "B", kind: "actor", external: true, x: 400, y: 0, width: 240, height: 120 },
    ],
    edges: [
      { from: "A", to: "B", technology: "HTTP", count: 1, label: "F", attenuated: false, points: [{ x: 240, y: 60 }, { x: 400, y: 60 }] },
    ],
    width: 640,
    height: 120,
    ...o,
  };
}

const colour = () => "#336699";

const model = (l: LayoutResult, title = "v"): FossflowModel => modelToFossflow([{ title, layout: l }], colour, "classeur.xlsx");

// The screen position a tile will get, reduced to what the tests compare:
// left-to-right reads on tx − ty, top-to-bottom on −(tx + ty).
const screenX = (t: { x: number; y: number }) => t.x - t.y;
const screenY = (t: { x: number; y: number }) => -(t.x + t.y);

describe("modelToFossflow", () => {
  it("produces a document with every top-level field the schema requires", () => {
    const m = JSON.parse(fossflowJson(model(layout())));
    for (const key of ["version", "title", "icons", "colors", "items", "views"]) {
      expect(m).toHaveProperty(key);
    }
    expect(m.title).toBe("classeur.xlsx");
    expect(m.views).toHaveLength(1);
  });

  it("declares one item per actor, deduplicated across boards", () => {
    const m = modelToFossflow(
      [
        { title: "one", layout: layout() },
        { title: "two", layout: layout() },
      ],
      colour,
      "classeur.xlsx"
    );
    expect(m.items.map((i) => i.name).sort()).toEqual(["A", "B"]);
    expect(m.views).toHaveLength(2);
  });

  it("carries the type and the description into the item, FossFLOW's one place for them", () => {
    const a = model(layout()).items.find((i) => i.name === "A")!;
    expect(a.description).toBe("[Application] — Un texte");
    expect(a.subtitle).toBe("Application");
  });

  it("gives every placed item an integer tile of its own", () => {
    const l = layout();
    // Two boxes ELK drew very close: rounding alone would give them one tile.
    l.nodes[1].x = 40;
    const view = model(l).views[0];
    const tiles = view.items.map((i) => `${i.tile.x},${i.tile.y}`);
    expect(new Set(tiles).size).toBe(view.items.length);
    for (const i of view.items) {
      expect(Number.isInteger(i.tile.x)).toBe(true);
      expect(Number.isInteger(i.tile.y)).toBe(true);
    }
  });

  it("keeps both reading axes: right stays right, down stays down", () => {
    const l = layout({
      nodes: [
        { id: "A", label: "A", kind: "actor", x: 0, y: 0, width: 240, height: 120 },
        { id: "B", label: "B", kind: "actor", x: 600, y: 0, width: 240, height: 120 },
        { id: "C", label: "C", kind: "actor", x: 0, y: 500, width: 240, height: 120 },
      ],
      edges: [],
    });
    const view = model(l).views[0];
    const tile = (id: string) => view.items.find((i) => i.id === id)!.tile;
    expect(screenX(tile("b"))).toBeGreaterThan(screenX(tile("a")));
    expect(screenY(tile("c"))).toBeGreaterThan(screenY(tile("a")));
  });

  it("chooses the drawing by type, cloud for the untyped external, router for the plumbing", () => {
    const l = layout({
      nodes: [
        { id: "Q", label: "Q", kind: "actor", subtitle: "Queue", x: 0, y: 0, width: 240, height: 120 },
        { id: "X", label: "X", kind: "actor", external: true, x: 400, y: 0, width: 240, height: 120 },
        { id: "T", label: "T", kind: "actor", subtitle: "ESB", technical: true, x: 800, y: 0, width: 240, height: 120 },
      ],
      edges: [],
    });
    const m = model(l);
    const iconOf = (name: string) => m.items.find((i) => i.name === name)!.icon;
    expect(iconOf("Q")).toBe("queue");
    expect(iconOf("X")).toBe("cloud");
    expect(iconOf("T")).toBe("router");
    // Only the drawings actually used travel, as data URIs the tool needs no
    // network to show.
    expect(m.icons.map((i) => i.id).sort()).toEqual(["cloud", "queue", "router"]);
    for (const icon of m.icons) expect(icon.url.startsWith("data:image/svg+xml")).toBe(true);
  });

  it("turns a boundary into a rectangle that contains its members, with its name in a text box", () => {
    const l = layout({
      nodes: [
        { id: "Zone", label: "Zone", kind: "boundary", x: 200, y: 60, width: 700, height: 260 },
        { id: "A", label: "A", kind: "actor", x: 0, y: 0, width: 240, height: 120 },
        { id: "B", label: "B", kind: "actor", x: 400, y: 120, width: 240, height: 120 },
      ],
      edges: [],
    });
    const view = model(l).views[0];
    expect(view.rectangles).toHaveLength(1);
    const zone = view.rectangles[0];
    for (const item of view.items) {
      expect(item.tile.x).toBeGreaterThanOrEqual(zone.from.x);
      expect(item.tile.x).toBeLessThanOrEqual(zone.to.x);
      expect(item.tile.y).toBeGreaterThanOrEqual(zone.from.y);
      expect(item.tile.y).toBeLessThanOrEqual(zone.to.y);
    }
    expect(view.textBoxes.map((b) => b.content)).toEqual(["Zone"]);
    // A boundary is a frame, never a piece on the board: no item, no drawing.
    expect(view.items.map((i) => i.id).sort()).toEqual(["a", "b"]);
  });

  it("draws a connector from provider to consumer, in the diagrams' colour and words", () => {
    const m = model(layout());
    const c = m.views[0].connectors[0];
    expect(c.anchors.map((a) => a.ref.item)).toEqual(["a", "b"]);
    expect(c.description).toBe("F — [HTTP]");
    const palette = new Map(m.colors.map((entry) => [entry.id, entry.value]));
    expect(palette.get(c.color!)).toBe("#336699");
    expect(c.style).toBeUndefined();
    expect(c.startArrow).toBeUndefined();
  });

  it("says DASHED what the diagrams attenuate, and startArrow what they pull", () => {
    const l = layout();
    l.edges[0].attenuated = true;
    l.edges[0].pulled = true;
    const c = model(l).views[0].connectors[0];
    expect(c.style).toBe("DASHED");
    expect(c.startArrow).toBe(true);
  });

  it("keeps the functional reading's lines in neutral ink rather than a borrowed colour", () => {
    const l = layout();
    l.edges[0].technology = "";
    const m = model(l);
    const c = m.views[0].connectors[0];
    const palette = new Map(m.colors.map((entry) => [entry.id, entry.value]));
    expect(palette.get(c.color!)).toBe("#5b6472");
  });
});

describe("continuousTile", () => {
  it("is linear: the projection carries ELK's plane without folding it", () => {
    const a = continuousTile(100, 50);
    const b = continuousTile(200, 100);
    expect(b.x).toBeCloseTo(2 * a.x);
    expect(b.y).toBeCloseTo(2 * a.y);
  });
});
