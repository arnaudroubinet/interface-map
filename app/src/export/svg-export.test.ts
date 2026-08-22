import { describe, it, expect } from "vitest";
import { serializeSvg } from "./svg-export";
import { buildGraphSvg } from "../render/svg-builder";
import type { LayoutResult } from "../layout/graph-layout";

describe("serializeSvg", () => {
  it("paints the background over the whole viewBox, including a negative origin", () => {
    // A corner rising above 0 forces a viewBox with a negative minY, as in
    // "sizes the viewBox from the actual path" (svg-builder.test.ts).
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
    // The clone carries xmlns twice (an independent bug, not tested here): a
    // strict XML parser rejects it, so it is reread as HTML, which is more lenient.
    const clone = new DOMParser().parseFromString(source, "text/html").querySelector("svg")!;
    const background = clone.querySelector("rect")!;

    expect(Number(background.getAttribute("x"))).toBe(vbX);
    expect(Number(background.getAttribute("y"))).toBe(vbY);
    expect(Number(background.getAttribute("width"))).toBe(vbL);
    expect(Number(background.getAttribute("height"))).toBe(vbH);
  });
});
