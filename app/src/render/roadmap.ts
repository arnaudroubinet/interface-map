import type { Roadmap } from "../aggregation/roadmap";
import { INK, PAPER, styleOfNode } from "./node-styles";
import { buildTitleBlock, TITLE_BLOCK_HEIGHT, type DiagramContext } from "./title-block";

const SVG_NS = "http://www.w3.org/2000/svg";
const FONT = 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

// A grid, not a graph: one axis, one row per subject. Going through the layout
// engine would cost dearly and give a worse result -- it has nothing to place
// here, everything is determined by the milestone's rank.
const MARGIN = 24;
const LABEL_WIDTH = 300;
const MILESTONE_WIDTH = 150;
const LINE_HEIGHT = 26;
const HEADER_HEIGHT = 44;
const SECONDARY_GREY = "#39424f";

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function text(x: number, y: number, content: string, size: number, colour: string, gras = false): SVGTextElement {
  const t = el("text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  t.setAttribute("font-size", String(size));
  if (gras) t.setAttribute("font-weight", "600");
  t.setAttribute("fill", colour);
  t.textContent = content;
  return t;
}

export function buildRoadmapSvg(timeline: Roadmap, shownMilestone: string | null, context: DiagramContext | null): SVGSVGElement {
  const svg = el("svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("font-family", FONT);
  svg.setAttribute("class", "fx-roadmap");

  const ranks = timeline.milestones.map((p) => p.rank);
  const minRank = ranks.length ? Math.min(...ranks) : 0;
  // One more column on the right: that is where "still there" is drawn.
  const columns = ranks.length ? Math.max(...ranks) - minRank + 2 : 1;
  const x = (rank: number) => MARGIN + LABEL_WIDTH + (rank - minRank) * MILESTONE_WIDTH;

  const topOfLines = MARGIN + (context ? TITLE_BLOCK_HEIGHT : 0) + HEADER_HEIGHT;
  const width = MARGIN * 2 + LABEL_WIDTH + columns * MILESTONE_WIDTH;
  const height = topOfLines + timeline.segments.length * LINE_HEIGHT + MARGIN;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  const fill = el("rect");
  fill.setAttribute("width", String(width));
  fill.setAttribute("height", String(height));
  fill.setAttribute("fill", PAPER);
  svg.appendChild(fill);

  if (context) svg.appendChild(buildTitleBlock(context, MARGIN, MARGIN));

  // The axis: one tick per milestone, with its name and its date. The displayed
  // milestone carries a solid vertical -- that is the "you are here".
  for (const milestone of timeline.milestones) {
    const px = x(milestone.rank);
    const line = el("line");
    line.setAttribute("x1", String(px));
    line.setAttribute("y1", String(topOfLines - 22));
    line.setAttribute("x2", String(px));
    line.setAttribute("y2", String(height - MARGIN));
    line.setAttribute("stroke", milestone.name === shownMilestone ? "#0E7DAD" : "#dde1e7");
    line.setAttribute("stroke-width", milestone.name === shownMilestone ? "2" : "1");
    svg.appendChild(line);

    svg.appendChild(text(px + 6, topOfLines - 26, milestone.name, 12, INK, true));
    const subtitle = [milestone.label?.trim(), milestone.date?.trim()].filter(Boolean).join(" · ");
    if (subtitle) svg.appendChild(text(px + 6, topOfLines - 11, subtitle, 11, SECONDARY_GREY));
  }

  const style = styleOfNode({ kind: "actor", external: false });
  timeline.segments.forEach((s, i) => {
    const y = topOfLines + i * LINE_HEIGHT;
    svg.appendChild(text(MARGIN, y + 14, s.label, 12, INK));

    const left = x(s.start);
    const right = x(s.end);
    const toolbar = el("rect");
    toolbar.setAttribute("x", String(left));
    toolbar.setAttribute("y", String(y + 4));
    toolbar.setAttribute("width", String(Math.max(6, right - left)));
    toolbar.setAttribute("height", "14");
    toolbar.setAttribute("rx", "4");
    toolbar.setAttribute("fill", style.fill);
    svg.appendChild(toolbar);

    // Open on the right: a point, not a clean edge. A clean edge would say the
    // row stops there, when it simply has no known end.
    if (s.openRight) {
      const head = el("path");
      head.setAttribute("d", `M${right} ${y + 4} L${right + 10} ${y + 11} L${right} ${y + 18} Z`);
      head.setAttribute("fill", style.fill);
      head.setAttribute("class", "fx-roadmap-open");
      svg.appendChild(head);
    }
  });

  return svg;
}
