import { describe, it, expect } from "vitest";
import { contrastRatio, darkenTo } from "./contrast";
import { styleOfNode } from "./node-styles";

describe("ratioDeContraste", () => {
  // The WCAG formula's bounds: they frame everything else.
  it("gives 21 between black and white, and 1 between a colour and itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrastRatio("#3a7bd5", "#3a7bd5")).toBeCloseTo(1, 5);
  });

  it("is symmetric", () => {
    expect(contrastRatio("#0E7DAD", "#ffffff")).toBeCloseTo(contrastRatio("#ffffff", "#0E7DAD"), 5);
  });

  // Reference values recomputed by hand: they are what justifies the whole
  // correction.
  it("reproduces the values measured on the product's colours", () => {
    expect(contrastRatio("#ffffff", "#23A2D9")).toBeCloseTo(2.9, 2);
    expect(contrastRatio("#cccccc", "#23A2D9")).toBeCloseTo(1.81, 2);
    expect(contrastRatio("#ffffff", "#0E7DAD")).toBeCloseTo(4.61, 2);
  });
});

describe("assombrirJusquA", () => {
  it("darkens a colour that is too light until it meets the target on white", () => {
    expect(contrastRatio(darkenTo("#eda100", 4.5), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  // A colour that already complies must not move: correcting it would change a
  // hue the workbook deliberately chose.
  it("leaves a colour that already passes untouched", () => {
    expect(darkenTo("#4a3aa7", 4.5)).toBe("#4a3aa7");
  });

  // It darkens, it does not redefine: a yellow stays a yellow.
  it("keeps the hue by touching only the lightness", () => {
    const corrected = darkenTo("#ffee00", 3);
    const [r, v, b] = [1, 3, 5].map((i) => parseInt(corrected.slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(b);
    expect(v).toBeGreaterThan(b);
  });
});

describe("styleOfNode — every fill carries its text", () => {
  // Box text is ALWAYS white (lightText). Every fill must therefore support it,
  // with no exception: that is 100% of the diagrams produced.
  it("keeps white legible on every fill", () => {
    const cas = [
      { kind: "actor", external: false },
      { kind: "actor", external: true },
      { kind: "platform", external: false },
      { kind: "focus-actor", external: false },
    ] as const;
    for (const c of cas) {
      const style = styleOfNode(c);
      expect(contrastRatio("#ffffff", style.fill), `fill ${style.fill}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  // The border must stay distinguishable from its fill: it carries the width
  // that signals the selected actor.
  it("keeps the border distinguishable from its fill", () => {
    for (const c of [{ kind: "actor", external: false }, { kind: "platform", external: false }] as const) {
      const style = styleOfNode(c);
      expect(contrastRatio(style.stroke, style.fill)).toBeGreaterThan(1.1);
    }
  });
});
