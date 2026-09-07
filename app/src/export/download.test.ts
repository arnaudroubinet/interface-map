import { describe, it, expect } from "vitest";
import { mimeTypeFor } from "./download";

// Every text export left as Markdown: a draw.io file, a DSL, a JSON document,
// all typed text/markdown, which some browsers took as a reason to rename the
// file. The type follows the extension, and Markdown is one text among others.
describe("mimeTypeFor", () => {
  it("types each export after its extension", () => {
    expect(mimeTypeFor("carto.md")).toContain("text/markdown");
    expect(mimeTypeFor("carto.drawio")).toContain("xml");
    expect(mimeTypeFor("carto.json")).toContain("application/json");
    expect(mimeTypeFor("carto.dsl")).toContain("text/plain");
    expect(mimeTypeFor("carto.c4")).toContain("text/plain");
    expect(mimeTypeFor("carto.xlsx")).toContain("spreadsheetml");
  });

  it("falls back on plain text, never on Markdown", () => {
    expect(mimeTypeFor("notes.unknown")).toContain("text/plain");
  });
});
