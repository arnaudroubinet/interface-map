import { describe, it, expect } from "vitest";
import { reportToMarkdown } from "./markdown-report";
import type { IntegrityReport } from "../integrity/checks";

function report(overrides: Partial<IntegrityReport> = {}): IntegrityReport {
  return {
    families: [],
    infoBlocks: [],
    totalAnomalies: 0,
    totalActions: 0,
    totalWarnings: 0,
    ...overrides,
  };
}

const family = (title: string, messages: string[]) => ({
  id: title.toLowerCase(),
  title,
  description: `Description of ${title}.`,
  anomalies: messages.map((message) => ({ message })),
});

describe("reportToMarkdown", () => {
  it("names the workbook the report was taken on", () => {
    const md = reportToMarkdown(report(), "carto.xlsx", null);
    expect(md).toContain("# Integrity report — carto.xlsx");
  });

  // The checks read AT the displayed milestone: without it, the list pasted into
  // a ticket does not say which moment of the workbook it speaks of.
  it("names the milestone the report was taken at", () => {
    const md = reportToMarkdown(report(), "carto.xlsx", "v2");
    expect(md).toContain("v2");
  });

  it("turns a family into a section with one bullet per anomaly", () => {
    const md = reportToMarkdown(
      report({ families: [family("Structure", ["Sheet FX_A_HTTP missing.", "Actor \"A\" (Actors, row 3): oops."])], totalAnomalies: 2 }),
      "carto.xlsx",
      null
    );
    expect(md).toContain("## Structure (2)");
    expect(md).toContain("- Sheet FX_A_HTTP missing.");
    expect(md).toContain('- Actor "A" (Actors, row 3): oops.');
  });

  // What has nothing to report has no place in a ticket: the tick is reassuring
  // on screen, it clutters once pasted.
  it("leaves out the sections that have nothing to report", () => {
    const md = reportToMarkdown(
      report({ families: [family("Structure", ["Sheet missing."]), family("References", [])], totalAnomalies: 1 }),
      "carto.xlsx",
      null
    );
    expect(md).toContain("## Structure (1)");
    expect(md).not.toContain("References");
  });

  it("says so plainly when the workbook is clean", () => {
    const md = reportToMarkdown(report({ families: [family("Structure", [])] }), "carto.xlsx", null);
    expect(md).toContain("Nothing to report.");
  });

  // The pasted file must read in the same order as the screen, failing which two
  // people looking at the same report are not talking about the same thing.
  it("follows the same reading order as the screen", () => {
    const md = reportToMarkdown(
      report({
        families: [family("Structure", ["Sheet missing."])],
        infoBlocks: [
          { id: "b1", title: "Interfaces to confirm", description: "d", items: ["F"], level: "action" },
          { id: "b2", title: "Components with no flow", description: "d", items: ["A"], level: "warning" },
        ],
        totalAnomalies: 1,
        totalActions: 1,
        totalWarnings: 1,
      }),
      "carto.xlsx",
      null
    );
    const titles = [...md.matchAll(/^## (.+) \(\d+\)$/gm)].map((m) => m[1]);
    expect(titles).toEqual(["Structure", "Interfaces to confirm", "Components with no flow"]);
  });
});

// --- QA: the report copied the checks' text without escaping it, and announced
// a summary computed from counters other than the bullets it prints. Both show
// on a real workbook.
describe("reportToMarkdown — what comes from the workbook does not forge structure", () => {
  // A line break in an Excel cell is obtained with Alt+Enter: the gesture is
  // common, and it forged a whole anomaly family the checks had never produced.
  //
  it("does not let a line break forge a section", () => {
    const trap = 'Innocent\n\n## Structure (0)\n\nNothing to report.\n\n- All good';
    const md = reportToMarkdown(
      report({ families: [family("Cohérence", [trap])], totalAnomalies: 1 }),
      "carto.xlsx",
      null
    );
    expect(md.split("\n").filter((l) => l.startsWith("## "))).toHaveLength(1);
    expect(md.split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
  });

  it("neutralises the markup carried by an actor's name", () => {
    const md = reportToMarkdown(
      report({ families: [family("Cohérence", ['Actor "[Sullust](http://ailleurs)" and **Chandrila**.'])], totalAnomalies: 1 }),
      "carto.xlsx",
      null
    );
    // Brackets and stars come out escaped: rendered, they give the character back,
    // so the name can still be found in the workbook.
    expect(md).toContain("\\[Sullust\\]");
    expect(md).toContain("\\*\\*Chandrila\\*\\*");
  });
});

describe("reportToMarkdown — the summary counts what it prints", () => {
  const block = (title: string, level: "action" | "warning" | "info", items: string[]) => ({
    id: title.toLowerCase(), title, description: `Description of ${title}.`, level, items,
  });

  // The summary counted neither the informational blocks: on the sample workbook
  // it announced "2 pending decisions" above nineteen bullets.
  it("leaves no bullets out of the summary", () => {
    const md = reportToMarkdown(
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

  // No counter filled and yet sections to print: the summary line shrank to a
  // lone full stop.
  it("never writes a summary line reduced to a full stop", () => {
    const md = reportToMarkdown(
      report({ infoBlocks: [block("Groups in use", "info", ["Socle"])] }),
      "carto.xlsx",
      null
    );
    expect(md.split("\n")).not.toContain(".");
  });
});

// --- QA: the file announced a milestone although half the checks judge the
// whole workbook. A reader attributed to the milestone a fault that does not
// depend on it.
describe("reportToMarkdown — the checks' scope is stated", () => {
  it("states what reads at the milestone and what reads over the whole workbook", () => {
    const md = reportToMarkdown(report(), "carto.xlsx", "v2");
    expect(md).toContain("whole workbook");
    expect(md).toContain("at this milestone");
  });

  it("says nothing of the scope when no milestone is displayed", () => {
    expect(reportToMarkdown(report(), "carto.xlsx", null)).not.toContain("whole workbook");
  });
});
