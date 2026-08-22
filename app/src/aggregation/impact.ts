import type { FlowInstance } from "./core";

// The blast radius: "if X goes down, who is hit?", and its converse "what does
// X depend on?". The dependency graph already existed in the integrity checks,
// where it only ever served to detect cycles.
//
// This is degree-of-interest in Furnas's sense ("Generalized fisheye views",
// CHI '86): start from a point of interest and widen, rather than showing
// everything first. Van Ham & Perer (IEEE TVCG 15(6), 2009) show it is the
// strategy that holds on large graphs, where Shneiderman's "overview first"
// does not.
export type Neighbourhood = "direct" | "upstream" | "downstream";

// The direction of the arcs: from CONSUMER to PROVIDER, that is, the direction
// of the dependency -- not that of the data. A consumer depends on its
// provider; if the provider goes down, it is the consumer that suffers.
function arcs(flows: readonly FlowInstance[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const f of flows) {
    const from = f.consumer.trim();
    const to = f.provider.trim();
    if (!from || !to || from === to) continue;
    if (!m.has(from)) m.set(from, new Set());
    m.get(from)!.add(to);
  }
  return m;
}

function reversed(m: Map<string, Set<string>>): Map<string, Set<string>> {
  const inverse = new Map<string, Set<string>>();
  for (const [from, targets] of m) {
    for (const t of targets) {
      if (!inverse.has(t)) inverse.set(t, new Set());
      inverse.get(t)!.add(from);
    }
  }
  return inverse;
}

// Each actor mapped to its distance in hops. The starting point is at zero: it
// belongs to its own radius, without which the view would lose what it came to
// show.
//
// A BREADTH-first walk, not depth-first: the distance is the point, and a
// depth-first walk would get it wrong on a graph that loops -- the sample
// workbook holds one, across four components.
export function radius(
  flows: readonly FlowInstance[],
  from: string,
  direction: Neighbourhood
): Map<string, number> {
  const start = from.trim();
  const dependencies = arcs(flows);
  const distances = new Map<string, number>([[start, 0]]);

  if (direction === "direct") {
    // Both sides at one hop: what the by-actor board already showed.
    for (const v of dependencies.get(start) ?? []) distances.set(v, 1);
    for (const v of reversed(dependencies).get(start) ?? []) distances.set(v, 1);
    return distances;
  }

  // "upstream": what the starting point depends on, transitively. "downstream":
  // what depends on it -- those its fall would touch.
  const next = direction === "upstream" ? dependencies : reversed(dependencies);
  let front = [start];
  let hop = 0;
  while (front.length > 0) {
    hop += 1;
    const following: string[] = [];
    for (const current of front) {
      for (const v of next.get(current) ?? []) {
        if (distances.has(v)) continue;
        distances.set(v, hop);
        following.push(v);
      }
    }
    front = following;
  }
  return distances;
}
