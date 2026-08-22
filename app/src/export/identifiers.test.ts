import { describe, it, expect } from "vitest";
import { identifiers } from "./identifiers";

describe("identifiants", () => {
  it("turns a free-form name into a word a DSL accepts", () => {
    expect(identifiers(["Sonde réseau"]).get("Sonde réseau")).toBe("sonde_reseau");
  });

  it("drops the punctuation the workbook allows and a DSL does not", () => {
    expect(identifiers(["Ord. Mantell"]).get("Ord. Mantell")).toBe("ord_mantell");
    expect(identifiers(["Ahch - To"]).get("Ahch - To")).toBe("ahch_to");
  });

  // Two distinct names can reduce to the same word: the produced file would
  // then hold a single element, and half the flows would point elsewhere.
  it("keeps two names apart when they reduce to the same word", () => {
    const ids = identifiers(["Ord. Mantell", "Ord Mantell"]);
    expect(ids.get("Ord. Mantell")).toBe("ord_mantell");
    expect(ids.get("Ord Mantell")).toBe("ord_mantell_2");
  });

  // An identifier starting with a digit is not an identifier.
  it("does not let an identifier start with a digit", () => {
    expect(identifiers(["3DS"]).get("3DS")).toBe("e3ds");
  });

  it("still names something whose name holds nothing usable", () => {
    expect(identifiers(["···"]).get("···")).toBe("e");
  });
});
