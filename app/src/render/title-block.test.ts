import { describe, it, expect } from "vitest";
import { titleBlockText, descriptionAccessible, type DiagramContext } from "./title-block";

const ctx = (o: Partial<DiagramContext> = {}): DiagramContext => ({
  title: "Platform detail",
  reading: "architecture",
  milestone: "v2",
  source: "carto.xlsx",
  date: "2026-08-22",
  components: 12,
  flows: 24,
  technologies: 5,
  ...o,
});

describe("titleBlockText", () => {
  it("states the view, the reading and the milestone on the first line", () => {
    expect(titleBlockText(ctx()).title).toBe("Platform detail — architecture reading, milestone v2");
  });

  // --- QA: the by-actor board IS the C4 context view -- "the nearest inbound
  // and outbound dependencies" -- and elk.direction RIGHT already lays the
  // inbound on the left and the outbound on the right. Nothing said so, so the
  // reader had to guess that the two sides meant anything at all.
  it("carries the note a board wants to add about its own layout", () => {
    expect(titleBlockText(ctx({ layoutNote: "inbound left, outbound right" })).title).toContain(
      "inbound left, outbound right"
    );
  });

  it("says nothing extra when a board has no note", () => {
    expect(titleBlockText(ctx()).title).toBe("Platform detail — architecture reading, milestone v2");
  });

  // A workbook with no milestone must not display "milestone null".
  it("says nothing of the milestone when the workbook declares none", () => {
    expect(titleBlockText(ctx({ milestone: null })).title).toBe("Platform detail — architecture reading");
  });

  it("states the source, the counts and the date on the second line", () => {
    expect(titleBlockText(ctx()).subtitle).toBe("carto.xlsx · 12 components, 24 flows · 2026-08-22");
  });

  // The singular matters: "1 components" betrays hand-built text.
  it("agrees in the singular", () => {
    expect(titleBlockText(ctx({ components: 1, flows: 1 })).subtitle).toContain("1 component, 1 flow");
  });
});

describe("descriptionAccessible", () => {
  // What a screen reader reads: the counts AND the reading convention, which no
  // text of the diagram carries otherwise.
  it("states the counts then the reading convention", () => {
    const d = descriptionAccessible(ctx());
    expect(d).toContain("12 components, 24 flows, 5 technologies");
    expect(d).toContain("Line = data, provider to consumer");
    expect(d).toContain("Arrowhead = who calls");
  });

  // "1 technologys" is the kind of mistake a naive plural produces.
  it("agrees with technology's irregular plural", () => {
    expect(descriptionAccessible(ctx({ technologies: 1 }))).toContain("1 technology.");
  });
});

// --- QA: the roadmap counts rows and milestones, not boxes and lines. Its
// title block announced "0 component, 0 flow" over seventeen rows.
describe("titleBlockText — what the board counts", () => {
  it("lets a board say what it counts, when boxes make no sense", () => {
    const c = { ...ctx(), components: 0, flows: 0, detail: "17 interfaces, 3 milestones" };
    expect(titleBlockText(c).subtitle).toContain("17 interfaces, 3 milestones");
    expect(titleBlockText(c).subtitle).not.toContain("0 component");
  });

  it("keeps the ordinary counts when nothing replaces them", () => {
    expect(titleBlockText(ctx()).subtitle).toContain("12 components, 24 flows");
  });

  it("carries the same detail into the accessible description", () => {
    expect(descriptionAccessible({ ...ctx(), detail: "17 interfaces, 3 milestones" })).toContain("17 interfaces");
  });
});
