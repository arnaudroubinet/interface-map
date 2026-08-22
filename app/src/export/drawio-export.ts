import type { LayoutResult, LayoutNode, LayoutEdge } from "../layout/graph-layout";
import { legendEntries } from "../render/legend";
import { titleBlockText, type DiagramContext } from "../render/title-block";
import { subLabel } from "../layout/graph-layout";

// Every board, in a file that can be reopened and reworked: one per tab, the
// way draw.io presents its pages. It is the editable counterpart of the image
// exports, layout included -- the one ELK computed, taken as it is. Redoing it
// in draw.io would give boards other than the ones being looked at.
//

const XML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeXml = (v: string) => v.replace(/[&<>"]/g, (c) => XML[c]);

// draw.io's C4 template, the very one whose dimensions the layout takes up:
// name in bold, type in brackets, description below.
//
// A label is HTML carried inside an XML attribute: the workbook's text
// therefore goes through TWO escapings, one for the HTML draw.io will render,
// one for the attribute carrying it. Doing only one produces a file no XML
// parser opens -- draw.io included.
function content(n: LayoutNode): string {
  const pieces = [`<b>${escapeXml(n.label)}</b>`];
  if (n.subtitle) pieces.push(`[${escapeXml(n.subtitle)}]`);
  if (n.description) pieces.push(`<br/>${escapeXml(n.description)}`);
  return pieces.join("<div></div>");
}

const FILL: Record<string, { fill: string; line: string; text: string }> = {
  boundary: { fill: "none", line: "#7f8c9a", text: "#14181f" },
  external: { fill: "#8d9aa8", line: "#6b7684", text: "#ffffff" },
  normal: { fill: "#2a6fbb", line: "#1c4f88", text: "#ffffff" },
};

function nodeStyle(n: LayoutNode): string {
  const key = n.kind === "boundary" ? "boundary" : n.external ? "external" : "normal";
  const c = FILL[key];
  const frame = n.kind === "boundary";
  return [
    "rounded=1",
    "arcSize=8",
    "whiteSpace=wrap",
    "html=1",
    `fillColor=${c.fill}`,
    `strokeColor=${c.line}`,
    `fontColor=${c.text}`,
    frame ? "dashed=1;verticalAlign=top;align=left;spacingLeft=10;spacingTop=6" : "verticalAlign=middle;align=center",
  ].join(";");
}

function edgeLabelMode(e: LayoutEdge): string {
  const sous = subLabel(e.label, e.technology);
  return sous ? `${escapeXml(e.label)}<div></div>${escapeXml(sous)}` : escapeXml(e.label ?? "");
}

export interface PlacedBoard {
  title: string;
  // What the page says about itself: the same block as the SVG's title block.
  // draw.io is the format MEANT TO CIRCULATE, and its pages left without it.
  context?: DiagramContext;
  // The actor the board details, when it details one: it is what this actor's
  // box points at, wherever that box appears.
  actor?: string;
  layout: LayoutResult;
}

// One tab per board: the file carries everything the tool can draw, and
// draw.io presents them as it presents its pages. Reopening the workbook to
// pull one single view out would mean redoing the work every time.
export function buildDrawio(
  boards: PlacedBoard[],
  technologyColour: (technology: string) => string
): string {
  // An actor's board declares itself as such: that is what makes it possible,
  // from any box, to open the page detailing that actor. Searching by title
  // would just as readily hit the tab of the flow type of the same name --
  // "HTTP" names a technology as readily as an actor.
  const byActorPage = new Map(
    boards.flatMap((p, i) => (p.actor ? [[p.actor, `page_${i}`] as [string, string]] : []))
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mxfile host="interface-map">',
    ...boards.flatMap((p, i) => diagram(p, i, technologyColour, byActorPage)),
    "</mxfile>",
    "",
  ].join("\n");
}

// The title block and the legend, as draw.io cells. The entries come from the
// same function as the SVG's: two diverging legends for one diagram are
// precisely what this makes impossible.
function explanatoryBlocks(
  { title, context, layout }: PlacedBoard,
  cellule: (id: string) => string,
  technologyColour: (technology: string) => string
): string[] {
  const xs = layout.nodes.flatMap((n) => [n.x - n.width / 2, n.x + n.width / 2]);
  const ys = layout.nodes.flatMap((n) => [n.y - n.height / 2, n.y + n.height / 2]);
  if (xs.length === 0) return [];
  const left = Math.min(...xs);
  const bottom = Math.max(...ys);
  const cells: string[] = [];

  const text = (id: string, value: string, x: number, y: number, l: number, h: number, style: string) =>
    cells.push(
      `        <mxCell id="${cellule(id)}" value="${escapeXml(value)}" style="${style}" vertex="1" parent="${cellule("1")}">`,
      `          <mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${l}" height="${h}" as="geometry" />`,
      "        </mxCell>"
    );

  const yCartouche = Math.min(...ys) - 64;
  const header = context ? titleBlockText(context) : { title, subtitle: "" };
  text("cartouche_t", header.title, left, yCartouche, 720, 24, "text;html=1;align=left;verticalAlign=middle;fontSize=16;fontStyle=1");
  if (header.subtitle) {
    text("cartouche_s", header.subtitle, left, yCartouche + 24, 720, 20, "text;html=1;align=left;verticalAlign=middle;fontSize=11;fontColor=#5b6472");
  }

  const inputs = legendEntries(layout.edges, layout.nodes, technologyColour);
  inputs.forEach((input, i) => {
    const y = bottom + 48 + i * 22;
    const e = input.sample;
    if (e.shape === "line") {
      const style = [
        "html=1",
        `strokeColor=${e.colour}`,
        "strokeWidth=2",
        e.dashed ? "dashed=1" : "dashed=0",
        e.head === "start" ? "startArrow=block;startFill=0;endArrow=none" : "endArrow=block;endFill=1;startArrow=none",
      ].join(";");
      cells.push(
        `        <mxCell id="${cellule(`legende_${i}`)}" style="${style}" edge="1" parent="${cellule("1")}">`,
        `          <mxGeometry relative="1" as="geometry"><mxPoint x="${Math.round(left)}" y="${Math.round(y)}" as="sourcePoint" /><mxPoint x="${Math.round(left + 34)}" y="${Math.round(y)}" as="targetPoint" /></mxGeometry>`,
        "        </mxCell>"
      );
    } else {
      text(
        `legende_${i}`,
        "",
        left,
        y - 6,
        34,
        12,
        `rounded=0;html=1;fillColor=${e.fill};strokeColor=${e.stroke}${e.dashed ? ";dashed=1" : ""}`
      );
    }
    text(`legende_t_${i}`, input.text, left + 42, y - 10, 320, 20, "text;html=1;align=left;verticalAlign=middle;fontSize=11");
  });

  return cells;
}

function diagram(
  board: PlacedBoard,
  index: number,
  technologyColour: (technology: string) => string,
  byActorPage: Map<string, string>
): string[] {
  const { title, layout } = board;
  const parId = new Map(layout.nodes.map((n) => [n.id, n]));
  const cells: string[] = [];
  // The identifiers are unique within the FILE, not within the page: two boards
  // almost always name the same actor, and draw.io would then attach one's lines
  // to the other's boxes.
  const cellule = (id: string) => `p${index}_${escapeXml(id)}`;

  for (const n of layout.nodes) {
    // The one point in the file where the two conventions meet, and it has
    // already cost one shipped defect: the layout gives a box's CENTRE (see
    // graph-layout), draw.io reads a top-left CORNER. Without the conversion,
    // every box slides by half a box.
    // And draw.io places a child INSIDE its frame: its corner is read from the
    // frame's corner. The centre-to-centre offset would say the same thing only
    // if frame and box had the same size -- they never do.
    const parent = n.parent ? parId.get(n.parent) : undefined;
    const x = n.x - n.width / 2 - (parent ? parent.x - parent.width / 2 : 0);
    const y = n.y - n.height / 2 - (parent ? parent.y - parent.height / 2 : 0);
    // A UserObject rather than a bare mxCell: it is what carries the tooltip,
    // the link and the shape data, which draw.io shows under "Edit Data". An
    // mxCell can carry nothing but a label.
    const page = byActorPage.get(n.label);
    const attributs = [
      `id="${cellule(n.id)}"`,
      `label="${escapeXml(content(n))}"`,
      n.description ? `tooltip="${escapeXml(n.description)}"` : "",
      // Clicking a box opens that actor's board, when it exists: sixty tabs are
      // not browsed by hand.
      page && page !== `page_${index}` ? `link="data:page/id,${page}"` : "",
      n.subtitle ? `type="${escapeXml(n.subtitle)}"` : "",
      n.external ? 'perimeter="External"' : "",
    ].filter(Boolean);
    cells.push(
      `        <UserObject ${attributs.join(" ")}>`,
      `          <mxCell style="${nodeStyle(n)}" vertex="1" parent="${parent ? cellule(parent.id) : cellule("1")}">`,
      `            <mxGeometry x="${x}" y="${y}" width="${n.width}" height="${n.height}" as="geometry" />`,
      "          </mxCell>",
      "        </UserObject>"
    );
  }

  layout.edges.forEach((e, i) => {
    const style = [
      "edgeStyle=orthogonalEdgeStyle",
      "rounded=1",
      "html=1",
      `strokeColor=${technologyColour(e.technology)}`,
      "strokeWidth=2",
      e.attenuated ? "dashed=1" : "dashed=0",
      // The line always goes from provider to consumer -- that is the data's
      // direction. The arrowhead designates the one being called on: at the
      // arrival when the provider pushes, at the start when the consumer calls.
      // Turning the line round instead would make the data climb back up, and
      // draw.io would tell something other than the diagram it comes from.
      ...(e.pulled
        ? ["startArrow=block", "startFill=1", "endArrow=none"]
        : ["endArrow=block", "endFill=1", "startArrow=none"]),
    ].join(";");
    cells.push(
      `        <mxCell id="${cellule(`e${i}`)}" value="${escapeXml(
        edgeLabelMode(e)
      )}" style="${style}" edge="1" parent="${cellule("1")}" source="${cellule(e.from)}" target="${cellule(e.to)}">`,
      '          <mxGeometry relative="1" as="geometry" />',
      "        </mxCell>"
    );
  });

  return [
    `  <diagram name="${escapeXml(title)}" id="page_${index}">`,
    // tooltips and fold are not decorative: without them draw.io shows no
    // tooltips and does not fold the platform boundary.
    `    <mxGraphModel dx="${Math.round(layout.width)}" dy="${Math.round(
      layout.height
    )}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0">`,
    "      <root>",
    `        <mxCell id="${cellule("0")}" />`,
    `        <mxCell id="${cellule("1")}" parent="${cellule("0")}" />`,
    ...cells,
    ...explanatoryBlocks(board, cellule, technologyColour),
    "      </root>",
    "    </mxGraphModel>",
    "  </diagram>",
  ];
}
