import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { buildRoadmap } from "./roadmap";
import type { ParsedModel } from "../parsing/model";

function estate(overrides: Partial<ParsedModel> = {}): ParsedModel {
  return base.template({
    milestones: [
      base.milestone({ name: "v1", rank: 1 }),
      base.milestone({ name: "v2", rank: 2 }),
      base.milestone({ name: "v3", rank: 3 }),
    ],
    groups: [base.group({ name: "G" })],
    actorTypes: [base.actorType()],
    flowTypes: [base.flowType()],
    fxSheetNames: ["FX_A_HTTP"],
    actors: [base.actor({ name: "A", group: "G", introducedAt: "v1" })],
    interfaces: [
      base.iface({ flowName: "Member lookup", version: "1.0", providerName: "A", expectedSheet: "FX_A_HTTP", introducedAt: "v1", retiredAt: "v3" }),
      base.iface({ flowName: "Member lookup", version: "2.0", providerName: "A", expectedSheet: "FX_A_HTTP", introducedAt: "v2" }),
    ],
    consumptions: [],
    ...overrides,
  });
}

describe("buildRoadmap", () => {
  it("returns one bar per row, bounded by its milestones", () => {
    const f = buildRoadmap(estate(), "interfaces");
    expect(f.segments.find((s) => s.label === "Member lookup 1.0")).toMatchObject({ start: 1, end: 3 });
  });

  // A row with no retirement milestone runs to the end: that must be DRAWN as
  // such; stopping it at the last known milestone would say it dies there.
  it("marks a row with no retirement milestone as open on the right", () => {
    const f = buildRoadmap(estate(), "interfaces");
    expect(f.segments.find((s) => s.label === "Member lookup 2.0")?.openRight).toBe(true);
    expect(f.segments.find((s) => s.label === "Member lookup 1.0")?.openRight).toBe(false);
  });

  // Symmetrically: a row with no arrival milestone comes from before the axis.
  it("marks a row with no arrival milestone as open on the left", () => {
    const m = estate();
    m.interfaces[0].introducedAt = "";
    expect(buildRoadmap(m, "interfaces").segments[0].openLeft).toBe(true);
  });

  // The overlap of two versions is exactly what one comes to see.
  it("lets two coexisting versions be seen", () => {
    const [un, two] = buildRoadmap(estate(), "interfaces").segments;
    expect(Math.max(un.start, two.start)).toBeLessThan(Math.min(un.end, two.end));
  });

  it("files the rows by grouping then by arrival", () => {
    const m = estate();
    m.interfaces.push(
      base.iface({ flowName: "Autre", providerName: "Zeffo", expectedSheet: "FX_A_HTTP", introducedAt: "v1" })
    );
    expect(buildRoadmap(m, "interfaces").segments.map((s) => s.label)).toEqual([
      "Member lookup 1.0",
      "Member lookup 2.0",
      "Autre",
    ]);
  });

  it("also returns the actors' roadmap", () => {
    expect(buildRoadmap(estate(), "actors").segments.map((s) => s.label)).toEqual(["A"]);
  });

  // A workbook with no milestone has no axis: the roadmap is empty rather than
  // fausse.
  it("returns nothing when the workbook declares no milestone", () => {
    expect(buildRoadmap(estate({ milestones: [] }), "interfaces").segments).toEqual([]);
  });
});
