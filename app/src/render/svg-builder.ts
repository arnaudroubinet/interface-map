import { ICONS, DEFAULT_ICON } from "./icons";
import type { LayoutResult, LayoutEdge, LayoutNode } from "../layout/graph-layout";
import {
  descriptionLines,
  truncatedName,
  nodeTextHeight,
  NAME_LINE_HEIGHT,
  TYPE_LINE_HEIGHT,
  EMPTY_LINE_HEIGHT,
  DESC_LINE_HEIGHT,
  CHIP_HEIGHT,
  chipWidth,
  subLabel as subLabelOf,
  chipSize,
} from "../layout/graph-layout";
import { normalizeText } from "../shared/text";
import {
  roundedPath,
  breakTheLine,
  setBackForTheHead,
  segmentIntersectsRect,
  CORNER_RADIUS,
  type Point,
  type Rect,
} from "./geometry";
import { PAPER, INK, STROKE_WIDTH, CHANGE_COLOUR, styleOfNode } from "./node-styles";
import { legendEntries, type LegendEntry, type LegendSample } from "./legend";
import { buildTitleBlock, descriptionAccessible, titleBlockText, TITLE_BLOCK_HEIGHT, type DiagramContext } from "./title-block";

const SVG_NS = "http://www.w3.org/2000/svg";
// The same stack as the page (index.html): the label-width constants are
// calibrated on it, and an export in serif puts them at fault.
const FONT = 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function rect(x: number, y: number, w: number, h: number, fill: string, stroke: string, strokeWidth: number): SVGRectElement {
  const r = el("rect");
  r.setAttribute("x", String(x));
  r.setAttribute("y", String(y));
  r.setAttribute("width", String(w));
  r.setAttribute("height", String(h));
  r.setAttribute("rx", "8");
  r.setAttribute("fill", fill);
  r.setAttribute("stroke", stroke);
  r.setAttribute("stroke-width", String(strokeWidth));
  return r;
}









interface RenderEdge {
  criticality?: string;
  points: { x: number; y: number }[];
  // The chip's centre, placed by the layout engine.
  labelCentreOf?: { x: number; y: number };
  // Endpoints kept: the obstacle constraint applies AFTER the merge, hence to
  // those edges, and it must know which nodes are legitimately approached. A
  // merge trunk has no origin node.
  from?: string;
  to?: string;
  technology: string;
  count: number;
  // The arrowhead sits at the line's START: the consumer queries the provider,
  // but the data always travels the other way.
  pulled?: boolean;
  // The exchanges this line gathers, for the tooltip.
  names?: string[];
  attenuated: boolean;
  change?: "added" | "removed";
  label?: string;
  arrow: boolean;
  // A merged group's trunk starts from a confluence point, not from a real
  // node -- so there is no start point to mark in that case.
  isTrunk?: boolean;
}

// The play kept between the arrowhead and the target box: the arrow points at
// the node, it does not overlap it.
const ARROW_GAP = 4;






// The distance, before the target node, at which flows sharing (target, tech,
// dimming) join into a common trunk -- they keep their own path and name up to
// there, and only the trunk carries the arrowhead. Must stay greater than
// TIGE_MAX, otherwise the confluence would fall inside the entry stem it
// replaces.
const DISTANCE_CONFLUENCE = 34;

// The number of distinct flows touching each node (source and target alike) --
// used to decide on which side a label is most likely to land in a crowd, so
// as to place it on the other one instead.

function mergeByTechnologyToTarget(edges: LayoutEdge[]): RenderEdge[] {
  const groups = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    // The dimming is part of the key: a flow to be transformed never merges
    // with an active flow, even at the same target/tech.
    // A pulled line does not merge: the confluence sits at the TARGET, which is
    // precisely where its arrowhead is not. So it gets a key of its own.
    const key = JSON.stringify([edge.to, edge.technology, edge.attenuated, edge.pulled === true]);
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }

  const result: RenderEdge[] = [];

  // A flow drawn as it is, with its own arrowhead.
  const alone = (edge: LayoutEdge) => {
      result.push({ points: edge.points, labelCentreOf: edge.labelCentreOf, from: edge.from, to: edge.to, technology: edge.technology, count: edge.count, pulled: edge.pulled, names: edge.names, attenuated: edge.attenuated, change: edge.change, label: edge.label, criticality: edge.criticality, arrow: true });
  };

  for (const group of groups.values()) {
    // A pulled line does not merge: the confluence sits at the TARGET, which is
    // precisely where its arrowhead is not. Each therefore draws for itself --
    // and ALL of them, failing which the group would lose all but its first.
    if (group[0].pulled === true) {
      for (const edge of group) alone(edge);
      continue;
    }
    if (group.length < 2) {
      const edge = group[0];
      // No merge, but one of the two ends may still be a very busy node (e.g. a
      // hub that also has outgoing flows): the label is placed on whichever side
      // is the less crowded.
      result.push({ points: edge.points, labelCentreOf: edge.labelCentreOf, from: edge.from, to: edge.to, technology: edge.technology, count: edge.count, pulled: edge.pulled, names: edge.names, attenuated: edge.attenuated, change: edge.change, label: edge.label, criticality: edge.criticality, arrow: true });
      continue;
    }

    // The branches share the same entry port, hence normally the same final
    // approach, and the confluence sits along its extension. But as soon as a
    // container comes into play, the engine may bring them in on different
    // segments: replacing their endpoint with a common confluence would then
    // manufacture a shortcut cutting straight through the boxes. Merging only
    // happens where the approach really is common.
    const reference = group[0].points;
    const target = reference[reference.length - 1];
    const before = reference[reference.length - 2];
    const sameApproach = group.every((e) => {
      const a = e.points[e.points.length - 2];
      const c = e.points[e.points.length - 1];
      return a && c && Math.abs(a.x - before.x) < 0.5 && Math.abs(a.y - before.y) < 0.5 && Math.abs(c.x - target.x) < 0.5 && Math.abs(c.y - target.y) < 0.5;
    });
    if (!sameApproach) {
      for (const edge of group) alone(edge);
      continue;
    }
    const length = Math.hypot(target.x - before.x, target.y - before.y) || 1;
    // Never beyond half of the last segment: otherwise the confluence would
    // pass behind the previous corner and the branch would head backwards just
    // before the trunk.
    const setback = Math.min(DISTANCE_CONFLUENCE, length / 2);
    const confluence = {
      x: target.x - ((target.x - before.x) / length) * setback,
      y: target.y - ((target.y - before.y) / length) * setback,
    };

    for (const edge of group) {
      // Only the arrival point is replaced by the confluence, which sits on that
      // same last segment: the branch therefore stays orthogonal. Every routing
      // point the engine produced is kept.
      const points = [...edge.points.slice(0, -1), confluence];
      // Every branch converges on the same crowded confluence: the label is
      // placed near its own source, where the branches are still spread apart
      // from one another (at their exit ports).
      result.push({ points, labelCentreOf: edge.labelCentreOf, from: edge.from, to: edge.to, technology: edge.technology, count: edge.count, pulled: edge.pulled, names: edge.names, attenuated: edge.attenuated, label: edge.label, criticality: edge.criticality, arrow: false });
    }

    result.push({
      points: [confluence, target],
      to: group[0].to,
      technology: group[0].technology,
      count: group.reduce((s, e) => s + e.count, 0),
      names: [...new Set(group.flatMap((e) => e.names ?? []))],
      attenuated: group[0].attenuated,
      // The trunk carries the strongest criticality of its branches: it falls
      // with the most vital of them.
      criticality: group.map((e) => e.criticality).find(Boolean),
      arrow: true,
      isTrunk: true,
    });
  }
  return result;
}

// The arrowhead must FIT within the segment carrying it. ELK leaves a box by a
// stub perpendicular to the face -- sometimes 5 px -- then turns: a 12 px head
// overran the corner there and planted itself sideways on the next segment, as
// if the line arrived through the arrow's flank. On the sample workbook, 14
// edges out of 24 were in that state.
//
// It is shrunk in steps rather than continuously: one size per edge would mean
// as many marker definitions as there are edges.
const HEAD_SIZES = [12, 8, 5, 3] as const;

// The gap before contact follows the head: kept at 4 px under a 3 px head, it
// would eat more than the head itself.
function arrowGapFor(size: number): number {
  return Math.min(ARROW_GAP, size / 3);
}

function headSizeFor(approachLength: number): number {
  return HEAD_SIZES.find((t) => approachLength >= t + arrowGapFor(t)) ?? HEAD_SIZES[HEAD_SIZES.length - 1];
}

// The STRAIGHT length actually available at the line's end for setting the
// head. Two deductions, and forgetting the second one was the mistake: ELK's
// raw segment loses length to the rounding of the corner preceding it -- up to
// RAYON_ANGLE, or half the segment if it is short.
function approachLengthOf(edge: RenderEdge): number {
  const p = edge.points;
  const [a, b] = edge.pulled ? [p[0], p[1]] : [p[p.length - 1], p[p.length - 2]];
  if (!a || !b) return 0;
  const raw = Math.hypot(b.x - a.x, b.y - a.y);
  return raw - Math.min(CORNER_RADIUS, raw / 2);
}

function arrowMarkerId(colour: string, hollow = false, size = HEAD_SIZE): string {
  return `${hollow ? "arrow-hollow" : "arrow"}-${size}-${colour.replace(/[^a-zA-Z0-9]/g, "")}`;
}

// The engine places the labels itself, reserving room for them along the path
// (elk.edgeLabels.placement). The hand-rolled placement that used to live here
// -- middle of the longest segment, then clearing the boxes, then mutual
// spreading -- ended up taking the chip away from its own arrow, to the point
// where one could no longer tell which went with which.
function placeLabels(edges: RenderEdge[]): Map<RenderEdge, Point> {
  const placements = new Map<RenderEdge, Point>();
  for (const e of edges) {
    if (e.label && e.labelCentreOf) placements.set(e, e.labelCentreOf);
  }
  return placements;
}

// The text occupies the white left by the line; it therefore no longer needs a
// chip to stand out against its own. A white halo does protect it from the
// OTHER lines passing behind -- "paint-order: stroke" paints that halo under
// the letters, which avoids thickening them.
// The colour reminder goes through a DISC, not the text's ink: all eight hues
// of the palette fail 4.5:1 as text, and writing in colour made the diagram
// illegible in greyscale. This is exactly what the matrix already does. A
// change colour, for its part, stays the ink: there the hue IS the message,
// and both pass the threshold (5.05 and 4.80).
function buildEdgeLabel(
  cx: number,
  cy: number,
  text: string,
  subText: string | undefined,
  colour: string,
  attenuated: boolean,
  colourChip: boolean
): SVGGElement {
  const g = el("g");
  const height = CHIP_HEIGHT + (subText ? 10 : 0);
  const textY = subText ? cy - height / 2 + 9 : cy + 3.5;
  const offset = colourChip ? DISC_WIDTH : 0;

  const apply = (content: string, y: number, size: string, fill: string, gras: boolean) => {
    const t = el("text");
    t.setAttribute("x", String(cx + offset / 2));
    t.setAttribute("y", String(y));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", size);
    if (gras) t.setAttribute("font-weight", "600");
    t.setAttribute("fill", fill);
    t.setAttribute("stroke", PAPER);
    t.setAttribute("stroke-width", "3");
    t.setAttribute("stroke-linejoin", "round");
    t.setAttribute("paint-order", "stroke");
    if (attenuated) t.setAttribute("opacity", "0.7");
    t.textContent = content;
    g.appendChild(t);
  };

  if (colourChip) {
    const disc = el("circle");
    disc.setAttribute("cx", String(cx - chipWidth(text) / 2 - offset / 2 + DISC_RADIUS + 7));
    disc.setAttribute("cy", String(textY - 3.5));
    disc.setAttribute("r", String(DISC_RADIUS));
    disc.setAttribute("fill", colour);
    disc.setAttribute("stroke", PAPER);
    disc.setAttribute("stroke-width", "1.5");
    if (attenuated) disc.setAttribute("opacity", "0.7");
    g.appendChild(disc);
  }

  apply(text, textY, "11", colourChip ? INK : colour, true);
  // 8.5 px in pale grey: the diagram's smallest text was also its least
  // contrasted. Now 10 px and a frank slate (10.16:1 against 4.74:1).
  if (subText) apply(subText, textY + 11, "10", SECONDARY_GREY, false);
  return g;
}



// A line that appears or disappears between two milestones carries its own
// colour: the technology is no longer the main information, the change is.
// Everywhere else, nothing changes.
// The colours themselves live in node-styles.ts: written literally, not as CSS
// variables -- those are defined only in the app's own page. Outside it -- an
// .svg opened on its own, a rasterised PNG -- the stroke resolved to "none"
// and the Changes diagram came out WITH NO LINES AT ALL.

function edgeColour(edge: RenderEdge, colorFor: (tech: string) => string): string {
  return edge.change ? CHANGE_COLOUR[edge.change] : colorFor(edge.technology);
}

// Line weight is the Bertin variable made for ORDER. It is deliberately
// uniform elsewhere -- varying the width with the NUMBER of aggregated flows
// visually crushed the neighbours, and the volume reads in the "×N". That
// reasoning held for a volume; it does not hold for an order, and criticality
// is one.
const WIDTH_BY_CRITICALITY: Record<string, number> = {
  "1 - critical": 3.5,
  "2 - important": 2,
  "3 - standard": 1,
};

function strokeWidthOf(edge: RenderEdge, byCriticality: boolean): number {
  if (!byCriticality || !edge.criticality) return STROKE_WIDTH;
  return WIDTH_BY_CRITICALITY[normalizeText(edge.criticality)] ?? STROKE_WIDTH;
}

function buildEdgeElement(
  edge: RenderEdge,
  colorFor: (tech: string) => string,
  labelRect: Rect | null,
  byCriticality: boolean
): SVGGElement {
  const g = el("g");
  const colour = edgeColour(edge, colorFor);

  // The exchange's name reads here, on hover, in the browser as in an .svg
  // opened on its own. The "at least two names" condition deprived every simple
  // edge of it, that is, very nearly all of them: on the sample workbook, 23
  // edges out of 24 were mute.
  if (edge.names && edge.names.length > 0) {
    const tooltip = el("title");
    tooltip.textContent = edge.names.join("\n");
    g.appendChild(tooltip);
  }

  const headSize = headSizeFor(approachLengthOf(edge));
  const drawnPoints = edge.arrow
    ? setBackForTheHead(edge.points, headSize + arrowGapFor(headSize), edge.pulled === true)
    : edge.points;
  const pieces = breakTheLine(drawnPoints, labelRect ? [labelRect] : []);

  pieces.forEach((piece, i) => {
    const path = el("path");
    path.setAttribute("d", roundedPath(piece));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", colour);
    path.setAttribute("stroke-width", String(strokeWidthOf(edge, byCriticality)));
    // The head only goes on the piece approaching what it designates: the last
    // one when the provider pushes, the first when the consumer calls. The
    // marker orients itself (auto-start-reverse), so one definition serves
    // both.
    if (edge.arrow) {
      if (edge.pulled && i === 0) path.setAttribute("marker-start", `url(#${arrowMarkerId(colour, true, headSize)})`);
      if (!edge.pulled && i === pieces.length - 1) path.setAttribute("marker-end", `url(#${arrowMarkerId(colour, false, headSize)})`);
    }
    if (edge.attenuated) {
      path.setAttribute("stroke-dasharray", "6 4");
      path.setAttribute("opacity", "0.5");
    }
    // A removal was only RED, an addition only green: in print, the two became
    // the same grey. The long dash says "this line is leaving" without
    // depending on colour.
    if (edge.change === "removed") path.setAttribute("stroke-dasharray", "10 5");
    g.appendChild(path);
  });



  // Start point: explicitly marks the origin node, mirroring the arrowhead
  // that marks the arrival -- a merge trunk starts from a confluence point,
  // not from a real node, so it carries none.

  return g;
}





function buildIcon(name: string, x: number, y: number, size: number, colour: string): SVGGElement {
  const g = el("g");
  const scale = size / 24;
  g.setAttribute("transform", `translate(${x},${y}) scale(${scale})`);
  g.setAttribute("fill", "none");
  g.setAttribute("stroke", colour);
  g.setAttribute("stroke-width", "2");
  g.setAttribute("stroke-linecap", "round");
  g.setAttribute("stroke-linejoin", "round");
  // An unknown name falls back to the neutral token rather than drawing nothing:
  // a box with no icon would read as an oversight, not as a data-entry error --
  // which the integrity checks report separately.
  for (const element of ICONS[name] ?? ICONS[DEFAULT_ICON]) {
    const e = el(element.tag);
    for (const [attr, val] of Object.entries(element.attrs)) e.setAttribute(attr, val);
    g.appendChild(e);
  }
  return g;
}

// Rounded chip (C4 "type" / "external" style): tinted fill at low opacity,
// text in the same colour as the node's border.
function buildChip(x: number, y: number, contenu: string, colour: string): { element: SVGGElement; width: number } {
  const width = contenu.length * 5.3 + 14;
  const height = 15;
  const g = el("g");
  const fill = el("rect");
  fill.setAttribute("x", String(x));
  fill.setAttribute("y", String(y));
  fill.setAttribute("width", String(width));
  fill.setAttribute("height", String(height));
  fill.setAttribute("rx", String(height / 2));
  fill.setAttribute("fill", colour);
  fill.setAttribute("opacity", "0.16");
  g.appendChild(fill);
  const text = el("text");
  text.setAttribute("x", String(x + width / 2));
  text.setAttribute("y", String(y + height / 2 + 3.2));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "9");
  text.setAttribute("font-weight", "600");
  text.setAttribute("fill", colour);
  text.textContent = contenu;
  g.appendChild(text);
  return { element: g, width };
}

// A boundary in the C4 sense: a dashed frame around the product's components,
// its label at the top left. It has neither fill nor icon -- it is an outline,
// not a box, and it is drawn before everything else so as to stay underneath.
//
function buildBoundaryElement(node: LayoutNode): SVGGElement {
  const g = el("g");
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;

  const frame = rect(x, y, node.width, node.height, "none", "#7a828d", 1.5);
  frame.setAttribute("stroke-dasharray", "8 5");
  g.appendChild(frame);

  const label = el("text");
  label.setAttribute("x", String(x + 12));
  label.setAttribute("y", String(y + 17));
  label.setAttribute("font-size", "11");
  label.setAttribute("font-weight", "600");
  label.setAttribute("letter-spacing", "0.4");
  label.setAttribute("fill", SECONDARY_GREY);
  label.textContent = node.label;
  g.appendChild(label);

  return g;
}

function buildNodeElement(node: LayoutNode): SVGGElement {
  const g = el("g");
  if (node.dimming !== undefined) g.setAttribute("opacity", String(node.dimming));
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;
  const style = styleOfNode(node);
  const isExternal = !!node.external;

  // A folded group is drawn as a STACK: two offset boxes behind its own. The
  // reader sees at a glance that this node holds several, where only the "4
  // actors" subtitle used to say so.
  if (node.aggregate && node.aggregate > 1) {
    const pile = el("g");
    pile.setAttribute("class", "fx-stack");
    for (const offset of [8, 4]) {
      const behind = rect(x + offset, y - offset, node.width, node.height, style.fill, style.stroke, style.strokeWidth);
      behind.setAttribute("rx", "10");
      behind.setAttribute("opacity", "0.55");
      pile.appendChild(behind);
    }
    g.appendChild(pile);
  }

  // A TECHNICAL actor carries a cut corner, like a component. That is the
  // convention ArchiMate already settled (§3.9): the shape restates what the
  // colour says, and colour alone says nothing in black and white or for a
  // colour-blind reader (WCAG 1.4.1, technique G111).
  const COUPE = 14;
  let box: SVGElement;
  if (node.technical) {
    const path = el("path");
    path.setAttribute("class", "fx-cut-corner");
    path.setAttribute(
      "d",
      `M${x + 10} ${y} H${x + node.width - COUPE} L${x + node.width} ${y + COUPE} V${y + node.height - 10}` +
        ` a10 10 0 0 1 -10 10 H${x + 10} a10 10 0 0 1 -10 -10 V${y + 10} a10 10 0 0 1 10 -10 Z`
    );
    path.setAttribute("fill", style.fill);
    path.setAttribute("stroke", style.stroke);
    path.setAttribute("stroke-width", String(style.strokeWidth));
    path.setAttribute("stroke-linejoin", "round");
    box = path;
  } else {
    const r = rect(x, y, node.width, node.height, style.fill, style.stroke, style.strokeWidth);
    r.setAttribute("rx", "10"); // arcSize=10 dans le gabarit draw.io
    box = r;
  }
  // The dashed stroke restates "external" through shape: colour alone is not
  // enough in black and white or for a colour-blind reader.
  if (isExternal) box.setAttribute("stroke-dasharray", "8 5");
  g.appendChild(box);

  const blanc = "#ffffff";
  // White, not grey. #cccccc fell to 1.81:1; a half-tone is not enough either --
  // #e8eef2 gives only 3.94:1. The visual hierarchy is already carried by size
  // (16 px bold, 12 px, 11 px); colour has no business carrying it as well.
  //
  const descGrey = "#ffffff";
  const cx = node.x;

  // A text block centred in the box: name at 16 bold, [Type] below it, a blank
  // line, then the description at 11 in light grey -- the draw.io mock-up.
  const rows = descriptionLines(node.description);
  let cursor = node.y - nodeTextHeight(node) / 2;

  const iconSize = 16;
  const shownName = truncatedName(node.label);
  const nameWidth = shownName.length * 8.2;
  g.appendChild(buildIcon(node.icon ?? DEFAULT_ICON, cx - nameWidth / 2 - iconSize - 6, cursor + 1, iconSize, blanc));

  const nameText = el("text");
  nameText.setAttribute("x", String(cx + iconSize / 2 + 3));
  nameText.setAttribute("y", String(cursor + 14));
  nameText.setAttribute("text-anchor", "middle");
  nameText.setAttribute("font-size", "16");
  nameText.setAttribute("font-weight", "700");
  nameText.setAttribute("fill", blanc);
  nameText.textContent = shownName;
  g.appendChild(nameText);
  // Truncated, the name stays readable on hover over the whole box -- in the
  // browser as in an .svg opened on its own. Set on the group rather than on
  // the text element: there it would add itself to the name's textContent.
  if (shownName !== node.label) {
    const tooltip = el("title");
    tooltip.textContent = node.label;
    g.appendChild(tooltip);
  }
  cursor += NAME_LINE_HEIGHT;

  if (node.subtitle) {
    const typeText = el("text");
    typeText.setAttribute("x", String(cx));
    typeText.setAttribute("y", String(cursor + 12));
    typeText.setAttribute("text-anchor", "middle");
    typeText.setAttribute("font-size", "12");
    typeText.setAttribute("fill", blanc);
    typeText.textContent = `[${node.subtitle}${isExternal ? " · External" : ""}]`;
    g.appendChild(typeText);
    cursor += TYPE_LINE_HEIGHT;
  }

  if (rows.length) cursor += EMPTY_LINE_HEIGHT;
  for (const row of rows) {
    const descText = el("text");
    descText.setAttribute("x", String(cx));
    descText.setAttribute("y", String(cursor + 11));
    descText.setAttribute("text-anchor", "middle");
    descText.setAttribute("font-size", "11");
    descText.setAttribute("fill", descGrey);
    descText.textContent = row;
    g.appendChild(descText);
    cursor += DESC_LINE_HEIGHT;
  }

  return g;
}

// Softened dart, in the same bounding box (0..10, tip at (10,5)) as c4hero's
// "c4-arrow" marker (src/components/canvas/Canvas.tsx) that this starts from.
// refX="0" anchors the marker by its BASE, not its tip: it is
// pointsBeforeHead (buildEdgeElement) that shortens the line back to that
// base, and the marker alone covers the last HEAD_SIZE units to the true point
// of contact -- otherwise a thick line visually overruns the concave back,
// narrower than the flat back of the original triangle.
//
// markerUnits="userSpaceOnUse": by default a marker is measured in multiples
// of stroke-width, so the head of a thick merged trunk (stroke-width up to 6)
// was 48px wide -- it crushed the target node, ate the gap before contact and
// covered the neighbouring heads. Fixed size: a flow's strength reads in the
// line's thickness, not in the size of its head.
const HEAD_SIZE = 12;

// Two heads, and THEY are what says who calls: a SOLID DART when the provider
// pushes, an OPEN V when the consumer pulls. The head's position was not
// enough -- one would have had to know which end of the line was the provider,
// which the drawing does not say.
//
// Two silhouettes, not merely two fills: a hollowed dart and a solid dart blur
// together at small size and in print. This is the pair UML uses on its
// messages -- solid triangle for a synchronous call, open V for an
// asynchronous message -- and both target DSLs can write it (normal / vee in
// LikeC4).
function addArrowMarker(defs: SVGDefsElement, colour: string, hollow = false, size = HEAD_SIZE): void {
  const marker = el("marker");
  marker.setAttribute("id", arrowMarkerId(colour, hollow, size));
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "0");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", String(size));
  marker.setAttribute("markerHeight", String(size));
  marker.setAttribute("orient", "auto-start-reverse");
  // The same bounding box in both cases (0..10, tip at (10,5)): the line's
  // setback before contact therefore does not depend on the shape.
  const arrowPath = el("path");
  if (hollow) {
    // The V: two open strokes, no fill, no base. Nothing like the dart's
    // silhouette, even from afar.
    arrowPath.setAttribute("d", "M 0.5,0 L 10,5 L 0.5,10");
    arrowPath.setAttribute("fill", "none");
    arrowPath.setAttribute("stroke", colour);
    arrowPath.setAttribute("stroke-width", "2");
    arrowPath.setAttribute("stroke-linecap", "round");
    arrowPath.setAttribute("stroke-linejoin", "round");
  } else {
    // Softened dart: sides slightly convex towards the tip, back slightly
    // concave rather than the three straight edges of a raw triangle.
    arrowPath.setAttribute("d", "M 0,0 Q 6,1 10,5 Q 6,9 0,10 Q 2.5,5 0,0 Z");
    arrowPath.setAttribute("fill", colour);
  }
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
}

// The margin around the diagram's real content (lines, label chips,
// arrowheads). The dimensions the layout engine returns cover only the nodes
// and their raw routing -- once the flows are spread around the envelope (as
// far as the top/bottom faces) and diverted, the drawing can spill well beyond
// that frame.
const FRAME_MARGIN = 24;

// The grey of everything secondary. Not a pale grey: #6b7480 held 4.74:1 on
// white, right at the threshold and uncomfortable at small sizes.
const SECONDARY_GREY = "#39424f";

const DISC_RADIUS = 3.5;
// The disc plus its gap to the text: the room chipSize must reserve.
const DISC_WIDTH = DISC_RADIUS * 2 + 4;

const TITLE_ID = "fx-titre";
const DESC_ID = "fx-desc";

function computeBounds(nodes: LayoutNode[], edges: RenderEdge[], labels: Map<RenderEdge, Point>): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const expand = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const n of nodes) {
    expand(n.x - n.width / 2, n.y - n.height / 2);
    expand(n.x + n.width / 2, n.y + n.height / 2);
  }
  for (const e of edges) {
    // The path follows its waypoints exactly (orthogonal polyline, roundings
    // included since they stay within the corner): no overflow to anticipate
    // any more, as there was with a spline.
    for (const p of e.points) expand(p.x, p.y);
    if (e.arrow) {
      // The head spreads around the path's endpoint, in a direction that depends
      // on the line's orientation: its whole footprint is reserved.
      const bout = e.points[e.points.length - 1];
      expand(bout.x - HEAD_SIZE, bout.y - HEAD_SIZE);
      expand(bout.x + HEAD_SIZE, bout.y + HEAD_SIZE);
    }
    // A label's chip spills well beyond its anchor point alone
    // (e.g. "File + ETL (repository)") -- count its real width, not just that point.
    const pos = labels.get(e);
    if (pos) {
      const size = chipSize(e.label, e.technology);
      expand(pos.x - size.width / 2, pos.y - size.height / 2);
      expand(pos.x + size.width / 2, pos.y + size.height / 2);
    }
  }

  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 100, y1: 100 };
  return { x0: x0 - FRAME_MARGIN, y0: y0 - FRAME_MARGIN, x1: x1 + FRAME_MARGIN, y1: y1 + FRAME_MARGIN };
}

// --- Legend ----------------------------------------------------------------
//
// It lives IN the SVG, not in the interface: the colour code must travel with
// the diagram. As long as it lived in the rail, every export to Word or
// PowerPoint left without it, and it had to be explained at every circulation.
// The legend now carries the NOTATION as well as the colour code: a dozen
// entries where there were five. At 10 px it was the board's smallest text,
// the one read last even though it explains everything else.
//
const LEGEND_TEXT_SIZE = 12;
const LEGEND_LINE = 19;
const LEGEND_PAD = 12;
const LEGEND_SAMPLE = 26;
// The average character width at this size, in the diagram's font stack.
// Underestimated, the text spills out of the frame.
const LEGEND_CHAR_WIDTH = 6.7;

function widthOfLegend(inputs: string[]): number {
  const text = Math.max(0, ...inputs.map((e) => e.length * LEGEND_CHAR_WIDTH));
  return LEGEND_PAD * 2 + LEGEND_SAMPLE + 10 + text;
}

function buildLegend(inputs: readonly LegendEntry[], x: number, y: number, width: number, height: number): SVGGElement {
  const g = el("g");
  g.setAttribute("class", "fx-legend");
  g.appendChild(rect(x, y, width, height, PAPER, "#c8cdd5", 1));

  let row = y + LEGEND_PAD + LEGEND_LINE / 2;

  const line = (e: Extract<LegendSample, { shape: "line" }>): SVGElement => {
    const l = el("line");
    // The head OVERRUNS the line's end, by HEAD_SIZE. Without this shortening
    // it encroached on the entry's text -- a legend overlapping itself.
    //
    const margin = e.head ? HEAD_SIZE : 0;
    l.setAttribute("x1", String(x + LEGEND_PAD + (e.head === "start" ? margin : 0)));
    l.setAttribute("y1", String(row));
    l.setAttribute("x2", String(x + LEGEND_PAD + LEGEND_SAMPLE - (e.head === "end" ? margin : 0)));
    l.setAttribute("y2", String(row));
    l.setAttribute("stroke", e.colour);
    l.setAttribute("stroke-width", String(e.thickness ?? STROKE_WIDTH));
    if (e.dashed) l.setAttribute("stroke-dasharray", "6 4");
    if (e.head === "end") l.setAttribute("marker-end", `url(#${arrowMarkerId(e.colour)})`);
    if (e.head === "start") l.setAttribute("marker-start", `url(#${arrowMarkerId(e.colour, true)})`);
    return l;
  };

  // The sample SHOWS the shape it announces: an ordinary box under "cut
  // corner" would be a legend entry as mute as the sign it claims to explain.
  //
  const box = (e: Extract<LegendSample, { shape: "box" }>): SVGElement => {
    const x0 = x + LEGEND_PAD;
    const y0 = row - 5;
    const l = LEGEND_SAMPLE;
    const h = 10;
    if (e.pile) {
      const g2 = el("g");
      for (const [dx, dy, op] of [[4, -3, "0.55"], [0, 0, "1"]] as [number, number, string][]) {
        const r = rect(x0 + dx, y0 + dy, l - 4, h, e.fill, e.stroke, 1);
        r.setAttribute("opacity", op);
        g2.appendChild(r);
      }
      return g2;
    }
    if (e.cutCorner) {
      const coupe = 4;
      const p2 = el("path");
      p2.setAttribute("d", `M${x0} ${y0} H${x0 + l - coupe} L${x0 + l} ${y0 + coupe} V${y0 + h} H${x0} Z`);
      p2.setAttribute("fill", e.fill);
      p2.setAttribute("stroke", e.stroke);
      p2.setAttribute("stroke-width", "1");
      return p2;
    }
    const r = rect(x0, y0, l, h, e.fill, e.stroke, 1);
    if (e.dashed) r.setAttribute("stroke-dasharray", "3 2");
    return r;
  };

  for (const input of inputs) {
    g.appendChild(input.sample.shape === "line" ? line(input.sample) : box(input.sample));
    const t = el("text");
    t.setAttribute("x", String(x + LEGEND_PAD + LEGEND_SAMPLE + 10));
    t.setAttribute("y", String(row + 4));
    t.setAttribute("font-size", String(LEGEND_TEXT_SIZE));
    t.setAttribute("fill", INK);
    t.textContent = input.text;
    g.appendChild(t);
    row += LEGEND_LINE;
  }

  return g;
}

export function buildGraphSvg(
  layout: LayoutResult,
  colorFor: (tech: string) => string,
  // What the diagram says about itself. `null` for the calls that have nothing
  // to say -- a rendering test, a fragment -- rather than an empty title block.
  context: DiagramContext | null = null,
  options?: { weightByCriticality?: boolean }
): SVGSVGElement {
  // The routes come from ELK: ports spread over the imposed side and orthogonal
  // routing avoiding the boxes by construction. All that is left is merging the
  // flows of the same technology towards the same target.
  const renderEdges = mergeByTechnologyToTarget(layout.edges);
  const labels = placeLabels(renderEdges);

  const bounds = computeBounds(layout.nodes, renderEdges, labels);

  // The legend occupies a reserved corner under the drawing: it is added to the
  // bounds rather than laid over the diagram.
  // Only what serves is listed: a line marked as a change no longer carries its
  // technology's colour, which therefore has no business in the legend. And an
  // empty technology is not one -- functional mode empties `technology` on all
  // its edges, and an unnamed entry would announce nothing but a colour code
  // nowhere to be found on the drawing.
  const inputs = legendEntries(renderEdges, layout.nodes, colorFor, options?.weightByCriticality === true);
  const legendWidth = inputs.length ? widthOfLegend(inputs.map((e) => e.text)) : 0;
  const legendHeight = inputs.length ? LEGEND_PAD * 2 + inputs.length * LEGEND_LINE : 0;

  if (inputs.length) {
    bounds.y1 += FRAME_MARGIN + legendHeight;
    bounds.x0 = Math.min(bounds.x0, bounds.x1 - legendWidth);
  }

  // The title block occupies a reserved band above the drawing, as the legend
  // occupies its own below.
  if (context) bounds.y0 -= FRAME_MARGIN + TITLE_BLOCK_HEIGHT;

  const width = bounds.x1 - bounds.x0;
  const height = bounds.y1 - bounds.y0;

  const svg = el("svg");
  svg.setAttribute("xmlns", SVG_NS);
  // The file names its font: inherited from the page, it fell back to serif as
  // soon as it was opened on its own, whereas the label widths are calibrated
  // for that stack.
  svg.setAttribute("font-family", FONT);
  // The viewBox drives the FRAMING (zoom, pan); width and height set the display
  // size, which stays that of the drawing. Stretching the SVG to the window's
  // width was tried: everything fitted on screen, and nothing was legible any
  // more -- 0.5× scale, hence a 5 px legend.
  svg.setAttribute("viewBox", `${bounds.x0} ${bounds.y0} ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  // Accessibility pattern no. 11 from the Deque study, the most reliable of the
  // twelve tested across browsers × screen readers. Two requirements: <title>
  // and <desc> must be DIRECT CHILDREN of <svg> -- SVG-AAM does not walk deeper
  // -- and aria-labelledby takes precedence over <title> alone, notoriously
  // unreliable in NVDA + Firefox.
  if (context) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", `${TITLE_ID} ${DESC_ID}`);
    const title = el("title");
    title.setAttribute("id", TITLE_ID);
    title.textContent = titleBlockText(context).title;
    svg.appendChild(title);
    const desc = el("desc");
    desc.setAttribute("id", DESC_ID);
    desc.textContent = descriptionAccessible(context);
    svg.appendChild(desc);
  }

  const defs = el("defs");
  // One definition per (colour, shape, size) actually used.
  const marqueurs = new Map<string, { colour: string; hollow: boolean; size: number }>();
  const declare = (colour: string, hollow: boolean, size: number) =>
    marqueurs.set(arrowMarkerId(colour, hollow, size), { colour, hollow, size });
  for (const e of renderEdges) {
    if (!e.arrow) continue;
    declare(edgeColour(e, colorFor), e.pulled === true, headSizeFor(approachLengthOf(e)));
  }
  // The legend draws its own arrowed samples: their marker must exist in <defs>,
  // failing which the entry comes out headless -- that is, it explains a
  // notation by not showing it. Its sample is long enough for the full size.
  //
  for (const e of inputs) {
    if (e.sample.shape !== "line" || !e.sample.head) continue;
    declare(e.sample.colour, e.sample.head === "start", HEAD_SIZE);
  }
  for (const m of marqueurs.values()) addArrowMarker(defs, m.colour, m.hollow, m.size);
  svg.appendChild(defs);

  const background = rect(bounds.x0, bounds.y0, width, height, PAPER, "none", 0);
  svg.appendChild(background);

  if (context) svg.appendChild(buildTitleBlock(context, bounds.x0 + FRAME_MARGIN, bounds.y0 + FRAME_MARGIN));

  // The rectangle each label occupies: that is where its line breaks.
  const labelRect = (e: RenderEdge): Rect | null => {
    const centreOf = labels.get(e);
    if (!centreOf || !e.label) return null;
    const t = chipSize(e.label, e.technology);
    return { x0: centreOf.x - t.width / 2, y0: centreOf.y - t.height / 2, x1: centreOf.x + t.width / 2, y1: centreOf.y + t.height / 2 };
  };

  const edgeLayer = el("g");
  edgeLayer.setAttribute("class", "fx-edges");
  for (const edge of renderEdges) {
    edgeLayer.appendChild(buildEdgeElement(edge, colorFor, labelRect(edge), options?.weightByCriticality === true));
  }
  svg.appendChild(edgeLayer);

  // Boundaries go under the edges: they are background scenery, not objects to
  // hover over.
  const boundaryLayer = el("g");
  boundaryLayer.setAttribute("class", "fx-frontieres");
  for (const node of layout.nodes.filter((n) => n.kind === "boundary")) {
    boundaryLayer.appendChild(buildBoundaryElement(node));
  }
  svg.insertBefore(boundaryLayer, edgeLayer);

  const nodeLayer = el("g");
  nodeLayer.setAttribute("class", "fx-nodes");
  for (const node of layout.nodes.filter((n) => n.kind !== "boundary")) {
    nodeLayer.appendChild(buildNodeElement(node));
  }
  svg.appendChild(nodeLayer);

  // Drawing order: boundaries, edges, boxes, then labels. The labels come last
  // so that no line and no box covers them -- as long as they lived in their
  // edge's group, a box laid down afterwards could hide them.
  //
  const labelLayer = el("g");
  labelLayer.setAttribute("class", "fx-labels");
  for (const edge of renderEdges) {
    const anchor = labels.get(edge);
    if (!edge.label || !anchor) continue;
    labelLayer.appendChild(
      buildEdgeLabel(
        anchor.x,
        anchor.y,
        edge.label,
        subLabelOf(edge.label, edge.technology),
        edgeColour(edge, colorFor),
        edge.attenuated,
        !edge.change && edge.technology.trim() !== ""
      )
    );
  }
  svg.appendChild(labelLayer);

  if (inputs.length) {
    svg.appendChild(buildLegend(inputs, bounds.x1 - legendWidth, bounds.y1 - legendHeight, legendWidth, legendHeight));
  }

  return svg;
}
