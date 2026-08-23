import { describe, it, expect } from "vitest";
import { rankOfMilestone, lifespanOf, isLiveAt, currentMilestone, ALWAYS } from "./milestones";
import type { ParsedModel, Milestone } from "../parsing/model";
import { SCHEMA_VERSION } from "../parsing/build-model";

// The time axis had no test of its own: it was only exercised through its
// callers, which do not visit its edge cases.

function milestone(name: string, rank: number, status = "Delivered"): Milestone {
  return { name, rank, label: "", status, date: "", description: "", sheet: "Milestones", row: 0 };
}

function model(milestones: Milestone[]): ParsedModel {
  return {
    actors: [], actorTypes: [], groups: [], groupsSheetMissing: false, milestones,
    flowTypes: [], interfaces: [], consumptions: [], fxSheetNames: [],
    missingOptionalColumns: [], schemaVersion: SCHEMA_VERSION, savedAt: null,
    referentialActors: [], referentialTechnologies: [],
  };
}

const ROADMAP = model([milestone("v1", 1), milestone("Étape 2", 2), milestone("v3", 3, "Planned")]);

describe("rankOfMilestone", () => {
  it("resolves a milestone whatever the case, the accents and the spaces", () => {
    expect(rankOfMilestone(ROADMAP, " V1 ")).toBe(1);
    expect(rankOfMilestone(ROADMAP, "etape 2")).toBe(2);
    expect(rankOfMilestone(ROADMAP, "ÉTAPE 2")).toBe(2);
  });

  it("returns undefined for an unknown or empty milestone", () => {
    expect(rankOfMilestone(ROADMAP, "v9")).toBeUndefined();
    expect(rankOfMilestone(ROADMAP, "   ")).toBeUndefined();
  });
});

describe("lifespanOf", () => {
  it("opens the bound no milestone names", () => {
    expect(lifespanOf(ROADMAP, { introducedAt: "", retiredAt: "" })).toEqual(ALWAYS);
    expect(lifespanOf(ROADMAP, { introducedAt: "v1", retiredAt: "" }).end).toBe(Infinity);
    expect(lifespanOf(ROADMAP, { introducedAt: "", retiredAt: "v3" }).start).toBe(-Infinity);
  });

  // A milestone quoted but absent from the roadmap leaves the bound open rather
  // than resolving it at random -- an integrity check asks for it separately.
  it("leaves the bound open when the milestone quoted is unknown", () => {
    expect(lifespanOf(ROADMAP, { introducedAt: "v9", retiredAt: "" }).start).toBe(-Infinity);
  });
});

describe("isLiveAt", () => {
  // The retirement is EXCLUSIVE: "retired at v3" means that at v3 the row is
  // already gone. The introduction, for its part, is inclusive.
  it("includes the arrival milestone and excludes the retirement one", () => {
    const interval = lifespanOf(ROADMAP, { introducedAt: "v1", retiredAt: "v3" });
    expect(isLiveAt(interval, 0)).toBe(false);
    expect(isLiveAt(interval, 1)).toBe(true);
    expect(isLiveAt(interval, 2)).toBe(true);
    expect(isLiveAt(interval, 3)).toBe(false);
  });
});

describe("currentMilestone", () => {
  it("returns the delivered one of highest rank", () => {
    expect(currentMilestone(ROADMAP)?.name).toBe("Étape 2");
  });

  it("with none delivered, returns the highest rank declared", () => {
    const nothingDelivered = model([milestone("v1", 1, "Planned"), milestone("v2", 2, "Planned")]);
    expect(currentMilestone(nothingDelivered)?.name).toBe("v2");
  });

  it("returns undefined on an empty roadmap", () => {
    expect(currentMilestone(model([]))).toBeUndefined();
  });
});
