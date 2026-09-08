import type { FossflowView, FossflowViewItem } from "../export/fossflow-json";
import { routeConnectors, crossingsOf } from "./iso-routing";
import { screenDistance } from "./iso-projection";

// Simulated annealing over the WHOLE placement, judged by the routes.
//
// The translation's placement is greedy and its repair pass local: both stop
// at the first placement no single swap improves. The remaining cuts on a
// dense board are the ones no single move undoes -- two moves would, if the
// first were allowed to look worse for a while. That is what annealing buys:
// a seeded random walk over placements, accepting a worse one with a
// probability that cools down, so it climbs out of the greedy's basin before
// settling. The objective is the exact count of drawn cuts (quick routing),
// the wire length a tie-break; the final answer is confirmed by the full
// routing and kept only if it beats the start.
//
// Deterministic: a seeded generator and a budget in ITERATIONS, never in
// seconds, so the same board anneals to the same drawing on any machine.
// Asynchronous: the loop yields to the page every few evaluations, so the
// board already on screen stays alive while its better self is searched.

export interface AnnealOptions {
  iterations?: number;
  seed?: number;
  // How many evaluations between two yields to the event loop.
  yieldEvery?: number;
  // Asked at every yield: true, and the search stops there and hands back
  // the board it was given, marked `stopped`. The reader who moved on to
  // another view must not leave a search running for a board nobody looks at.
  shouldStop?: () => boolean;
}

export interface AnnealResult {
  view: FossflowView;
  crossings: number;
  improved: boolean;
  evaluated: number;
  // The search was stopped before its budget: the view is the one given,
  // untouched, and nothing about it should be remembered.
  stopped?: boolean;
}

// The closest two drawings may stand, in tiles (Chebyshev): the translation's
// DRAWING_SPACING, which a move must respect just as the placement did.
const SPACING = 4;
const DEFAULT_ITERATIONS = 900;
// One cut weighs one; four thousand pixels of extra wire weigh the same. A
// cut is what the eye stumbles on, but a board that spreads to the horizon
// to avoid one is no easier to read -- the first walks, weighted lighter,
// did exactly that.
const WIRE_WEIGHT = 1 / 4000;
const T_START = 1.2;
const T_END = 0.02;

// mulberry32: a tiny seeded generator, enough to make the walk repeatable.
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const chebyshev = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));

// Is this placement one the translation would have allowed? Drawings keep
// their spacing, and a boundary's frame (its members' tile box, one apart)
// holds no stranger -- a zone enclosing an outsider would tell a falsehood.
export function placementIsValid(items: FossflowViewItem[]): boolean {
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (chebyshev(items[i].tile, items[j].tile) < SPACING) return false;
    }
  }
  const zones = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  for (const item of items) {
    if (!item.parent) continue;
    const z = zones.get(item.parent) ?? { x0: item.tile.x, y0: item.tile.y, x1: item.tile.x, y1: item.tile.y };
    z.x0 = Math.min(z.x0, item.tile.x - 1);
    z.y0 = Math.min(z.y0, item.tile.y - 1);
    z.x1 = Math.max(z.x1, item.tile.x + 1);
    z.y1 = Math.max(z.y1, item.tile.y + 1);
    zones.set(item.parent, z);
  }
  for (const item of items) {
    for (const [parent, z] of zones) {
      if (item.parent === parent) continue;
      if (item.tile.x >= z.x0 && item.tile.x <= z.x1 && item.tile.y >= z.y0 && item.tile.y <= z.y1) return false;
    }
  }
  return true;
}

// The frames follow their members, never the reverse: a boundary's
// rectangle is the tile box of its members' seats, one tile of air around,
// and its name sits at the top corner -- exactly as the translation drew it.
export function reframed(view: FossflowView): FossflowView {
  const boxes = new Map<string, { x0: number; y0: number; x1: number; y1: number }>();
  for (const item of view.items) {
    if (!item.parent) continue;
    const b = boxes.get(item.parent) ?? { x0: item.tile.x, y0: item.tile.y, x1: item.tile.x, y1: item.tile.y };
    b.x0 = Math.min(b.x0, item.tile.x - 1);
    b.y0 = Math.min(b.y0, item.tile.y - 1);
    b.x1 = Math.max(b.x1, item.tile.x + 1);
    b.y1 = Math.max(b.y1, item.tile.y + 1);
    boxes.set(item.parent, b);
  }
  return {
    ...view,
    rectangles: view.rectangles.map((r) => {
      const b = r.parent ? boxes.get(r.parent) : undefined;
      return b ? { ...r, from: { x: b.x0, y: b.y0 }, to: { x: b.x1, y: b.y1 } } : r;
    }),
    textBoxes: view.textBoxes.map((t) => {
      const b = t.parent ? boxes.get(t.parent) : undefined;
      return b ? { ...t, tile: { x: b.x1, y: b.y1 } } : t;
    }),
  };
}

export async function annealPlacement(view: FossflowView, options: AnnealOptions = {}): Promise<AnnealResult> {
  const iterations = options.iterations ?? DEFAULT_ITERATIONS;
  const yieldEvery = options.yieldEvery ?? 6;
  const random = seeded(options.seed ?? 1);
  const items = view.items.map((i) => ({ ...i, tile: { ...i.tile } }));
  const working: FossflowView = { ...view, items };

  const links: { a: number; b: number; w: number }[] = [];
  {
    const index = new Map(items.map((i, n) => [i.id, n]));
    const weights = new Map<string, number>();
    for (const c of view.connectors) {
      const a = index.get(c.anchors[0].ref.item ?? "");
      const b = index.get(c.anchors[c.anchors.length - 1].ref.item ?? "");
      if (a === undefined || b === undefined || a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      weights.set(k, (weights.get(k) ?? 0) + 1);
    }
    for (const [k, w] of weights) {
      const [a, b] = k.split("|").map(Number);
      links.push({ a, b, w });
    }
  }
  const wire = () => links.reduce((s, l) => s + l.w * screenDistance(items[l.a].tile, items[l.b].tile), 0);
  let evaluated = 0;
  const energy = () => {
    evaluated++;
    return crossingsOf(routeConnectors(working, { quick: true })) + WIRE_WEIGHT * wire();
  };

  const startFull = crossingsOf(routeConnectors(view));
  const startWire = wire();
  let current = energy();
  let best = current;
  let bestTiles = items.map((i) => ({ ...i.tile }));
  if (startFull === 0 || items.length < 2) {
    return { view: { ...view, items: view.items.map((i) => ({ ...i, tile: { ...i.tile } })) }, crossings: startFull, improved: false, evaluated };
  }

  // The window a relocation may land in: the board's box AS GIVEN, a little
  // air around -- fixed for the whole walk. A window that followed the
  // drawings outward let the board creep to twice its size, one accepted
  // step at a time.
  const box = {
    x0: Math.min(...items.map((i) => i.tile.x)) - 2,
    x1: Math.max(...items.map((i) => i.tile.x)) + 2,
    y0: Math.min(...items.map((i) => i.tile.y)) - 2,
    y1: Math.max(...items.map((i) => i.tile.y)) + 2,
  };

  for (let step = 0; step < iterations; step++) {
    const temperature = T_START * Math.pow(T_END / T_START, step / Math.max(1, iterations - 1));
    // A move: half the time two seats of one parent exchanged, half the time
    // one drawing relocated to a free tile. Either is undone if the walk
    // declines it, or if it breaks the spacing or a wall.
    const i = Math.floor(random() * items.length);
    const undo: { index: number; tile: { x: number; y: number } }[] = [];
    if (random() < 0.5) {
      const peers = items.map((it, n) => n).filter((n) => n !== i && items[n].parent === items[i].parent);
      if (peers.length === 0) continue;
      const j = peers[Math.floor(random() * peers.length)];
      undo.push({ index: i, tile: { ...items[i].tile } }, { index: j, tile: { ...items[j].tile } });
      [items[i].tile, items[j].tile] = [items[j].tile, items[i].tile];
    } else {
      const tile = { x: box.x0 + Math.floor(random() * (box.x1 - box.x0 + 1)), y: box.y0 + Math.floor(random() * (box.y1 - box.y0 + 1)) };
      undo.push({ index: i, tile: { ...items[i].tile } });
      items[i].tile = tile;
    }
    if (!placementIsValid(items)) {
      for (const u of undo) items[u.index].tile = u.tile;
      continue;
    }
    const candidate = energy();
    const delta = candidate - current;
    if (delta <= 0 || random() < Math.exp(-delta / temperature)) {
      current = candidate;
      if (current < best - 1e-9) {
        best = current;
        bestTiles = items.map((it) => ({ ...it.tile }));
      }
    } else {
      for (const u of undo) items[u.index].tile = u.tile;
    }
    if (evaluated % yieldEvery === 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      if (options.shouldStop?.()) {
        return { view: { ...view, items: view.items.map((i) => ({ ...i, tile: { ...i.tile } })) }, crossings: startFull, improved: false, evaluated, stopped: true };
      }
    }
  }

  // The full routing has the last word: the quick one screens, it does not
  // decide. Kept only if it beats the start -- fewer cuts, or as many for
  // less wire -- so this never hands back a worse board than it was given.
  items.forEach((it, n) => (it.tile = bestTiles[n]));
  const finalFull = crossingsOf(routeConnectors(working));
  const finalWire = wire();
  const improved = finalFull < startFull || (finalFull === startFull && finalWire < startWire - 1e-6);
  if (!improved) {
    return { view: { ...view, items: view.items.map((i) => ({ ...i, tile: { ...i.tile } })) }, crossings: startFull, improved: false, evaluated };
  }
  return { view: reframed(working), crossings: finalFull, improved: true, evaluated };
}
