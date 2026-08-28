import type { LayoutResult, LayoutNode, LayoutEdge } from "../layout/graph-layout";
import { subLabel } from "../layout/graph-layout";
import type { PlacedBoard } from "./drawio-export";
import { identifiers } from "./identifiers";
import { ISO_ICONS, iconForType } from "../render/iso-icons";

// The boards as a FossFLOW/Isoflow document: one view per board, on the tile
// grid that family of tools draws isometrically. The SAME translation feeds
// two consumers -- the downloadable JSON, openable in FossFLOW to rework and
// present, and the in-app isometric painter (render/iso-view.ts). One
// translation, two outputs: a board cannot show one thing on screen and
// export another.
//
// The target schema is the one fossflow@1.0.5 validates (zod, strip mode):
// unknown keys are silently DROPPED on import, never refused. The few fields
// below marked "painter only" rely on exactly that: they carry what the
// isometric convention cannot say (initiative, the [Type] under a name), our
// painter reads them, FossFLOW ignores them.

export interface FossflowIcon {
  id: string;
  name: string;
  url: string;
  isIsometric?: boolean;
}

export interface FossflowItem {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  // Painter only: the C4 [Type] line under the name. FossFLOW shows only the
  // name on the board, so there the type stays in the description.
  subtitle?: string;
}

export interface FossflowAnchor {
  id: string;
  ref: { item?: string; tile?: { x: number; y: number } };
}

export interface FossflowConnector {
  id: string;
  description?: string;
  color?: string;
  width?: number;
  style?: "SOLID" | "DOTTED" | "DASHED";
  anchors: FossflowAnchor[];
  // Painter only. The repo's convention needs two pieces of information on a
  // line -- the stroke follows the data, the head says who takes the
  // initiative -- and the schema has no field for the second. Anchors already
  // run provider to consumer like the stroke; this says the head goes at the
  // START (a pulled flow: the consumer calls). Same arbitration as the C4
  // export's Pulled tag: annotate, never reverse.
  startArrow?: boolean;
}

export interface FossflowRectangle {
  id: string;
  color?: string;
  from: { x: number; y: number };
  to: { x: number; y: number };
}

export interface FossflowTextBox {
  id: string;
  tile: { x: number; y: number };
  content: string;
  fontSize?: number;
}

export interface FossflowViewItem {
  id: string;
  tile: { x: number; y: number };
}

export interface FossflowView {
  id: string;
  name: string;
  items: FossflowViewItem[];
  connectors: FossflowConnector[];
  rectangles: FossflowRectangle[];
  textBoxes: FossflowTextBox[];
}

export interface FossflowColor {
  id: string;
  value: string;
}

export interface FossflowModel {
  version: string;
  title: string;
  icons: FossflowIcon[];
  colors: FossflowColor[];
  items: FossflowItem[];
  views: FossflowView[];
}

// ELK pixels per tile unit. The divisors follow the boxes' own metrics -- a
// 240-wide box with ELK's spacing lands neighbouring columns about two tiles
// apart -- so two boxes never fight for a tile before rounding even starts.
// x and y differ because a box is wider than it is tall.
const PX_PER_TILE_X = 150;
const PX_PER_TILE_Y = 130;

// A layout position on the CONTINUOUS tile plane. The mapping is linear and
// keeps both reading axes: more to the right in ELK is more to the right on
// the isometric screen, and same for down -- the projection rotates the grid,
// not the board's story. Derivation: the screen position of a tile (tx, ty)
// is (w/2·(tx−ty), −h/2·(tx+ty)) -- constants extracted from fossflow itself,
// see iso-view.ts -- and solving screen ∝ (x, y) for (tx, ty) gives this.
export function continuousTile(x: number, y: number): { x: number; y: number } {
  const u = x / PX_PER_TILE_X;
  const v = y / PX_PER_TILE_Y;
  return { x: u - v, y: -u - v };
}

// Integer tiles for a board's nodes, collisions resolved. Rounding can land
// two boxes on one tile or on touching tiles (boxes ELK drew very close), and
// an isometric drawing is WIDER than a tile: two drawings on touching tiles
// overlap. So a placed tile claims its ring of neighbours too -- every
// drawing ends at least two tiles from the next -- and the later box slides
// to the nearest free tile, nearest first, deterministically: an export must
// not shuffle under its user's feet between two clicks.
function quantizeTiles(nodes: LayoutNode[]): Map<string, { x: number; y: number }> {
  const taken = new Set<string>();
  const tiles = new Map<string, { x: number; y: number }>();

  // Candidate offsets around the rounded tile, by growing distance. Radius 6
  // is room for a whole huddle of boxes ELK packed tightly.
  const offsets: { x: number; y: number }[] = [{ x: 0, y: 0 }];
  for (let r = 1; r <= 6; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dy = -r; dy <= r; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) === r) offsets.push({ x: dx, y: dy });
      }
    }
  }

  for (const node of nodes) {
    if (node.kind === "boundary") continue;
    const exact = continuousTile(node.x, node.y);
    const base = { x: Math.round(exact.x), y: Math.round(exact.y) };
    let placed = base;
    for (const o of offsets) {
      const candidate = { x: base.x + o.x, y: base.y + o.y };
      if (!taken.has(`${candidate.x},${candidate.y}`)) {
        placed = candidate;
        break;
      }
    }
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        taken.add(`${placed.x + dx},${placed.y + dy}`);
      }
    }
    tiles.set(node.id, placed);
  }
  return tiles;
}

// A boundary as a tile rectangle: the four corners of the ELK box, carried to
// the tile plane, then the axis-aligned tile box that contains them. The
// mapping rotates, so the plane rectangle becomes a diamond and the enclosing
// tile box is larger than its children strictly need -- which is the right
// side to err on: a boundary that CUTS one of its members tells a falsehood.
function boundaryRectangle(node: LayoutNode): { from: { x: number; y: number }; to: { x: number; y: number } } {
  const corners = [
    continuousTile(node.x - node.width / 2, node.y - node.height / 2),
    continuousTile(node.x + node.width / 2, node.y - node.height / 2),
    continuousTile(node.x - node.width / 2, node.y + node.height / 2),
    continuousTile(node.x + node.width / 2, node.y + node.height / 2),
  ];
  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  return {
    from: { x: Math.floor(Math.min(...xs)), y: Math.floor(Math.min(...ys)) },
    to: { x: Math.ceil(Math.max(...xs)), y: Math.ceil(Math.max(...ys)) },
  };
}

// The connector's label: the same words as the diagrams -- the flow's label,
// then what subLabel adds when the technology is not already the label.
function connectorLabel(edge: LayoutEdge): string | undefined {
  const sous = subLabel(edge.label, edge.technology);
  const text = [edge.label, sous].filter(Boolean).join(" — ");
  return text || undefined;
}

export function modelToFossflow(
  boards: PlacedBoard[],
  technologyColour: (technology: string) => string,
  title: string
): FossflowModel {
  // One item per actor across ALL boards: FossFLOW separates what a thing IS
  // (an item) from where a view PUTS it, exactly like the workbook separates
  // the catalogue from the boards.
  const nodesByLabel = new Map<string, LayoutNode>();
  for (const board of boards) {
    for (const node of board.layout.nodes) {
      if (node.kind === "boundary") continue;
      if (!nodesByLabel.has(node.id)) nodesByLabel.set(node.id, node);
    }
  }
  const names = [...nodesByLabel.keys()];
  const itemIds = identifiers(names);

  const usedIcons = new Set<string>();
  const items: FossflowItem[] = names.map((name) => {
    const node = nodesByLabel.get(name)!;
    const icon = iconForType(node.technical ? "middleware" : node.subtitle, node.external === true);
    usedIcons.add(icon);
    return {
      id: itemIds.get(name)!,
      name: node.label,
      ...(node.subtitle ? { subtitle: node.subtitle } : {}),
      // FossFLOW shows the description in the item's expandable label; the
      // type rides along there because the board itself has no line for it.
      ...(node.subtitle || node.description
        ? { description: [node.subtitle ? `[${node.subtitle}]` : "", node.description ?? ""].filter(Boolean).join(" — ") }
        : {}),
      icon,
    };
  });

  // One colour entry per technology seen on any edge. FossFLOW connectors
  // point at a colour by id, so the palette is part of the document -- the
  // very same palette as the diagrams, or the JSON would tell another story.
  const technologies = [...new Set(boards.flatMap((b) => b.layout.edges.map((e) => e.technology)))];
  const colourIds = identifiers(technologies.map((t) => t || "flow"));
  const colors: FossflowColor[] = technologies.map((t) => ({
    id: colourIds.get(t || "flow")!,
    // The functional reading empties `technology`: those lines keep the
    // diagrams' neutral ink rather than borrowing a technology's colour.
    value: t ? technologyColour(t) : "#5b6472",
  }));

  const views: FossflowView[] = boards.map((board, index) => {
    const tiles = quantizeTiles(board.layout.nodes);
    const rectangles: FossflowRectangle[] = [];
    const textBoxes: FossflowTextBox[] = [];
    for (const node of board.layout.nodes) {
      if (node.kind !== "boundary") continue;
      const rect = boundaryRectangle(node);
      // The anti-overlap slide can push a member off the geometric rectangle:
      // the frame follows its members, never the reverse -- a boundary that
      // cuts one of them tells a falsehood.
      for (const member of board.layout.nodes) {
        if (member.parent !== node.id) continue;
        const tile = tiles.get(member.id);
        if (!tile) continue;
        rect.from = { x: Math.min(rect.from.x, tile.x - 1), y: Math.min(rect.from.y, tile.y - 1) };
        rect.to = { x: Math.max(rect.to.x, tile.x + 1), y: Math.max(rect.to.y, tile.y + 1) };
      }
      rectangles.push({ id: `zone${rectangles.length + 1}`, ...rect });
      // A FossFLOW rectangle has no label of its own: the boundary's name goes
      // in a text box at its top corner, the one the projection puts highest.
      textBoxes.push({
        id: `zonelabel${textBoxes.length + 1}`,
        tile: { x: rect.to.x, y: rect.to.y },
        content: node.label,
      });
    }

    const connectors: FossflowConnector[] = board.layout.edges.map((edge, i) => ({
      id: `c${i + 1}`,
      ...(connectorLabel(edge) ? { description: connectorLabel(edge) } : {}),
      color: colourIds.get(edge.technology || "flow")!,
      ...(edge.attenuated ? { style: "DASHED" as const } : {}),
      ...(edge.pulled === true ? { startArrow: true } : {}),
      anchors: [
        { id: `c${i + 1}a`, ref: { item: itemIds.get(edge.from)! } },
        { id: `c${i + 1}b`, ref: { item: itemIds.get(edge.to)! } },
      ],
    }));

    return {
      id: `view${index + 1}`,
      name: board.title,
      items: board.layout.nodes
        .filter((n) => n.kind !== "boundary")
        .map((n) => ({ id: itemIds.get(n.id)!, tile: tiles.get(n.id)! })),
      connectors,
      rectangles,
      textBoxes,
    };
  });

  return {
    version: "1.0",
    title,
    icons: ISO_ICONS.filter((icon) => usedIcons.has(icon.id)).map((icon) => ({ ...icon, isIsometric: true })),
    colors,
    items,
    views,
  };
}

export function fossflowJson(model: FossflowModel): string {
  return JSON.stringify(model, null, 2) + "\n";
}
