import { describe, it, expect } from "vitest";
import { scaleHint } from "./scale";

describe("scaleHint", () => {
  // On the sample workbook: |V| = 15, d = 27/225 = 0.12. No banner, and that is
  // the right behaviour -- a warning that shouts on a small estate mostly
  // teaches people to ignore it.
  it("stays silent on a board node-link serves well", () => {
    expect(scaleHint(15, 27)).toBeNull();
  });

  it("is still silent at the threshold, and speaks just above it", () => {
    expect(scaleHint(20, 400)).toBeNull();
    expect(scaleHint(21, 400)).not.toBeNull();
  });

  // Large AND dense: the matrix reads better.
  it("suggests the matrix on a large, dense board", () => {
    const c = scaleHint(47, 400);
    expect(c?.views).toContain("matrix");
    expect(c?.message).toContain("47 components and 400 flows");
  });

  // Large but sparse: node-link is still better, it is the AREA that gets in the
  // way -- so it points to the by-actor view, not to the matrix.
  it("suggests the by-actor view on a large, sparse board", () => {
    const c = scaleHint(47, 60);
    expect(c?.views).toEqual(["by-actor"]);
    expect(c?.message).toContain("By-actor");
  });
});
