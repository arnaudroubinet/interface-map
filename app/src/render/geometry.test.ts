import { describe, it, expect } from "vitest";
import { breakTheLine } from "./geometry";

// The geometry is verified on numbers, without mounting an SVG: that is
// precisely what its move out of the SVG builder makes possible.

// --- QA: the head sits on the LAST visible piece of the path. When the label
// covered the arrival, the cut ran to the segment's end, the remainder was
// thrown away, and the last piece became the one BEFORE the label: the arrow
// stopped at its label instead of the box it aimed at -- 51 px too early, on 2
// of the 18 lines of the "platform detail" view.
describe("breakTheLine", () => {
  const lastPoint = (pieces: { x: number; y: number }[][]) => {
    const last = pieces[pieces.length - 1];
    return last[last.length - 1];
  };

  it("keeps a remainder after a label that covers the arrival", () => {
    const trace = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    const labelOnArrival = { x0: 150, y0: -10, x1: 210, y1: 10 };
    const pieces = breakTheLine(trace, [labelOnArrival]);
    expect(pieces.length).toBeGreaterThan(0);
    expect(lastPoint(pieces).x).toBeCloseTo(200, 5);
  });

  it("still cuts in the middle when the label is in the middle", () => {
    const trace = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    const pieces = breakTheLine(trace, [{ x0: 90, y0: -10, x1: 110, y1: 10 }]);
    expect(pieces).toHaveLength(2);
    expect(lastPoint(pieces).x).toBeCloseTo(200, 5);
  });
});
