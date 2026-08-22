import { describe, it, expect, vi, beforeEach } from "vitest";
import { handlersExport, type ExportContext } from "./export-handlers";
import { initialState, withLoadedFile, withView, withMode, withActorSelection, type AppState } from "./state";
import type { IntegrityReport } from "../integrity/checks";
import * as base from "../testing/fixtures";

// The seven exports, exercised one by one. That is what their move out of
// mountApp's closure makes possible: before, the whole DOM had to be mounted to
// touch a single one, and none had a test.
//
// The download functions are intercepted: what is checked here is not that a
// file comes down -- the browser handles that -- but WHAT IT IS GIVEN: the
// right content, under the right name.

const downloads: { name: string; content: string }[] = [];
vi.mock("../export/download", () => ({
  downloadText: (content: string, name: string) => void downloads.push({ name, content }),
  downloadBlob: () => {},
}));
vi.mock("../export/svg-export", () => ({
  downloadSvg: (_svg: unknown, name: string) => void downloads.push({ name, content: "<svg>" }),
}));
vi.mock("../export/xlsx-export", () => ({
  downloadMatrixXlsx: (_m: unknown, name: string) => void downloads.push({ name, content: "xlsx" }),
}));
const renderedPng = { ok: true as boolean, scale: 0 };
vi.mock("../export/png-export", () => ({
  exportPng: async (_svg: unknown, _fill: unknown, scale: number) => {
    renderedPng.scale = scale;
    return renderedPng.ok ? { ok: true, blob: new Blob() } : { ok: false, error: "No PNG here." };
  },
  downloadPngBlob: (_b: unknown, name: string) => void downloads.push({ name, content: "png" }),
}));

const report: IntegrityReport = {
  families: [], infoBlocks: [], totalAnomalies: 0, totalActions: 0, totalWarnings: 0,
};

const template = base.template({
  actors: [base.actor({ name: "Tatooine" })],
  groups: [base.group()],
  actorTypes: [base.actorType()],
  flowTypes: [base.flowType()],
  interfaces: [base.iface({ providerName: "Tatooine" })],
  consumptions: [base.consumption()],
  fxSheetNames: ["FX_A_HTTP"],
});

function context(state: AppState, svg: SVGSVGElement | null = document.createElementNS("http://www.w3.org/2000/svg", "svg")) {
  let current = state;
  const ctx: ExportContext = {
    legacyState: () => current,
    setState: (s) => void (current = s),
    svgCourant: () => svg,
    currentMatrix: () => base.matrix({ columns: ["B"], rows: [] }),
  };
  return { ctx, handlers: handlersExport(ctx), state: () => current };
}

const loaded = () =>
  withLoadedFile(initialState(), { name: "carto.xlsx", model: template, report: report, dateModification: null, referentials: { actors: "", technologies: "" } });

beforeEach(() => {
  downloads.length = 0;
  renderedPng.ok = true;
  renderedPng.scale = 0;
});

describe("handlersExport", () => {
  it("does nothing while no workbook is loaded", async () => {
    const { handlers } = context(initialState());
    handlers.onExportSvg();
    await handlers.onExportPng();
    handlers.onExportMarkdown();
    handlers.onExportStructurizr();
    expect(downloads).toHaveLength(0);
  });

  it("does nothing when no diagram is on screen", () => {
    const { handlers } = context(withView(loaded(), "platform-detail"), null);
    handlers.onExportSvg();
    expect(downloads).toHaveLength(0);
  });

  // The name carries the view, the milestone and the selection: without it, two
  // different readings would download under the same name.
  it("puts the selection in the by-actor view's name", () => {
    const s = withActorSelection(withView(loaded(), "by-actor"), "Tatooine");
    context(s).handlers.onExportSvg();
    expect(downloads[0].name).toContain("tatooine");
    expect(downloads[0].name).toMatch(/\.svg$/);
  });

  // The report judges the WORKBOOK, not a reading of it: its content does not
  // move from one mode to the other, so its name must not move either.
  it("does not put the mode in the Markdown report's name", () => {
    const s = withMode(withView(loaded(), "checks"), "functional");
    context(s).handlers.onExportMarkdown();
    expect(downloads[0].name).not.toContain("functional");
    expect(downloads[0].content).toContain("Integrity report");
  });

  it("does put the mode in a diagram's name, though", () => {
    const s = withMode(withView(loaded(), "platform-detail"), "functional");
    context(s).handlers.onExportSvg();
    expect(downloads[0].name).toContain("functional");
  });

  // A browser that refuses the conversion must SAY so: with no message, the
  // button would seem to do nothing. And it is the export's message that is
  // shown: it distinguishes two failures, and the banner invents no third one.
  //
  it("warns in the banner when the PNG fails, and downloads nothing", async () => {
    renderedPng.ok = false;
    const { handlers, state } = context(withView(loaded(), "platform-detail"));
    await handlers.onExportPng();
    expect(downloads).toHaveLength(0);
    expect(state().messageBandeau).toBe("No PNG here.");
  });

  it("downloads the PNG when the conversion succeeds", async () => {
    const { handlers } = context(withView(loaded(), "platform-detail"));
    await handlers.onExportPng();
    expect(downloads[0].name).toMatch(/\.png$/);
  });

  it("exports the displayed matrix, under the matrix view's name", () => {
    context(withView(loaded(), "matrix")).handlers.onExportXlsx();
    expect(downloads[0].name).toMatch(/matrix.*\.xlsx$/);
  });

  // Both DSLs describe the MODEL: no view name, no selection, no mode.
  it("names both DSLs after the model, not after the view", () => {
    const s = withMode(withView(loaded(), "by-actor"), "functional");
    const { handlers } = context(s);
    handlers.onExportStructurizr();
    handlers.onExportLikeC4();
    expect(downloads.map((t) => t.name)).toEqual(["carto-model.dsl", "carto-model.c4"]);
    expect(downloads[0].content).toContain("workspace");
    expect(downloads[1].content).toContain("specification");
  });

  it("carries every board into the draw.io, whatever view is open", async () => {
    await context(withView(loaded(), "checks")).handlers.onExportDrawio();
    expect(downloads[0].name).toMatch(/boards.*\.drawio$/);
    expect(downloads[0].content).toContain("<mxfile");
  });
});

// --- §2.8: the PNG's scale factor was hard-coded at 2. An architecture diagram
// is thin lines with small type: the case where high resolution still pays.
//
const dernierScalePng = () => renderedPng.scale;

describe("onExportPng — the scale is chosen", () => {
  it("keeps 2 as the default scale", async () => {
    const { handlers } = context(loaded());
    await handlers.onExportPng();
    expect(dernierScalePng()).toBe(2);
  });

  it("exports at the chosen scale", async () => {
    const s = loaded();
    const { handlers } = context({ ...s, options: { ...s.options, pngScale: 4 } });
    await handlers.onExportPng();
    expect(dernierScalePng()).toBe(4);
  });
});

// --- A7 / A5: an actor's board is the C4 context view wherever it is carried.
// The note lived only in the on-screen title block, so the same drawing said
// two different things depending on which door it left by.
describe("exports — a board says the same thing on every door it leaves by", () => {
  // The shared fixture has one actor and a consumer that is not one, so it
  // produces no actor board at all: the note needs two actors that exchange.
  const twoActors = withLoadedFile(initialState(), {
    name: "carto.xlsx",
    model: base.template({
      actors: [base.actor({ name: "Tatooine" }), base.actor({ name: "B" })],
      groups: [base.group()],
      actorTypes: [base.actorType()],
      flowTypes: [base.flowType()],
      interfaces: [base.iface({ providerName: "Tatooine" })],
      consumptions: [base.consumption({ consumerName: "B" })],
      fxSheetNames: ["FX_A_HTTP"],
    }),
    report,
    dateModification: null, referentials: { actors: "", technologies: "" },
  });

  it("carries the context note on an actor's board, in the draw.io file", async () => {
    const { handlers } = context(twoActors);
    await handlers.onExportDrawio();
    const drawio = downloads.find((d) => d.name.endsWith(".drawio"))?.content ?? "";
    expect(drawio).toContain("(actor)");
    expect(drawio).toContain("inbound left, outbound right");
  });

  // The three fixed boards are not context views: the note there would claim a
  // reading the drawing does not support.
  it("does not carry it on a board that is not one actor's context", async () => {
    const { handlers } = context(twoActors);
    await handlers.onExportDrawio();
    const drawio = downloads.find((d) => d.name.endsWith(".drawio"))?.content ?? "";
    const groupToGroup = drawio.slice(0, drawio.indexOf("(actor)"));
    expect(groupToGroup).not.toContain("inbound left, outbound right");
  });
});
