import type { AppState } from "./state";
import { VIEW_LABEL, withMessageBandeau } from "./state";
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

// The seven exports, outside mountApp's closure.
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

  return {
    onExportSvg() {
      const svg = ctx.svgCourant();
      if (!svg || !ctx.legacyState().file) return;
      downloadSvg(svg, fileName("svg"), "#ffffff");
    },

    async onExportPng() {
      const svg = ctx.svgCourant();
      if (!svg || !ctx.legacyState().file) return;
      const result = await exportPng(svg, "#ffffff", ctx.legacyState().options.pngScale);
      if (!result.ok) {
        // The message comes from the export: it distinguishes two of them, and
        // copying it here had erased one.
        ctx.setState(withMessageBandeau(ctx.legacyState(), result.error));
        return;
      }
      downloadPngBlob(result.blob, fileName("png"));
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
      const model = state.file.model;
      const colours = coloursOfModel(model);
      const placed = [];
      for (const board of allBoards(model, shownRank(state), state.mode)) {
        const layout = await computeLayout(board.nodes, board.edges);
        placed.push({
          title: board.title,
          actor: board.actor,
          layout,
          // Each page describes itself, like each SVG: draw.io is the format meant to
          // CIRCULATE, and its pages used to leave with neither title nor legend.
          context: {
            title: board.title,
            reading: state.mode === "functional" ? "functional" : "architecture",
            milestone: state.shownMilestone,
            source: state.file.name,
            date: state.file.dateModification
              ? state.file.dateModification.toISOString().slice(0, 10)
              : "save date unknown",
            components: board.nodes.filter((n) => n.kind !== "boundary").length,
            flows: board.edges.length,
            technologies: new Set(board.edges.map((e) => e.technology).filter(Boolean)).size,
          },
        });
      }
      downloadText(
        buildDrawio(placed, (t) => colours.get(t) ?? "#000"),
        buildExportFilename("boards", null, state.shownMilestone, "drawio", state.mode)
      );
    },

    onExportStructurizr() {
      const state = ctx.legacyState();
      if (!state.file) return;
      downloadText(
        modelToStructurizr(state.file.model, shownRank(state), state.file.name, state.shownMilestone, state.mode),
        buildExportFilename("model", null, state.shownMilestone, "dsl")
      );
    },

    onExportLikeC4() {
      const state = ctx.legacyState();
      if (!state.file) return;
      downloadText(
        modelToLikeC4(state.file.model, shownRank(state), state.mode),
        buildExportFilename("model", null, state.shownMilestone, "c4")
      );
    },
  };
}
