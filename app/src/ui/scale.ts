import type { View } from "./state";

// The threshold is COMPUTED, not guessed. The literature gives the formula:
// density d = |E| / |V|². Beyond twenty nodes, a dense board reads better as a
// matrix; a sparse board reads better actor by actor -- there, it is the area
// that gets in the way, not the tangle.
//
// On the sample workbook: |V| = 15 and d = 27/225 = 0.12, so nothing is
// displayed. That is the right behaviour: a warning that shouts on a small
// estate mostly teaches people to ignore it.
const NODE_THRESHOLD = 20;
const DENSITY_THRESHOLD = 0.15;

export interface ScaleHint {
  message: string;
  views: View[];
}

export function scaleHint(nodeCount: number, edgeCount: number): ScaleHint | null {
  if (nodeCount <= NODE_THRESHOLD) return null;
  const density = edgeCount / (nodeCount * nodeCount);
  const dense = density > DENSITY_THRESHOLD;
  return {
    message: `${nodeCount} components and ${edgeCount} flows on one board — ${
      dense ? "the Matrix view" : "a By-actor view"
    } will read better.`,
    // Nothing is ever blocked or truncated: it is said, and a course is offered.
    views: dense ? ["matrix", "by-actor"] : ["by-actor"],
  };
}
