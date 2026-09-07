import { describe, it, expect } from "vitest";
import { buildExportFilename } from "./filename";
import { serializeSvg } from "./svg-export";
import { exportPng } from "./png-export";

describe("buildExportFilename", () => {
  it("builds a lowercase, accent-free filename with view and extension", () => {
    expect(buildExportFilename("Groupe à groupe", null, null, "svg")).toBe("carto-groupe-a-groupe.svg");
  });

  it("appends the selection when present", () => {
    expect(buildExportFilename("Par acteur", "Tatooine Système", null, "png")).toBe("carto-par-acteur-tatooine-systeme.png");
  });

  // The file name says at which milestone the diagram was taken: two exports of
  // the same diagram at two milestones must not carry the same name.
  // A milestone is typed by a person: "T3 2026 / lot 1" is a name the browser
  // truncates at the slash. Slugged like the view and the selection.
  it("slugs the palier like the rest of the name", () => {
    expect(buildExportFilename("Groupe à groupe", null, "T3 2026 / lot 1", "svg")).toBe("carto-groupe-a-groupe-t3-2026-lot-1.svg");
  });

  it("appends the palier the diagram was taken at", () => {
    expect(buildExportFilename("Groupe à groupe", null, "v2", "svg")).toBe("carto-groupe-a-groupe-v2.svg");
  });
});

describe("buildExportFilename — mode", () => {
  it("names the functional mode", () => {
    expect(buildExportFilename("Group to group", null, "v2", "drawio", "functional")).toBe(
      "carto-functional-group-to-group-v2.drawio"
    );
  });

  // Today's names do not move: architecture stays silent.
  it("laisse l'architecture muette", () => {
    expect(buildExportFilename("Group to group", null, "v2", "drawio", "architecture")).toBe(
      "carto-group-to-group-v2.drawio"
    );
  });
});

describe("serializeSvg", () => {
  it("produces a standalone SVG string with an opaque background", () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 50");

    const out = serializeSvg(svg, "#ffffff");

    expect(out).toContain("<svg");
    expect(out).toContain("#ffffff");
  });
});

describe("exportPng", () => {
  it("reports a failure explicitly instead of throwing when canvas conversion is unavailable", async () => {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 100 50");
    svg.setAttribute("width", "100");
    svg.setAttribute("height", "50");

    // jsdom's canvas has no real rasterizer: toBlob never resolves with a
    // real image, and drawImage on an SVG data URL throws — this mirrors
    // the real-world Safari failure mode this function must handle.
    const result = await exportPng(svg, "#ffffff", 2);

    expect(result.ok).toBe(false);
  });
});

describe("buildExportFilename — rapport", () => {
  it("names the milestone the report was taken at", () => {
    expect(buildExportFilename("Integrity checks", null, "v2", "md")).toBe("carto-integrity-checks-v2.md");
  });
});

describe("buildExportFilename — Changes view", () => {
  // Two different comparisons must not download under the same name: the file
  // carries both milestones, the departure and the arrival.
  it("names both paliers of the comparison", () => {
    expect(buildExportFilename("Écarts", "v1", "v3", "svg")).toBe("carto-ecarts-v1-v3.svg");
  });
});
