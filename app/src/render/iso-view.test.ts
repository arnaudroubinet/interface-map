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
    const l = layout({
      nodes: [
        { id: "Back", label: "Back", kind: "actor", x: 300, y: 0, width: 240, height: 120 },
        { id: "Front", label: "Front", kind: "actor", x: 300, y: 500, width: 240, height: 120 },
      ],
      edges: [],
    });
    const svg = svgOf(l);
    const names = [...svg.querySelectorAll("text")].filter((t) => t.getAttribute("font-weight") === "bold").map((t) => t.textContent);
    expect(names).toEqual(["Back", "Front"]);
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

  it("draws the ground grid with the same projection as the drawings", () => {
    const svg = svgOf(layout());
    expect(svg.querySelectorAll("g[stroke] line").length).toBeGreaterThan(0);
  });

  it("projects a boundary as the dashed zone it is on the flat boards", () => {
    const l = layout({
      nodes: [
        { id: "Zone", label: "Zone", kind: "boundary", x: 200, y: 60, width: 700, height: 260 },
        { id: "A", label: "A", kind: "actor", x: 0, y: 0, width: 240, height: 120 },
        { id: "B", label: "B", kind: "actor", x: 400, y: 120, width: 240, height: 120 },
      ],
      edges: [],
    });
    const svg = svgOf(l);
    const zones = [...svg.querySelectorAll("polygon")].filter((p) => p.getAttribute("stroke-dasharray"));
    expect(zones).toHaveLength(1);
    const texts = [...svg.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("Zone");
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
