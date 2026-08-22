// The render/ folder's test file in its entirety -- matrix-table,
// integrity-report, help, icons. Colocation says "one test beside its module";
// here it is one test for six modules, and the absence of a
// matrix-table.test.ts therefore does not mean it is uncovered.
import { describe, it, expect } from "vitest";
// The comparison lives here, not in help.ts: the help page has no business
// depending on the rail to be written, it must only stay in agreement with it.
// It is the test's job to hold both ends.
import { VIEWS } from "../ui/rail";
import { EXPORTS } from "../ui/banner";
import { AVAILABLE_ICONS, ICON_PREVIEWS } from "./icons";
import { buildAide, documentedViews, exportsDocumentes } from "./help";
import { buildRoadmapSvg } from "./roadmap";
import { buildMatrixTable } from "./matrix-table";
import { buildIntegrityReport } from "./integrity-report";
import type { MatrixResult } from "../aggregation/views";
import * as base from "../testing/fixtures";
import type { IntegrityReport } from "../integrity/checks";

describe("buildMatrixTable", () => {
  it("draws exactly the rows and columns it is given", () => {
    const matrix: MatrixResult = base.matrix({
      columns: ["A"],
      rows: [{ actor: "B", cells: new Map([["A", [{ technology: "HTTP", count: 2, attenuated: false, names: [] }]]]) }],
    });

    const table = buildMatrixTable(matrix, () => "#2a78d6");

    expect(table.tagName.toLowerCase()).toBe("table");
    expect(table.querySelectorAll("tbody tr")).toHaveLength(1);
    // Corner, one column, and the totals margin.
    expect(table.querySelectorAll("thead th")).toHaveLength(3);
    expect(table.textContent).toContain("HTTP ×2");
  });

  it("marks an attenuated technology distinctly", () => {
    const matrix: MatrixResult = base.matrix({
      columns: ["B"],
      rows: [{ actor: "A", cells: new Map([["B", [{ technology: "HTTP", count: 1, attenuated: true, names: [] }]]]) }],
    });

    const table = buildMatrixTable(matrix, () => "#2a78d6");

    expect(table.querySelector("[data-dimmed='true']")).not.toBeNull();
  });

  // Rows and columns no longer share an order since they are pruned each on
  // their own side: a "self to self" cell is no longer on a diagonal, and greying
  // it produced nothing but a grey block floating in the middle of the table.
  // The cells' background comes from the theme, never from the table: on a dark
  // theme, a background set here made the data illegible. The TOTAL cells carry a
  // class, but no colour of their own.
  it("marks no cell with a background of its own", () => {
    const matrix: MatrixResult = base.matrix({
      columns: ["A", "B"],
      rows: [
        { actor: "A", cells: new Map([["B", [{ technology: "HTTP", count: 1, attenuated: false, names: [] }]]]) },
        { actor: "B", cells: new Map([["A", [{ technology: "HTTP", count: 1, attenuated: false, names: [] }]]]) },
      ],
    });

    const table = buildMatrixTable(matrix, () => "#2a78d6");

    expect([...table.querySelectorAll("td[class]")].filter((td) => td.className !== "matrix-total")).toEqual([]);
    expect([...table.querySelectorAll("td")].every((td) => td.style.backgroundColor === "")).toBe(true);
  });

  // In functional mode the technology is emptied (§4.5); the cell must not show
  // a "×3" preceded by a blank.
  it("shows the counter alone when the cell has no technology", () => {
    const matrix: MatrixResult = base.matrix({
      columns: ["A"],
      rows: [{ actor: "B", cells: new Map([["A", [{ technology: "", count: 2, attenuated: false, names: [] }]]]) }],
    });

    const table = buildMatrixTable(matrix, () => "#000");

    expect(table.textContent).toContain("2");
    expect(table.textContent).not.toContain("×");
  });
});

describe("buildIntegrityReport", () => {
  it("renders one block per family with its title and anomaly count", () => {
    const report: IntegrityReport = {
      families: [
        { id: "structure", title: "Structure", description: "d", anomalies: [{ message: "Problème A" }] },
        { id: "references", title: "Références", description: "d", anomalies: [] },
      ],
      infoBlocks: [{ id: "groupes", title: "Groupes utilisés", description: "d", items: ["Socle (2)"], level: "info" }],
      totalAnomalies: 1,
      totalActions: 0,
      totalWarnings: 0,
    };

    const el = buildIntegrityReport(report);

    expect(el.textContent).toContain("Structure");
    expect(el.textContent).toContain("Problème A");
    expect(el.textContent).toContain("Nothing to report");
    expect(el.textContent).toContain("Groupes utilisés");
    expect(el.textContent).toContain("Socle (2)");
  });
});

describe("buildIntegrityReport — the sections' visual state", () => {
  const report: IntegrityReport = {
    families: [
      { id: "structure", title: "Structure", description: "…", anomalies: [] },
      { id: "coherence", title: "Cohérence", description: "…", anomalies: [{ message: "un problème" }] },
    ],
    infoBlocks: [],
    totalAnomalies: 1,
    totalActions: 0,
    totalWarnings: 0,
  };

  const byTitle = (el: HTMLElement, start: string) =>
    [...el.querySelectorAll("details")].find((d) => d.querySelector("summary")!.textContent!.startsWith(start))!;

  it("collapses a clean section behind a green check, and opens an alerting one under a stop icon", () => {
    const el = buildIntegrityReport(report);
    const sound = byTitle(el, "Structure");
    const onAlert = byTitle(el, "Cohérence");

    // A sound section: collapsed, marked "ok".
    expect(sound.open).toBe(false);
    expect(sound.classList.contains("section-ok")).toBe(true);
    expect(sound.querySelector("summary")!.textContent).toContain("Structure (0)");

    // A section on alert: unfolded by default, marked "alert".
    expect(onAlert.open).toBe(true);
    expect(onAlert.classList.contains("section-alert")).toBe(true);
    expect(onAlert.querySelector("summary")!.textContent).toContain("Cohérence (1)");
    expect(onAlert.querySelectorAll("li")).toHaveLength(1);
  });

  it("gives each section an icon that distinguishes the two states without relying on colour alone", () => {
    const el = buildIntegrityReport(report);
    const sound = byTitle(el, "Structure");
    const onAlert = byTitle(el, "Cohérence");
    const traces = (d: Element) => [...d.querySelectorAll("summary svg path")].length;

    expect(traces(sound)).toBe(1); // coche : un seul tracé
    expect(traces(onAlert)).toBe(3); // octogone + les deux barres de la croix
  });
});

describe("buildIntegrityReport — avertissements", () => {
  it("marks a warning block distinctly from an error and from plain information", () => {
    const report: IntegrityReport = {
      families: [{ id: "coherence", title: "Cohérence", description: "…", anomalies: [{ message: "faute" }] }],
      infoBlocks: [
        { id: "a-confirmer", title: "Interfaces à confirmer", description: "…", items: ["F1"], level: "warning" },
        { id: "groupes", title: "Groupes utilisés", description: "…", items: ["Socle (2)"], level: "info" },
      ],
      totalAnomalies: 1,
      totalActions: 0,
      totalWarnings: 1,
    };

    const el = buildIntegrityReport(report);
    const byTitle = (start: string) =>
      [...el.querySelectorAll("details")].find((d) => d.querySelector("summary")!.textContent!.startsWith(start))!;
    const error = byTitle("Cohérence");
    const avert = byTitle("Interfaces à confirmer");
    const info = byTitle("Groupes utilisés");

    expect(error.classList.contains("section-alert")).toBe(true);
    expect(avert.classList.contains("section-warning")).toBe(true);
    expect(info.classList.contains("section-info")).toBe(true);

    // Each is visible by default: a warning does not hide.
    expect([error.open, avert.open, info.open]).toEqual([true, true, true]);

    // The three icons differ by their shape, not only by their colour.
    const traces = (d: Element) => d.querySelectorAll("summary svg path").length;
    expect(traces(error)).toBe(3); // octogone + croix
    expect(traces(avert)).toBe(3); // triangle + barre + point
    expect(traces(info)).toBe(2); // barre + point, dans un cercle
    expect(avert.querySelector("summary svg path")!.getAttribute("d")).not.toBe(
      error.querySelector("summary svg path")!.getAttribute("d")
    );
  });
});

describe("buildIntegrityReport — reading order", () => {
  it("sorts sections by what they demand: errors, then warnings, then information, then the clean ones", () => {
    const report: IntegrityReport = {
      families: [
        { id: "structure", title: "Structure", description: "…", anomalies: [] },
        { id: "coherence", title: "Cohérence", description: "…", anomalies: [{ message: "faute" }] },
      ],
      infoBlocks: [
        { id: "groupes", title: "Groups", description: "…", items: ["Socle (2)"], level: "info" },
        { id: "vide", title: "Bloc vide", description: "…", items: [], level: "info" },
        { id: "a-confirmer", title: "To confirm", description: "…", items: ["F1"], level: "warning" },
      ],
      totalAnomalies: 1,
      totalActions: 0,
      totalWarnings: 1,
    };

    const titles = [...buildIntegrityReport(report).querySelectorAll("details")].map(
      (d) => d.querySelector("summary")!.textContent!.replace(/\s*\(\d+\)$/, "")
    );

    expect(titles).toEqual(["Cohérence", "To confirm", "Groups", "Structure", "Bloc vide"]);
  });
});

describe("the icon catalogue", () => {
  // Adding an icon without its preview would leave an empty cell in the workbook,
  // with nothing to report it.
  it("gives every catalogue icon a preview, and nothing more", () => {
    expect(Object.keys(ICON_PREVIEWS).sort()).toEqual(AVAILABLE_ICONS);
  });
});

describe("buildIntegrityReport — actions", () => {
  const block = (id: string, level: "info" | "action" | "warning") => ({
    id, title: id, description: "d", items: ["x"], level,
  });

  // An action is not a defect in the file: it awaits a decision, and tells itself
  // apart from the alert by its shape as much as by its colour.
  it("gives an action its own icon and class, distinct from a warning", () => {
    const html = buildIntegrityReport({
      families: [],
      infoBlocks: [block("a-confirmer", "action"), block("criticite", "warning")],
      totalAnomalies: 0, totalActions: 1, totalWarnings: 1,
    });
    const action = html.querySelector(".section-action")!;
    const warning = html.querySelector(".section-warning")!;
    expect(action).not.toBeNull();
    expect(warning).not.toBeNull();
    expect(action.querySelector("svg")!.innerHTML).not.toBe(warning.querySelector("svg")!.innerHTML);
  });

  // Reading order: what must be fixed, then what must be decided, then what must
  // be completed, then what need only be read.
  it("sorts errors, then actions, then warnings, then information", () => {
    const html = buildIntegrityReport({
      families: [{ id: "structure", title: "Structure", description: "d", anomalies: [{ message: "m" }] }],
      infoBlocks: [block("info", "info"), block("avert", "warning"), block("action", "action")],
      totalAnomalies: 1, totalActions: 1, totalWarnings: 1,
    });
    const classes = [...html.querySelectorAll("details")].map((d) => d.className.split(" ")[1]);
    expect(classes).toEqual(["section-alert", "section-action", "section-warning", "section-info"]);
  });
});

// --- The help page is compared with the rail: a view added without a line of
// documentation would fail this test. Documentation that falls behind is worse
// than no documentation, since it asserts.
describe("buildAide", () => {
  it("documents every rail view, and nothing more", () => {
    expect(documentedViews().sort()).toEqual(VIEWS.map((v) => v.label).sort());
  });

  // The same device as for the views: an eighth export cannot arrive without its
  // line of explanation. It is the project's best seam, and it was only serving
  // half its purpose.
  it("documents every export offered, and nothing more", () => {
    expect(exportsDocumentes().sort()).toEqual(EXPORTS.map((e) => e.label).sort());
  });

  it("explains both readings and the two columns that carry them", () => {
    const text = buildAide().textContent ?? "";
    for (const expected of ["ARCHITECTURE", "BUSINESS", "Nature", "Republished as"]) {
      expect(text).toContain(expected);
    }
  });

  it("says the workbook is never modified nor sent anywhere", () => {
    const text = buildAide().textContent ?? "";
    expect(text).toContain("never writes");
    expect(text).toContain("nothing leaves this browser");
  });

  it("warns of the confusion between Remove and retirement", () => {
    expect(buildAide().textContent ?? "").toContain("deprecation warning");
  });
});

// --- QA: in the functional reading the technology is empty, and the colour
// function fell back on its "#000" default -- hard-coded into every cell's
// style. On the dark theme that gave black on black: the functional matrix was
// illegible. With no technology there is no colour to carry, and the cell must
// inherit the theme's.
describe("buildMatrixTable — the cells' colour", () => {
  const matrix = (technology: string): MatrixResult => base.matrix({
    columns: ["A"],
    rows: [{ actor: "B", cells: new Map([["A", [{ technology, count: 1, attenuated: false, names: ["F"] }]]]) }],
  });

  it("imposes no colour when there is no technology", () => {
    const span = buildMatrixTable(matrix(""), () => "#000").querySelector(".matrix-tech") as HTMLElement;
    expect(span.style.color).toBe("");
  });

  // The intent has not changed -- the technology's colour is still shown -- but
  // it has left the text for the chip.
  it("still shows the technology's colour, on its chip", () => {
    const table = buildMatrixTable(matrix("HTTP"), () => "#2a78d6");
    const pastille = table.querySelector(".matrix-dot") as HTMLElement;
    expect(pastille.style.backgroundColor).not.toBe("");
  });
});

// --- A technology's colour will come from the external referential, in free
// hexadecimal. Measured on five typical corporate colours: all excellent on
// white (4.3 to 9.2:1), four below the 3:1 threshold on a dark background. Yet
// in the matrix the colour WAS the text's colour: a palette tuned for print
// therefore made the data illegible.
//
// So the colour moves onto a chip, and the label takes the theme's ink. Any
// hexadecimal becomes legible, and the colour stays the reminder it always was.
//
describe("buildMatrixTable — the colour no longer carries the text", () => {
  const matrix = (technology: string): MatrixResult => base.matrix({
    columns: ["A"],
    rows: [{ actor: "B", cells: new Map([["A", [{ technology, count: 1, attenuated: false, names: ["F"] }]]]) }],
  });

  it("sets the colour on a chip, never on the label", () => {
    const table = buildMatrixTable(matrix("HTTP"), () => "#7a2e3b");
    const pastille = table.querySelector(".matrix-dot") as HTMLElement;
    const label = table.querySelector(".matrix-tech") as HTMLElement;
    expect(pastille.style.backgroundColor).not.toBe("");
    expect(label.style.color).toBe("");
  });

  it("shows no chip when there is no technology", () => {
    const table = buildMatrixTable(matrix(""), () => "#000");
    expect(table.querySelector(".matrix-dot")).toBeNull();
  });

  it("keeps the label legible in both cases", () => {
    for (const tech of ["HTTP", ""]) {
      const table = buildMatrixTable(matrix(tech), () => "#7a2e3b");
      expect(table.textContent).toContain("F");
    }
  });
});

// --- §2.10: 143 cells, no total, no title, and nothing to tell a screen reader
// which cells a header titles.
describe("buildMatrixTable — the margins and the table's semantics", () => {
  const estate = () =>
    base.matrix({
      columns: ["A", "B"],
      rows: [
        { actor: "A", cells: new Map([["B", [{ technology: "HTTP", count: 3, attenuated: false, names: [] }]]]) },
        { actor: "B", cells: new Map([["A", [{ technology: "HTTP", count: 1, attenuated: false, names: [] }]]]) },
      ],
    });

  it("carries the table's title in a caption", () => {
    const table = buildMatrixTable(estate(), () => "#111", "Matrix — architecture reading, milestone v2");
    expect(table.querySelector("caption")?.textContent).toContain("milestone v2");
  });

  it("invents no caption when no title is supplied", () => {
    expect(buildMatrixTable(estate(), () => "#111").querySelector("caption")).toBeNull();
  });

  // Without `scope`, a 143-cell matrix reads as 143 numbers with no
  // adresse.
  it("says which cells each header titles", () => {
    const table = buildMatrixTable(estate(), () => "#111");
    // The corner titles nothing: it announces both axes' reading direction, and
    // giving it a scope would tie it to one of the two.
    const enTetes = [...table.querySelectorAll("thead th")].filter((th) => !th.classList.contains("matrix-corner"));
    expect(enTetes.length).toBeGreaterThan(0);
    expect(enTetes.every((th) => th.getAttribute("scope") === "col")).toBe(true);
    expect([...table.querySelectorAll("tbody th")].every((th) => th.getAttribute("scope") === "row")).toBe(true);
  });

  it("counts the outgoing flows at the row's end and the incoming ones at the column's foot", () => {
    const table = buildMatrixTable(estate(), () => "#111");
    const endOfLine = [...table.querySelectorAll("tbody tr")].map((tr) => tr.lastElementChild?.textContent);
    expect(endOfLine).toEqual(["3", "1"]);
    const foot = [...table.querySelectorAll("tfoot td")].map((td) => td.textContent);
    expect(foot.slice(0, 2)).toEqual(["1", "3"]);
  });
});

// --- §2.15: both readings exist, are correct, and did not borrow the
// vocabulary their readers already have.
describe("buildHelp — the two readings' vocabulary", () => {
  const text = () => buildAide().textContent ?? "";

  it("ties both readings to the ArchiMate viewpoints", () => {
    expect(text()).toContain("Application Cooperation");
    expect(text()).toContain("Application Usage");
  });

  // The point of honesty: folding a chain is a derivation the standard says can
  // be wrong, and the tool asserted it without saying so.
  it("says what a folded link asserts, and what it does not", () => {
    expect(text()).toContain("derivation rule 10");
    expect(text()).toContain("it says the information travels, not that it arrives unchanged");
  });
});

// --- §A4: the milestone axis was a drop-down, and time was never seen. The
// roadmap shows it at a glance.
describe("buildFriseSvg", () => {
  const timeline = {
    milestones: [
      { name: "v1", rank: 1, label: "Initial", status: "Delivered", date: "2026-01-01", description: "", sheet: "Milestones", row: 2 },
      { name: "v2", rank: 2, label: "Partners", status: "Delivered", date: "2026-06-01", description: "", sheet: "Milestones", row: 3 },
    ],
    segments: [
      { label: "Member lookup 1.0", grouping: "A", start: 1, end: 2, openRight: false, openLeft: false },
      { label: "Member lookup 2.0", grouping: "A", start: 2, end: 3, openRight: true, openLeft: false },
    ],
  };

  it("draws one bar per segment and one tick per milestone", () => {
    const svg = buildRoadmapSvg(timeline, null, null);
    expect(svg.querySelectorAll("rect")).toHaveLength(3); // le fond, plus deux barres
    expect(svg.querySelectorAll("line")).toHaveLength(2);
  });

  it("names every milestone and every row", () => {
    const texts = [...buildRoadmapSvg(timeline, null, null).querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("v1");
    expect(texts).toContain("Member lookup 1.0");
    expect(texts.some((t) => t?.includes("2026-06-01"))).toBe(true);
  });

  // A point, not a clean edge: an edge would say the row stops there, when it
  // simply has no known end.
  it("ends the row with no retirement with a point", () => {
    expect(buildRoadmapSvg(timeline, null, null).querySelectorAll(".fx-roadmap-open")).toHaveLength(1);
  });

  // The "you are here": the displayed milestone stands out from the others.
  it("marks the displayed milestone with a stronger vertical", () => {
    const svg = buildRoadmapSvg(timeline, "v2", null);
    const widths = [...svg.querySelectorAll("line")].map((l) => l.getAttribute("stroke-width"));
    expect(new Set(widths).size).toBe(2);
  });

  // A bar longer on the right than on the left: without that, two versions
  // following one another would be drawn in the same place.
  it("places each bar at its milestone's abscissa", () => {
    const svg = buildRoadmapSvg(timeline, null, null);
    const [, un, two] = [...svg.querySelectorAll("rect")];
    expect(Number(two.getAttribute("x"))).toBeGreaterThan(Number(un.getAttribute("x")));
  });
});
