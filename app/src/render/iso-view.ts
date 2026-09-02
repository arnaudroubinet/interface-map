import type { LayoutResult } from "../layout/graph-layout";
import { chipWidth, CHIP_HEIGHT } from "../layout/graph-layout";
import {
  modelToFossflow,
  type FossflowModel,
  type FossflowView,
  type FossflowConnector,
} from "../export/fossflow-json";
import { PAPER, INK } from "./node-styles";
import { routeConnectors } from "./iso-routing";
import { buildTitleBlock, descriptionAccessible, titleBlockText, TITLE_BLOCK_HEIGHT, type DiagramContext } from "./title-block";

// The isometric painter: a FossFLOW view drawn as plain SVG, no engine.
//
// FossFLOW's renderer is a React tree and cannot be lifted out of it -- but
// what it computes is three formulas, extracted from its bundle and reproduced
// here: a tile projects to (w/2·(tx−ty), −h/2·(tx+ty)) with a projected tile
// of 141.5 × 81.9, flat shapes take one affine matrix, and the "3D" is not
// computed at all -- it is DRAWN, once, in the icons (iso-icons.ts).
//
// This is a view for SHOWING, complementary to the boards for reading: the
// projection rotates ELK's reading axis, which is exactly why it never
// replaces them (see BACKLOG, « Vue isométrique façon isoflow »). What the
// original objection got right is corrected here all the same: the painter is
// ours, so the boxes keep their text -- name, [Type] -- and the arrowheads
// keep saying who takes the initiative.

const SVG_NS = "http://www.w3.org/2000/svg";
const FONT = 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

// The projection lives in iso-projection.ts, shared with the placement:
// re-exported here because the painter is its natural address for callers.
import { tileToScreen } from "./iso-projection";
export { tileToScreen };

const FRAME_MARGIN = 24;
// The icon's box. Bottom-anchored on its tile: an isometric drawing STANDS on
// the ground plane, it is not centred in the air.
const ICON_SIZE = 132;
const ICON_FOOT = 22;
// Where a line stops before the drawing it joins -- measured ALONG its last
// segment, so the segment keeps the grid's direction to its very tip. An
// earlier version aimed at the icon's body by lifting the endpoint on
// screen, and that one lift turned every arrival into an angle the grid
// does not have. The distance depends on the side: arriving from above, the
// line runs into the icon's body and must stop at its silhouette; arriving
// from below, it passes behind the name -- whose halo keeps it readable --
// and stops at the icon's foot: a head parked on the letters, halfway, read
// as pointing at the name rather than at the drawing.
const END_GAP_FROM_ABOVE = 70;
const END_GAP_FROM_BELOW = 26;
const HEAD_ROOM = 4;

const TITLE_ID = "iso-titre";
const DESC_ID = "iso-desc";

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function textAt(x: number, y: number, content: string, size: number, colour: string, bold = false): SVGTextElement {
  const t = el("text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  t.setAttribute("text-anchor", "middle");
  t.setAttribute("font-size", String(size));
  t.setAttribute("fill", colour);
  if (bold) t.setAttribute("font-weight", "bold");
  t.textContent = content;
  return t;
}

// A name with the paper showing through behind it: the flows run everywhere
// on a dense board, and a name a line runs under stops being readable
// precisely where the reader needs it. The halo is the stroke painted first.
function haloed(t: SVGTextElement): SVGTextElement {
  t.setAttribute("paint-order", "stroke");
  t.setAttribute("stroke", PAPER);
  t.setAttribute("stroke-width", "4");
  t.setAttribute("stroke-linejoin", "round");
  return t;
}

interface Point {
  x: number;
  y: number;
}

// Shorten a polyline at both ends, each along its own last segment: the line
// stops before the drawings it joins instead of running under them.
function trimmed(points: Point[], gapStart: number, gapEnd: number): Point[] {
  const result = points.map((p) => ({ ...p }));
  const pull = (a: Point, b: Point, gap: number) => {
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    if (d <= gap) return a;
    return { x: a.x + ((b.x - a.x) * gap) / d, y: a.y + ((b.y - a.y) * gap) / d };
  };
  result[0] = pull(result[0], result[1], gapStart);
  result[result.length - 1] = pull(result[result.length - 1], result[result.length - 2], gapEnd);
  return result;
}

interface ChipRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const rectsOverlap = (a: ChipRect, b: ChipRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// Where a label chip lands: on one of its route's two longest screen
// segments -- the ones with room -- slid along it and, failing that, stepped
// off it one chip-height at a time, until it covers neither a drawing, nor a
// name, nor another chip. The flat boards get this from ELK's label
// placement; here the painter owes it to itself. When EVERY candidate
// collides -- the heart of a dense board -- the one covering the least is
// taken: a label somewhere beats a label nowhere, and least-covered beats
// the middle of the pile.
function chipPlace(path: Point[], width: number, height: number, obstacles: ChipRect[]): { x: number; y: number } {
  const segments = [];
  for (let i = 1; i < path.length; i++) {
    segments.push({ a: path[i - 1], b: path[i], length: Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y) });
  }
  segments.sort((s, t) => t.length - s.length);

  const overlapArea = (centre: { x: number; y: number }) => {
    const rect = { x0: centre.x - width / 2, y0: centre.y - height / 2, x1: centre.x + width / 2, y1: centre.y + height / 2 };
    let area = 0;
    for (const o of obstacles) {
      if (!rectsOverlap(o, rect)) continue;
      area += (Math.min(o.x1, rect.x1) - Math.max(o.x0, rect.x0)) * (Math.min(o.y1, rect.y1) - Math.max(o.y0, rect.y0));
    }
    return area;
  };

  const step = height + 4;
  let best: { centre: { x: number; y: number }; area: number } | null = null;
  for (const { a, b } of segments.slice(0, 2)) {
    for (const t of [0.5, 0.36, 0.64, 0.24, 0.76, 0.12, 0.88]) {
      for (const dy of [0, -step, step, -2 * step, 2 * step, -3 * step, 3 * step]) {
        const centre = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t + dy };
        const area = overlapArea(centre);
        if (area === 0) return centre;
        if (!best || area < best.area) best = { centre, area };
      }
    }
  }
  return best!.centre;
}

function arrowHead(tip: Point, from: Point, colour: string): SVGPolygonElement {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x);
  const wing = (offset: number) =>
    `${tip.x - 16 * Math.cos(angle - offset)},${tip.y - 16 * Math.sin(angle - offset)}`;
  const head = el("polygon");
  head.setAttribute("points", `${tip.x},${tip.y} ${wing(0.42)} ${wing(-0.42)}`);
  head.setAttribute("fill", colour);
  return head;
}

export function buildIsoSvg(model: FossflowModel, view: FossflowView, context: DiagramContext | null = null): SVGSVGElement {
  const itemById = new Map(model.items.map((i) => [i.id, i]));
  const iconById = new Map(model.icons.map((i) => [i.id, i]));
  const colourById = new Map(model.colors.map((c) => [c.id, c.value]));

  // Routed before anything is measured: the routes take part in the framing,
  // and the corridors' lanes are part of where every line will be.
  const routes = routeConnectors(view);

  // -- Bounds, in screen space, before drawing anything ----------------------
  const points: Point[] = [];
  for (const item of view.items) {
    const p = tileToScreen(item.tile);
    points.push({ x: p.x - ICON_SIZE / 2 - 20, y: p.y - ICON_SIZE });
    points.push({ x: p.x + ICON_SIZE / 2 + 20, y: p.y + 66 });
  }
  for (const route of routes.values()) for (const tile of route.points) points.push(tileToScreen(tile));
  for (const rectangle of view.rectangles) {
    points.push(tileToScreen({ x: rectangle.from.x - 0.5, y: rectangle.from.y - 0.5 }));
    points.push(tileToScreen({ x: rectangle.to.x + 0.5, y: rectangle.to.y + 0.5 }));
    points.push(tileToScreen({ x: rectangle.from.x - 0.5, y: rectangle.to.y + 0.5 }));
    points.push(tileToScreen({ x: rectangle.to.x + 0.5, y: rectangle.from.y - 0.5 }));
  }
  for (const box of view.textBoxes) points.push(tileToScreen(box.tile));
  if (points.length === 0) points.push({ x: 0, y: 0 });

  const bounds = {
    x0: Math.min(...points.map((p) => p.x)) - FRAME_MARGIN,
    y0: Math.min(...points.map((p) => p.y)) - FRAME_MARGIN,
    x1: Math.max(...points.map((p) => p.x)) + FRAME_MARGIN,
    y1: Math.max(...points.map((p) => p.y)) + FRAME_MARGIN,
  };
  // The frame is SET at the end: the label chips place themselves late, and a
  // chip the frame was not told about came out cut at the edge.
  const svg = el("svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("font-family", FONT);

  // Same accessibility pattern as buildGraphSvg: <title> and <desc> as direct
  // children, named by aria-labelledby.
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

  // Sized at the end, with the frame.
  const background = el("rect");
  background.setAttribute("fill", PAPER);
  svg.appendChild(background);

  // -- The ground: a diamond grid under everything ---------------------------
  // Lines of constant tile column and constant tile row, projected with the
  // same formula as everything else -- ONE projection, or the ground and the
  // drawings would drift apart.
  const tiles = [...view.items.map((i) => i.tile), ...[...routes.values()].flatMap((r) => r.points)];
  if (tiles.length > 0) {
    const txs = tiles.map((t) => t.x);
    const tys = tiles.map((t) => t.y);
    // Floored: a route's lane sits at a fractional tile, and a grid drawn
    // from a fractional origin would no longer be THE grid everything sits on.
    const range = {
      x0: Math.floor(Math.min(...txs)) - 2,
      x1: Math.ceil(Math.max(...txs)) + 2,
      y0: Math.floor(Math.min(...tys)) - 2,
      y1: Math.ceil(Math.max(...tys)) + 2,
    };
    const grid = el("g");
    grid.setAttribute("stroke", "#e2e7ef");
    grid.setAttribute("stroke-width", "1");
    const line = (a: Point, b: Point) => {
      const l = el("line");
      l.setAttribute("x1", String(a.x));
      l.setAttribute("y1", String(a.y));
      l.setAttribute("x2", String(b.x));
      l.setAttribute("y2", String(b.y));
      grid.appendChild(l);
    };
    for (let tx = range.x0; tx <= range.x1; tx++) {
      line(tileToScreen({ x: tx, y: range.y0 - 0.5 }), tileToScreen({ x: tx, y: range.y1 + 0.5 }));
    }
    for (let ty = range.y0; ty <= range.y1; ty++) {
      line(tileToScreen({ x: range.x0 - 0.5, y: ty }), tileToScreen({ x: range.x1 + 0.5, y: ty }));
    }
    svg.appendChild(grid);
  }

  // -- Boundaries: the projected rectangle, same dashes as the flat boards ---
  for (const rectangle of view.rectangles) {
    const f = { x: rectangle.from.x - 0.5, y: rectangle.from.y - 0.5 };
    const t = { x: rectangle.to.x + 0.5, y: rectangle.to.y + 0.5 };
    const corners = [
      tileToScreen({ x: f.x, y: f.y }),
      tileToScreen({ x: t.x, y: f.y }),
      tileToScreen({ x: t.x, y: t.y }),
      tileToScreen({ x: f.x, y: t.y }),
    ];
    const zone = el("polygon");
    zone.setAttribute("points", corners.map((c) => `${c.x},${c.y}`).join(" "));
    zone.setAttribute("fill", "#2a6fbb");
    zone.setAttribute("fill-opacity", "0.06");
    zone.setAttribute("stroke", "#7f8c9a");
    zone.setAttribute("stroke-dasharray", "6 4");
    svg.appendChild(zone);
  }

  // -- Connectors, under the drawings they join ------------------------------
  // The routes come from iso-routing: found on the grid around the occupied
  // tiles, one lane per route inside a shared corridor -- two flows never run
  // exactly on top of each other, whoever their endpoints are.
  //
  // The labels dodge for themselves: every drawing and every name is an
  // obstacle, and each chip placed becomes one for the next.
  const chipObstacles: ChipRect[] = view.items.map((placed) => {
    const p = tileToScreen(placed.tile);
    return { x0: p.x - ICON_SIZE / 2, y0: p.y - ICON_SIZE + ICON_FOOT, x1: p.x + ICON_SIZE / 2, y1: p.y + ICON_FOOT + 42 };
  });
  const chips: SVGGElement[] = [];
  const flowIds: string[] = [];
  for (const connector of view.connectors) {
    const route = routes.get(connector.id);
    if (!route) continue;
    flowIds.push(connector.id);
    const colour = (connector.color && colourById.get(connector.color)) || INK;

    let path = route.points.map(tileToScreen);
    // "From above" at an end: the last segment travels DOWN the screen into
    // the drawing (its icon stands above its tile); at the start, the first
    // segment leaves upward, out of the icon's body.
    const gapAtEnd = path[path.length - 1].y > path[path.length - 2].y ? END_GAP_FROM_ABOVE : END_GAP_FROM_BELOW;
    const gapAtStart = path[0].y > path[1].y ? END_GAP_FROM_ABOVE : END_GAP_FROM_BELOW;
    path = trimmed(
      path,
      connector.startArrow ? gapAtStart + HEAD_ROOM : gapAtStart,
      connector.startArrow ? gapAtEnd : gapAtEnd + HEAD_ROOM
    );

    // One group per flow, named by its connector: the hover style points at
    // it, and the chip carries the same name so hovering either lights both.
    const flow = el("g");
    flow.setAttribute("class", `iso-flow f-${connector.id}`);

    const line = el("polyline");
    line.setAttribute("points", path.map((p) => `${p.x},${p.y}`).join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", colour);
    line.setAttribute("stroke-width", "3.5");
    line.setAttribute("stroke-linejoin", "round");
    if (connector.style === "DASHED") line.setAttribute("stroke-dasharray", "8 5");
    if (connector.style === "DOTTED") line.setAttribute("stroke-dasharray", "2 4");
    flow.appendChild(line);

    // A 3.5px stroke is no hover target: an invisible twin, wide enough for
    // a fingertip, catches the pointer instead.
    const grip = el("polyline");
    grip.setAttribute("points", line.getAttribute("points")!);
    grip.setAttribute("fill", "none");
    grip.setAttribute("stroke", colour);
    grip.setAttribute("stroke-opacity", "0");
    grip.setAttribute("stroke-width", "16");
    grip.setAttribute("pointer-events", "stroke");
    flow.appendChild(grip);

    // The stroke follows the data; the head says who takes the initiative
    // (startArrow: the consumer calls). The one convention of the flat boards
    // the projection does not touch. A trunk's head is dealt by the routing:
    // members overlaying the leader's line draw no second head on top of its.
    if (connector.startArrow) {
      flow.appendChild(arrowHead(path[0], path[1], colour));
    } else if (route.drawsHead) {
      flow.appendChild(arrowHead(path[path.length - 1], path[path.length - 2], colour));
    }
    svg.appendChild(flow);

    if (connector.description) {
      const w = chipWidth(connector.description);
      const centre = chipPlace(path, w, CHIP_HEIGHT + 2, chipObstacles);
      chipObstacles.push({ x0: centre.x - w / 2, y0: centre.y - CHIP_HEIGHT / 2 - 1, x1: centre.x + w / 2, y1: centre.y + CHIP_HEIGHT / 2 + 1 });
      const chip = el("g");
      chip.setAttribute("class", `iso-flow f-${connector.id}`);
      const box = el("rect");
      box.setAttribute("x", String(centre.x - w / 2));
      box.setAttribute("y", String(centre.y - CHIP_HEIGHT / 2 - 1));
      box.setAttribute("width", String(w));
      box.setAttribute("height", String(CHIP_HEIGHT + 2));
      box.setAttribute("rx", "8");
      box.setAttribute("fill", PAPER);
      box.setAttribute("stroke", colour);
      chip.appendChild(box);
      chip.appendChild(textAt(centre.x, centre.y + 4, connector.description, 11, INK));
      // Kept for after the drawings: a chip is a LABEL, and a label hidden
      // behind an icon explains nothing.
      chips.push(chip);
    }
  }

  // Hovering a flow -- its line or its chip -- dims every other flow: the
  // one reading aid the literature rates above any static layout work, and
  // it costs a stylesheet. Pure CSS via :has(), carried INSIDE the SVG so an
  // exported file keeps the behaviour; a renderer without :has() simply
  // shows the board unchanged, and a rasteriser never hovers.
  if (flowIds.length > 0) {
    const style = el("style");
    style.textContent = [
      ".iso-flow{transition:opacity .12s ease}",
      ...flowIds.map((id) => `svg:has(.f-${id}:hover) .iso-flow:not(.f-${id}){opacity:.12}`),
    ].join("\n");
    svg.appendChild(style);
  }

  // -- The drawings, back to front -------------------------------------------
  // Painter's algorithm on the projection itself: what the formula puts lower
  // on screen is nearer, and is drawn last so it passes in front.
  const drawOrder = [...view.items].sort((a, b) => tileToScreen(a.tile).y - tileToScreen(b.tile).y);
  for (const placed of drawOrder) {
    const item = itemById.get(placed.id);
    if (!item) continue;
    const p = tileToScreen(placed.tile);
    const icon = item.icon ? iconById.get(item.icon) : undefined;
    if (icon) {
      const image = el("image");
      image.setAttribute("href", icon.url);
      image.setAttribute("x", String(p.x - ICON_SIZE / 2));
      image.setAttribute("y", String(p.y - ICON_SIZE + ICON_FOOT));
      image.setAttribute("width", String(ICON_SIZE));
      image.setAttribute("height", String(ICON_SIZE));
      image.setAttribute("preserveAspectRatio", "xMidYMax meet");
      svg.appendChild(image);
    }
    svg.appendChild(haloed(textAt(p.x, p.y + ICON_FOOT + 20, item.name, 14, INK, true)));
    if (item.subtitle) svg.appendChild(haloed(textAt(p.x, p.y + ICON_FOOT + 36, `[${item.subtitle}]`, 11, "#5b6472")));
  }

  for (const chip of chips) svg.appendChild(chip);

  // A zone's name sits ABOVE its top corner tile: projected, that corner is
  // the diamond's apex, and the nearest drawing inside stands a tile lower --
  // the one spot on the frame no icon reaches up to.
  for (const box of view.textBoxes) {
    const p = tileToScreen(box.tile);
    svg.appendChild(haloed(textAt(p.x, p.y - 38, box.content, box.fontSize ?? 13, "#5b6472")));
  }

  // The chips have chosen their places: the frame can close around
  // everything, and only now. chipObstacles holds the drawings' boxes too --
  // already inside -- so taking the whole list changes nothing for them.
  for (const rect of chipObstacles) {
    bounds.x0 = Math.min(bounds.x0, rect.x0 - 8);
    bounds.y0 = Math.min(bounds.y0, rect.y0 - 8);
    bounds.x1 = Math.max(bounds.x1, rect.x1 + 8);
    bounds.y1 = Math.max(bounds.y1, rect.y1 + 8);
  }
  // The title block's reserved band, above everything now known.
  if (context) bounds.y0 -= FRAME_MARGIN + TITLE_BLOCK_HEIGHT;
  const width = bounds.x1 - bounds.x0;
  const height = bounds.y1 - bounds.y0;
  svg.setAttribute("viewBox", `${bounds.x0} ${bounds.y0} ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  background.setAttribute("x", String(bounds.x0));
  background.setAttribute("y", String(bounds.y0));
  background.setAttribute("width", String(width));
  background.setAttribute("height", String(height));

  if (context) svg.appendChild(buildTitleBlock(context, bounds.x0 + FRAME_MARGIN, bounds.y0 + FRAME_MARGIN));

  return svg;
}

// The board on screen, translated then painted: the SAME translation as the
// FossFLOW export, so the isometric view in the app and the JSON opened in
// FossFLOW show one board, not two cousins.
export function buildIsoBoardSvg(
  layout: LayoutResult,
  colorFor: (technology: string) => string,
  context: DiagramContext | null,
  title: string
): SVGSVGElement {
  const model = modelToFossflow([{ title, layout }], colorFor, title);
  return buildIsoSvg(model, model.views[0], context);
}
