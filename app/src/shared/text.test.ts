import { describe, it, expect } from "vitest";
import { normalizeText } from "./text";

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
