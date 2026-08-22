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

  // Le nom de fichier dit à quel palier le schéma a été pris : deux exports
  // du même schéma à deux paliers ne doivent pas porter le même nom.
  it("appends the palier the diagram was taken at", () => {
    expect(buildExportFilename("Groupe à groupe", null, "v2", "svg")).toBe("carto-groupe-a-groupe-v2.svg");
  });
});

describe("buildExportFilename — mode", () => {
  it("nomme le mode fonctionnel", () => {
    expect(buildExportFilename("Group to group", null, "v2", "drawio", "functional")).toBe(
      "carto-functional-group-to-group-v2.drawio"
    );
  });

  // Les noms d'aujourd'hui ne bougent pas : l'architecture reste muette.
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

describe("buildExportFilename — vue Écarts", () => {
  // Deux comparaisons différentes ne doivent pas se télécharger sous le même
  // nom : le fichier porte les deux paliers, celui de départ et celui d'arrivée.
  it("names both paliers of the comparison", () => {
    expect(buildExportFilename("Écarts", "v1", "v3", "svg")).toBe("carto-ecarts-v1-v3.svg");
  });
});
