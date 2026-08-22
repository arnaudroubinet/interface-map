import type { LayoutNode } from "../layout/graph-layout";
import { CHANGE_COLOUR, INK, styleOfNode } from "./node-styles";
import { normalizeText } from "../shared/text";

// What the legend announces must be what the drawing uses. It lives here, as
// DATA rather than in the SVG builder: the draw.io file must draw exactly the
// same one, and two diverging legends for a single diagram are precisely what
// this makes impossible.
export type LegendSample =
  | { shape: "line"; colour: string; dashed?: boolean; head?: "start" | "end"; thickness?: number }
  | { shape: "box"; fill: string; stroke: string; dashed?: boolean; cutCorner?: boolean; pile?: boolean };

export interface LegendEntry {
  sample: LegendSample;
  text: string;
}

// The bare minimum needed to decide an entry: the legend does not know the SVG
// builder's internal type, and has no business knowing it.
export interface LegendableNode {
  kind: LayoutNode["kind"];
  external?: boolean;
  technical?: boolean;
  aggregate?: number;
}

export interface LegendableEdge {
  technology: string;
  criticality?: string;
  change?: "added" | "removed";
  // The arrowhead and the dashes are NOTATION: they say who calls and whether
  // the content changes on the way. Colour is only a reminder.
  //
  // `arrow` says whether THIS line carries one: a merged trunk does not, and
  // the legend announces only what the drawing shows.
  arrow?: boolean;
  pulled?: boolean;
  attenuated?: boolean;
}

const CHANGE_LABEL: Record<"added" | "removed", string> = {
  added: "+n : flows added",
  removed: "−n : flows removed",
};

export function legendEntries(
  edges: readonly LegendableEdge[],
  nodes: readonly LegendableNode[],
  colorFor: (tech: string) => string,
  weightByCriticality = false
): LegendEntry[] {
  const inputs: LegendEntry[] = [];

  for (const change of ["added", "removed"] as const) {
    if (edges.some((e) => e.change === change)) {
      inputs.push({
        // A removal also carries the long dash: without it, green and red become
        // the same grey in print.
        sample: { shape: "line", colour: CHANGE_COLOUR[change], dashed: change === "removed" },
        text: CHANGE_LABEL[change],
      });
    }
  }

  // Notation before the colour code: a reader must be able to read the line's
  // SHAPE before wondering what its hue means. On a change diagram there is no
  // arrowhead to explain -- the lines there carry neither technology nor
  // direction any more.
  //
  // BOTH arrowheads are explained only if a pulled flow is drawn: it is the
  // HOLLOW head that surprises, and it only means anything against the solid
  // one. Where every head is solid, they read as the direction of the data and
  // call for no explanation. Above all, the functional reading sets "from
  // provider to consumer" for want of anything better -- a chain crosses several
  // media, sometimes of opposite directions -- and announcing "provider pushes"
  // there would assert what the diagram does not know.
  const drawing = edges.filter((e) => !e.change && e.arrow);
  if (drawing.some((e) => e.pulled === true)) {
    inputs.push({
      sample: { shape: "line", colour: INK, head: "end" },
      text: "provider pushes",
    });
    inputs.push({
      sample: { shape: "line", colour: INK, head: "start" },
      text: "consumer pulls",
    });
  }
  // An unannounced weight is one more silent notation, exactly what the
  // arrowhead used to be.
  if (weightByCriticality) {
    for (const [value, thickness] of [
      ["1 - Critical", 3.5],
      ["2 - Important", 2],
      ["3 - Standard", 1],
    ] as [string, number][]) {
      if (!edges.some((e) => normalizeText(e.criticality ?? "") === normalizeText(value))) continue;
      inputs.push({ sample: { shape: "line", colour: INK, thickness }, text: `criticality: ${value}` });
    }
  }

  if (edges.some((e) => !e.change && e.attenuated === true)) {
    inputs.push({
      sample: { shape: "line", colour: INK, dashed: true },
      text: "decision: Transform — content changes on the way",
    });
  }

  // A line marked as a change no longer carries its technology's colour:
  // announcing it would point at a colour code absent from the drawing. And an
  // empty technology is not one -- the functional reading empties it on every
  // one of its edges.
  const technologies = [...new Set(edges.filter((e) => !e.change && e.technology !== "").map((e) => e.technology))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
  for (const tech of technologies) {
    inputs.push({ sample: { shape: "line", colour: colorFor(tech) }, text: tech });
  }

  // The platform boundary is background scenery, not an actor: counting it would
  // make "External" appear all on its own.
  const drawable = nodes.filter((n) => n.kind !== "boundary");

  // An unannounced shape is one more silent notation, exactly what the arrowhead
  // used to be.
  if (drawable.some((n) => n.technical)) {
    const style = styleOfNode({ kind: "actor", external: false });
    inputs.push({
      sample: { shape: "box", fill: style.fill, stroke: style.stroke, cutCorner: true },
      text: "cut corner: technical component",
    });
  }
  if (drawable.some((n) => (n.aggregate ?? 0) > 1)) {
    const style = styleOfNode({ kind: "actor", external: false });
    inputs.push({
      sample: { shape: "box", fill: style.fill, stroke: style.stroke, pile: true },
      text: "stacked box: several components",
    });
  }

  if (drawable.some((n) => n.external) && drawable.some((n) => !n.external)) {
    for (const [text, external] of [["Platform", false], ["External", true]] as [string, boolean][]) {
      const style = styleOfNode({ kind: "actor", external });
      inputs.push({ sample: { shape: "box", fill: style.fill, stroke: style.stroke, dashed: external }, text });
    }
  }

  return inputs;
}
