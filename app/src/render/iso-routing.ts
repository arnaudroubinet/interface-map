import type { FossflowView } from "../export/fossflow-json";
import { endGapPx, TILE_STEP_PX } from "./iso-projection";

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
const TURN_COST = 1;
// Crossing a route already drawn costs more than a turn: a route accepts a
// bend to avoid cutting another, never a cut to avoid a bend. And two
// L-shaped paths of equal length -- the everyday case -- are no longer
// decided by the order of exploration but by what each one cuts through.
// (Crossing minimisation is what the empirical graph-drawing literature puts
// first; this is the routing's share of it, the placement has its own.)
const CROSSING_COST = 3;
// Running down a corridor another trunk already uses is allowed -- the lanes
// keep them apart -- but a free corridor of the same length is preferred.
const SHARED_CORRIDOR_COST = 0.25;

type Axis = "row" | "col";
// A move along x keeps y fixed: it runs in a ROW. The other two run in a column.
const axisOfMove = (m: number): Axis => (m < 2 ? "row" : "col");

// The path from a to b on the grid, around the blocked tiles. Plain Dijkstra
// over (tile, incoming direction) -- the boards are a few dozen tiles across,
// nothing here needs a cleverer engine. Falls back to the direct elbow when
// the target is walled in: a drawn-through line beats a flow that vanishes.
// `price` is what routing sequentially already knows about the tiles other
// routes took: `along` for stepping INTO a tile along an axis (a corridor
// shared), `through` for passing STRAIGHT through a tile along an axis --
// the only way a route can actually cut another.
export interface StepPrice {
  along: (tile: TilePoint, axis: Axis) => number;
  through: (tile: TilePoint, axis: Axis) => number;
}
const FREE: StepPrice = { along: () => 0, through: () => 0 };

function gridPath(
  a: TilePoint,
  b: TilePoint,
  blocked: Set<string>,
  bounds: { x0: number; x1: number; y0: number; y1: number },
  price: StepPrice = FREE
): TilePoint[] {
  if (a.x === b.x && a.y === b.y) return [a];

  interface State {
    at: TilePoint;
    dir: number;
    cost: number;
    from: string | null;
  }
  const stateKey = (p: TilePoint, dir: number) => `${p.x},${p.y},${dir}`;
  const best = new Map<string, State>();
  const start: State = { at: a, dir: -1, cost: 0, from: null };
  best.set(stateKey(a, -1), start);
  // A binary heap keyed on (cost, insertion order): the cheapest first, and
  // on a tie the earliest inserted -- the same order a stable sort gave, at a
  // logarithm of the cost instead of a sort of the whole queue per pop. The
  // placement search below runs this thousands of times per click.
  // A*: the heap is ordered on cost so far PLUS the grid distance still to
  // go -- admissible, since a step costs at least one and every surcharge is
  // non-negative -- which spares exploring away from the goal. Same result
  // as plain Dijkstra, found sooner.
  const remaining = (p: TilePoint) => Math.abs(p.x - b.x) + Math.abs(p.y - b.y);
  const heap: { state: State; seq: number; f: number }[] = [];
  let seq = 0;
  const before = (i: number, j: number) => heap[i].f < heap[j].f || (heap[i].f === heap[j].f && heap[i].seq < heap[j].seq);
  const push = (state: State) => {
    heap.push({ state, seq: seq++, f: state.cost + remaining(state.at) });
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (!before(i, parent)) break;
      [heap[i], heap[parent]] = [heap[parent], heap[i]];
      i = parent;
    }
  };
  const pop = (): State => {
    const top = heap[0].state;
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && before(l, m)) m = l;
        if (r < heap.length && before(r, m)) m = r;
        if (m === i) break;
        [heap[i], heap[m]] = [heap[m], heap[i]];
        i = m;
      }
    }
    return top;
  };
  push(start);

  let arrival: State | null = null;
  while (heap.length > 0) {
    const current = pop();
    // A stale entry: a cheaper way to this state was found after it was queued.
    if (best.get(stateKey(current.at, current.dir)) !== current) continue;
    if (current.at.x === b.x && current.at.y === b.y) {
      arrival = current;
      break;
    }
    for (let m = 0; m < MOVES.length; m++) {
      const next = { x: current.at.x + MOVES[m].x, y: current.at.y + MOVES[m].y };
      if (next.x < bounds.x0 || next.x > bounds.x1 || next.y < bounds.y0 || next.y > bounds.y1) continue;
      const isGoal = next.x === b.x && next.y === b.y;
      if (!isGoal && blocked.has(key(next))) continue;
      // Passing straight through the tile we stand on -- same axis in and
      // out -- is when we may cut a route that passes straight through it
      // the other way. Turning there never cuts: the other route's arms and
      // ours leave side by side, in their lanes.
      const straight = current.dir !== -1 && axisOfMove(current.dir) === axisOfMove(m);
      const cost =
        current.cost +
        1 +
        (current.dir !== -1 && current.dir !== m ? TURN_COST : 0) +
        (isGoal ? 0 : price.along(next, axisOfMove(m))) +
        (straight ? price.through(current.at, axisOfMove(m)) : 0);
      const k = stateKey(next, m);
      const seen = best.get(k);
      if (seen && seen.cost <= cost) continue;
      const state = { at: next, dir: m, cost, from: stateKey(current.at, current.dir) };
      best.set(k, state);
      push(state);
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

// Do two polyline segments cut each other? Proper crossings only: two lines
// meeting at an endpoint, or running on top of each other (a trunk), do not.
function segmentsCross(a1: TilePoint, a2: TilePoint, b1: TilePoint, b2: TilePoint): boolean {
  const orient = (p: TilePoint, q: TilePoint, r: TilePoint) =>
    Math.sign((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x));
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  return o1 !== o2 && o3 !== o4 && o1 !== 0 && o2 !== 0 && o3 !== 0 && o4 !== 0;
}

// The number of times the drawn routes cut each other -- the EXACT count on
// the polylines as they will be drawn, lanes included, in tile space (the
// projection is linear, so the count is the screen's). This is the objective
// everything below minimises; no proxy stands in for it.
// A route's two end segments hide under the drawings they join: the painter
// trims them (iso-projection.ts says by how much, per side), and whatever
// happens inside the trimmed part is never seen -- and must not be counted.
// Two routes fanning into one hub from neighbouring lanes meet there; on the
// board they end before they meet.
const trimmedEnds = (points: TilePoint[]): TilePoint[] => {
  if (points.length < 2) return points;
  const pull = (from: TilePoint, to: TilePoint, gapTiles: number) => {
    const d = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);
    if (d <= gapTiles) return { ...to };
    return { x: from.x + ((to.x - from.x) * gapTiles) / d, y: from.y + ((to.y - from.y) * gapTiles) / d };
  };
  const out = points.map((p) => ({ ...p }));
  out[0] = pull(points[0], points[1], endGapPx(points[0], points[1]) / TILE_STEP_PX);
  out[out.length - 1] = pull(
    points[points.length - 1],
    points[points.length - 2],
    endGapPx(points[points.length - 1], points[points.length - 2]) / TILE_STEP_PX
  );
  return out;
};

export function crossingsOf(routes: Map<string, ConnectorRoute>): number {
  const all = [...routes.values()].map((r) => trimmedEnds(r.points));
  let n = 0;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];
      for (let s = 1; s < a.length; s++) {
        for (let t = 1; t < b.length; t++) {
          if (segmentsCross(a[s - 1], a[s], b[t - 1], b[t])) n++;
        }
      }
    }
  }
  return n;
}

// The connectors whose drawn route cuts another's: where a placement search
// should look. Swapping two actors that no cut involves changes nothing.
export function crossingPairs(routes: Map<string, ConnectorRoute>): [string, string][] {
  const entries = [...routes.entries()].map(([id, r]) => [id, trimmedEnds(r.points)] as const);
  const pairs: [string, string][] = [];
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const [ida, a] = entries[i];
      const [idb, b] = entries[j];
      let cut = false;
      for (let s = 1; s < a.length && !cut; s++) {
        for (let t = 1; t < b.length && !cut; t++) if (segmentsCross(a[s - 1], a[s], b[t - 1], b[t])) cut = true;
      }
      if (cut) pairs.push([ida, idb]);
    }
  }
  return pairs;
}

export function routesInCrossings(routes: Map<string, ConnectorRoute>): Set<string> {
  return new Set(crossingPairs(routes).flat());
}

const pathLength = (path: TilePoint[]): number => {
  let l = 0;
  for (let i = 1; i < path.length; i++) l += Math.abs(path[i].x - path[i - 1].x) + Math.abs(path[i].y - path[i - 1].y);
  return l;
};

// How many passes the negotiation and the lane search may take before they
// are declared converged. Both converge far sooner on every board tried; the
// bound is a promise about the click, not about the result.
const MAX_PASSES = 8;
// Up to this many trunks in a corridor, every ordering is tried; beyond it,
// the endpoint heuristic stands -- 5040 orderings of a seven-trunk corridor
// is where exhaustive stops being free.
const EXHAUSTIVE_LANES_UP_TO = 6;

interface CorridorUse {
  segments: Segment[];
  crossSum: number;
  crossCount: number;
}

// The routes as drawn from a set of tile paths: corridors, lanes, heads.
// A pure function of the paths (and of an optional lane ordering per
// corridor), so the search above it can evaluate any set of paths exactly.
function assemble(
  view: FossflowView,
  pathById: Map<string, TilePoint[]>,
  laneOrder: Map<string, string[]> = new Map()
): { routes: Map<string, ConnectorRoute>; corridors: Map<string, string[]> } {
  const routed: { id: string; trunk: string; turns: TilePoint[]; segments: Segment[] }[] = [];
  const corridors = new Map<string, Map<string, CorridorUse>>();
  for (const connector of view.connectors) {
    const path = pathById.get(connector.id);
    if (!path) continue;
    const trunk = trunkOf(connector);
    const turns = vertices(path);
    const from = turns[0];
    const to = turns[turns.length - 1];
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

  // Lanes: one per trunk in a shared corridor, in the order given -- the
  // endpoint heuristic by default (a route takes the lane on the side its
  // ends already are), or the order the exhaustive search settled on.
  const orders = new Map<string, string[]>();
  for (const [corridorKey, users] of corridors) {
    if (users.size < 2) continue;
    const order =
      laneOrder.get(corridorKey) ??
      [...users.entries()]
        .sort((a, b) => a[1].crossSum / a[1].crossCount - b[1].crossSum / b[1].crossCount || a[0].localeCompare(b[0]))
        .map(([trunk]) => trunk);
    orders.set(corridorKey, order);
    order.forEach((trunk, i) => {
      const offset = (i / (order.length - 1) - 0.5) * CORRIDOR_SPREAD;
      for (const segment of users.get(trunk)!.segments) segment.offset = offset;
    });
  }

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
  return { routes, corridors: orders };
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, i) => permutations([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]));
}

// Every connector's route, lanes assigned, crossings minimised. Where the
// grid allows it, the routes below do not cut each other; where they must,
// they cut as little as a search over the whole board can find -- the
// problem is NP-hard in general, so "as little as can be found" is a fixed
// point of two exhaustive-where-affordable searches, not a proof. The
// result is deterministic: same board, same drawing.
export interface RoutingOptions {
  // First pass only: no negotiation, no lane search. What a search OVER the
  // placement uses to judge a candidate placement in a few milliseconds --
  // the full search runs once, on the placement finally kept.
  quick?: boolean;
}

export function routeConnectors(view: FossflowView, options: RoutingOptions = {}): Map<string, ConnectorRoute> {
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

  // Per tile: the trunks running through it along each axis, and whether one
  // passes STRAIGHT through along that axis. A corner is not a crossing: a
  // route that turns where another turns, or where another runs, leaves side
  // by side with it in its own lane. Only two routes passing straight through
  // one tile on different axes cut each other; a route passing straight
  // through another's corner is priced half a cut -- that corner's
  // perpendicular arm leaves from its own lane, on one side of ours or the
  // other. This pricing GUIDES the search for one route; the exact count on
  // the drawn polylines decides what is kept.
  interface TileUse {
    row: Set<string>;
    col: Set<string>;
    straightRow: boolean;
    straightCol: boolean;
  }
  const taken = new Map<string, TileUse>();
  const priceFor = (trunk: string): StepPrice => ({
    along: (tile, axis) => {
      const use = taken.get(key(tile));
      if (!use) return 0;
      const along = axis === "row" ? use.row : use.col;
      return along.size > 0 && !along.has(trunk) ? SHARED_CORRIDOR_COST : 0;
    },
    through: (tile, axis) => {
      const use = taken.get(key(tile));
      if (!use) return 0;
      const cutAcross = axis === "row" ? use.straightCol : use.straightRow;
      if (cutAcross) return CROSSING_COST;
      const turnsHere = use.row.size > 0 && use.col.size > 0;
      return turnsHere ? CROSSING_COST / 2 : 0;
    },
  });
  const record = (path: TilePoint[], trunk: string) => {
    const claim = (tile: TilePoint): TileUse => {
      const use = taken.get(key(tile)) ?? { row: new Set<string>(), col: new Set<string>(), straightRow: false, straightCol: false };
      taken.set(key(tile), use);
      return use;
    };
    for (let i = 1; i < path.length; i++) {
      const axis: Axis = path[i].y === path[i - 1].y ? "row" : "col";
      claim(path[i - 1])[axis].add(trunk);
      claim(path[i])[axis].add(trunk);
    }
    for (let i = 1; i < path.length - 1; i++) {
      const axisIn: Axis = path[i].y === path[i - 1].y ? "row" : "col";
      const axisOut: Axis = path[i + 1].y === path[i].y ? "row" : "col";
      if (axisIn !== axisOut) continue;
      const use = claim(path[i]);
      if (axisIn === "row") use.straightRow = true;
      else use.straightCol = true;
    }
  };

  const toRoute = view.connectors
    .map((connector, index) => {
      const ends = connector.anchors
        .map((a) => (a.ref.item ? tileById.get(a.ref.item) : a.ref.tile))
        .filter((t): t is TilePoint => t !== undefined);
      return { connector, index, ends, trunk: trunkOf(connector) };
    })
    .filter((c) => c.ends.length >= 2)
    .sort((a, b) => {
      const length = (c: { ends: TilePoint[] }) =>
        Math.abs(c.ends[0].x - c.ends[c.ends.length - 1].x) + Math.abs(c.ends[0].y - c.ends[c.ends.length - 1].y);
      return length(a) - length(b) || a.index - b.index;
    });
  const routeOne = (c: (typeof toRoute)[number]) =>
    gridPath(c.ends[0], c.ends[c.ends.length - 1], blockedFor(c.ends[0], c.ends[c.ends.length - 1]), bounds, priceFor(c.trunk));

  // -- First pass: sequential, short first ----------------------------------
  // A short flow has little choice, a long one has plenty and can go around.
  const pathById = new Map<string, TilePoint[]>();
  for (const c of toRoute) {
    const path = routeOne(c);
    record(path, c.trunk);
    pathById.set(c.connector.id, path);
  }

  // -- Second pass: negotiation -----------------------------------------------
  // The first pass is biased by its order: an early route never saw the
  // later ones. So every route is ripped up and found again against ALL the
  // others, and the new path is kept only if the exact number of cuts on the
  // drawn board falls -- or holds while the path shortens. Until a full pass
  // changes nothing: a fixed point where no single route can do better.
  const rebuildTaken = (except: string) => {
    taken.clear();
    for (const c of toRoute) if (c.connector.id !== except) record(pathById.get(c.connector.id)!, c.trunk);
  };
  if (options.quick) return assemble(view, pathById).routes;

  let score = crossingsOf(assemble(view, pathById).routes);
  for (let pass = 0; pass < MAX_PASSES && score > 0; pass++) {
    let improved = false;
    for (const c of toRoute) {
      const id = c.connector.id;
      const before = pathById.get(id)!;
      rebuildTaken(id);
      const after = routeOne(c);
      if (after.length === before.length && after.every((p, i) => p.x === before[i].x && p.y === before[i].y)) continue;
      pathById.set(id, after);
      const candidate = crossingsOf(assemble(view, pathById).routes);
      if (candidate < score || (candidate === score && pathLength(after) < pathLength(before))) {
        score = candidate;
        improved = true;
      } else {
        pathById.set(id, before);
      }
    }
    if (!improved) break;
  }

  // -- Third pass: the lanes, exhaustively -----------------------------------
  // Inside a shared corridor the ORDER of the lanes decides whether two
  // routes swap sides -- and cut -- on their way to different exits. Every
  // ordering of every small corridor is tried, one corridor at a time,
  // against the exact count, until a full round changes nothing.
  let { routes, corridors } = assemble(view, pathById);
  const laneOrder = new Map(corridors);
  let laneScore = crossingsOf(routes);
  for (let round = 0; round < MAX_PASSES && laneScore > 0; round++) {
    let improved = false;
    for (const [corridorKey, order] of [...laneOrder.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (order.length > EXHAUSTIVE_LANES_UP_TO) continue;
      let bestOrder = order;
      for (const candidate of permutations(order)) {
        laneOrder.set(corridorKey, candidate);
        const n = crossingsOf(assemble(view, pathById, laneOrder).routes);
        if (n < laneScore) {
          laneScore = n;
          bestOrder = candidate;
          improved = true;
        }
      }
      laneOrder.set(corridorKey, bestOrder);
    }
    if (!improved) break;
  }
  return assemble(view, pathById, laneOrder).routes;
}
