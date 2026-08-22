import type { LayoutNode } from "../layout/graph-layout";

// Fixed, independent of the app's theme: an export must stay legible when
// opened on its own, outside any page that would dress it light or dark (§8).
export const PAPER = "#ffffff";
export const INK = "#14181f";

// Uniform width for every line. Varying the width with the number of
// aggregated flows produced a bold effect on merged trunks that visually
// crushed their neighbours; the volume reads in the label's "×N", not in the
// line's weight.
export const STROKE_WIDTH = 2;

// A change does not carry its technology's colour: it carries the colour of
// its direction. That is also what PAPER/INK says -- an export does not follow
// the theme of whoever displays it.
export const CHANGE_COLOUR: Record<"added" | "removed", string> = {
  added: "#1a7f43",
  removed: "#d03b3b",
};

export interface NodeStyle {
  fill: string;
  stroke: string;
  lightText: boolean;
  strokeWidth: number;
}

// Palette by kind, in the C4 spirit (Structurizr): neutral blue-grey for a
// context system, strong blue for what is brought forward (platform, selected
// actor).
//
// Colour encodes the PERIMETER, not the technology: it is the strongest
// legibility lever when a central platform is surrounded by third-party
// systems -- the technology, for its part, is already carried by the lines'
// colour and by the legend.
//
// Colours taken from the source of draw.io's C4 template (Sidebar-C4.js), then
// darkened: box text is always white, and two of these fills did not carry it
// -- white on #23A2D9 gave 2.90:1 and white on #8C8496 gave 3.59:1, against a
// 4.5:1 threshold. Each takes the hue of its OWN BORDER or its equivalent: the
// colour family does not change, only its lightness comes down. #0E7DAD gives
// 4.61:1 and #6E6579 gives 5.53:1.
export function styleOfNode(node: Pick<LayoutNode, "kind" | "external">): NodeStyle {
  if (node.kind === "focus-actor") {
    return { fill: "#083F75", stroke: "#06315C", lightText: true, strokeWidth: 2 };
  }
  if (node.external) {
    return { fill: "#6E6579", stroke: "#514A5A", lightText: true, strokeWidth: 1 };
  }
  if (node.kind === "platform") {
    return { fill: "#0E7DAD", stroke: "#0A5E82", lightText: true, strokeWidth: 1 };
  }
  return { fill: "#1061B0", stroke: "#0D5091", lightText: true, strokeWidth: 1 };
}
