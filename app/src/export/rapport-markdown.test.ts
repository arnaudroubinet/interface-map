import { describe, it, expect } from "vitest";
import { rapportEnMarkdown } from "./rapport-markdown";
import type { IntegrityReport } from "../integrity/checks";

function report(overrides: Partial<IntegrityReport> = {}): IntegrityReport {
  return {
    families: [],
    infoBlocks: [],
    totalAnomalies: 0,
    totalActions: 0,
    totalAvertissements: 0,
    ...overrides,
  };
}

const family = (title: string, messages: string[]) => ({
  id: title.toLowerCase(),
  title,
  description: `Description of ${title}.`,
  anomalies: messages.map((message) => ({ message })),
});

describe("rapportEnMarkdown", () => {
  it("names the workbook the report was taken on", () => {
    const md = rapportEnMarkdown(report(), "carto.xlsx", null);
    expect(md).toContain("# Integrity report — carto.xlsx");
  });

  // Les contrôles se lisent AU palier affiché : sans lui, la liste collée dans
  // un ticket ne dit pas de quel moment du classeur elle parle.
  it("names the milestone the report was taken at", () => {
    const md = rapportEnMarkdown(report(), "carto.xlsx", "v2");
    expect(md).toContain("v2");
  });

  it("turns a family into a section with one bullet per anomaly", () => {
    const md = rapportEnMarkdown(
      report({ families: [family("Structure", ["Sheet FX_A_HTTP missing.", "Actor \"A\" (Actors, row 3): oops."])], totalAnomalies: 2 }),
      "carto.xlsx",
      null
    );
    expect(md).toContain("## Structure (2)");
    expect(md).toContain("- Sheet FX_A_HTTP missing.");
    expect(md).toContain('- Actor "A" (Actors, row 3): oops.');
  });

  // Ce qui n'a rien à signaler n'a rien à faire dans un ticket : la coche
  // rassure à l'écran, elle encombre une fois collée.
  it("leaves out the sections that have nothing to report", () => {
    const md = rapportEnMarkdown(
      report({ families: [family("Structure", ["Sheet missing."]), family("References", [])], totalAnomalies: 1 }),
      "carto.xlsx",
      null
    );
    expect(md).toContain("## Structure (1)");
    expect(md).not.toContain("References");
  });

  it("says so plainly when the workbook is clean", () => {
    const md = rapportEnMarkdown(report({ families: [family("Structure", [])] }), "carto.xlsx", null);
    expect(md).toContain("Nothing to report.");
  });

  // Le fichier collé doit se lire dans le même ordre que l'écran, sans quoi
  // deux personnes regardant le même rapport ne parlent pas de la même chose.
  it("follows the same reading order as the screen", () => {
    const md = rapportEnMarkdown(
      report({
        families: [family("Structure", ["Sheet missing."])],
        infoBlocks: [
          { id: "b1", title: "Interfaces to confirm", description: "d", items: ["F"], level: "action" },
          { id: "b2", title: "Components with no flow", description: "d", items: ["A"], level: "warning" },
        ],
        totalAnomalies: 1,
        totalActions: 1,
        totalAvertissements: 1,
      }),
      "carto.xlsx",
      null
    );
    const titles = [...md.matchAll(/^## (.+) \(\d+\)$/gm)].map((m) => m[1]);
    expect(titles).toEqual(["Structure", "Interfaces to confirm", "Components with no flow"]);
  });
});

// --- QA : le rapport recopiait le texte des contrôles sans l'échapper, et
// annonçait un bilan calculé sur d'autres compteurs que les puces qu'il
// imprime. Les deux se voient sur un classeur réel.
describe("rapportEnMarkdown — ce qui vient du classeur ne fabrique pas de structure", () => {
  // Un retour à la ligne dans une cellule Excel s'obtient par Alt+Entrée : le
  // geste est courant, et il forgeait une famille d'anomalies entière que les
  // contrôles n'avaient jamais produite.
  it("ne laisse pas un retour à la ligne forger une section", () => {
    const trap = 'Innocent\n\n## Structure (0)\n\nNothing to report.\n\n- All good';
    const md = rapportEnMarkdown(
      report({ families: [family("Cohérence", [trap])], totalAnomalies: 1 }),
      "carto.xlsx",
      null
    );
    expect(md.split("\n").filter((l) => l.startsWith("## "))).toHaveLength(1);
    expect(md.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
  });

  it("neutralise le balisage porté par un nom d'acteur", () => {
    const md = rapportEnMarkdown(
      report({ families: [family("Cohérence", ['Actor "[Sullust](http://ailleurs)" and **Chandrila**.'])], totalAnomalies: 1 }),
      "carto.xlsx",
      null
    );
    // Les crochets et les étoiles sortent échappés : rendus, ils redonnent le
    // caractère, donc le nom se retrouve encore dans le classeur.
    expect(md).toContain("\\[Sullust\\]");
    expect(md).toContain("\\*\\*Chandrila\\*\\*");
  });
});

describe("rapportEnMarkdown — le bilan compte ce qu'il imprime", () => {
  const block = (title: string, level: "action" | "warning" | "info", items: string[]) => ({
    id: title.toLowerCase(), title, description: `Description of ${title}.`, level, items,
  });

  // Le bilan ne comptait ni les blocs informatifs : sur le classeur d'exemple
  // il annonçait « 2 pending decisions » au-dessus de dix-neuf puces.
  it("ne laisse pas des puces hors du bilan", () => {
    const md = rapportEnMarkdown(
      report({
        infoBlocks: [block("Groups in use", "info", ["Socle", "Finance", "Ops"])],
        totalActions: 0,
      }),
      "carto.xlsx",
      null
    );
    const puces = md.split("\n").filter((l) => l.startsWith("- ")).length;
    expect(md).toContain(`${puces} `);
  });

  // Aucun compteur renseigné et pourtant des sections à imprimer : la ligne de
  // bilan se réduisait à un point solitaire.
  it("n'écrit jamais une ligne de bilan réduite à un point", () => {
    const md = rapportEnMarkdown(
      report({ infoBlocks: [block("Groups in use", "info", ["Socle"])] }),
      "carto.xlsx",
      null
    );
    expect(md.split("\n")).not.toContain(".");
  });
});

// --- QA : le fichier annonçait un palier alors que la moitié des contrôles
// jugent le classeur entier. Un lecteur attribuait au palier une faute qui
// n'en dépend pas.
describe("rapportEnMarkdown — la portée des contrôles est dite", () => {
  it("précise ce qui se lit au palier et ce qui se lit sur tout le classeur", () => {
    const md = rapportEnMarkdown(report(), "carto.xlsx", "v2");
    expect(md).toContain("whole workbook");
    expect(md).toContain("at this milestone");
  });

  it("ne dit rien de la portée quand aucun palier n'est affiché", () => {
    expect(rapportEnMarkdown(report(), "carto.xlsx", null)).not.toContain("whole workbook");
  });
});
