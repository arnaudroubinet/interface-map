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

// Les sept exports, hors de la fermeture de mountApp.
//
// Ils y vivaient parmi dix-huit fonctions imbriquées, et l'on ne pouvait en
// éprouver aucun sans monter le DOM entier. Or ils ne dépendent que de quatre
// choses : l'état, de quoi le remplacer, le SVG à l'écran et la matrix
// affichée. C'est ce contrat-là qui est déclaré ci-dessous, et il tient en
// quatre lignes.
//
// Les fonctions sont demandées plutôt que les valeurs : l'état change à chaque
// rendu, et un gestionnaire câblé une fois doit lire l'état du moment où on
// clique, pas celui d'où on l'a construit.
export interface ExportContext {
  legacyState: () => AppState;
  setState: (state: AppState) => void;
  // Le schéma à l'écran. Absent sur la matrix, le rapport et l'aide.
  svgCourant: () => SVGSVGElement | null;
  // La matrix AFFICHÉE, et non recalculée au clic : la recalculer risquerait
  // de livrer autre chose que ce que l'utilisateur a sous les yeux.
  currentMatrix: () => MatrixResult | null;
}

// Ce que le nom de fichier doit porter en plus de la vue : la sélection quand
// il y en a une, sans quoi deux lectures différentes se téléchargent sous le
// même nom.
function nameSelection(state: AppState): string | null {
  if (state.view === "by-actor") return state.actorSelection;
  if (state.view === "by-technology") return state.technologySelection;
  // Un écart se lit ENTRE deux paliers : le nom doit porter les deux. Le palier
  // d'arrivée est déjà ajouté par ailleurs.
  if (state.view === "changes") return state.comparedMilestone;
  return null;
}

// Le palier affiché vaut pour tout ce qui décrit le MODÈLE plutôt qu'une
// planche : ces exports ne portent ni nom de vue ni sélection.
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
        // Le message vient de l'export : il en distingue deux, et le recopier
        // ici en avait effacé un.
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
      // Pas de mode ici : le rapport juge le CLASSEUR, pas une lecture du
      // classeur (§5.3). Son contenu ne bouge pas d'un mode à l'autre, son nom
      // ne doit donc pas bouger non plus.
      downloadText(
        reportToMarkdown(state.file.report, state.file.name, state.shownMilestone),
        fileName("md", false)
      );
    },

    // Le fichier draw.io porte TOUTES les planches, une par onglet : il ne
    // dépend pas de la vue ouverte. Les placements se calculent à la demande --
    // une soixantaine de planches tient en moins d'une seconde, et les garder
    // au chaud obligerait à les refaire à chaque changement de palier.
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
          // Chaque page se décrit, comme chaque SVG : draw.io est le format
          // destiné à CIRCULER, et ses pages partaient sans titre ni légende.
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
