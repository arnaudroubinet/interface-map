import { describe, it, expect } from "vitest";
import { ICONS, DEFAULT_ICON } from "./icons";
import { buildGraphSvg } from "./svg-builder";
import { styleOfNode } from "./node-styles";
import { computeLayout, chipSize } from "../layout/graph-layout";
import { contrastRatio } from "./contrast";
import { serializeSvg } from "../export/svg-export";
import { colourForTechnologies } from "./colors";
import type { GraphNode, GraphEdge } from "../aggregation/core";
import type { LayoutResult } from "../layout/graph-layout";

describe("buildGraphSvg", () => {
  it("draws one <g> per node and one per edge, with the technology label always present", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "Socle", kind: "group" },
      { id: "B", label: "Ryloth", kind: "group" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 3, label: "HTTP ×3", attenuated: false }];
    const layout = await computeLayout(nodes, edges);
    const colorFor = (tech: string) => colourForTechnologies(["HTTP"]).get(tech) ?? "#000";

    const svg = buildGraphSvg(layout, colorFor);

    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.querySelectorAll("text").length).toBeGreaterThanOrEqual(3); // 2 node labels + 1 edge label
    expect(svg.textContent).toContain("HTTP ×3");
  });

  it("renders an attenuated edge as dashed with reduced opacity", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: true }];
    const layout = await computeLayout(nodes, edges);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const path = svg.querySelector("path[stroke-dasharray]");
    expect(path).not.toBeNull();
  });

  it("colours a node by its perimeter: solid blue inside the platform, grey outside", async () => {
    const layout = await computeLayout(
      [
        { id: "A", label: "Tatooine", kind: "platform" },
        { id: "B", label: "Bespin", kind: "actor", external: true },
      ],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }]
    );

    const svg = buildGraphSvg(layout, () => "#2a78d6");
    const boxes = [...svg.querySelectorAll(".fx-nodes rect")];

    // The hues come from styleOfNode, the single source: copying them here would
    // fail this test at the first contrast adjustment, with nothing having stopped
    // working.
    const blue = boxes.find((r) => r.getAttribute("fill") === styleOfNode({ kind: "platform", external: false }).fill);
    const grey = boxes.find((r) => r.getAttribute("fill") === styleOfNode({ kind: "actor", external: true }).fill);
    expect(blue).not.toBeUndefined();
    expect(grey).not.toBeUndefined();
    expect(blue!.getAttribute("fill")).not.toBe(grey!.getAttribute("fill"));
    // The external side is told apart by shape too, not only by colour.
    expect(grey!.getAttribute("stroke-dasharray")).toBe("8 5");
  });

  it("renders a node's «type» and description under its name (style C4)", async () => {
    const nodes: GraphNode[] = [{ id: "A", label: "Tatooine", kind: "platform", subtitle: "Middleware", description: "Bus d'échange principal" }];
    const layout = await computeLayout(nodes, []);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const texts = [...svg.querySelectorAll("g > text")].map((t) => t.textContent);
    expect(texts).toContain("Tatooine");
    // The type is written in brackets under the name, C4 convention.
    expect(texts).toContain("[Middleware]");
    expect(texts).toContain("Bus d'échange principal");
  });

  it("omits the «type»/description lines when a node has none (aggregated groupe with no matching acteurs)", async () => {
    const nodes: GraphNode[] = [{ id: "A", label: "Socle", kind: "group" }];
    const layout = await computeLayout(nodes, []);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    expect(svg.querySelectorAll("g > text")).toHaveLength(1);
  });

  // The icon is no longer deduced from the type: it is NAMED by the workbook.
  it("draws the icon designated for the node, and marks an external actor in its type line and border", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "Hoth", kind: "actor", subtitle: "Partenaire", external: true, icon: "handshake" },
    ];
    const layout = await computeLayout(nodes, []);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const nodeGroups = [...svg.querySelectorAll(".fx-nodes g")];
    const iconGroup = nodeGroups.find((g) => g.children.length === 5 && [...g.children].every((c) => c.tagName === "path"));
    expect(iconGroup).not.toBeUndefined();

    const box = svg.querySelector(".fx-nodes rect")!;
    expect(box.getAttribute("stroke-dasharray")).toBe("8 5");

    const texts = [...svg.querySelectorAll("g > text")].map((t) => t.textContent);
    expect(texts).toContain("[Partenaire · External]");
  });

  it("falls back to the neutral token when the workbook designates nothing, or names an icon that does not exist", async () => {
    const expected = ICONS[DEFAULT_ICON].length;
    for (const icon of [undefined, "licorne-violette"]) {
      const layout = await computeLayout([{ id: "A", label: "Tatooine", kind: "actor", subtitle: "Rituel", icon }], []);
      const svg = buildGraphSvg(layout, () => "#2a78d6");
      const groups = [...svg.querySelectorAll(".fx-nodes g")];
      expect(groups.some((g) => g.children.length === expected)).toBe(true);
    }
  });

  it("renders the selected actor in inverted colors", async () => {
    const nodes: GraphNode[] = [{ id: "A", label: "Tatooine", kind: "focus-actor" }];
    const layout = await computeLayout(nodes, []);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const text = svg.querySelector("text")!;
    expect(text.getAttribute("fill")).toBe("#ffffff");
  });

  it("fuses same-technology edges arriving at the same target into one arrowed trunk, keeping each branch's own name", async () => {
    const layout: LayoutResult = {
      nodes: [
        { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
        { id: "C", label: "C", kind: "group", x: 0, y: 100, width: 80, height: 40 },
        { id: "B", label: "B", kind: "group", x: 200, y: 50, width: 80, height: 40 },
      ],
      edges: [
        {
          from: "A",
          to: "B",
          technology: "HTTP",
          count: 2,
          label: "Flux A",
          attenuated: false,
          // Both branches share B's entry port, hence the same final approach: that is
          // the condition that allows the merge.
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 20 },
            { x: 100, y: 50 },
            { x: 160, y: 50 },
          ],
          labelCentreOf: { x: 90, y: 15 },
        },
        {
          from: "C",
          to: "B",
          technology: "HTTP",
          count: 3,
          label: "Flux C",
          attenuated: false,
          points: [
            { x: 0, y: 100 },
            { x: 100, y: 80 },
            { x: 100, y: 50 },
            { x: 160, y: 50 },
          ],
          labelCentreOf: { x: 90, y: 90 },
        },
      ],
      width: 300,
      height: 150,
    };

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const paths = [...svg.querySelectorAll(".fx-edges g > path")];
    // Each branch is cut in two at its label; the trunk, which carries none,
    // stays in one piece.
    expect(paths).toHaveLength(5);
    const arrowed = paths.filter((p) => p.hasAttribute("marker-end"));
    expect(arrowed).toHaveLength(1);
    // The trunk carries the branches' total, but its width stays that of every
    // other line: the aggregation must produce no bold effect.
    const widths = new Set(paths.map((p) => p.getAttribute("stroke-width")));
    expect(widths).toEqual(new Set(["2"]));

    const labels = [...svg.querySelectorAll(".fx-labels text")].map((t) => t.textContent);
    expect(labels).toContain("Flux A");
    expect(labels).toContain("Flux C");
    // The trunk carries no label of its own.
    expect(svg.querySelectorAll(".fx-labels g")).toHaveLength(2);
  });

  it("leaves a single edge into a target unfused (own arrow, own path)", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }];
    const layout = await computeLayout(nodes, edges);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const paths = [...svg.querySelectorAll(".fx-edges g > path")];
    // A single flow: its path is cut in two at its label, and only the last piece
    // carries the head.
    expect(paths).toHaveLength(2);
    expect(paths[0].hasAttribute("marker-end")).toBe(false);
    expect(paths[1].getAttribute("marker-end")).toBe("url(#arrow-12-2a78d6)");
  });

  it("keeps a deprecated (dimmed) flow separate from active flows of the same technology into the same target", async () => {
    const layout: LayoutResult = {
      nodes: [
        { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
        { id: "B", label: "B", kind: "group", x: 200, y: 50, width: 80, height: 40 },
      ],
      edges: [
        {
          from: "A",
          to: "B",
          technology: "HTTP",
          count: 1,
          label: "Flux actif",
          attenuated: false,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 25 },
            { x: 200, y: 50 },
          ],
        },
        {
          from: "A",
          to: "B",
          technology: "HTTP",
          count: 1,
          label: "Flux à transformer",
          attenuated: true,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 25 },
            { x: 200, y: 50 },
          ],
        },
      ],
      width: 300,
      height: 100,
    };

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const paths = [...svg.querySelectorAll(".fx-edges g > path")];
    expect(paths).toHaveLength(2); // pas de fusion malgré même cible + même techno
    expect(paths.filter((p) => p.hasAttribute("marker-end"))).toHaveLength(2);
    expect(paths.filter((p) => p.hasAttribute("stroke-dasharray"))).toHaveLength(1);
  });

  it("keeps the arrowhead a fixed size in user units, independent of the stroke width", async () => {
    const layout: LayoutResult = {
      nodes: [
        { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
        { id: "C", label: "C", kind: "group", x: 0, y: 100, width: 80, height: 40 },
        { id: "B", label: "B", kind: "group", x: 300, y: 50, width: 80, height: 40 },
      ],
      edges: [
        { from: "A", to: "B", technology: "HTTP", count: 40, label: "F1", attenuated: false, points: [{ x: 40, y: 0 }, { x: 260, y: 50 }] },
        { from: "C", to: "B", technology: "HTTP", count: 40, label: "F2", attenuated: false, points: [{ x: 40, y: 100 }, { x: 260, y: 50 }] },
      ],
      width: 400,
      height: 200,
    };

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const trunk = [...svg.querySelectorAll(".fx-edges g > path")].find((p) => p.hasAttribute("marker-end"))!;
    expect(trunk).toBeTruthy();

    const marker = svg.querySelector("marker")!;
    // By default a marker is measured in multiples of stroke-width: this trunk's
    // head would have been ~48px wide and would have covered the box.
    expect(marker.getAttribute("markerUnits")).toBe("userSpaceOnUse");
    expect(Number(marker.getAttribute("markerWidth"))).toBeLessThanOrEqual(14);
  });

  it("contains the smoothed curve itself in the viewBox, not merely the points it was built from", async () => {
    // Routing around an obstacle creates a tight turn: the smoothed spline then
    // overshoots its control polyline by a wide margin (up to ~100px observed on
    // the sample workbook) and left the white frame.
    const nodes: GraphNode[] = [
      { id: "A", label: "Source", kind: "group" },
      { id: "C", label: "Obstacle sur la route", kind: "group" },
      { id: "B", label: "Cible", kind: "group" },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "C", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
      { from: "C", to: "B", technology: "Kafka", count: 1, label: "Kafka", attenuated: false },
      { from: "B", to: "A", technology: "JMS", count: 1, label: "JMS", attenuated: false }, // repart en arrière : détour garanti
    ];
    const layout = await computeLayout(nodes, edges);

    const svg = buildGraphSvg(layout, () => "#2a78d6");
    const [vbX, vbY, vbL, vbH] = svg.getAttribute("viewBox")!.split(" ").map(Number);

    // Replays the path's cubics to learn the points ACTUALLY drawn (the d holds
    // only the control points).
    function drawnPoints(d: string): { x: number; y: number }[] {
      const numbers = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      const rendus = [numbers[0]];
      for (let i = 1; i + 2 < numbers.length; i += 3) {
        const [p0, p1, p2, p3] = [numbers[i - 1], numbers[i], numbers[i + 1], numbers[i + 2]];
        for (let s = 1; s <= 20; s++) {
          const t = s / 20;
          const u = 1 - t;
          rendus.push({
            x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
          });
        }
      }
      return rendus;
    }

    for (const path of svg.querySelectorAll(".fx-edges g > path")) {
      for (const p of drawnPoints(path.getAttribute("d")!)) {
        expect(p.x).toBeGreaterThanOrEqual(vbX);
        expect(p.x).toBeLessThanOrEqual(vbX + vbL);
        expect(p.y).toBeGreaterThanOrEqual(vbY);
        expect(p.y).toBeLessThanOrEqual(vbY + vbH);
      }
    }
  });

  it("reserves room for the arrowheads in the viewBox, not just for the path endpoints", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }];
    const layout = await computeLayout(nodes, edges);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const [vbX, vbY, vbL, vbH] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    const headSize = Number(svg.querySelector("marker")!.getAttribute("markerWidth"));
    for (const p of svg.querySelectorAll(".fx-edges g > path[marker-end]")) {
      const coords = [...p.getAttribute("d")!.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      const end = coords[coords.length - 1];
      expect(end.x - headSize).toBeGreaterThanOrEqual(vbX);
      expect(end.x + headSize).toBeLessThanOrEqual(vbX + vbL);
      expect(end.y - headSize).toBeGreaterThanOrEqual(vbY);
      expect(end.y + headSize).toBeLessThanOrEqual(vbY + vbH);
    }
  });

  it("colors the arrowhead marker to match its edge's technology, using a soft dart shape in the same bounding box as c4hero's marker", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "Kafka", count: 1, label: "Kafka", attenuated: false }];
    const layout = await computeLayout(nodes, edges);

    const svg = buildGraphSvg(layout, () => "#ff6600");

    const marker = svg.querySelector("marker")!;
    expect(marker.querySelector("path")!.getAttribute("fill")).toBe("#ff6600");
    // The same bounding box (0..10, tip at (10,5)) as c4hero's "c4-arrow" marker
    // (Canvas.tsx) that this starts from, but a softened dart (convex sides,
    // concave back) rather than its three straight edges.
    expect(marker.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(marker.querySelector("path")!.getAttribute("d")).toBe("M 0,0 Q 6,1 10,5 Q 6,9 0,10 Q 2.5,5 0,0 Z");
    // The head is carried by the path's last piece, the one approaching the
    // target -- the preceding pieces stop at the label.
    const pieces = [...svg.querySelectorAll(".fx-edges g > path[stroke]")];
    expect(pieces[pieces.length - 1].getAttribute("marker-end")).toBe(`url(#${marker.id})`);
  });
});

describe("buildGraphSvg — orthogonal routing", () => {
  const ellipsis = (points: { x: number; y: number }[]): LayoutResult => ({
    nodes: [
      { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
      { id: "B", label: "B", kind: "group", x: 400, y: 200, width: 80, height: 40 },
    ],
    edges: [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, points }],
    width: 500,
    height: 300,
  });

  it("rounds a right-angle bend with a quadratic arc instead of a sharp corner", () => {
    const layout = ellipsis([
      { x: 40, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 360, y: 200 },
    ]);

    const d = buildGraphSvg(layout, () => "#2a78d6").querySelector(".fx-edges g > path")!.getAttribute("d")!;

    // One arc per corner, and no vertex left sharp.
    expect([...d.matchAll(/Q /g)]).toHaveLength(2);
    expect(d).not.toContain("L 200,0 L");
  });

  it("leaves a collinear triple alone rather than emitting a degenerate arc on it", () => {
    const layout = ellipsis([
      { x: 40, y: 0 },
      { x: 200, y: 0 },
      { x: 360, y: 0 },
    ]);

    const d = buildGraphSvg(layout, () => "#2a78d6").querySelector(".fx-edges g > path")!.getAttribute("d")!;

    expect(d).not.toContain("Q ");
    expect(d).not.toContain("NaN");
  });

  it("stops the stroke short of the target so the arrowhead points at the box without biting into it", () => {
    const layout = ellipsis([
      { x: 40, y: 0 },
      { x: 360, y: 0 },
    ]);

    const svg = buildGraphSvg(layout, () => "#2a78d6");
    const d = svg.querySelector(".fx-edges g > path[marker-end]")!.getAttribute("d")!;
    const coords = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
    const end = Number(coords[coords.length - 1][1]);
    const headSize = Number(svg.querySelector("marker")!.getAttribute("markerWidth"));

    // The line stops before the point the engine supplied: the head occupies the
    // remaining distance, plus a little play before the box.
    expect(end).toBeLessThan(360 - headSize);
  });

  it("sizes the viewBox from the actual path, arrowhead footprint included", () => {
    const layout = ellipsis([
      { x: 40, y: 0 },
      { x: 200, y: -150 },
      { x: 360, y: 200 },
    ]);

    const svg = buildGraphSvg(layout, () => "#2a78d6");
    const [vbX, vbY, vbL, vbH] = svg.getAttribute("viewBox")!.split(" ").map(Number);

    // The corner at y = -150 leaves both boxes by a wide margin: the frame must contain it.
    expect(vbY).toBeLessThanOrEqual(-150);
    expect(vbX + vbL).toBeGreaterThanOrEqual(360);
    expect(vbY + vbH).toBeGreaterThanOrEqual(200);
  });
});

describe("buildGraphSvg — the merge guard", () => {
  it("leaves flows unfused when they do not share their final approach, rather than cutting a shortcut", () => {
    const layout: LayoutResult = {
      nodes: [
        { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
        { id: "C", label: "C", kind: "group", x: 0, y: 200, width: 80, height: 40 },
        { id: "B", label: "B", kind: "group", x: 300, y: 100, width: 80, height: 40 },
      ],
      edges: [
        { from: "A", to: "B", technology: "HTTP", count: 1, label: "F1", attenuated: false,
          points: [{ x: 40, y: 0 }, { x: 200, y: 0 }, { x: 260, y: 100 }] },
        // A different final approach: merging would amount to joining the two by a
        // diagonal that ignores the routing.
        { from: "C", to: "B", technology: "HTTP", count: 1, label: "F2", attenuated: false,
          points: [{ x: 40, y: 200 }, { x: 200, y: 200 }, { x: 260, y: 140 }] },
      ],
      width: 400,
      height: 300,
    };

    const paths = [...buildGraphSvg(layout, () => "#2a78d6").querySelectorAll(".fx-edges g > path[stroke]")];

    // Two flows, two paths, two heads: no trunk manufactured.
    expect(paths).toHaveLength(2);
    expect(paths.filter((p) => p.hasAttribute("marker-end"))).toHaveLength(2);
  });
});

describe("buildGraphSvg — edge labels", () => {
  const layoutWithLabel = (label: string, technology: string): LayoutResult => ({
    nodes: [
      { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
      { id: "B", label: "B", kind: "group", x: 400, y: 0, width: 80, height: 40 },
    ],
    edges: [{ from: "A", to: "B", technology, count: 1, label, attenuated: false,
      points: [{ x: 40, y: 0 }, { x: 360, y: 0 }], labelCentreOf: { x: 200, y: 0 } }],
    width: 500,
    height: 200,
  });

  it("adds the technology on a second line only when the label says something else", () => {
    // "By actor": the label is an interface name, and the technology completes
    // the intent.
    const withIntent = buildGraphSvg(layoutWithLabel("Colis à valider", "Kafka"), () => "#2a78d6");
    const rows = [...withIntent.querySelectorAll(".fx-labels g")][0];
    expect([...rows.querySelectorAll("text")].map((t) => t.textContent)).toEqual(["Colis à valider", "[Kafka]"]);

    // An aggregated view: the label IS the technology, repeating it teaches nothing.
    const aggregated = buildGraphSvg(layoutWithLabel("Kafka ×3", "Kafka"), () => "#2a78d6");
    const alone = [...aggregated.querySelectorAll(".fx-labels g")][0];
    expect([...alone.querySelectorAll("text")].map((t) => t.textContent)).toEqual(["Kafka ×3"]);
  });

  it("paints labels after the boxes, so no box can cover a label", () => {
    const svg = buildGraphSvg(layoutWithLabel("Colis à valider", "Kafka"), () => "#2a78d6");
    const layers = [...svg.querySelectorAll("svg > g")].map((g) => g.getAttribute("class"));

    // Drawing order: boundaries, edges, boxes, labels.
    expect(layers.indexOf("fx-labels")).toBeGreaterThan(layers.indexOf("fx-nodes"));
    expect(layers.indexOf("fx-nodes")).toBeGreaterThan(layers.indexOf("fx-edges"));
  });

});

describe("buildGraphSvg — legend", () => {
  it("draws the legend inside the SVG so it survives export, not in the surrounding page", async () => {
    const layout = await computeLayout(
      [
        { id: "A", label: "Tatooine", kind: "platform" },
        { id: "B", label: "Bespin", kind: "actor", external: true },
      ],
      [
        { from: "A", to: "B", technology: "Kafka", count: 1, label: "Kafka", attenuated: false },
        { from: "B", to: "A", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
      ]
    );

    const svg = buildGraphSvg(layout, (t) => (t === "Kafka" ? "#e0a83c" : "#d03b3b"));
    const legend = svg.querySelector(".fx-legend")!;
    expect(legend).not.toBeNull();

    const inputs = [...legend.querySelectorAll("text")].map((t) => t.textContent);
    // One entry per technology present, plus the perimeters' code. The notation
    // (provider end, arrowheads) is tested separately, in legend.ts.
    expect(inputs.filter((t) => t !== "provider pushes" && t !== "consumer pulls")).toEqual([
      "HTTP",
      "Kafka",
      "Platform",
      "External",
    ]);

    // It fits within the frame: otherwise it would be clipped on export.
    const [vbX, vbY, vbL, vbH] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    const frame = legend.querySelector("rect")!;
    const x = Number(frame.getAttribute("x"));
    const y = Number(frame.getAttribute("y"));
    expect(x).toBeGreaterThanOrEqual(vbX);
    expect(y).toBeGreaterThanOrEqual(vbY);
    expect(x + Number(frame.getAttribute("width"))).toBeLessThanOrEqual(vbX + vbL + 0.001);
    expect(y + Number(frame.getAttribute("height"))).toBeLessThanOrEqual(vbY + vbH + 0.001);
  });

  it("omits the perimeter key when every node sits on the same side of the platform", async () => {
    const layout = await computeLayout(
      [
        { id: "A", label: "A", kind: "group" },
        { id: "B", label: "B", kind: "group" },
      ],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }]
    );

    const inputs = [...buildGraphSvg(layout, () => "#d03b3b").querySelectorAll(".fx-legend text")].map((t) => t.textContent);
    expect(inputs).not.toContain("Platform");
    expect(inputs).not.toContain("External");
    expect(inputs).toContain("HTTP");
  });

  // Functional mode empties `technology` on every edge: an unnamed entry would
  // announce a colour code found nowhere on the drawing. The legend does keep the
  // NOTATION, though -- the provider-end circle is drawn there too, and it must
  // explain itself.
  it("drops the legend entirely when every edge carries no technology name", async () => {
    const layout = await computeLayout(
      [
        { id: "A", label: "A", kind: "group" },
        { id: "B", label: "B", kind: "group" },
      ],
      [{ from: "A", to: "B", technology: "", count: 1, label: "", attenuated: false }]
    );

    const svg = buildGraphSvg(layout, () => "#2a78d6");
    expect(svg.querySelector(".fx-legend")).toBeNull();
  });

  it("keeps the named technologies and drops only the nameless ones", async () => {
    const layout = await computeLayout(
      [
        { id: "A", label: "A", kind: "group" },
        { id: "B", label: "B", kind: "group" },
        { id: "C", label: "C", kind: "group" },
      ],
      [
        { from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
        { from: "B", to: "C", technology: "", count: 1, label: "", attenuated: false },
      ]
    );

    const inputs = [...buildGraphSvg(layout, () => "#2a78d6").querySelectorAll(".fx-legend text")].map((t) => t.textContent);
    expect(inputs).toEqual(["HTTP"]);
  });
});

describe("buildGraphSvg — the label sits inside the line", () => {
  const layoutWithLabel = (labelCentreOf: { x: number; y: number }): LayoutResult => ({
    nodes: [
      { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
      { id: "B", label: "B", kind: "group", x: 600, y: 0, width: 80, height: 40 },
    ],
    edges: [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false,
      points: [{ x: 40, y: 0 }, { x: 560, y: 0 }], labelCentreOf }],
    width: 700,
    height: 200,
  });

  it("interrupts the line where the label sits, and resumes behind it", () => {
    const svg = buildGraphSvg(layoutWithLabel({ x: 300, y: 0 }), () => "#2a78d6");
    const lines = [...svg.querySelectorAll(".fx-edges g > path[stroke]")];

    // Two pieces: before the text, then after.
    expect(lines).toHaveLength(2);
    // Only the last carries the head, the one approaching the target.
    expect(lines.filter((p) => p.hasAttribute("marker-end"))).toHaveLength(1);
    expect(lines[1].hasAttribute("marker-end")).toBe(true);

    const coord = (p: Element, last: boolean) => {
      const all = [...p.getAttribute("d")!.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
      return Number((last ? all[all.length - 1] : all[0])[1]);
    };
    // The white surrounds the text, centred at x = 300.
    expect(coord(lines[0], true)).toBeLessThan(300);
    expect(coord(lines[1], false)).toBeGreaterThan(300);
  });

  it("writes the label as text with a white halo rather than inside a pill", () => {
    const svg = buildGraphSvg(layoutWithLabel({ x: 300, y: 0 }), () => "#2a78d6");
    const label = svg.querySelector(".fx-labels g")!;

    // No more rectangle: it is the line's white gap that clears the text.
    expect(label.querySelector("rect")).toBeNull();
    const text = label.querySelector("text")!;
    expect(text.textContent).toBe("HTTP");
    // The halo protects from the OTHER lines, and is painted under the letters.
    expect(text.getAttribute("stroke")).toBe("#ffffff");
    expect(text.getAttribute("paint-order")).toBe("stroke");
  });

  it("leaves the line whole when the edge carries no label", () => {
    const layout: LayoutResult = {
      nodes: [
        { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
        { id: "B", label: "B", kind: "group", x: 600, y: 0, width: 80, height: 40 },
      ],
      edges: [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "", attenuated: false,
        points: [{ x: 40, y: 0 }, { x: 560, y: 0 }] }],
      width: 700,
      height: 200,
    };
    expect([...buildGraphSvg(layout, () => "#2a78d6").querySelectorAll(".fx-edges g > path[stroke]")]).toHaveLength(1);
  });
});

describe("legend — what it announces is what the drawing uses", () => {
  const nodes = [
    { id: "A", label: "A", kind: "actor" as const },
    { id: "B", label: "B", kind: "actor" as const },
  ];

  // On a change diagram no line carries a technology colour: listing them would
  // announce a colour code found nowhere.
  it("names the change colours and drops the technologies when every edge is marked", async () => {
    const svg = buildGraphSvg(
      await computeLayout(nodes, [
        { from: "A", to: "B", technology: "HTTP", count: 1, label: "+1", attenuated: false, change: "added" },
        { from: "B", to: "A", technology: "SFTP", count: 1, label: "−1", attenuated: false, change: "removed" },
      ]),
      () => "#2a78d6"
    );
    const texts = [...svg.querySelectorAll(".fx-legend text")].map((t) => t.textContent);
    expect(texts.join(" ")).toContain("flows added");
    expect(texts.join(" ")).toContain("flows removed");
    expect(texts.join(" ")).not.toContain("HTTP");
    expect(texts.join(" ")).not.toContain("SFTP");
  });

  it("keeps naming the technologies on an ordinary diagram", async () => {
    const svg = buildGraphSvg(
      await computeLayout(nodes, [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }]),
      () => "#2a78d6"
    );
    const texts = [...svg.querySelectorAll(".fx-legend text")].map((t) => t.textContent);
    expect(texts.join(" ")).toContain("HTTP");
    expect(texts.join(" ")).not.toContain("flows added");
  });
});

// --- QA: the exported file must stand on its own. It inherited two things from
// the page that it never names -- the font, and the CSS variables of the change
// colours. Opened on its own, a Changes diagram therefore came out WITH NO
// LINES AT ALL (stroke resolved to "none"), with black arrows, an empty legend
// chip, and all the text in serif although the label widths are calibrated for
// the page's font.
describe("buildGraphSvg — the file stands on its own", () => {
  const change = async (direction: "added" | "removed") => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, change: direction },
    ];
    return buildGraphSvg(await computeLayout(nodes, edges), () => "#2a78d6");
  };

  it("names its font on the root", () => {
    const nodes: GraphNode[] = [{ id: "A", label: "A", kind: "group" }];
    return computeLayout(nodes, []).then((layout) => {
      const svg = buildGraphSvg(layout, () => "#2a78d6");
      expect(svg.getAttribute("font-family")).toBeTruthy();
    });
  });

  it("paints the changes with a literal colour, never a CSS variable", async () => {
    for (const direction of ["added", "removed"] as const) {
      const svg = await change(direction);
      expect(svg.outerHTML).not.toContain("var(--");
      const line = svg.querySelector("path[stroke]");
      expect(line?.getAttribute("stroke")).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});


// --- QA: an actor's name was neither measured nor truncated, unlike its
// description. A long name overflowed its box (by up to 128 px), covered the
// neighbouring box and got clipped by the drawing's frame -- 82 px lost outside
// the viewBox, illegible on export as on screen.
describe("buildGraphSvg — a long name fits in its box", () => {
  const LONG = "Plateforme de règlement-livraison interbancaire et de conservation titres";

  const rendered = async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: LONG, kind: "actor", icon: "app-window" },
      { id: "B", label: "Chandrila", kind: "actor", icon: "app-window" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }];
    return buildGraphSvg(await computeLayout(nodes, edges), () => "#2a78d6");
  };

  it("truncates the name instead of letting it overflow", async () => {
    const svg = await rendered();
    const name = [...svg.querySelectorAll("text")].find((t) => t.getAttribute("font-size") === "16")!;
    expect(name.textContent!.length).toBeLessThan(LONG.length);
    expect(name.textContent).toMatch(/…$/);
  });

  it("keeps the whole name reachable on hover", async () => {
    const svg = await rendered();
    expect([...svg.querySelectorAll("title")].map((t) => t.textContent)).toContain(LONG);
  });

  it("leaves a short name untouched and without a tooltip", async () => {
    const svg = await rendered();
    const courts = [...svg.querySelectorAll("text")].filter((t) => t.textContent === "Chandrila");
    expect(courts.length).toBe(1);
  });
});

// --- The line follows the data, from provider to consumer. When it is the
// consumer that calls, the initiative reads on the HEAD, set at the line's
// start: it leaves by the provider's right, runs along the pipe, and its tip
// designates the one being queried.
describe("buildGraphSvg — a pulled line's arrowhead", () => {
  const line = async (pulled: boolean) => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "actor" },
      { id: "B", label: "B", kind: "actor" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, pulled }];
    return buildGraphSvg(await computeLayout(nodes, edges), () => "#2a78d6");
  };

  it("sets the head at the start when the consumer calls", async () => {
    const svg = await line(true);
    expect(svg.querySelector("path[marker-start]")).not.toBeNull();
    expect(svg.querySelector("path[marker-end]")).toBeNull();
  });

  it("leaves it at the arrival when the provider pushes", async () => {
    const svg = await line(false);
    expect(svg.querySelector("path[marker-end]")).not.toBeNull();
    expect(svg.querySelector("path[marker-start]")).toBeNull();
  });
});

// --- A diagram must describe itself (C4, rule no. 1). Pasted into a ticket, a
// PNG said neither its workbook, nor its milestone, nor its reading.
describe("buildGraphSvg — the title block", () => {
  const context = {
    title: "Platform detail", reading: "architecture", milestone: "v2",
    source: "carto.xlsx", date: "2026-08-22", components: 2, flows: 1, technologies: 1,
  };
  const estate = async () =>
    computeLayout(
      [{ id: "A", label: "A", kind: "group" }, { id: "B", label: "B", kind: "group" }],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }]
    );

  it("sets title and description as DIRECT children of <svg>, referenced by aria-labelledby", async () => {
    const svg = buildGraphSvg(await estate(), () => "#111", context);
    expect(svg.getAttribute("role")).toBe("img");
    const ids = (svg.getAttribute("aria-labelledby") ?? "").split(" ");
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      const target = [...svg.children].find((c) => c.getAttribute("id") === id);
      expect(target, `#${id} must be a direct child of <svg>`).toBeDefined();
    }
    expect(svg.querySelector(":scope > title")?.textContent).toBe("Platform detail — architecture reading, milestone v2");
  });

  it("writes the title block on the drawing, above the content", async () => {
    const svg = buildGraphSvg(await estate(), () => "#111", context);
    const texts = [...svg.querySelectorAll(".fx-titleblock text")].map((t) => t.textContent);
    expect(texts[0]).toContain("milestone v2");
    expect(texts[1]).toContain("carto.xlsx");
  });

  // With no context, nothing: an empty title block would assert less than nothing.
  it("adds neither role nor title block when no context is supplied", async () => {
    const svg = buildGraphSvg(await estate(), () => "#111");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.querySelector(".fx-titleblock")).toBeNull();
    expect(svg.querySelector(":scope > title")).toBeNull();
  });

  // The title block's band must be RESERVED: laid over the top, it would cover
  // the first row of boxes.
  it("reserves its band within the viewBox rather than laying itself over the top", async () => {
    const layout = await estate();
    const withoutContext = buildGraphSvg(layout, () => "#111");
    const withContext = buildGraphSvg(layout, () => "#111", context);
    const top = (s: SVGSVGElement) => Number(s.getAttribute("viewBox")!.split(" ")[1]);
    expect(top(withContext)).toBeLessThan(top(withoutContext));
  });
});

// --- §2.5: all eight hues of the palette fail 4.5:1 as ink, and writing in
// colour made the diagram illegible in greyscale. The visual reminder goes
// through a disc, as the matrix already does.
describe("buildGraphSvg — the ink is not the line's colour", () => {
  const estate = async (technology: string, label: string) =>
    computeLayout(
      [{ id: "A", label: "A", kind: "group" }, { id: "B", label: "B", kind: "group" }],
      [{ from: "A", to: "B", technology, count: 1, label, attenuated: false }]
    );

  it("writes the label in ink and sets a disc of the technology's colour", async () => {
    const svg = buildGraphSvg(await estate("HTTP", "HTTP"), () => "#eda100");
    for (const t of svg.querySelectorAll(".fx-labels text")) {
      expect(contrastRatio(t.getAttribute("fill")!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
    expect(svg.querySelector(".fx-labels circle")?.getAttribute("fill")).toBe("#eda100");
  });

  // The functional reading empties `technology`: a disc would have nothing to
  // remind of, and would steal the text's room.
  it("sets no disc when no technology is named", async () => {
    const svg = buildGraphSvg(await estate("", "Policy events 1.0"), () => "#111111");
    expect(svg.querySelector(".fx-labels circle")).toBeNull();
  });

  // The disc takes up room: it must be reserved BEFORE layout, failing which the
  // label overflows the box ELK kept for it.
  it("reserves the disc's room within the chip's size", () => {
    expect(chipSize("HTTP ×3", "HTTP").width).toBeGreaterThan(chipSize("HTTP ×3", "").width);
  });
});

// --- QA: the tooltip was only set from TWO names upwards. On the sample
// workbook, 23 edges out of 24 therefore carried none, and the exchange's name
// was legible nowhere.
describe("buildGraphSvg — the edges' tooltip", () => {
  const estate = async (names: string[]) =>
    computeLayout(
      [{ id: "A", label: "A", kind: "group" }, { id: "B", label: "B", kind: "group" }],
      [{ from: "A", to: "B", technology: "HTTP", count: names.length, label: "HTTP", attenuated: false, names }]
    );

  it("sets the tooltip even when the edge carries a single exchange", async () => {
    const svg = buildGraphSvg(await estate(["Policy events 1.0"]), () => "#111");
    expect([...svg.querySelectorAll(".fx-edges title")].map((t) => t.textContent)).toContain("Policy events 1.0");
  });

  it("lists every name of a merged line, one per line", async () => {
    const svg = buildGraphSvg(await estate(["A 1.0", "B 2.0"]), () => "#111");
    expect(svg.querySelector(".fx-edges title")?.textContent).toBe("A 1.0\nB 2.0");
  });

  // An edge with no name -- an aggregated view that does not carry them -- must
  // not produce an empty tooltip, which would open on nothing.
  it("sets nothing when the edge carries no name", async () => {
    const svg = buildGraphSvg(await estate([]), () => "#111");
    expect(svg.querySelector(".fx-edges title")).toBeNull();
  });
});

// --- §2.6: a single node shape in the whole tool. Nature, aggregate and
// removal read by colour alone -- hence not at all in print or for a
// colour-blind reader (WCAG 1.4.1).
describe("buildGraphSvg — the shape restates what the colour says", () => {
  const estate = async (a: Partial<GraphNode>, b: Partial<GraphNode> = {}, e: Partial<GraphEdge> = {}) =>
    computeLayout(
      [{ id: "A", label: "A", kind: "actor", ...a }, { id: "B", label: "B", kind: "actor", ...b }],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, ...e }]
    );

  it("cuts a technical actor's corner", async () => {
    const svg = buildGraphSvg(await estate({ technical: true }), () => "#111");
    expect(svg.querySelectorAll(".fx-nodes path.fx-cut-corner")).toHaveLength(1);
  });

  it("leaves the box rectangular for a business actor", async () => {
    const svg = buildGraphSvg(await estate({}), () => "#111");
    expect(svg.querySelector(".fx-nodes path.fx-cut-corner")).toBeNull();
  });

  it("stacks the box of a node folding several actors", async () => {
    const svg = buildGraphSvg(await estate({ aggregate: 4 }), () => "#111");
    expect(svg.querySelectorAll(".fx-nodes .fx-stack rect").length).toBeGreaterThan(1);
  });

  // A group of a single actor hides nothing: stacking it would assert the
  // opposite.
  it("does not stack a group of a single actor", async () => {
    const svg = buildGraphSvg(await estate({ aggregate: 1 }), () => "#111");
    expect(svg.querySelector(".fx-nodes .fx-stack")).toBeNull();
  });

  it("dashes a removal's line", async () => {
    const svg = buildGraphSvg(await estate({}, {}, { change: "removed" }), () => "#111");
    expect(svg.querySelector(".fx-edges path")?.getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("leaves an addition's line solid", async () => {
    const svg = buildGraphSvg(await estate({}, {}, { change: "added" }), () => "#111");
    expect(svg.querySelector(".fx-edges path")?.getAttribute("stroke-dasharray")).toBeNull();
  });
});

// --- §2.9: the SVG carried hard-coded dimensions, so it overflowed its area --
// 47% visible on the sample workbook -- with no way to bring it back.
describe("buildGraphSvg — the diagram's size", () => {
  const estate = async () =>
    computeLayout(
      [{ id: "A", label: "A", kind: "group" }, { id: "B", label: "B", kind: "group" }],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }]
    );

  // The viewBox drives the FRAMING, width/height the display size. Both, and
  // consistent: stretching the SVG to the window's width brought the scale down
  // to 0.5× on the sample workbook, hence the legend to 5 px.
  it("sets a viewBox AND the drawing's dimensions, in agreement", async () => {
    const svg = buildGraphSvg(await estate(), () => "#111");
    const [, , l, h] = svg.getAttribute("viewBox")!.split(/\s+/);
    expect(svg.getAttribute("width")).toBe(l);
    expect(svg.getAttribute("height")).toBe(h);
  });

  // The FILE must state its size: with no width and no height, an .svg opens at
  // an arbitrary size in Word or PowerPoint.
  it("sets the dimensions again in the exported file, from the viewBox", async () => {
    const svg = buildGraphSvg(await estate(), () => "#111");
    const [, , l, h] = svg.getAttribute("viewBox")!.split(/\s+/);
    const text = serializeSvg(svg, "#ffffff");
    expect(text).toContain(`width="${l}"`);
    expect(text).toContain(`height="${h}"`);
  });
});


// --- What tells a pushed flow from a pulled one is the head's SHAPE, not its
// position: position alone would have required knowing which end of the line
// is the provider, which the drawing does not say.
describe("buildGraphSvg — two arrowhead shapes", () => {
  const estate = async (pulled: boolean) =>
    computeLayout(
      [{ id: "F", label: "F", kind: "actor" }, { id: "C", label: "C", kind: "actor" }],
      [{ from: "F", to: "C", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, pulled }]
    );
  const headOf = (svg: SVGSVGElement, attribute: string) => {
    const url = svg.querySelector(`.fx-edges [${attribute}]`)!.getAttribute(attribute)!;
    return svg.querySelector(`#${url.slice(5, -1)} path`)!;
  };

  it("fills a pushed flow's head", async () => {
    const svg = buildGraphSvg(await estate(false), () => "#1f5fae");
    const head = headOf(svg, "marker-end");
    expect(head.getAttribute("fill")).toBe("#1f5fae");
    expect(head.getAttribute("stroke")).toBeNull();
  });

  // A different SILHOUETTE, not merely a fill: a hollowed dart and a solid dart
  // blur together at small size and in print.
  it("draws an open V for a pulled flow", async () => {
    const svg = buildGraphSvg(await estate(true), () => "#1f5fae");
    const head = headOf(svg, "marker-start");
    expect(head.getAttribute("fill")).toBe("none");
    expect(head.getAttribute("stroke")).toBe("#1f5fae");
    // Open: the path does not close.
    expect(head.getAttribute("d")).not.toContain("Z");
  });

  it("keeps both heads in the same bounding box, so the line's setback does not change", async () => {
    const solid = headOf(buildGraphSvg(await estate(false), () => "#1f5fae"), "marker-end");
    const hollow = headOf(buildGraphSvg(await estate(true), () => "#1f5fae"), "marker-start");
    const extremeX = (d: string) => Math.max(...(d.match(/[\d.]+(?=,)/g) ?? []).map(Number));
    expect(extremeX(hollow.getAttribute("d")!)).toBe(extremeX(solid.getAttribute("d")!));
  });

  // The two markers carry distinct identifiers: shared, the second definition
  // would overwrite the first and both flows would come out of the same shape.
  //
  it("declares two distinct markers when both directions coexist", async () => {
    const layout = await computeLayout(
      [{ id: "F", label: "F", kind: "actor" }, { id: "C", label: "C", kind: "actor" }, { id: "D", label: "D", kind: "actor" }],
      [
        { from: "F", to: "C", technology: "HTTP", count: 1, label: "a", attenuated: false, pulled: false },
        { from: "F", to: "D", technology: "HTTP", count: 1, label: "b", attenuated: false, pulled: true },
      ]
    );
    const svg = buildGraphSvg(layout, () => "#1f5fae");
    const ids = [...svg.querySelectorAll("defs marker")].map((m) => m.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
    // The two shapes coexist for the SAME colour: shared, the second definition
    // would overwrite the first.
    expect(ids.some((i) => /^arrow-\d+-1f5fae$/.test(i!))).toBe(true);
    expect(ids.some((i) => /^arrow-hollow-\d+-1f5fae$/.test(i!))).toBe(true);
  });

  // The head overruns the line's end: without shortening, the legend's sample
  // encroached on its own entry's text.
  it("keeps the arrowed sample inside its column", async () => {
    const svg = buildGraphSvg(await estate(true), () => "#1f5fae");
    const texts = [...svg.querySelectorAll(".fx-legend text")];
    const left = Math.min(...texts.map((t) => Number(t.getAttribute("x"))));
    for (const l of svg.querySelectorAll(".fx-legend line[marker-end]")) {
      expect(Number(l.getAttribute("x2"))).toBeLessThanOrEqual(left);
    }
    for (const l of svg.querySelectorAll(".fx-legend line[marker-start]")) {
      expect(Number(l.getAttribute("x1")) - 12).toBeGreaterThanOrEqual(
        Math.min(...[...svg.querySelectorAll(".fx-legend rect")].map((r) => Number(r.getAttribute("x"))))
      );
    }
  });
});

// --- QA: ELK leaves a box by a stub perpendicular to the face, sometimes 5 px
// long, then turns. A 12 px head overran the corner there and ended up planted
// sideways on the next segment -- the line seemed to arrive through the arrow's
// flank. 14 of the sample workbook's 24 edges.
describe("buildGraphSvg — the head fits in the segment carrying it", () => {
  const withApproach = (length: number): LayoutResult => ({
    width: 400,
    height: 200,
    nodes: [
      { id: "A", label: "A", kind: "actor", x: 40, y: 100, width: 80, height: 40 },
      { id: "B", label: "B", kind: "actor", x: 300, y: 20, width: 80, height: 40 },
    ],
    edges: [
      {
        from: "A",
        to: "B",
        technology: "HTTP",
        count: 1,
        label: "HTTP",
        attenuated: false,
        // A long run, then a corner, then the approach stub.
        points: [{ x: 80, y: 100 }, { x: 260, y: 100 }, { x: 260, y: 40 }, { x: 260 + length, y: 40 }],
      },
    ],
  });

  const headSizeFor = (length: number): number => {
    const svg = buildGraphSvg(withApproach(length), () => "#1f5fae");
    const url = svg.querySelector(".fx-edges [marker-end]")!.getAttribute("marker-end")!;
    return Number(svg.querySelector(`#${url.slice(5, -1)}`)!.getAttribute("markerWidth"));
  };

  it("keeps the full size when the approach is long enough", () => {
    expect(headSizeFor(40)).toBe(12);
  });

  // The real workbook's case: a 5 px stub.
  it("shrinks the head on a short approach", () => {
    expect(headSizeFor(5)).toBeLessThan(12);
  });

  // It must FIT: otherwise it overruns the corner, which is the defect itself.
  it("never sets a head longer than its approach", () => {
    for (const length of [4, 5, 8, 10, 13, 16, 20, 40]) {
      expect(headSizeFor(length), `approche de ${length} px`).toBeLessThanOrEqual(Math.max(5, length));
    }
  });
});

// --- §A3: line weight is the Bertin variable made for ORDER. It is
// deliberately uniform elsewhere -- varying the width with the NUMBER of flows
// crushed the neighbours -- but that reasoning held for a volume, not for an
// order.
describe("buildGraphSvg — the weight follows the criticality", () => {
  const estate = async (criticality?: string) =>
    computeLayout(
      [{ id: "A", label: "A", kind: "actor" }, { id: "B", label: "B", kind: "actor" }],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, criticality }]
    );
  const weight = (svg: SVGSVGElement) => Number(svg.querySelector(".fx-edges path")!.getAttribute("stroke-width"));

  it("thickens the critical line when the setting is on", async () => {
    expect(weight(buildGraphSvg(await estate("1 - Critical"), () => "#111", null, { weightByCriticality: true }))).toBeGreaterThan(2);
  });

  it("thins the standard line", async () => {
    expect(weight(buildGraphSvg(await estate("3 - Standard"), () => "#111", null, { weightByCriticality: true }))).toBeLessThan(2);
  });

  // Off, nothing moves: elsewhere the weight serves to say NOTHING, and the two
  // uses do not mix.
  it("keeps a uniform weight when the setting is off", async () => {
    expect(weight(buildGraphSvg(await estate("1 - Critical"), () => "#111"))).toBe(2);
  });

  // A criticality that is not filled in must not produce an invisible line.
  it("keeps the default weight on an absent criticality", async () => {
    expect(weight(buildGraphSvg(await estate(undefined), () => "#111", null, { weightByCriticality: true }))).toBe(2);
  });

  it("announces the weights used in the legend", async () => {
    const svg = buildGraphSvg(await estate("1 - Critical"), () => "#111", null, { weightByCriticality: true });
    const texts = [...svg.querySelectorAll(".fx-legend text")].map((t) => t.textContent);
    expect(texts).toContain("criticality: 1 - Critical");
    expect(texts).not.toContain("criticality: 3 - Standard");
  });
});
