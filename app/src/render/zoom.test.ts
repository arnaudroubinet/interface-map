import { describe, it, expect } from "vitest";
import { zoomBy, panBy, type Frame } from "./zoom";

const initial: Frame = { x: 0, y: 0, width: 100, height: 100 };

describe("zoomBy", () => {
  it("shrinks the frame on zoom in, grows it on zoom out", () => {
    expect(zoomBy(initial, 2, { x: 50, y: 50 }, initial).width).toBeCloseTo(50);
    expect(zoomBy(initial, 0.5, { x: 50, y: 50 }, initial).width).toBeCloseTo(200);
  });

  // The point under the cursor must not move: that is what separates a usable
  // zoom from one that loses its reader.
  it("keeps the anchor point still", () => {
    const anchor = { x: 25, y: 75 };
    const after = zoomBy(initial, 2, anchor, initial);
    expect(after.x).toBeCloseTo(12.5);
    expect(after.y).toBeCloseTo(37.5);
    // Put another way: the anchor's RELATIVE position within the frame is the same
    // before and after. That is the property that matters; the two numbers above
    // are only one reading of it.
    expect((anchor.x - after.x) / after.width).toBeCloseTo((anchor.x - initial.x) / initial.width);
    expect((anchor.y - after.y) / after.height).toBeCloseTo((anchor.y - initial.y) / initial.height);
  });

  it("preserves the aspect ratio", () => {
    const large = { x: 0, y: 0, width: 200, height: 100 };
    const after = zoomBy(large, 1.7, { x: 10, y: 10 }, large);
    expect(after.width / after.height).toBeCloseTo(2);
  });

  // Without bounds, a few wheel turns are enough to leave the drawing behind.
  it("bounds zooming in below 8×", () => {
    let c = initial;
    for (let i = 0; i < 40; i += 1) c = zoomBy(c, 2, { x: 50, y: 50 }, initial);
    expect(c.width).toBeGreaterThanOrEqual(100 / 8 - 0.001);
  });

  it("bounds zooming out above 0.2×", () => {
    let c = initial;
    for (let i = 0; i < 40; i += 1) c = zoomBy(c, 0.5, { x: 50, y: 50 }, initial);
    expect(c.width).toBeLessThanOrEqual(100 / 0.2 + 0.001);
  });

  // Once the bound is reached, one more notch must do NOTHING: without that, the
  // frame keeps sliding towards the anchor without changing size.
  it("no longer moves the frame once the bound is reached", () => {
    let c = initial;
    for (let i = 0; i < 40; i += 1) c = zoomBy(c, 2, { x: 50, y: 50 }, initial);
    expect(zoomBy(c, 2, { x: 10, y: 10 }, initial)).toEqual(c);
  });
});

describe("panBy", () => {
  it("translates the frame without resizing it", () => {
    expect(panBy(initial, 7, -3)).toEqual({ x: 7, y: -3, width: 100, height: 100 });
  });
});
