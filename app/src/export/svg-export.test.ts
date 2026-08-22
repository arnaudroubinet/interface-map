import { describe, it, expect } from "vitest";
import { serializeSvg } from "./svg-export";
import { buildGraphSvg } from "../render/svg-builder";
import type { LayoutResult } from "../layout/graph-layout";

describe("serializeSvg", () => {
  it("paints the background over the whole viewBox, including a negative origin", () => {
    // Un coude qui remonte au-dessus de 0 force un viewBox à minY négatif,
    // comme dans "sizes the viewBox from the actual path" (svg-builder.test.ts).
    const layout: LayoutResult = {
      nodes: [
        { id: "A", label: "A", kind: "group", x: 40, y: 0, width: 80, height: 40 },
        { id: "B", label: "B", kind: "group", x: 360, y: 200, width: 80, height: 40 },
      ],
      edges: [
        {
          from: "A",
          to: "B",
          technology: "HTTP",
          count: 1,
          label: "HTTP",
          attenuated: false,
          points: [
            { x: 40, y: 0 },
            { x: 200, y: -150 },
            { x: 360, y: 200 },
          ],
        },
      ],
      width: 500,
      height: 300,
    };

    const svg = buildGraphSvg(layout, () => "#2a78d6");
    const [vbX, vbY, vbL, vbH] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(vbY).toBeLessThan(0); // condition du bug : origine négative

    const source = serializeSvg(svg, "#ffffff");
    // Le clone porte deux fois xmlns (bug indépendant, pas testé ici) : un
    // parseur XML strict le rejette, on relit donc en HTML, plus tolérant.
    const clone = new DOMParser().parseFromString(source, "text/html").querySelector("svg")!;
    const background = clone.querySelector("rect")!;

    expect(Number(background.getAttribute("x"))).toBe(vbX);
    expect(Number(background.getAttribute("y"))).toBe(vbY);
    expect(Number(background.getAttribute("width"))).toBe(vbL);
    expect(Number(background.getAttribute("height"))).toBe(vbH);
  });
});
