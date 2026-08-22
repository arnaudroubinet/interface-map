import { describe, it, expect } from "vitest";
import { legendEntries } from "./legend";
import type { LayoutNode } from "../layout/graph-layout";

const node = (o: Partial<LayoutNode> = {}): LayoutNode =>
  ({ id: "A", label: "A", kind: "actor", external: false, x: 0, y: 0, width: 240, height: 120, ...o }) as LayoutNode;

describe("entreesDeLegende", () => {
  it("lists one entry per technology drawn, in alphabetical order", () => {
    const inputs = legendEntries(
      [{ technology: "SFTP" }, { technology: "HTTP" }, { technology: "HTTP" }],
      [node()],
      () => "#111111"
    );
    expect(inputs.map((e) => e.text)).toEqual(["HTTP", "SFTP"]);
  });

  // Functional mode empties `technology` on every edge: an unnamed entry would
  // announce a colour code nowhere to be found on the drawing.
  it("ignores an empty technology", () => {
    expect(legendEntries([{ technology: "" }], [node()], () => "#111111")).toEqual([]);
  });

  // A line marked as a change no longer carries its technology's colour.
  it("announces the changes and says nothing of the technologies when the diagram is a change", () => {
    const inputs = legendEntries(
      [{ technology: "HTTP", change: "added" }, { technology: "SFTP", change: "removed" }],
      [node()],
      () => "#111111"
    );
    expect(inputs.map((e) => e.text)).toEqual([
      "+n : flows added",
      "−n : flows removed",
    ]);
  });

  // The two perimeters are only announced if both are drawn: on an entirely
  // internal board, "External" would teach nothing.
  it("announces the perimeters only when both are present", () => {
    const mixte = legendEntries([{ technology: "HTTP" }], [node(), node({ id: "B", external: true })], () => "#111111");
    expect(mixte.map((e) => e.text)).toContain("Platform");
    expect(mixte.map((e) => e.text)).toContain("External");
    const internal = legendEntries([{ technology: "HTTP" }], [node()], () => "#111111");
    expect(internal.map((e) => e.text)).not.toContain("External");
  });

  // The platform boundary is background scenery, not an actor: counting it among
  // the perimeters would make "External" appear all on its own.
  it("does not count the boundary among the nodes", () => {
    const inputs = legendEntries([{ technology: "HTTP" }], [node({ kind: "boundary" }), node()], () => "#111111");
    expect(inputs.map((e) => e.text)).not.toContain("External");
  });
});

describe("legendEntries — the notation, not only the colour", () => {
  // The arrowhead convention is the tool's own invention: the line follows the
  // data, the head says who calls. Unannounced, it reads as a mistake in the
  // arrow's direction.
  it("explains the arrowhead as soon as a pulled flow is drawn", () => {
    const texts = legendEntries(
      [{ technology: "HTTP", arrow: true, pulled: true }, { technology: "Kafka", arrow: true, pulled: false }],
      [node()],
      () => "#111111"
    ).map((e) => e.text);
    expect(texts).toContain("provider pushes");
    expect(texts).toContain("consumer pulls");
  });

  // A merged trunk carries no arrowhead: announcing it would explain a sign
  // absent from the drawing.
  it("explains no arrowhead when no line carries one", () => {
    const texts = legendEntries([{ technology: "HTTP", arrow: false, pulled: true }], [node()], () => "#111111").map((e) => e.text);
    expect(texts.some((t) => t.includes("pushes") || t.includes("pulls"))).toBe(false);
  });

  // Where every head goes to the consumer, they read as the data's direction:
  // nothing to explain. That is also the case of the functional reading, which
  // sets that direction for want of anything better -- announcing "provider
  // pushes" there would assert what the diagram does not know.
  it("explains no arrowhead when no flow is pulled", () => {
    const texts = legendEntries([{ technology: "Kafka", arrow: true, pulled: false }], [node()], () => "#111111").map((e) => e.text);
    expect(texts.some((t) => t.includes("pushes") || t.includes("pulls"))).toBe(false);
  });

  // The dashes say that a hop transforms the content. That is a strong claim --
  // the link says information travels, not that it arrives intact -- and it was
  // mute.
  it("explains the dashes as soon as a flow is dimmed", () => {
    const texts = legendEntries([{ technology: "HTTP", attenuated: true }], [node()], () => "#111111").map((e) => e.text);
    expect(texts).toContain("decision: Transform — content changes on the way");
  });

  it("does not explain the dashes when no flow is", () => {
    const texts = legendEntries([{ technology: "HTTP" }], [node()], () => "#111111").map((e) => e.text);
    expect(texts.some((t) => t.includes("Transform"))).toBe(false);
  });

  // The reading order: what explains the SHAPE first, what explains the COLOUR
  // second. The notation reads before the colour code.
  it("puts the notation before the technologies", () => {
    const texts = legendEntries([{ technology: "HTTP", arrow: true, pulled: true }], [node()], () => "#111111").map((e) => e.text);
    const notation = texts.findIndex((t) => t.includes("pushes"));
    expect(notation).toBeGreaterThanOrEqual(0);
    expect(texts.indexOf("HTTP")).toBeGreaterThan(notation);
  });

  // A change diagram has no arrowhead to explain: its lines carry neither
  // technology nor direction any more, only an addition or a removal.
  it("does not explain the arrowhead on a change diagram", () => {
    const texts = legendEntries([{ technology: "HTTP", change: "added", arrow: true, pulled: true }], [node()], () => "#111111").map((e) => e.text);
    expect(texts.some((t) => t.includes("pushes") || t.includes("pulls"))).toBe(false);
  });
});

// --- WCAG 1.4.1 / G111: what the colour says, a shape must restate. And an
// unannounced shape is one more silent notation.
describe("legendEntries — the shapes are announced too", () => {
  it("announces the cut corner as soon as a technical actor is drawn", () => {
    const inputs = legendEntries([{ technology: "HTTP" }], [node({ technical: true })], () => "#111111");
    const shape = inputs.find((e) => e.text.includes("technical component"));
    expect(shape).toBeDefined();
    expect(shape!.sample).toMatchObject({ shape: "box", cutCorner: true });
  });

  it("announces the stack as soon as a node folds several actors", () => {
    const inputs = legendEntries([{ technology: "HTTP" }], [node({ aggregate: 4 })], () => "#111111");
    expect(inputs.find((e) => e.text.includes("several components"))?.sample).toMatchObject({ pile: true });
  });

  // A group of a single actor is not a stack: drawing it stacked would assert
  // that it hides others.
  it("does not announce the stack for a group of a single actor", () => {
    const inputs = legendEntries([{ technology: "HTTP" }], [node({ aggregate: 1 })], () => "#111111");
    expect(inputs.some((e) => e.text.includes("several components"))).toBe(false);
  });

  // A removal carries the long dash: without it, green and red become the same
  // grey in print.
  it("shows the removal dashed in its own entry", () => {
    const inputs = legendEntries([{ technology: "HTTP", change: "removed" }], [node()], () => "#111111");
    expect(inputs[0].sample).toMatchObject({ dashed: true });
  });
});

