import { describe, it, expect } from "vitest";
import type { LayoutResult } from "../layout/graph-layout";
import type { DiagramContext } from "./title-block";
import { buildIsoBoardSvg, tileToScreen } from "./iso-view";

function layout(o: Partial<LayoutResult> = {}): LayoutResult {
  return {
    nodes: [
      { id: "A", label: "A", kind: "actor", subtitle: "Application", x: 0, y: 0, width: 240, height: 120 },
      { id: "B", label: "B", kind: "actor", external: true, x: 600, y: 0, width: 240, height: 120 },
    ],
    edges: [
      { from: "A", to: "B", technology: "HTTP", count: 1, label: "F", attenuated: false, points: [{ x: 240, y: 60 }, { x: 400, y: 60 }] },
    ],
    width: 840,
    height: 120,
    ...o,
  };
}

const colour = () => "#336699";

const svgOf = (l: LayoutResult, context: DiagramContext | null = null) => buildIsoBoardSvg(l, colour, context, "v");

const context: DiagramContext = {
  title: "Group to group",
  reading: "architecture",
  milestone: null,
  source: "classeur.xlsx",
  date: "2026-08-28",
  components: 2,
  flows: 1,
  technologies: 1,
};

describe("buildIsoBoardSvg", () => {
  it("stands on its own: a viewBox, its font, its background", () => {
    const svg = svgOf(layout());
    expect(svg.getAttribute("viewBox")).toBeTruthy();
    expect(svg.getAttribute("font-family")).toContain("system-ui");
    expect(svg.querySelector("rect")!.getAttribute("fill")).toBe("#ffffff");
  });

  it("draws one isometric drawing per actor, and its text under it", () => {
    const svg = svgOf(layout());
    const images = [...svg.querySelectorAll("image")];
    expect(images).toHaveLength(2);
    for (const image of images) expect(image.getAttribute("href")).toMatch(/^data:image\/svg\+xml/);
    const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("A");
    expect(texts).toContain("B");
    // The very objection that kept the isometric out (« their boxes carry no
    // text ») is what this line guards: ours do.
    expect(texts).toContain("[Application]");
  });

  it("paints back to front, so the front drawing passes before the back one", () => {
    const svg = svgOf(layout());
    // Whatever the placement decided, the DOM order of the drawings must be
    // their screen order, top first: SVG paints in document order.
    const tops = [...svg.querySelectorAll("image")].map((i) => Number(i.getAttribute("y")));
    expect(tops).toEqual([...tops].sort((a, b) => a - b));
  });

  it("draws the flow in its technology's colour, head at the arrival", () => {
    const svg = svgOf(layout());
    const line = svg.querySelector("polyline")!;
    expect(line.getAttribute("stroke")).toBe("#336699");
    expect(line.getAttribute("stroke-dasharray")).toBeNull();
    const head = svg.querySelector("polygon")!;
    const tip = head.getAttribute("points")!.split(" ")[0].split(",").map(Number);
    const ends = line
      .getAttribute("points")!
      .split(" ")
      .map((p) => p.split(",").map(Number));
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(d(tip, ends[ends.length - 1])).toBeLessThan(d(tip, ends[0]));
  });

  it("puts the head at the START of a pulled flow: the stroke follows the data, the head the initiative", () => {
    const l = layout();
    l.edges[0].pulled = true;
    const svg = svgOf(l);
    const line = svg.querySelector("polyline")!;
    const head = svg.querySelector("polygon")!;
    const tip = head.getAttribute("points")!.split(" ")[0].split(",").map(Number);
    const ends = line
      .getAttribute("points")!
      .split(" ")
      .map((p) => p.split(",").map(Number));
    const d = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    expect(d(tip, ends[0])).toBeLessThan(d(tip, ends[ends.length - 1]));
  });

  it("draws every segment along one of the grid's two directions, to its very tip", () => {
    // A board dense enough to have lanes, detours and heads from both sides:
    // whatever the routing did, a line on an isometric grid runs along the
    // grid -- the slope of every segment is ±(81.9 / 141.5), never anything
    // else. One angle off the grid and the projection stops reading as one.
    const l = layout({
      nodes: [
        { id: "A", label: "A", kind: "actor", x: 0, y: 0, width: 240, height: 120 },
        { id: "B", label: "B", kind: "actor", x: 600, y: 0, width: 240, height: 120 },
        { id: "C", label: "C", kind: "actor", x: 300, y: 400, width: 240, height: 120 },
        { id: "D", label: "D", kind: "actor", x: 900, y: 400, width: 240, height: 120 },
      ],
      edges: [
        { from: "A", to: "B", technology: "HTTP", count: 1, label: "F", attenuated: false, points: [] },
        { from: "A", to: "B", technology: "SQL", count: 1, label: "G", attenuated: false, points: [] },
        { from: "C", to: "B", technology: "HTTP", count: 1, label: "H", attenuated: false, points: [] },
        { from: "D", to: "A", technology: "File", count: 1, label: "I", attenuated: false, pulled: true, points: [] },
        { from: "B", to: "D", technology: "Kafka", count: 1, label: "J", attenuated: false, points: [] },
      ],
    });
    const svg = svgOf(l);
    const gridSlope = 40.95 / 70.75;
    const lines = [...svg.querySelectorAll("polyline")].filter((p) => p.getAttribute("stroke-opacity") !== "0");
    expect(lines.length).toBe(5);
    for (const line of lines) {
      const pts = line
        .getAttribute("points")!
        .split(" ")
        .map((p) => p.split(",").map(Number));
      for (let i = 1; i < pts.length; i++) {
        const dx = pts[i][0] - pts[i - 1][0];
        const dy = pts[i][1] - pts[i - 1][1];
        if (Math.hypot(dx, dy) < 1e-6) continue;
        expect(Math.abs(Math.abs(dy / dx) - gridSlope)).toBeLessThan(1e-6);
      }
    }
  });

  it("dashes what the diagrams attenuate, and labels the flow in their words", () => {
    const l = layout();
    l.edges[0].attenuated = true;
    const svg = svgOf(l);
    expect(svg.querySelector("polyline")!.getAttribute("stroke-dasharray")).toBe("8 5");
    const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("F — [HTTP]");
  });

  it("fans out parallel flows instead of stacking them", () => {
    const l = layout();
    l.edges.push({ from: "A", to: "B", technology: "SQL", count: 1, label: "G", attenuated: false, points: [] });
    const svg = svgOf(l);
    const lines = [...svg.querySelectorAll("polyline")].map((p) => p.getAttribute("points"));
    expect(new Set(lines).size).toBe(2);
  });

  it("keeps the labels of parallel flows off each other", () => {
    const l = layout();
    l.edges.push({ from: "A", to: "B", technology: "SQL", count: 1, label: "G", attenuated: false, points: [] });
    const svg = svgOf(l);
    const boxes = [...svg.querySelectorAll("g > rect[rx]")].map((r) => ({
      x0: Number(r.getAttribute("x")),
      y0: Number(r.getAttribute("y")),
      x1: Number(r.getAttribute("x")) + Number(r.getAttribute("width")),
      y1: Number(r.getAttribute("y")) + Number(r.getAttribute("height")),
    }));
    expect(boxes).toHaveLength(2);
    const [a, b] = boxes;
    expect(a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1).toBe(false);
  });

  it("draws the ground grid with the same projection as the drawings", () => {
    const svg = svgOf(layout());
    expect(svg.querySelectorAll("g[stroke] line").length).toBeGreaterThan(0);
  });

  it("projects a boundary as the dashed zone it is on the flat boards", () => {
    const l = layout({
      nodes: [
        { id: "Zone", label: "Zone", kind: "boundary", x: 200, y: 60, width: 700, height: 260 },
        { id: "A", label: "A", kind: "actor", parent: "Zone", x: 0, y: 0, width: 240, height: 120 },
        { id: "B", label: "B", kind: "actor", parent: "Zone", x: 400, y: 120, width: 240, height: 120 },
      ],
      edges: [],
    });
    const svg = svgOf(l);
    const zones = [...svg.querySelectorAll("polygon")].filter((p) => p.getAttribute("stroke-dasharray"));
    expect(zones).toHaveLength(1);
    const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("Zone");
  });

  it("wires the hover focus: one named group per flow, the dimming rule in the file itself", () => {
    const l = layout();
    l.edges.push({ from: "A", to: "B", technology: "SQL", count: 1, label: "G", attenuated: false, points: [] });
    const svg = svgOf(l);
    // The line group and the chip group of one flow carry the same name:
    // hovering either lights both.
    expect(svg.querySelectorAll("g.iso-flow.f-c1")).toHaveLength(2);
    const style = svg.querySelector("style")!;
    expect(style.textContent).toContain(":has(.f-c1:hover)");
    expect(style.textContent).toContain(".iso-flow:not(.f-c2)");
    // The wide invisible twin that makes a 3.5px stroke hoverable.
    const grips = [...svg.querySelectorAll("polyline")].filter((p) => p.getAttribute("stroke-opacity") === "0");
    expect(grips).toHaveLength(2);
  });

  it("says what it shows, exactly like the flat board: title block and accessible name", () => {
    const svg = svgOf(layout(), context);
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.querySelector("title")!.textContent).toContain("Group to group");
    expect(svg.querySelector("desc")!.textContent).toBeTruthy();
  });
});

describe("tileToScreen", () => {
  it("projects with fossflow's own constants: the 141.5 × 81.9 tile", () => {
    expect(tileToScreen({ x: 1, y: 0 })).toEqual({ x: 70.75, y: -40.95 });
    expect(tileToScreen({ x: 0, y: 1 })).toEqual({ x: -70.75, y: -40.95 });
  });
});
