import { describe, it, expect } from "vitest";
import { fitScale, MAX_CANVAS_SIDE } from "./png-export";

// Beyond the canvas limits a browser hands back a blank picture without a word:
// the scale comes down first, and the export says so.
describe("fitScale", () => {
  it("keeps the scale asked for when the canvas can hold it", () => {
    expect(fitScale(1200, 800, 2)).toBe(2);
  });

  it("brings the scale down so no side exceeds the canvas limit", () => {
    const scale = fitScale(12_000, 2_000, 4);
    expect(scale * 12_000).toBeLessThanOrEqual(MAX_CANVAS_SIDE);
    expect(scale).toBeLessThan(4);
  });

  it("brings the scale down so the area fits", () => {
    const scale = fitScale(15_000, 15_000, 1);
    expect(scale * 15_000 * scale * 15_000).toBeLessThanOrEqual(268_000_000);
  });
});
