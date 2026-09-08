import { describe, it, expect } from "vitest";
import { ICONS, AVAILABLE_ICONS, ICON_PREVIEWS } from "./icons";

// Converted from lucide by hand, and two of them lost their <line> coordinates
// on the way: the element was there, invisible, and nothing said so. Every
// primitive must carry the attributes that make it draw.
const REQUIRED: Record<string, string[]> = {
  line: ["x1", "y1", "x2", "y2"],
  rect: ["width", "height"],
  circle: ["cx", "cy", "r"],
  ellipse: ["cx", "cy", "rx", "ry"],
  path: ["d"],
  polyline: ["points"],
  polygon: ["points"],
};

describe("ICONS — every primitive draws something", () => {
  for (const [name, elements] of Object.entries(ICONS)) {
    it(`${name}: no element without its coordinates`, () => {
      for (const element of elements) {
        const required = REQUIRED[element.tag];
        expect(required, `unknown primitive <${element.tag}> in ${name}`).toBeDefined();
        for (const attribute of required) {
          expect(element.attrs[attribute], `<${element.tag}> of ${name} lacks ${attribute}`).toBeTruthy();
        }
      }
    });
  }

  it("previews every icon it offers", () => {
    for (const name of AVAILABLE_ICONS) expect(ICON_PREVIEWS[name], name).toBeTruthy();
  });
});
