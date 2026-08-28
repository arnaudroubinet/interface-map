import type { LayoutResult } from "../layout/graph-layout";
import { chipWidth, CHIP_HEIGHT } from "../layout/graph-layout";
import {
  modelToFossflow,
  type FossflowModel,
  type FossflowView,
  type FossflowConnector,
} from "../export/fossflow-json";
import { PAPER, INK } from "./node-styles";
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

// The projected tile, as fossflow's own constants have it (100 × {1.415, 0.819}).
const HALF_TILE_W = 70.75;
const HALF_TILE_H = 40.95;

export function tileToScreen(tile: { x: number; y: number }): { x: number; y: number } {
  return {
    x: HALF_TILE_W * (tile.x - tile.y),
    y: -HALF_TILE_H * (tile.x + tile.y),
  };
}

const FRAME_MARGIN = 24;
// The icon's box. Bottom-anchored on its tile: an isometric drawing STANDS on
// the ground plane, it is not centred in the air.
const ICON_SIZE = 132;
const ICON_FOOT = 22;
// The clearance a connector keeps before an icon, so the line reads as
// arriving AT the drawing rather than under it.
const END_GAP = 40;

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

// The connector's route in TILE space: straight when aligned, otherwise one
// elbow -- through whichever intermediate corner is not somebody's tile. No
// A*: fossflow routes with one because its user drags items live; an exported
// board is already laid out by ELK, whose crossings these two candidates
// inherit well enough for a view meant to show.
function connectorTiles(a: Point, b: Point, occupied: Set<string>): Point[] {
  if (a.x === b.x || a.y === b.y) return [a, b];
  const corner1 = { x: b.x, y: a.y };
  const corner2 = { x: a.x, y: b.y };
  const free = (p: Point) => !occupied.has(`${p.x},${p.y}`);
  const corner = free(corner1) ? corner1 : free(corner2) ? corner2 : corner1;
  return [a, corner, b];
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
  const tileById = new Map(view.items.map((i) => [i.id, i.tile]));
  const occupied = new Set(view.items.map((i) => `${i.tile.x},${i.tile.y}`));

  // -- Bounds, in screen space, before drawing anything ----------------------
  const points: Point[] = [];
  for (const item of view.items) {
    const p = tileToScreen(item.tile);
    points.push({ x: p.x - ICON_SIZE / 2 - 20, y: p.y - ICON_SIZE });
    points.push({ x: p.x + ICON_SIZE / 2 + 20, y: p.y + 66 });
  }
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
  if (context) bounds.y0 -= FRAME_MARGIN + TITLE_BLOCK_HEIGHT;

  const width = bounds.x1 - bounds.x0;
  const height = bounds.y1 - bounds.y0;

  const svg = el("svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("font-family", FONT);
  svg.setAttribute("viewBox", `${bounds.x0} ${bounds.y0} ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

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

  const background = el("rect");
  background.setAttribute("x", String(bounds.x0));
  background.setAttribute("y", String(bounds.y0));
  background.setAttribute("width", String(width));
  background.setAttribute("height", String(height));
  background.setAttribute("fill", PAPER);
  svg.appendChild(background);

  // -- The ground: a diamond grid under everything ---------------------------
  // Lines of constant tile column and constant tile row, projected with the
  // same formula as everything else -- ONE projection, or the ground and the
  // drawings would drift apart.
  const tiles = [...tileById.values()];
  if (tiles.length > 0) {
    const txs = tiles.map((t) => t.x);
    const tys = tiles.map((t) => t.y);
    const range = {
      x0: Math.min(...txs) - 2,
      x1: Math.max(...txs) + 2,
      y0: Math.min(...tys) - 2,
      y1: Math.max(...tys) + 2,
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
  // Parallel flows between the same two tiles are offset side by side, the way
  // the flat boards fan their edges out -- stacked exactly on top of each
  // other, only the last one would exist.
  const seenPairs = new Map<string, number>();
  const chips: SVGGElement[] = [];
  for (const connector of view.connectors) {
    const ends = connector.anchors
      .map((a) => (a.ref.item ? tileById.get(a.ref.item) : a.ref.tile))
      .filter((t): t is Point => t !== undefined);
    if (ends.length < 2) continue;
    const colour = (connector.color && colourById.get(connector.color)) || INK;

    const pairKey = [`${ends[0].x},${ends[0].y}`, `${ends[1].x},${ends[1].y}`].sort().join("|");
    const rank = seenPairs.get(pairKey) ?? 0;
    seenPairs.set(pairKey, rank + 1);
    const shift = rank * 9;

    const route = connectorTiles(ends[0], ends[ends.length - 1], occupied);
    let path = route.map(tileToScreen).map((p) => ({ x: p.x + shift, y: p.y + shift * 0.6 }));
    path = trimmed(
      path,
      connector.startArrow ? END_GAP + 4 : END_GAP,
      connector.startArrow ? END_GAP : END_GAP + 4
    );

    const line = el("polyline");
    line.setAttribute("points", path.map((p) => `${p.x},${p.y}`).join(" "));
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", colour);
    line.setAttribute("stroke-width", "3.5");
    line.setAttribute("stroke-linejoin", "round");
    if (connector.style === "DASHED") line.setAttribute("stroke-dasharray", "8 5");
    if (connector.style === "DOTTED") line.setAttribute("stroke-dasharray", "2 4");
    svg.appendChild(line);

    // The stroke follows the data; the head says who takes the initiative
    // (startArrow: the consumer calls). The one convention of the flat boards
    // the projection does not touch.
    svg.appendChild(
      connector.startArrow
        ? arrowHead(path[0], path[1], colour)
        : arrowHead(path[path.length - 1], path[path.length - 2], colour)
    );

    if (connector.description) {
      const middle = path[Math.floor(path.length / 2)];
      const chip = el("g");
      const w = chipWidth(connector.description);
      const box = el("rect");
      box.setAttribute("x", String(middle.x - w / 2));
      box.setAttribute("y", String(middle.y - CHIP_HEIGHT / 2 - 1));
      box.setAttribute("width", String(w));
      box.setAttribute("height", String(CHIP_HEIGHT + 2));
      box.setAttribute("rx", "8");
      box.setAttribute("fill", PAPER);
      box.setAttribute("stroke", colour);
      chip.appendChild(box);
      chip.appendChild(textAt(middle.x, middle.y + 4, connector.description, 11, INK));
      // Kept for after the drawings: a chip is a LABEL, and a label hidden
      // behind an icon explains nothing.
      chips.push(chip);
    }
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
    svg.appendChild(textAt(p.x, p.y + ICON_FOOT + 20, item.name, 14, INK, true));
    if (item.subtitle) svg.appendChild(textAt(p.x, p.y + ICON_FOOT + 36, `[${item.subtitle}]`, 11, "#5b6472"));
  }

  for (const chip of chips) svg.appendChild(chip);

  for (const box of view.textBoxes) {
    const p = tileToScreen(box.tile);
    const label = textAt(p.x, p.y, box.content, box.fontSize ?? 13, "#5b6472");
    label.setAttribute("text-anchor", "start");
    svg.appendChild(label);
  }

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
