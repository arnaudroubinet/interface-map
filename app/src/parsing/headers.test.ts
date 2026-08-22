import { describe, it, expect } from "vitest";
import { findHeader, matchesSheetName, hasPrefix } from "./headers";

describe("findHeader", () => {
  it("matches ignoring case, accents and spacing", () => {
    expect(findHeader(["  type   de flux "], "Flow type")).toBe("  type   de flux ");
    expect(findHeader(["Périmètre"], "perimetre")).toBe("Périmètre");
  });

  it("returns undefined when absent", () => {
    expect(findHeader(["Name", "Group"], "Status")).toBeUndefined();
  });

  it("ignores unexpected extra columns without matching them by accident", () => {
    expect(findHeader(["Commentaire libre"], "Comments")).toBeUndefined();
  });
});

describe("matchesSheetName", () => {
  it("matches ignoring case and accents", () => {
    expect(matchesSheetName("actors", "Actors")).toBe(true);
    expect(matchesSheetName("MODE D'EMPLOI", "Mode d'emploi")).toBe(true);
  });

  it("rejects different names", () => {
    expect(matchesSheetName("Lists", "Actors")).toBe(false);
  });
});

describe("hasPrefix", () => {
  it("matches the FX_ prefix case-insensitively", () => {
    expect(hasPrefix("fx_Tatooine_HTTP", "FX_")).toBe(true);
    expect(hasPrefix("Interfaces", "FX_")).toBe(false);
  });
});
