import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { text, contractUrl, exportableActors } from "./c4-common";

describe("text — a string literal both DSLs accept", () => {
  // A cell typed with Alt+Enter broke the whole file, not merely its line.
  it("folds line breaks and runs of whitespace into one space", () => {
    expect(text("first line\nsecond   line\r\n")).toBe("first line second line");
  });

  it("turns double quotes into single ones", () => {
    expect(text('the "core" bus')).toBe("the 'core' bus");
  });
});

describe("contractUrl — only a web address goes out", () => {
  it("quotes a web address", () => {
    expect(contractUrl(" https://docs.example.org/contract.pdf ")).toBe('"https://docs.example.org/contract.pdf"');
  });

  it("drops a UNC path, a space, or prose", () => {
    expect(contractUrl("\\\\server\\doc contrat.pdf")).toBeNull();
    expect(contractUrl("https://a b")).toBeNull();
    expect(contractUrl("see SharePoint")).toBeNull();
    expect(contractUrl("")).toBeNull();
  });
});

describe("exportableActors — one declaration per name", () => {
  // Two Actors rows of one name produced two declarations under ONE
  // identifier, and both tools refused the file.
  it("keeps the first of two homonymous rows", () => {
    const model = base.template({
      actors: [base.actor({ name: "Naboo", owner: "Leia" }), base.actor({ name: "Naboo ", owner: "Han" }), base.actor({ name: "Hoth" })],
    });
    expect(exportableActors(model, null).map((a) => `${a.name.trim()}:${a.owner}`)).toEqual(["Naboo:Leia", "Hoth:"]);
  });
});
