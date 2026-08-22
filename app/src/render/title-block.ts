import { INK } from "./node-styles";

// What a diagram must say about itself. C4 makes this its first rule: a
// diagram pasted into a folder, a ticket or a slide deck said neither which
// workbook it came from, nor at which milestone it reads, nor under which
// reading -- and those three change its whole meaning.
export interface DiagramContext {
  title: string;
  reading: string;
  milestone: string | null;
  source: string;
  date: string;
  components: number;
  flows: number;
  technologies: number;
  // What the board counts, when "components and flows" means nothing: a roadmap
  // counts rows and milestones, not boxes and lines.
  detail?: string;
}

const singularOrPlural = (n: number, word: string, plural = `${word}s`) => `${n} ${n > 1 ? plural : word}`;

export function titleBlockText(c: DiagramContext): { title: string; subtitle: string } {
  const milestone = c.milestone ? `, milestone ${c.milestone}` : "";
  return {
    title: `${c.title} — ${c.reading} reading${milestone}`,
    subtitle: `${c.source} · ${c.detail ?? `${singularOrPlural(c.components, "component")}, ${singularOrPlural(c.flows, "flow")}`} · ${c.date}`,
  };
}

// The reading convention appears NOWHERE in the diagram's text: a screen
// reader cannot deduce it from the drawing. It therefore belongs in the
// description, along with the counts.
export function descriptionAccessible(c: DiagramContext): string {
  return (
    `${c.source} · ${c.detail ?? `${singularOrPlural(c.components, "component")}, ${singularOrPlural(c.flows, "flow")}, ${singularOrPlural(c.technologies, "technology", "technologies")}`}. ` +
    "Line = data, provider to consumer. Arrowhead = who calls."
  );
}

export const TITLE_BLOCK_HEIGHT = 44;

// A pale grey on white reads badly, even above the threshold: #5b6472 held
// 5.98:1 and stayed uncomfortable at small sizes. Frank slate gives 10.16:1,
// and the hierarchy is still carried by size and weight -- not by paleness.
//
const SUBTITLE_GREY = "#39424f";

export function buildTitleBlock(c: DiagramContext, x: number, y: number): SVGGElement {
  const ns = "http://www.w3.org/2000/svg";
  const { title, subtitle } = titleBlockText(c);
  const g = document.createElementNS(ns, "g");
  g.setAttribute("class", "fx-titleblock");
  const row = (text: string, dy: number, size: number, gras: boolean, colour: string) => {
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y + dy));
    t.setAttribute("font-size", String(size));
    if (gras) t.setAttribute("font-weight", "600");
    t.setAttribute("fill", colour);
    t.textContent = text;
    g.appendChild(t);
  };
  row(title, 14, 14, true, INK);
  row(subtitle, 31, 11.5, false, SUBTITLE_GREY);
  return g;
}
