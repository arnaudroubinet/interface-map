import type { FossflowView } from "../export/fossflow-json";

// Where a connector RUNS on the tile grid. The first painter drew one elbow
// per connector and hoped: every flow sharing a grid row or column ran exactly
// on top of its neighbours, and a long board became one thick line telling
// nothing. Two devices fix that, in tile space so everything stays aligned
// with the diamond grid:
//
//  - each route is found on the grid itself, around the occupied tiles, the
//    way fossflow routes its own connectors -- fewest steps, then fewest
//    turns, deterministically;
//  - a grid row or column used by several routes becomes a CORRIDOR: each
//    route gets a lane of its own inside it, offset by a fraction of a tile,
//    like the flat boards fan their edges out.

export interface TilePoint {
  x: number;
  y: number;
}

// How far apart the lanes of one corridor spread, in tiles. Capped under a
// half-tile each side: a lane must stay readable as "this corridor", not
// wander into the next one.
const CORRIDOR_SPREAD = 0.7;

const key = (p: TilePoint) => `${p.x},${p.y}`;

// The four moves, in a FIXED order: the tie-break between two equal paths is
// this order, and a route must not change from one render to the next.
const MOVES: TilePoint[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

// Fewest steps first, fewest turns second: the cost of a turn stays under the
// cost of a step, so the path never grows longer just to stay straight.
const TURN_COST = 0.4;

// The path from a to b on the grid, around the blocked tiles. Plain Dijkstra
// over (tile, incoming direction) -- the boards are a few dozen tiles across,
// nothing here needs a cleverer engine. Falls back to the direct elbow when
// the target is walled in: a drawn-through line beats a flow that vanishes.
function gridPath(a: TilePoint, b: TilePoint, blocked: Set<string>, bounds: { x0: number; x1: number; y0: number; y1: number }): TilePoint[] {
  if (a.x === b.x && a.y === b.y) return [a];

  interface State {
    at: TilePoint;
    dir: number;
    cost: number;
    from: string | null;
  }
  const stateKey = (p: TilePoint, dir: number) => `${p.x},${p.y},${dir}`;
  const best = new Map<string, State>();
  const queue: State[] = [{ at: a, dir: -1, cost: 0, from: null }];
  best.set(stateKey(a, -1), queue[0]);

  let arrival: State | null = null;
  while (queue.length > 0) {
    // The cheapest first; on a tie, the earliest inserted -- sort is stable.
    queue.sort((s, t) => s.cost - t.cost);
    const current = queue.shift()!;
    if (current.at.x === b.x && current.at.y === b.y) {
      arrival = current;
      break;
    }
    for (let m = 0; m < MOVES.length; m++) {
      const next = { x: current.at.x + MOVES[m].x, y: current.at.y + MOVES[m].y };
      if (next.x < bounds.x0 || next.x > bounds.x1 || next.y < bounds.y0 || next.y > bounds.y1) continue;
      const isGoal = next.x === b.x && next.y === b.y;
      if (!isGoal && blocked.has(key(next))) continue;
      const cost = current.cost + 1 + (current.dir !== -1 && current.dir !== m ? TURN_COST : 0);
      const k = stateKey(next, m);
      const seen = best.get(k);
      if (seen && seen.cost <= cost) continue;
      const state = { at: next, dir: m, cost, from: stateKey(current.at, current.dir) };
      best.set(k, state);
      queue.push(state);
    }
  }

  if (!arrival) return a.x === b.x || a.y === b.y ? [a, b] : [a, { x: b.x, y: a.y }, b];

  const path: TilePoint[] = [];
  let walk: State | null = arrival;
  while (walk) {
    path.push(walk.at);
    walk = walk.from ? best.get(walk.from) ?? null : null;
  }
  return path.reverse();
}

// The turns only: a run of tiles in one direction is one segment.
function vertices(path: TilePoint[]): TilePoint[] {
  const kept = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const before = path[i - 1];
    const after = path[i + 1];
    if ((before.x === path[i].x) !== (path[i].x === after.x)) kept.push(path[i]);
  }
  if (path.length > 1) kept.push(path[path.length - 1]);
  return kept;
}

interface Segment {
  // "row": ty is fixed and the route runs along tile-x. "col": the other way.
  axis: "row" | "col";
  index: number;
  // Filled by the lane assignment: how far this route sits from the
  // corridor's centre line, in tiles.
  offset: number;
}

export interface ConnectorRoute {
  points: TilePoint[];
  // Whether THIS connector draws the head where it arrives. Flows of one
  // technology into one target form a TRUNK -- they share their lanes, so
  // where their paths coincide they draw as one line, and that line carries
  // one head, not a stack of them. Same confluence the flat boards make in
  // mergeByTechnologyToTarget, translated to the grid.
  drawsHead: boolean;
}

// A connector's trunk: what it arrives at, in which colour, in which stroke.
// A pulled flow (head at the START) never merges -- its head is precisely
// where the trunk's is not, the same exception the flat boards make.
function trunkOf(connector: FossflowView["connectors"][number]): string {
  if (connector.startArrow) return `solo:${connector.id}`;
  const arrival = connector.anchors[connector.anchors.length - 1]?.ref;
  const at = arrival?.item ?? (arrival?.tile ? key(arrival.tile) : connector.id);
  return `${at}|${connector.color ?? ""}|${connector.style ?? "SOLID"}`;
}

// Every connector's route, lanes assigned. The map's iteration order is the
// view's connector order: same input, same lanes, same drawing.
export function routeConnectors(view: FossflowView): Map<string, ConnectorRoute> {
  const tileById = new Map(view.items.map((i) => [i.id, i.tile]));

  // What a drawing COVERS, not merely the tile it stands on: its icon is
  // wider than a tile and rises above it, its name hangs below. On screen
  // that footprint is the four orthogonal neighbours (the icon's flanks and
  // the name's line) plus the tile straight above it (the icon's body). A
  // route through any of them ran visibly under a drawing that was not its
  // own. The endpoints' own footprints stay open: that is how a route
  // enters and leaves.
  const footprintOf = (t: TilePoint): TilePoint[] => [
    t,
    { x: t.x + 1, y: t.y },
    { x: t.x - 1, y: t.y },
    { x: t.x, y: t.y + 1 },
    { x: t.x, y: t.y - 1 },
    { x: t.x + 1, y: t.y + 1 },
  ];
  const covered = new Set(view.items.flatMap((i) => footprintOf(i.tile).map(key)));
  const blockedFor = (from: TilePoint, to: TilePoint): Set<string> => {
    const open = new Set([...footprintOf(from), ...footprintOf(to)].map(key));
    return new Set([...covered].filter((k) => !open.has(k)));
  };

  const tiles = view.items.map((i) => i.tile);
  const bounds = {
    x0: Math.min(0, ...tiles.map((t) => t.x)) - 3,
    x1: Math.max(0, ...tiles.map((t) => t.x)) + 3,
    y0: Math.min(0, ...tiles.map((t) => t.y)) - 3,
    y1: Math.max(0, ...tiles.map((t) => t.y)) + 3,
  };

  // First pass: find every route and cut it into segments. A corridor's
  // ledger is kept per TRUNK, not per connector: the members of a trunk will
  // take one and the same lane, which is what welds them into one line
  // wherever their paths coincide.
  interface CorridorUse {
    segments: Segment[];
    // Where this trunk's routes come from and go, on the corridor's cross
    // axis: the lane ordering key.
    crossSum: number;
    crossCount: number;
  }
  const routed: { id: string; trunk: string; turns: TilePoint[]; segments: Segment[] }[] = [];
  const corridors = new Map<string, Map<string, CorridorUse>>();
  for (const connector of view.connectors) {
    const ends = connector.anchors
      .map((a) => (a.ref.item ? tileById.get(a.ref.item) : a.ref.tile))
      .filter((t): t is TilePoint => t !== undefined);
    if (ends.length < 2) continue;
    const trunk = trunkOf(connector);
    const from = ends[0];
    const to = ends[ends.length - 1];
    const turns = vertices(gridPath(from, to, blockedFor(from, to), bounds));
    const segments: Segment[] = [];
    for (let i = 0; i + 1 < turns.length; i++) {
      const segment: Segment =
        turns[i].y === turns[i + 1].y
          ? { axis: "row", index: turns[i].y, offset: 0 }
          : { axis: "col", index: turns[i].x, offset: 0 };
      segments.push(segment);
      const corridorKey = `${segment.axis}${segment.index}`;
      const users = corridors.get(corridorKey) ?? new Map<string, CorridorUse>();
      const use = users.get(trunk) ?? { segments: [], crossSum: 0, crossCount: 0 };
      use.segments.push(segment);
      const cross = segment.axis === "row" ? [from.y, to.y] : [from.x, to.x];
      use.crossSum += cross[0] + cross[1];
      use.crossCount += 2;
      users.set(trunk, use);
      corridors.set(corridorKey, users);
    }
    routed.push({ id: connector.id, trunk, turns, segments });
  }

  // Second pass: a corridor used by one trunk keeps its centre line; shared,
  // it deals one lane per trunk. The lanes are ORDERED, not just distinct:
  // a route gets the lane on the side its endpoints already are -- two
  // routes that would otherwise swap sides inside the corridor, and cross
  // twice for nothing, no longer do. (Crossing minimisation is what the
  // empirical graph-drawing literature puts first; this is its cheapest
  // local form, the track ordering of VLSI channel routing.)
  for (const users of corridors.values()) {
    if (users.size < 2) continue;
    const trunks = [...users.entries()].sort(
      (a, b) => a[1].crossSum / a[1].crossCount - b[1].crossSum / b[1].crossCount || a[0].localeCompare(b[0])
    );
    trunks.forEach(([, use], i) => {
      const offset = (i / (trunks.length - 1) - 0.5) * CORRIDOR_SPREAD;
      for (const segment of use.segments) segment.offset = offset;
    });
  }

  // Third pass: rebuild each polyline from its offset segments. Consecutive
  // segments alternate row/col, so each junction is simply "the column's x,
  // the row's y", offsets included.
  //
  // The head is dealt per (trunk, arrival direction): members of a trunk
  // arriving down the SAME final corridor overlay exactly -- lane shared --
  // and only the first draws the head the overlay carries. A member arriving
  // from another side keeps a head of its own: a bare line end would read as
  // unfinished, not as merged.
  const routes = new Map<string, ConnectorRoute>();
  const headsDealt = new Set<string>();
  for (const { id, trunk, turns, segments } of routed) {
    if (segments.length === 0) continue;
    const fixed = (s: Segment) => s.index + s.offset;
    const first = segments[0];
    const last = segments[segments.length - 1];
    const points: TilePoint[] = [];
    points.push(first.axis === "row" ? { x: turns[0].x, y: fixed(first) } : { x: fixed(first), y: turns[0].y });
    for (let i = 0; i + 1 < segments.length; i++) {
      const row = segments[i].axis === "row" ? segments[i] : segments[i + 1];
      const col = segments[i].axis === "col" ? segments[i] : segments[i + 1];
      points.push({ x: fixed(col), y: fixed(row) });
    }
    const end = turns[turns.length - 1];
    points.push(last.axis === "row" ? { x: end.x, y: fixed(last) } : { x: fixed(last), y: end.y });

    const tip = points[points.length - 1];
    const before = points[points.length - 2];
    const headKey = `${trunk}|${Math.sign(tip.x - before.x)},${Math.sign(tip.y - before.y)}`;
    const drawsHead = !headsDealt.has(headKey);
    headsDealt.add(headKey);
    routes.set(id, { points, drawsHead });
  }
  return routes;
}
