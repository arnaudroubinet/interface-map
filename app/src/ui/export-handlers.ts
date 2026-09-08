import type { AppState, LoadedFile } from "./state";
import { VIEW_LABEL, withBannerMessage } from "./state";
import type { BannerCallbacks } from "./banner";
import type { MatrixResult } from "../aggregation/views";
import { rankOfMilestone } from "../aggregation/milestones";
import { coloursOfModel } from "../render/colors";
import { allBoards } from "../aggregation/boards";
import { computeLayout } from "../layout/graph-layout";
import { buildDrawio } from "../export/drawio-export";
import { modelToStructurizr } from "../export/c4-dsl";
import { modelToLikeC4 } from "../export/likec4-dsl";
import { reportToMarkdown } from "../export/markdown-report";
import { buildExportFilename } from "../export/filename";
import { downloadSvg } from "../export/svg-export";
import { exportPng, downloadPngBlob } from "../export/png-export";
import { downloadMatrixXlsx } from "../export/xlsx-export";
import { downloadText } from "../export/download";
import { buildPrintableDocument } from "../export/pdf-export";
import { modelToFossflow, fossflowJson } from "../export/fossflow-json";

// The nine exports, outside mountApp's closure.
//
// They used to live in there among eighteen nested functions, and none could
// be exercised without mounting the whole DOM. Yet they depend on only four
// things: the state, a way to replace it, the SVG on screen and the displayed
// matrix. That is the contract declared below, and it fits in four lines.
//
//
// Functions are asked for rather than values: the state changes at every
// render, and a handler wired once must read the state at the moment of the
// click, not the one it was built from.
export interface ExportContext {
  legacyState: () => AppState;
  setState: (state: AppState) => void;
  // The diagram on screen. Absent on the matrix, the report and the help.
  svgCourant: () => SVGSVGElement | null;
  // The DISPLAYED matrix, not one recomputed on click: recomputing it would
  // risk delivering something other than what the user has in front of them.
  currentMatrix: () => MatrixResult | null;
}

// What the file name must carry beyond the view: the selection when there is
// one, failing which two different readings download under the same name.
//
function nameSelection(state: AppState): string | null {
  if (state.view === "by-actor") return state.actorSelection;
  if (state.view === "by-technology") return state.technologySelection;
  // A change reads BETWEEN two milestones: the name must carry both. The
  // arrival milestone is already appended elsewhere.
  if (state.view === "changes") return state.comparedMilestone;
  return null;
}

// The displayed milestone applies to everything describing the MODEL rather
// than a board: these exports carry neither a view name nor a selection.
function shownRank(state: AppState): number | null {
  if (!state.file || state.shownMilestone === null) return null;
  return rankOfMilestone(state.file.model, state.shownMilestone) ?? null;
}

export function handlersExport(ctx: ExportContext): BannerCallbacks {
  const fileName = (extension: Parameters<typeof buildExportFilename>[3], withMode = true) => {
    const state = ctx.legacyState();
    return buildExportFilename(
      VIEW_LABEL[state.view],
      nameSelection(state),
      state.shownMilestone,
      extension,
      withMode ? state.mode : undefined
    );
  };

  // Every board of the workbook, laid out and described. Two exports carry
  // them all -- draw.io and the PDF -- and a board must describe itself the
  // same way in both: a page torn from the folder and a tab in draw.io say
  // the same thing about the same drawing.
  async function allPlacedBoards(state: AppState, file: LoadedFile) {
    const placed = [];
    for (const board of allBoards(file.model, shownRank(state), state.mode)) {
      placed.push({
        title: board.title,
        actor: board.actor,
        layout: await computeLayout(board.nodes, board.edges),
        context: {
          title: board.title,
          reading: state.mode === "functional" ? "functional" : "architecture",
          milestone: state.shownMilestone,
          source: file.name,
          date: file.modifiedAt ? file.modifiedAt.toISOString().slice(0, 10) : "save date unknown",
          components: board.nodes.filter((n) => n.kind !== "boundary").length,
          flows: board.edges.length,
          technologies: new Set(board.edges.map((e) => e.technology).filter(Boolean)).size,
          // An actor's board is the C4 context view, wherever it is carried:
          // the page in the folder and the tab in draw.io must say what the
          // screen says, or the note is only true where someone happened to
          // add it.
          layoutNote: board.actor ? "inbound left, outbound right" : undefined,
        },
      });
    }
    return placed;
  }

  // The boards placed, or a banner message and nothing: a layout that failed
  // used to leave the click without any effect at all, which reads as a broken
  // button rather than a failed layout.
  async function placedOrSay(state: AppState, file: LoadedFile) {
    try {
      return await allPlacedBoards(state, file);
    } catch (err) {
      console.error(err);
      ctx.setState(withBannerMessage(ctx.legacyState(), "The boards could not be laid out for this export. Try again; if it persists, the SVG export of each view still works."));
      return null;
    }
  }

  return {
    onExportSvg() {
      const svg = ctx.svgCourant();
      if (!svg || !ctx.legacyState().file) return;
      downloadSvg(svg, fileName("svg"), "#ffffff");
    },

    async onExportPng() {
      const svg = ctx.svgCourant();
      if (!svg || !ctx.legacyState().file) return;
      const asked = ctx.legacyState().options.pngScale;
      const result = await exportPng(svg, "#ffffff", asked);
      if (!result.ok) {
        // The message comes from the export: it distinguishes two of them, and
        // copying it here had erased one.
        ctx.setState(withBannerMessage(ctx.legacyState(), result.error));
        return;
      }
      downloadPngBlob(result.blob, fileName("png"));
      // Smaller than asked, and said so: a picture that silently came out at
      // half the resolution would be blamed on the tool's eyes, not the canvas.
      if (result.scale < asked) {
        ctx.setState(
          withBannerMessage(ctx.legacyState(), `PNG rendered at ×${result.scale.toFixed(1)} instead of ×${asked}: the browser's canvas cannot hold a larger picture. The SVG export has no such limit.`)
        );
      }
    },

    onExportXlsx() {
      const matrix = ctx.currentMatrix();
      if (!matrix || !ctx.legacyState().file) return;
      downloadMatrixXlsx(matrix, fileName("xlsx"));
    },

    onExportMarkdown() {
      const state = ctx.legacyState();
      if (!state.file) return;
      // No mode here: the report judges the WORKBOOK, not a reading of the
      // workbook (§5.3). Its content does not move from one mode to the other, so
      // its name must not move either.
      downloadText(
        reportToMarkdown(state.file.report, state.file.name, state.shownMilestone),
        fileName("md", false)
      );
    },

    // The draw.io file carries EVERY board, one per tab: it does not depend on
    // the view that is open. The layouts are computed on demand -- some sixty
    // boards fit in under a second, and keeping them warm would mean redoing
    // them at every milestone change.
    async onExportDrawio() {
      const state = ctx.legacyState();
      if (!state.file) return;
      const colours = coloursOfModel(state.file.model);
      // Each page describes itself, like each SVG: draw.io is the format meant
      // to CIRCULATE, and its pages used to leave with neither title nor legend.
      const placed = await placedOrSay(state, state.file);
      if (!placed) return;
      downloadText(
        buildDrawio(placed, (t) => colours.get(t) ?? "#000"),
        buildExportFilename("boards", null, state.shownMilestone, "drawio", state.mode)
      );
    },

    // The folder one attaches to an architecture review: every board, one per
    // page, and the report in appendix. The browser makes the PDF -- a library
    // that did it would weigh more than the whole application, in a deliverable
    // that must stay one file.
    async onExportPdf() {
      const state = ctx.legacyState();
      if (!state.file) return;
      const file = state.file;
      const colours = coloursOfModel(file.model);
      const placed = await placedOrSay(state, file);
      if (!placed) return;
      const document_ = buildPrintableDocument(
        placed,
        file.report,
        {
          title: "Interface map",
          reading: state.mode === "functional" ? "functional" : "architecture",
          milestone: state.shownMilestone,
          source: file.name,
          date: file.modifiedAt ? file.modifiedAt.toISOString().slice(0, 10) : "save date unknown",
          components: 0,
          flows: 0,
          technologies: 0,
        },
        (t) => colours.get(t) ?? "#000"
      );

      // The application's own page is hidden for the duration rather than
      // navigated away from: the workbook lives in memory, and leaving the page
      // would lose it.
      document.body.appendChild(document_);
      document.body.classList.add("printing");
      // The document is removed when printing is OVER, not when print() returns:
      // Chrome blocks in print(), Safari and Firefox may hand back control before
      // the engine has paginated, and the page then printed empty. afterprint is
      // the signal; the timer is the net under it, for a browser that never fires it.
      const cleanup = () => {
        document.body.classList.remove("printing");
        document_.remove();
        window.removeEventListener("afterprint", cleanup);
      };
      window.addEventListener("afterprint", cleanup);
      setTimeout(cleanup, 120_000);
      try {
        window.print();
      } catch (err) {
        cleanup();
        console.error(err);
        ctx.setState(withBannerMessage(ctx.legacyState(), "This browser refused to print. The draw.io or SVG exports carry the same boards."));
      }
    },

    onExportStructurizr() {
      const state = ctx.legacyState();
      if (!state.file) return;
      downloadText(
        modelToStructurizr(state.file.model, shownRank(state), state.file.name, state.shownMilestone, state.mode),
        // The content follows the mode, so the name must: the two readings used
        // to overwrite one another under one file name.
        buildExportFilename("model", null, state.shownMilestone, "dsl", state.mode)
      );
    },

    onExportLikeC4() {
      const state = ctx.legacyState();
      if (!state.file) return;
      downloadText(
        modelToLikeC4(state.file.model, shownRank(state), state.mode, state.shownMilestone),
        buildExportFilename("model", null, state.shownMilestone, "c4", state.mode)
      );
    },

    // Every board as a FossFLOW/Isoflow document, one view per board, like
    // draw.io -- the same boards, on the tile grid, reworkable in that tool.
    // The very translation the in-app isometric rendering paints from: the
    // file cannot tell another story than the screen.
    async onExportFossflow() {
      const state = ctx.legacyState();
      if (!state.file) return;
      const colours = coloursOfModel(state.file.model);
      const placed = await placedOrSay(state, state.file);
      if (!placed) return;
      downloadText(
        fossflowJson(modelToFossflow(placed, (t) => colours.get(t) ?? "#000", state.file.name)),
        buildExportFilename("boards", null, state.shownMilestone, "json", state.mode)
      );
    },
  };
}
