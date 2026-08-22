import { describe, it, expect } from "vitest";
import { buildEcartsReport, buildChangesDiagramTitle, type Comparison } from "./changes-report";
import type { Changes } from "../aggregation/changes";

const nothing: Changes = {
  actors: { ajoutes: [], retires: [] },
  interfaces: { ajoutes: [], retires: [] },
  consumptions: { ajoutes: [], retires: [] },
};

const between = (o: Partial<Comparison> = {}): Comparison => ({
  before: "v1",
  after: "v2",
  kind: "milestone",
  ...o,
});

describe("buildEcartsReport — what the two sides are", () => {
  it("names the two milestones when the comparison is inside one workbook", () => {
    const text = buildEcartsReport(nothing, between()).textContent ?? "";
    expect(text).toContain("between milestone v1 and milestone v2");
  });

  // --- A6: the same report now also serves a comparison of two FILES. Saying
  // "between milestone january.xlsx" there would name a milestone axis that has
  // nothing to do with what is on screen -- and the wording is the only thing
  // that tells the reader the milestone selector is not applied.
  it("names the two workbooks, and says each is read whole", () => {
    const text = buildEcartsReport(nothing, between({ before: "january.xlsx", after: "june.xlsx", kind: "workbook" })).textContent ?? "";
    expect(text).toContain("january.xlsx");
    expect(text).toContain("june.xlsx");
    expect(text).not.toContain("milestone");
    expect(text).toContain("read whole");
  });

  it("titles the diagram with the two sides, whatever they are", () => {
    expect(buildChangesDiagramTitle(between()).textContent).toContain("between v1 and v2");
    expect(
      buildChangesDiagramTitle(between({ before: "january.xlsx", after: "june.xlsx", kind: "workbook" })).textContent
    ).toContain("between january.xlsx and june.xlsx");
  });
});
