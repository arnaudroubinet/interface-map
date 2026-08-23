import { describe, it, expect } from "vitest";
import { legendEntries } from "../render/legend";
import type { PlacedBoard } from "./drawio-export";
import { buildDrawio } from "./drawio-export";
import { computeLayout, type LayoutResult } from "../layout/graph-layout";
import { buildGraphSvg } from "../render/svg-builder";
import type { GraphNode, GraphEdge } from "../aggregation/core";

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

const board = (l: LayoutResult, title = "v") => [{ title, layout: l }];

// A box's label is HTML filed inside an XML attribute: it is by rereading the
// file the way draw.io does that one sees what it will show.
function box(xml: string, id: string): Element {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.querySelector(`UserObject[id="${id}"]`)!;
}

const valueOf = (xml: string, id: string) => box(xml, id).getAttribute("label")!;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function geometry(xml: string, id: string): Rect {
  const g = box(xml, id).querySelector("mxGeometry")!;
  const number = (a: string) => Number(g.getAttribute(a));
  return { x: number("x"), y: number("y"), width: number("width"), height: number("height") };
}

// What draw.io will draw on the PAGE: a child's geometry reads in its frame's
// coordinates, so the chain of parents must be walked back up to recover the
// rectangle the eye will see.
function absoluteRect(xml: string, id: string): Rect {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const rect = geometry(xml, id);
  let current = doc.querySelector(`UserObject[id="${id}"]`);
  while (current) {
    const parentId = current.querySelector("mxCell")!.getAttribute("parent")!;
    current = doc.querySelector(`UserObject[id="${parentId}"]`);
    if (!current) break;
    const g = current.querySelector("mxGeometry")!;
    rect.x += Number(g.getAttribute("x"));
    rect.y += Number(g.getAttribute("y"));
  }
  return rect;
}

const sameRect = (a: Rect, b: Rect) =>
  ["x", "y", "width", "height"].every((c) => Math.abs(a[c as keyof Rect] - b[c as keyof Rect]) < 1e-6);

describe("construireDrawio", () => {
  // A file the parser refuses, draw.io refuses too: this check comes before
  // anything the file might contain.
  it("produces XML a parser accepts", () => {
    const l = layout();
    l.nodes[0].label = "A & <B>";
    l.nodes[0].description = 'Avec "guillemets" & signes';
    const doc = new DOMParser().parseFromString(buildDrawio(board(l, "Group & co"), colour), "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
  });

  it("produces a drawio file holding one diagram", () => {
    const xml = buildDrawio(board(layout(), "Group to group"), colour);
    expect(xml).toContain("<mxfile");
    expect(xml).toContain('<diagram name="Group to group"');
    expect(xml).toContain("<mxGraphModel");
  });

  // The layout is already computed for the screen: redoing it in draw.io would
  // give a board other than the one just looked at.
  it("keeps the geometry the diagram was laid out with", () => {
    const xml = buildDrawio(board(layout()), colour);
    // The layout gives B's CENTRE at (400, 0); draw.io reads a corner
    // haut-gauche, soit (400 - 240/2, 0 - 120/2).
    expect(geometry(xml, "p0_B")).toEqual({ x: 280, y: -60, width: 240, height: 120 });
  });

  it("carries the name, the type and the description into the box", () => {
    const value = valueOf(buildDrawio(board(layout()), colour), "p0_A");
    expect(value).toContain("<b>A</b>");
    expect(value).toContain("[Application]");
    expect(value).toContain("Un texte");
  });

  it("colours an edge with the colour its technology has on screen", () => {
    const xml = buildDrawio(board(layout()), colour);
    expect(xml).toContain("strokeColor=#336699");
    expect(xml).toMatch(/source="[^"]*A"/);
    expect(xml).toMatch(/target="[^"]*B"/);
  });

  // The name crosses two layers: the XML attribute, then the HTML draw.io pulls
  // out of it. With only one escaping, "<B>" would become a tag there.
  it("keeps a name that looks like markup readable as text", () => {
    const l = layout();
    l.nodes[0].label = "A & <B>";
    // What draw.io reads in the attribute is HTML: the name is still escaped once
    // there, and will therefore display as it was typed in.
    expect(valueOf(buildDrawio(board(l), colour), "p0_A")).toContain("A &amp; &lt;B&gt;");
  });

  it("gives every board its own tab", () => {
    const xml = buildDrawio(
      [
        { title: "Group to group", layout: layout() },
        { title: "HTTP", layout: layout() },
        { title: "Tatooine", layout: layout() },
      ],
      colour
    );
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect([...doc.querySelectorAll("diagram")].map((d) => d.getAttribute("name"))).toEqual([
      "Group to group",
      "HTTP",
      "Tatooine",
    ]);
  });

  // Two boards almost always name the same actor. Shared identifiers and draw.io
  // would attach one's lines to the other's boxes.
  it("keeps the cells of one board out of the next", () => {
    const xml = buildDrawio(
      [
        { title: "Un", layout: layout() },
        { title: "Deux", layout: layout() },
      ],
      colour
    );
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const ids = [...doc.querySelectorAll("mxCell, UserObject")]
      .map((c) => c.getAttribute("id"))
      .filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // What the box cannot show, draw.io can keep alongside: a tooltip on hover, and
  // the workbook's columns under "Edit Data".
  //
  it("carries what the box cannot show as shape data", () => {
    const b = box(buildDrawio(board(layout()), colour), "p0_A");
    expect(b.getAttribute("tooltip")).toBe("Un texte");
    expect(b.getAttribute("type")).toBe("Application");
  });

  // Sixty tabs are not browsed by hand: clicking an actor must open the board
  // that details it.
  it("links a box to the board that details it", () => {
    const xml = buildDrawio(
      [
        { title: "Group to group", layout: layout() },
        { title: "B (actor)", actor: "B", layout: layout() },
      ],
      colour
    );
    expect(box(xml, "p0_B").getAttribute("link")).toBe("data:page/id,page_1");
    // On its own board, the box does not link back to itself.
    expect(box(xml, "p1_B").getAttribute("link")).toBeNull();
  });

  // A flow type and an actor may bear the same name: the link targets the board
  // that declares the actor, whatever the tab order -- relying on insertion
  // order is being right only by accident.
  it("links a box to the actor board, never to the flow type tab of the same name", () => {
    const xml = buildDrawio(
      [
        { title: "B (actor)", actor: "B", layout: layout() },
        { title: "B (technology)", layout: layout() },
      ],
      colour
    );
    expect(box(xml, "p1_B").getAttribute("link")).toBe("data:page/id,page_0");
  });

  // The platform boundary is a frame containing its boxes: draw.io places a
  // child relative to its parent's TOP-LEFT CORNER, not in the page. A
  // centre-to-centre offset would be a correct shift only if the frame and the
  // box had the same size -- they never do.
  it("places a boxed child relative to the frame that holds it", () => {
    const l = layout({
      nodes: [
        { id: "F", label: "Platform", kind: "boundary", x: 100, y: 50, width: 500, height: 300 },
        { id: "A", label: "A", kind: "actor", parent: "F", x: 130, y: 90, width: 240, height: 120 },
      ],
      edges: [],
    });
    const xml = buildDrawio(board(l), colour);
    // The frame's corner: (100 - 250, 50 - 150) = (-150, -100). A's corner:
    // (130 - 120, 90 - 60) = (10, 30). Hence the relative (160, 130).
    const g = geometry(xml, "p0_A");
    expect(g).toEqual({ x: 160, y: 130, width: 240, height: 120 });
    // A fits entirely inside F on screen: its relative coordinates are therefore
    // positive and its box stays within the frame's extent.
    expect(g.x).toBeGreaterThanOrEqual(0);
    expect(g.y).toBeGreaterThanOrEqual(0);
    expect(g.x + g.width).toBeLessThanOrEqual(500);
    expect(g.y + g.height).toBeLessThanOrEqual(300);
  });

  // Two engines draw the same layout: the screen (SVG) and the draw.io file.
  // They once drifted apart by half a box with nothing to say so; this check
  // holds them to the same rectangle, in the same frame.
  it("declares the same rectangles the SVG paints", async () => {
    const nodes: GraphNode[] = [
      { id: "F", label: "Platform", kind: "boundary" },
      { id: "A", label: "Tatooine", kind: "actor", parent: "F", subtitle: "Application" },
      { id: "B", label: "Geonosis", kind: "actor", parent: "F" },
      { id: "C", label: "Mustafar", kind: "actor", parent: "F", description: "Un texte un peu plus long" },
      { id: "D", label: "Takodana", kind: "actor", external: true },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
      { from: "B", to: "C", technology: "SFTP", count: 2, label: "SFTP", attenuated: false },
      { from: "C", to: "D", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
    ];
    const l = await computeLayout(nodes, edges);
    const xml = buildDrawio(board(l, "Platform detail"), colour);

    const paintedRects = [...buildGraphSvg(l, colour).querySelectorAll("rect")].map((r) => ({
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      width: Number(r.getAttribute("width")),
      height: Number(r.getAttribute("height")),
    }));

    for (const n of l.nodes) {
      const declared = absoluteRect(xml, `p0_${n.id}`);
      const painted = { x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height };
      expect(
        paintedRects.some((r) => sameRect(r, declared)),
        `${n.label} : draw.io ${JSON.stringify(declared)}, écran ${JSON.stringify(painted)}`
      ).toBe(true);
    }
  });
});

// --- The line follows the data, the head says the initiative: draw.io must
// tell the same thing as the diagram on screen, failing which the file opened
// in the drawing tool would contradict the one it came from.
describe("draw.io export — a pulled line", () => {
  const xml = async (pulled: boolean) => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "actor" },
      { id: "B", label: "B", kind: "actor" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, pulled }];
    const layout = await computeLayout(nodes, edges);
    return buildDrawio([{ title: "T", layout }], () => "#2a78d6");
  };

  it("turns the head round without turning the line round", async () => {
    const doc = await xml(true);
    expect(doc).toContain("startArrow=block");
    expect(doc).toContain("endArrow=none");
    // the line always starts from the provider
    expect(doc).toMatch(/source="[^"]*A"[^>]*target="[^"]*B"/);
  });

  it("leaves the head at the arrival when the provider pushes", async () => {
    const doc = await xml(false);
    expect(doc).toContain("endArrow=block");
    expect(doc).not.toContain("startArrow=block");
  });
});

// --- §2.14: 23 pages with neither legend nor title, in the very format meant
// to circulate.
describe("buildDrawio — each page describes itself", () => {
  const board = (): PlacedBoard => ({
    title: "Platform detail",
    context: {
      title: "Platform detail", reading: "architecture", milestone: "v2",
      source: "carto.xlsx", date: "2026-08-22", components: 2, flows: 1, technologies: 1,
    },
    layout: {
      width: 400, height: 200,
      nodes: [
        { id: "A", label: "A", kind: "actor", x: 60, y: 60, width: 80, height: 40 },
        { id: "B", label: "B", kind: "actor", external: true, x: 300, y: 60, width: 80, height: 40 },
      ],
      edges: [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, points: [{ x: 100, y: 60 }, { x: 260, y: 60 }] }],
    },
  });

  it("sets the board's title on the page", () => {
    expect(buildDrawio([board()], () => "#111")).toContain("Platform detail — architecture reading, milestone v2");
  });

  it("takes up the SAME legend as the SVG, entry for entry", () => {
    const p = board();
    const xml = buildDrawio([p], () => "#111");
    for (const e of legendEntries(p.layout.edges, p.layout.nodes, () => "#111")) {
      expect(xml, `input « ${e.text} » absente`).toContain(e.text);
    }
  });

  // The legend must not sit ON the drawing: it is a block alongside, as in the
  // SVG.
  it("sets the legend below the nodes' bounding box", () => {
    const xml = buildDrawio([board()], () => "#111");
    const y = Number(/id="p0_legend_0"[\s\S]*?y="(-?\d+)"/.exec(xml)![1]);
    expect(y).toBeGreaterThan(80);
  });

  // With no context, no invented title block: the board's title is enough.
  it("makes do with the board's title when no context is supplied", () => {
    const withoutContext = { ...board(), context: undefined };
    const xml = buildDrawio([withoutContext], () => "#111");
    expect(xml).toContain("Platform detail");
    expect(xml).not.toContain("milestone");
  });
});
