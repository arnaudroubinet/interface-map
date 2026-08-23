import { describe, it, expect } from "vitest";
import { normalizeText, nearDuplicate } from "./text";

describe("normalizeText", () => {
  it("trims and lowercases", () => {
    expect(normalizeText("  Nom  ")).toBe("nom");
  });

  it("collapses multiple internal spaces", () => {
    expect(normalizeText("Type   de    flux")).toBe("type de flux");
  });

  it("strips accents", () => {
    expect(normalizeText("Périmètre")).toBe("perimetre");
    expect(normalizeText("Décommissionné")).toBe("decommissionne");
  });

  it("is case-insensitive", () => {
    expect(normalizeText("ACTEUR EXPOSANT")).toBe(normalizeText("acteur exposant"));
  });
});

describe("nearDuplicate", () => {
  it("pairs names equal but for case or accents", () => {
    expect(nearDuplicate("Core", "core")).toEqual({ distance: null, reason: "same name but for case" });
    expect(nearDuplicate("Coré", "Core")).toEqual({
      distance: null,
      reason: "same name once accents and spacing are folded",
    });
  });

  it("pairs names equal once punctuation is ignored", () => {
    expect(nearDuplicate("Sales-network", "Sales network")).toEqual({
      distance: null,
      reason: "same name once punctuation is ignored",
    });
  });

  it("pairs a typo one edit away, above the length floor", () => {
    expect(nearDuplicate("Support", "Suport")).toEqual({ distance: 1, reason: "1 letter apart" });
  });

  it("counts a transposition as one edit, not two", () => {
    // Plain Levenshtein scores "Kakfa"/"Kafka" as 2 (two substitutions); the
    // adjacent 'k' and 'f' are swapped, which Damerau-Levenshtein counts once.
    expect(nearDuplicate("Kakfa", "Kafka")).toEqual({ distance: 1, reason: "1 letter apart" });
  });

  it("does not pair short names, even one edit apart", () => {
    expect(nearDuplicate("Core", "Care")).toBeNull();
  });

  it("does not pair short names further apart", () => {
    expect(nearDuplicate("Core", "Crait")).toBeNull();
  });

  it("requires the same first character", () => {
    expect(nearDuplicate("Backend", "Wackend")).toBeNull();
  });

  it("allows a distance of two once the longer name exceeds 8 characters", () => {
    expect(nearDuplicate("Procurement", "Procurment")).toEqual({ distance: 1, reason: "1 letter apart" });
    expect(nearDuplicate("Procurement", "Procurremant")).toEqual({ distance: 2, reason: "2 letters apart" });
  });

  it("is symmetric and unrelated names do not pair", () => {
    expect(nearDuplicate("Core", "Sales network")).toBeNull();
  });
});
