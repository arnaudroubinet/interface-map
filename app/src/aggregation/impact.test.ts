import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { radius } from "./impact";
import type { FlowInstance } from "./core";

// A supplies B, B supplies C, D supplies A. The DEPENDENCY therefore runs from
// B to A: B needs A.
const link = (provider: string, consumer: string): FlowInstance =>
  ({ provider, consumer, interfaceName: "F", version: "", flowType: "HTTP", direction: "provider-to-consumer",
     attenuated: false, iface: base.iface(), consumption: base.consumption() }) as FlowInstance;

const estate = [link("A", "B"), link("B", "C"), link("D", "A")];

describe("radius", () => {
  it("counts the starting point at zero hops", () => {
    expect(radius(estate, "A", "downstream").get("A")).toBe(0);
  });

  // "If A falls, who is affected?" B depends on it, and C depends on B.
  it("follows downstream transitively, counting the hops", () => {
    expect([...radius(estate, "A", "downstream").entries()].sort()).toEqual([["A", 0], ["B", 1], ["C", 2]]);
  });

  // "What does A depend on?" On D, and on nothing else.
  it("follows upstream the other way", () => {
    expect([...radius(estate, "A", "upstream").entries()].sort()).toEqual([["A", 0], ["D", 1]]);
  });

  it("keeps only the immediate neighbours at direct range, on both sides", () => {
    expect([...radius(estate, "A", "direct").keys()].sort()).toEqual(["A", "B", "D"]);
  });

  // A cycle must not loop forever: the sample workbook holds one, with four
  // components, reported by the checks.
  it("terminates on a cycle", () => {
    const loop = [link("A", "B"), link("B", "A")];
    expect(radius(loop, "A", "downstream").get("B")).toBe(1);
  });

  // The distance must be the SHORTEST: a depth-first walk would give 2 hops
  // where there is 1, as soon as a long path arrives before the short one.
  it("returns the shortest distance when two paths lead to the same node", () => {
    const diamond = [link("A", "B"), link("A", "C"), link("B", "D"), link("C", "D"), link("D", "E")];
    const r = radius(diamond, "A", "downstream");
    expect(r.get("D")).toBe(2);
    expect(r.get("E")).toBe(3);
  });

  // An actor touching nothing has only itself within its radius.
  it("returns the starting point alone for an isolated actor", () => {
    expect([...radius(estate, "Isolé", "downstream").keys()]).toEqual(["Isolé"]);
  });
});
