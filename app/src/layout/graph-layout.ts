// elk-api.js is the only API this code needs (construction, promises, types):
// 10 KB, without the algorithm. elk.bundled.js contained the same API PLUS a
// complete copy of the algorithm for its own worker-less fallback -- a second
// copy, on top of the one imported just below for the browser's real Worker.
// By importing the API alone, the algorithm is embedded only once.
//
import ELK from "elkjs/lib/elk-api.js";
// The source of elkjs's GWT worker (the algorithm itself), inlined as a string
// at build time (see the esbuild plugin in esbuild.build.mjs) so that a Blob
// URL can be made of it at runtime without ever loading a separate .js file.
// That same string also serves as the worker-less fallback (see
// nodeFallbackWorker below): it is the only copy of the algorithm in the whole
// deliverable.
import elkWorkerSource from "elkjs/lib/elk-worker.min.js?raw";
import type { GraphNode, GraphEdge } from "../aggregation/core";

export interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge extends GraphEdge {
  points: { x: number; y: number }[];
  // The chip's centre, as placed by the engine. Absent if the edge has no label
  // or if the engine returned nothing.
  labelCentreOf?: { x: number; y: number };
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

// --- The template of a C4 box ----------------------------------------------
//
// FIXED width, height varying with the text: it is this regularity of width
// that makes a board legible, far more than a uniform size.
// The metrics live here because the layout must know the boxes' size before
// positioning them; the rendering imports them, never the other way round.
// draw.io's C4 template, taken from its source (Sidebar-C4.js):
//   geometry 240 x 120, centred text, name at 16px bold, [Type] below it,
//   a blank line, then the description at 11px in #cccccc.
export const NODE_WIDTH = 240;
export const MIN_NODE_HEIGHT = 120;

export const NODE_PAD = 14;
export const NAME_LINE_HEIGHT = 21;
export const TYPE_LINE_HEIGHT = 16;
export const EMPTY_LINE_HEIGHT = 8;
export const DESC_LINE_HEIGHT = 14;

// The usable width for the description, and an approximation of a character's
// width at its rendered size (9.5px).
const USABLE_WIDTH = NODE_WIDTH - 2 * NODE_PAD;
const DESC_CHAR_WIDTH = 5.6;
const MAX_DESC_LINES = 3;

// The name, cut down to what fits in the box. Its width is fixed (NODE_WIDTH)
// and the name was neither measured nor truncated, unlike the description: a
// long name overflowed, covered the neighbouring box and got clipped by the
// drawing's frame. The icon and its gap reserve their room along the way.
//
const NAME_CHAR_WIDTH = 8.2;
const ICON_SLOT = 16 + 9;

export function truncatedName(label: string): string {
  const maxChars = Math.max(4, Math.floor((USABLE_WIDTH - ICON_SLOT) / NAME_CHAR_WIDTH));
  return label.length <= maxChars ? label : `${label.slice(0, maxChars - 1).trimEnd()}…`;
}

// Cuts the description into lines fitting the usable width, without breaking a
// word. Beyond the allowed number of lines, the last one is truncated.
export function descriptionLines(text: string | undefined): string[] {
  if (!text) return [];
  const maxChars = Math.max(1, Math.floor(USABLE_WIDTH / DESC_CHAR_WIDTH));
  const rows: string[] = [];
  let current = "";
  for (const word of text.split(/\s+/)) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) rows.push(current);
    current = word;
  }
  if (current) rows.push(current);
  if (rows.length <= MAX_DESC_LINES) return rows;
  const kept = rows.slice(0, MAX_DESC_LINES);
  kept[MAX_DESC_LINES - 1] = kept[MAX_DESC_LINES - 1].slice(0, maxChars - 1).trimEnd() + "…";
  return kept;
}

// --- The template of a label chip ------------------------------------------
// Declared to ELK, the sizes must be known before layout: it is ELK that
// positions the labels, reserving room for them along the path. The rendering
// imports these metrics to draw exactly the same box.
export const CHIP_HEIGHT = 16;
const SUB_LINE_HEIGHT = 12;

// The average character width at the label's size, in the diagram's font
// stack. Underestimated, the text overflows the room ELK reserved for it --
// this is WHERE the text size is paid for.
const LABEL_CHAR_WIDTH = 6.2;

export function chipWidth(text: string): number {
  return text.length * LABEL_CHAR_WIDTH + 14;
}

// The technology is only restated under the label if the label says something
// other than it: in the aggregated views the label IS the technology.
export function subLabel(label: string | undefined, technology: string): string | undefined {
  if (!label) return undefined;
  const tech = technology.trim();
  return tech && !label.startsWith(tech) ? `[${tech}]` : undefined;
}

// The technology's reminder disc lives in front of the text: its room is
// reserved HERE, before layout. Reserved too short, the label overflows the
// box ELK kept for it.
const DISC_WIDTH = 11;

export function chipSize(label: string | undefined, technology: string): { width: number; height: number } {
  if (!label) return { width: 0, height: 0 };
  const sub = subLabel(label, technology);
  const disc = technology.trim() !== "" ? DISC_WIDTH : 0;
  return {
    width: Math.max(chipWidth(label) + disc, sub ? chipWidth(sub) : 0),
    height: CHIP_HEIGHT + (sub ? SUB_LINE_HEIGHT : 0),
  };
}

export function nodeTextHeight(node: GraphNode): number {
  const rows = descriptionLines(node.description).length;
  return (
    NAME_LINE_HEIGHT +
    (node.subtitle ? TYPE_LINE_HEIGHT : 0) +
    (rows ? EMPTY_LINE_HEIGHT + rows * DESC_LINE_HEIGHT : 0)
  );
}

export function nodeHeight(node: GraphNode): number {
  return Math.max(MIN_NODE_HEIGHT, 2 * NODE_PAD + nodeTextHeight(node));
}

// elk-worker.min.js already knows how to behave as a worker-less fallback: its
// very last function (dHd, plainly visible in the unminified elk-worker.js)
// checks at runtime whether it runs in a real Worker (`self` exists,
// `document` does not -- it then wires self.onmessage directly) or under
// CommonJS (`module.exports` exists -- it drops a fallback Worker class there,
// which runs the algorithm in memory and wires postMessage/onmessage by hand
// instead of using a real thread). This is exactly what elk.bundled.js did for
// Node, except that it embedded its own copy of the algorithm to do so. By
// evaluating here the SAME string already inlined for the real Worker's Blob,
// with a local `module` to trigger the CommonJS branch, Node/jsdom gets the
// same fallback without ever duplicating the algorithm.
//
function nodeFallbackWorker(): new (url?: string) => Worker {
  const module = { exports: {} as { Worker?: new (url?: string) => Worker } };
  new Function("module", "exports", elkWorkerSource)(module, module.exports);
  const FakeWorker = module.exports.Worker;
  if (!FakeWorker) {
    throw new Error("elk-worker.min.js n'a pas exposé de Worker de repli (environnement inattendu).");
  }
  return FakeWorker;
}

// Without a Worker, elkjs computes on the main thread and slices its work with
// setTimeout(fn, 0), the algorithm interrupting itself roughly every 2 s. In a
// hidden tab, Chrome only fires that setTimeout(0) about once a second
// (throttling): each few-millisecond slice of work then waits a full second,
// whatever the graph's size -- an export chaining dozens of layouts becomes
// interminable as soon as the tab goes to the background. A real Worker runs
// on its own thread, out of that throttling's reach.
//
//
// A Worker normally needs a separate .js file, incompatible with the
// single-.html deliverable constraint. elkjs's GWT worker source is therefore
// inlined into the bundle (import above) and turned into a Blob URL at
// runtime: no network request, no side file.
function elkFactory() {
  if (typeof Worker === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    // Node/jsdom (tests): no usable native Worker. The fallback elkjs can build
    // for itself in that case (nodeFallbackWorker) is replayed rather than
    // embedding a second copy of the algorithm to obtain it.
    const FakeWorker = nodeFallbackWorker();
    return new ELK({ workerFactory: (u) => new FakeWorker(u) });
  }
  // elk-api.js (unlike elk.bundled.js's ELKNode) builds a real Worker itself as
  // soon as it is given workerUrl, with no dodgy detection to short-circuit: no
  // need to supply workerFactory here any more.
  const url = URL.createObjectURL(new Blob([elkWorkerSource], { type: "text/javascript" }));
  return new ELK({ workerUrl: url });
}

const elk = elkFactory();

const MARGIN = 20;

// "layered" is the modern implementation of the Sugiyama scheme: ranks,
// crossing minimisation, then routing. A fixed randomSeed guarantees that the
// same workbook gives exactly the same diagram from one export to the next.
const OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.randomSeed": "1",
  "elk.layered.thoroughness": "20",
  // The greedy switch swaps two neighbours when that removes crossings. Its
  // TWO_SIDED default does NOT apply here: the source's documentation says that
  // under hierarchyHandling INCLUDE_CHILDREN it is greedySwitchHierarchical that
  // takes over, and that one defaults to OFF. The threshold, for its part, cuts
  // the heuristic off beyond 40 nodes; 0 forces it.
  "elk.layered.crossingMinimization.greedySwitchHierarchical.type": "TWO_SIDED",
  "elk.layered.crossingMinimization.greedySwitch.activationThreshold": "0",
  // Right-angled links: this is the routing ELK can do while respecting port
  // constraints, and the one that reads best on an architecture diagram. It
  // makes all hand-rolled obstacle avoidance unnecessary.
  "elk.edgeRouting": "ORTHOGONAL",
  // Necessary as soon as one node contains others: without it, an edge crossing
  // a group's boundary is routed any old way. Removing it on the flat views was
  // tried: +25% crossings, +22% area.
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "70",
  "elk.spacing.edgeNode": "20",
  "elk.spacing.edgeEdge": "12",
  // ELK places the edge labels itself and reserves room for them in the layout:
  // the label sits on its line by construction, instead of being laid down
  // afterwards and then pushed away until it lost the link with its arrow.
  "elk.spacing.edgeLabel": "6",
  // A C4 box is 56 to 68 px tall: on so short a side, a hub receiving eleven
  // flows CANNOT spread its ports, and everything concentrates at one point. So
  // the node's size is constrained by its ports: the box grows in height as much
  // as needed to spread them, without ever going below the C4 template
  // (MINIMUM_SIZE).
  "elk.padding": `[top=${MARGIN},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]`,
};

// What was measured to tighten the board -- its aspect ratio reaches 3.6 on
// the detailed view -- and RULED OUT, for want of a trade worth making:
//
//   - elk.aspectRatio ALREADY defaults to 1.6 under layered, and only drives
//     the packing of connected components: on a connected graph it does
//     nothing, which the measurement confirms;
//   - wrapping.strategy at SINGLE_EDGE changes nothing at all; at MULTI_EDGE
//     it brings "platform only" from 3.92 down to 1.61, but by going from 2 to
//     5 crossings for 36% more area. A squarer, more tangled board is a bad
//     trade;
//   - layering.nodePromotion.strategy changed nothing on any of the five views;
//   - compaction.postCompaction.strategy=LEFT won 2 to 6% of area with not one
//     extra crossing... and makes ELK THROW on a multigraph ("Invalid hitboxes
//     for scanline constraint calculation"). A crash is not bought with 4% of
//     area.
//
// The lever that remains is the zoom, delivered separately.

type ReturnSide = "NORTH" | "SOUTH";

interface PortElk {
  id: string;
  width: number;
  height: number;
  layoutOptions: Record<string, string>;
}

// The room a line takes up on a box's face.
const PORT_SIZE = 4;

// The minimum step between two ports, and the air reserved at the top and bottom of the face.
const PORT_STEP = 14;
const PORT_MARGIN = 10;

// The height needed to line up n lines on one face.
function heightForPorts(n: number): number {
  return n <= 0 ? 0 : 2 * PORT_MARGIN + n * PORT_SIZE + (n - 1) * PORT_STEP;
}


// Flows sharing (target, technology, dimming) are merged at render time into a
// single trunk. For that to make geometric sense they must converge: they are
// given a COMMON entry port here, and it is ELK that brings them together.
// Without that sharing, each flow arrives on its own port and the render's
// "confluence" would be nothing but a diagonal slapped over an orthogonal
// routing.
function inputKey(edge: GraphEdge): string {
  return JSON.stringify([edge.to, edge.technology, edge.attenuated]);
}

interface ElkNode {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  ports?: PortElk[];
  children?: ElkNode[];
  layoutOptions?: Record<string, string>;
}

interface ElkSection {
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  bendPoints?: { x: number; y: number }[];
}


interface LabelElk {
  text?: string;
  layoutOptions?: Record<string, string>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface EdgeElk {
  id: string;
  sources: string[];
  targets: string[];
  sourcePort?: string;
  targetPort?: string;
  sections?: ElkSection[];
  labels?: LabelElk[];
  // ELK reparents an edge into the smallest container enclosing both its ends,
  // and then expresses its coordinates in that container's frame.
  container?: string;
}

interface ElkGraph {
  id: string;
  layoutOptions?: Record<string, string>;
  ports?: PortElk[];
  children?: ElkNode[];
  edges?: EdgeElk[];
  width?: number;
  height?: number;
}

// ELK positions by the top-left corner; the rest of the code reasons in box
// centres, which is handier for expressing an anchor (a vector from the
// centre) or a bound (a distance to the centre) than an offset from a corner.
function centreOf(n: ElkNode): { x: number; y: number } {
  return { x: (n.x ?? 0) + n.width / 2, y: (n.y ?? 0) + n.height / 2 };
}

function edgePoints(
  edgeElk: EdgeElk | undefined,
  start: LayoutNode,
  arrival: LayoutNode,
  offset: { x: number; y: number }
): { x: number; y: number }[] {
  const section = edgeElk?.sections?.[0];
  if (!section) {
    // ELK produced no route (a degenerate case, e.g. a loop): the two centres
    // are joined, for want of anything better.
    return [
      { x: start.x, y: start.y },
      { x: arrival.x, y: arrival.y },
    ];
  }
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
    x: p.x + offset.x,
    y: p.y + offset.y,
  }));
}

type Point = { x: number; y: number };

// The number of PAIRS of edges that cross. This is the arbiter between two
// layouts: a crossing is what costs the reader most.
function crossings(traces: Point[][]): number {
  const bounds = traces.map((pts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  });
  const side = (a: Point, b: Point, c: Point) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const cross = (a: Point, b: Point, c: Point, d: Point) =>
    side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);

  let total = 0;
  for (let i = 0; i < traces.length; i++) {
    for (let j = i + 1; j < traces.length; j++) {
      // Without this bounding-box filter, the counting is quadratic in segments
      // and freezes the rendering on the large views.
      const A = bounds[i], B = bounds[j];
      if (A.x1 < B.x0 || B.x1 < A.x0 || A.y1 < B.y0 || B.y1 < A.y0) continue;
      const P = traces[i], Q = traces[j];
      let found = false;
      for (let k = 0; k + 1 < P.length && !found; k++) {
        for (let l = 0; l + 1 < Q.length; l++) {
          if (cross(P[k], P[k + 1], Q[l], Q[l + 1])) { found = true; break; }
        }
      }
      if (found) total++;
    }
  }
  return total;
}

// A boundary's inner margin, and the room reserved at the top for its label
// (set at the top left, C4 convention).
const BOUNDARY_PAD = 24;
const BOUNDARY_HEADER = 22;

// An edge's key, independent of its label: the label carries the "×N" counter,
// which is not the same on the union as on a milestone.
function edgeKey(e: { from: string; to: string; technology: string }): string {
  return JSON.stringify([e.from, e.to, e.technology]);
}

// The union's layout, restricted to what a milestone shows. The positions are
// NOT recomputed: that is the whole point -- a box present at both milestones
// does not move by a pixel. The labels, for their part, come from the
// milestone's view: "HTTP ×2" at v1 is not "HTTP ×3" at v2.
export function restrictLayout(union: LayoutResult, view: { nodes: GraphNode[]; edges: GraphEdge[] }): LayoutResult {
  const liveIds = new Set(view.nodes.map((n) => n.id));
  const liveEdges = new Map(view.edges.map((e) => [edgeKey(e), e]));
  return {
    // The size stays that of the UNION: that is what keeps the frame still from
    // one milestone to the next, and hence the boxes in the same place on screen.
    width: union.width,
    height: union.height,
    nodes: union.nodes.filter((n) => liveIds.has(n.id) || n.kind === "boundary"),
    edges: union.edges
      .filter((e) => liveEdges.has(edgeKey(e)))
      .map((e) => {
        const live = liveEdges.get(edgeKey(e))!;
        return { ...e, label: live.label, count: live.count, names: live.names, attenuated: live.attenuated, change: live.change };
      }),
  };
}

export async function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): Promise<LayoutResult> {
  // Two reading rules, carried by ports set at both ends of the RETURN edges
  // (those whose source is further right than their target):
  //
  //   - one always leaves by the right       -> EAST port on the source side;
  //   - the right being reserved for exits, a flow coming from the right enters
  //     from the top or the bottom          -> NORTH/SOUTH port on the target.
  //
  // ELK can do both: NorthSouthPortPreprocessor inserts a dummy node above or
  // below the target, and InvertedPortProcessor routes around the source node --
  // a return edge being reversed at cycle breaking, its exit port is an
  // "inverted" port. The precondition for both is the same: "nodes have fixed
  // port sides", hence FIXED_SIDE.
  const buildElkNode = (node: GraphNode, returnEdges: Map<number, ReturnSide>): ElkNode => {
      // Only the return edges carry ports. Declaring them on EVERY edge was tried
      // and measured: the group view gains 6 crossings by it, but "By actor" takes
      // 10 more and the detailed view 30, for 14% more area. The other edges
      // therefore follow PortSideProcessor.
      const ports: PortElk[] = [];
      for (const [i, side] of returnEdges) {
        if (edges[i].to === node.id) {
          ports.push({ id: `pe${i}`, width: PORT_SIZE, height: PORT_SIZE, layoutOptions: { "elk.port.side": side } });
        }

      }
      // The height is that of the BUSIEST side, not the sum of the two. Left to
      // ELK (nodeSize.constraints PORTS), it added both faces together: the box
      // doubled in height, two thirds of it empty.
      const nWest = new Set(edges.filter((e) => e.to === node.id).map(inputKey)).size;
      const nEast = edges.filter((e) => e.from === node.id).length;
      const height = Math.max(nodeHeight(node), heightForPorts(Math.max(nWest, nEast)));
      return {
        id: node.id,
        width: NODE_WIDTH,
        height: height,
        // A NODE option: set on the graph, it would not reach down to the nodes. A
        // C4 box is 56 to 68 px tall; a hub receiving eleven flows cannot spread
        // them over so short a face, and everything concentrates at one point.
        //
        ports: ports.length ? ports : undefined,
        layoutOptions: {
          ...(ports.length ? { "elk.portConstraints": "FIXED_SIDE" } : {}),
          "elk.nodeSize.constraints": "MINIMUM_SIZE",
          "elk.nodeSize.minimum": `(${NODE_WIDTH},${height})`,
        },
      };
  };

  const childrenOf = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!node.parent) continue;
    const list = childrenOf.get(node.parent) ?? [];
    list.push(node);
    childrenOf.set(node.parent, list);
  }

  const buildElkGraph = (returnEdges: Map<number, ReturnSide>): ElkGraph => ({
    id: "root",
    layoutOptions: OPTIONS,
    children: nodes
      .filter((node) => !node.parent)
      .map((node) => {
        const children = childrenOf.get(node.id);
        if (!children) return buildElkNode(node, returnEdges);
        // A boundary has no size of its own: ELK sizes it from its children. Only
        // the margin and the label's height are reserved.
        return {
          id: node.id,
          width: 0,
          height: 0,
          layoutOptions: {
            "elk.padding": `[top=${BOUNDARY_HEADER + BOUNDARY_PAD},left=${BOUNDARY_PAD},bottom=${BOUNDARY_PAD},right=${BOUNDARY_PAD}]`,
          },
          children: children.map((child) => buildElkNode(child, returnEdges)),
        } as ElkNode;
      }),
    // One identifier per edge, independent of the (from, to) pair: two flows of
    // different technologies link the same nodes and must stay two distinct
    // edges.
    edges: edges.map((edge, i) => {
      const size = chipSize(edge.label, edge.technology);
      return {
        id: `e${i}`,
        sources: [edge.from],
        // "Extended edge" format: the PORT's identifier goes in the array, in place
        // of the node's. The targetPort field exists only for "primitive edges"
        // (source/target in the singular) and is silently ignored here -- ELK then
        // placed the port in the right spot but attached the edge to the node,
        // hence to its west face.
        targets: [returnEdges.has(i) ? `pe${i}` : edge.to],

        // These options apply TO THE LABEL, not to the graph.
        labels: edge.label
          ? [
              {
                text: edge.label,
                width: size.width,
                height: size.height,
                layoutOptions: {
                  "elk.edgeLabels.placement": "CENTER",
                  // The label is set ON the line, not beside it. The documentation
                  // conditions this on the rendering preventing the line from crossing
                  // it: that is exactly what breakTheLine does, opening a white gap in
                  // its place.
                  "elk.edgeLabels.inline": "true",
                },
              },
            ]
          : undefined,
      };
    }),
  });

  // The types elkjs publishes describe the input/output graph poorly; unknown is
  // used rather than bending our model to theirs.
  const apply = async (returnEdges: Map<number, ReturnSide>) =>
    (await elk.layout(buildElkGraph(returnEdges) as unknown as never)) as unknown as ElkGraph;

  // ELK places a child RELATIVE to its parent: the offsets are accumulated to
  // bring everyone into the same frame as the edges.
  const flatten = (r: ElkGraph) => {
    const m = new Map<string, ElkNode>();
    const walk = (list: ElkNode[] | undefined, dx: number, dy: number) => {
      for (const n of list ?? []) {
        const absolute = { ...n, x: (n.x ?? 0) + dx, y: (n.y ?? 0) + dy };
        m.set(n.id, absolute);
        walk(n.children, absolute.x, absolute.y);
      }
    };
    walk(r.children, 0, 0);
    return m;
  };

  // A PREFERENCE, not a rule: entering from the top or the bottom is better than
  // from the right, but not at the drawing's expense. So it lays out freely,
  // looks at who still enters from the right, lays out again redirecting those,
  // and keeps the second layout only if it does not cost more crossings than it
  // straightens edges. Imposed without that guard, the redirection created 28
  // crossings on its own, on a view that had none.
  //
  const CROSSING_BUDGET_PER_EDGE = 1;

  const freeOnes = await apply(new Map());
  const freeIds = flatten(freeOnes);

  // The face by which an edge reaches its target, in a given layout. Only
  // "EAST" is of interest: it is the face reserved for exits.
  const entersFromEast = (r: ElkGraph, ids: Map<string, ElkNode>, i: number): boolean => {
    const edgeElk = (r.edges ?? []).find((e) => e.id === `e${i}`);
    const end = edgeElk?.sections?.[0]?.endPoint;
    const target = ids.get(edges[i].to);
    if (!end || !target) return false;
    const container = edgeElk?.container ? ids.get(edgeElk.container) : undefined;
    const x = end.x + (container?.x ?? 0);
    const y = end.y + (container?.y ?? 0);
    const left = target.x ?? 0;
    const top = target.y ?? 0;
    if (y < top || y > top + target.height) return false;
    return Math.abs(x - (left + target.width)) < Math.abs(x - left);
  };

  // Each edge's polyline, in the graph's frame: enough to compare two layouts
  // before choosing one.
  const traces = (r: ElkGraph, ids: Map<string, ElkNode>): Point[][] =>
    (r.edges ?? []).map((edgeElk) => {
      const section = edgeElk.sections?.[0];
      if (!section) return [];
      const container = edgeElk.container ? ids.get(edgeElk.container) : undefined;
      const dx = container?.x ?? 0;
      const dy = container?.y ?? 0;
      return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
        x: p.x + dx,
        y: p.y + dy,
      }));
    });

  const returnEdges = new Map<number, ReturnSide>();
  edges.forEach((edge, i) => {
    if (!entersFromEast(freeOnes, freeIds, i)) return;
    const source = freeIds.get(edge.from);
    const target = freeIds.get(edge.to);
    if (!source || !target) return;
    // From the top or the bottom "depending on where it goes": on the side the
    // flow comes from.
    const side = (source.y ?? 0) + source.height / 2 <= (target.y ?? 0) + target.height / 2;
    returnEdges.set(i, side ? "NORTH" : "SOUTH");
  });

  let result = freeOnes;
  let byId = freeIds;


  if (returnEdges.size > 0) {
    const oriented = await apply(returnEdges);
    const orientedIds = flatten(oriented);
    const before = crossings(traces(freeOnes, freeIds));
    const after = crossings(traces(oriented, orientedIds));
    if (after <= before + CROSSING_BUDGET_PER_EDGE * returnEdges.size) {
      result = oriented;
      byId = orientedIds;
    }
  }

  const layoutNodes: LayoutNode[] = nodes.map((node) => {
    const n = byId.get(node.id);
    const width = n?.width ?? NODE_WIDTH;
    const height = n?.height ?? nodeHeight(node);
    const c = n ? centreOf(n) : { x: 0, y: 0 };
    return { ...node, x: c.x, y: c.y, width: width, height: height };
  });

  const nodesById = new Map(layoutNodes.map((n) => [n.id, n]));
  const edgesById = new Map((result.edges ?? []).map((e) => [e.id, e]));

  // The origin of the frame an edge is expressed in: its container's when ELK
  // reparented it there, the graph's origin otherwise. Without that offset, a
  // flow internal to the boundary was drawn beside both its nodes -- a line
  // leaving and arriving in the void.
  const originOf = (edgeElk: EdgeElk | undefined): { x: number; y: number } => {
    const container = edgeElk?.container ? byId.get(edgeElk.container) : undefined;
    return container ? { x: container.x ?? 0, y: container.y ?? 0 } : { x: 0, y: 0 };
  };

  const layoutEdges: LayoutEdge[] = edges.map((edge, i) => {
    const start = nodesById.get(edge.from);
    const arrival = nodesById.get(edge.to);
    if (!start || !arrival) return { ...edge, points: [] };
    const edgeElk = edgesById.get(`e${i}`);
    const offset = originOf(edgeElk);
    const tag = edgeElk?.labels?.[0];
    return {
      ...edge,
      points: edgePoints(edgeElk, start, arrival, offset),
      labelCentreOf:
        tag && tag.x !== undefined && tag.y !== undefined
          ? {
              x: tag.x + (tag.width ?? 0) / 2 + offset.x,
              y: tag.y + (tag.height ?? 0) / 2 + offset.y,
            }
          : undefined,
    };
  });

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: result.width ?? 400,
    height: result.height ?? 300,
  };
}
