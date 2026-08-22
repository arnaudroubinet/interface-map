import { el, clear } from "../shared/dom";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel, SCHEMA_VERSION } from "../parsing/build-model";
import { rankOfMilestone } from "../aggregation/milestones";
import { reading as readingOfMode } from "../aggregation/reading";
import { computeChanges, buildEcartsView } from "../aggregation/changes";
import { buildEcartsReport, buildChangesDiagramTitle } from "../render/changes-report";
import { runIntegrityChecks } from "../integrity/checks";
import {
  buildGroupToGroupView,
  buildPlatformDetailView,
  buildPlatformOnlyView,
  buildByTechnologyView,
  buildByActorView,
  buildMatrixView,
  type MatrixResult,
} from "../aggregation/views";
import { businessActors } from "../aggregation/nature";
import { computeLayout, restrictLayout, type LayoutResult } from "../layout/graph-layout";
import { allBoards } from "../aggregation/boards";
import { buildGraphSvg } from "../render/svg-builder";
import { titleBlockText, type DiagramContext } from "../render/title-block";
import { brancherZoom } from "../render/zoom";
import { scaleHint } from "./scale";
import { availableChains, buildChainView } from "../aggregation/chain";
import { buildRoadmap } from "../aggregation/roadmap";
import { buildRoadmapSvg } from "../render/roadmap";
import type { Reading } from "../aggregation/reading";
import { unionReading } from "../aggregation/reading";
import type { ViewResult } from "../aggregation/views";
import type { GraphNode, GraphEdge } from "../aggregation/core";
import { buildMatrixTable } from "../render/matrix-table";
import { buildIntegrityReport } from "../render/integrity-report";
import { coloursOfModel } from "../render/colors";
import { buildExportFilename } from "../export/filename";
import { downloadMatrixXlsx } from "../export/xlsx-export";
import { downloadTemplateXlsx } from "../export/template-export";
import { SAMPLE_DATA } from "../export/sample-data";
import { downloadSvg } from "../export/svg-export";
import { exportPng, downloadPngBlob } from "../export/png-export";
import { reportToMarkdown } from "../export/markdown-report";
import { downloadText } from "../export/download";
import { buildDrawio } from "../export/drawio-export";
import { modelToStructurizr } from "../export/c4-dsl";
import { modelToLikeC4 } from "../export/likec4-dsl";
import { buildDropTarget, wireDropZone } from "./drop-zone";
import { buildUpgradeScreen } from "../render/upgrade-screen";
import { buildAide } from "../render/help";
import { upgrade } from "../export/schema-upgrade";
import { renderBanner } from "./banner";
import { handlersExport } from "./export-handlers";
import { renderRail, renderRailFoot } from "./rail";
import { openMigration } from "./upgrade-dialog";
import {
  initialState,
  withLoadedFile,
  withView,
  withMode,
  withOptions,
  withActorSelection,
  withTechnologySelection,
  withChainSelection,
  withVoisinage,
  withSujetFrise,
  withTechnoMasquee,
  withActorHidden,
  withMasquerExternes,
  withActorHiddenForTechnology,
  withMasquerExternesMatrice,
  withActorHiddenInMatrix,
  withMatrixGrain,
  withMatrixOrder,
  withDisplayedMilestone,
  withComparedMilestone,
  withMessageBandeau,
  viewOnLoad,
  VIEW_LABEL,
  type AppState,
  type LoadedFile,
  type View,
} from "./state";


// The three framing controls, set under the diagram: "Fit" comes back to the
// full frame, the other two zoom around the centre. They live here rather than
// in the banner because they drive THAT diagram, the one just built.
//
function buildZoomControls(commandes: { ajuster: () => void; zoomBy: (f: number) => void }): HTMLElement {
  const toolbar = el("div", { class: "zoom-controls" });
  const button = (label: string, title: string, action: () => void) => {
    const b = el("button", { type: "button", title: title }, [label]);
    b.addEventListener("click", action);
    toolbar.appendChild(b);
  };
  button("Fit", "Fit the whole board", commandes.ajuster);
  button("−", "Zoom out", () => commandes.zoomBy(1 / 1.3));
  button("+", "Zoom in", () => commandes.zoomBy(1.3));
  return toolbar;
}

// What the diagram will say about itself. Everything comes from the state: the
// view, the reading, the displayed milestone, the file's name and its save
// date -- it is the DATA's age that counts, not the printing's.
function diagramContext(state: AppState, file: LoadedFile, view: { nodes: GraphNode[]; edges: GraphEdge[] }): DiagramContext {
  return {
    title: VIEW_LABEL[state.view],
    reading: state.mode === "functional" ? "functional" : "architecture",
    milestone: state.shownMilestone,
    source: file.name,
    date: file.dateModification ? file.dateModification.toISOString().slice(0, 10) : "save date unknown",
    components: view.nodes.filter((n) => n.kind !== "boundary").length,
    flows: view.edges.length,
    technologies: new Set(view.edges.map((e) => e.technology).filter(Boolean)).size,
  };
}

export function mountApp(root: HTMLElement): void {
  let state: AppState = initialState();

  root.innerHTML = "";
  const banner = el("header", { class: "banner" });
  const rail = el("aside", { class: "rail" });
  const renderArea = el("main", { class: "render-area" });
  const layout = el("div", { class: "layout" }, [rail, renderArea]);
  root.appendChild(banner);
  root.appendChild(layout);

  wireDropZone(root, handleFile);

  // The report depends on the displayed milestone for its "state of the
  // platform" part (§7.1): it is therefore recomputed at every milestone
  // change, and not only on load.
  function recomputeReport(s: AppState): AppState {
    if (!s.file) return s;
    const rank = s.shownMilestone === null ? null : rankOfMilestone(s.file.model, s.shownMilestone) ?? null;
    return { ...s, file: { ...s.file, report: runIntegrityChecks(s.file.model, rank) } };
  }

  function setState(next: AppState): void {
    state = next;
    render();
  }

  async function handleFile(file: File): Promise<void> {
    try {
      const okName = /\.(xlsx|xlsm)$/i.test(file.name);
      if (!okName) {
        setState(withMessageBandeau(state, "That is not an Excel workbook. Drop an .xlsx or .xlsm file."));
        return;
      }

      let parsed;
      try {
        parsed = parseWorkbook(await file.arrayBuffer());
      } catch {
        setState(withMessageBandeau(state, "Workbook unreadable or corrupted."));
        return;
      }

      const built = buildModel(parsed);
      if (!built.ok) {
        setState(withMessageBandeau(state, built.errors.map((e) => e.message).join(" ")));
        return;
      }

      // A workbook from a newer version is not read at all: guessing the shape
      // of a format one does not know would produce wrong diagrams, which is
      // worse than showing nothing.
      if (built.model.schemaVersion > SCHEMA_VERSION) {
        setState(
          withMessageBandeau(
            state,
            `This workbook follows model v${built.model.schemaVersion}, produced by a newer version of the tool. Update the tool to open it.`
          )
        );
        return;
      }

      // One estate's positions mean nothing on another.
      placements.clear();

      const report = runIntegrityChecks(built.model);
      // The report carried by withLoadedFile is not yet set on the current
      // milestone (recomputeReport replaces it right afterwards): the landing
      // view must therefore be decided again on the final report, otherwise an
      // anomaly that exists only at a retired milestone opens on a checks screen
      // showing (0) everywhere.
      let loaded = recomputeReport(
        withLoadedFile(state, {
          name: file.name,
          model: built.model,
          report,
          dateModification: parsed.savedAt,
        })
      );
      if (loaded.file) loaded = withView(loaded, viewOnLoad(loaded.file));
      setState(loaded);
    } catch (err) {
      // A safety net: a well-formed workbook whose content triggers an
      // unexpected exception further down the pipeline must never leave an
      // unhandled promise rejection (§9 — never a silent failure).
      console.error(err);
      setState(withMessageBandeau(state, "Workbook unreadable or corrupted."));
    }
  }

  // Incremented at every diagram request: only the last one may write into
  // the render area.
  let renderGeneration = 0;
  // The layouts already computed, by (view, reading, filters) -- without the
  // milestone. Cleared when another workbook is loaded: one estate's positions
  // mean nothing on another.
  const placements = new Map<string, Promise<LayoutResult>>();
  // The displayed matrix, kept for the export: recomputing it on click would
  // risk delivering something other than what is on screen.
  let currentMatrix: MatrixResult | null = null;

  function currentSvg(): SVGSVGElement | null {
    return renderArea.querySelector("svg");
  }










  function downloadTemplateHandler(): void {
    downloadTemplateXlsx("carto-interfaces-modele.xlsx");
  }

  function migrationLegacyHandler(): void {
    openMigration();
  }

  function downloadSampleHandler(): void {
    downloadTemplateXlsx("carto-interfaces-exemple.xlsx", SAMPLE_DATA);
  }

  // The seven exports live in their own module: they depend only on the state,
  // on a way to replace it, on the diagram on screen and on the displayed
  // matrix. They are built once, with lazy reads -- a handler wired on the first
  // render must read the state at click time, not the one at its construction.
  //
  const exportHandlers = handlersExport({
    legacyState: () => state,
    setState,
    svgCourant: currentSvg,
    currentMatrix: () => currentMatrix,
  });

  function render(): void {
    if (!state.file) {
      clear(rail);
      renderRailFoot(rail, {
        onDownloadTemplate: downloadTemplateHandler,
        onDownloadSample: downloadSampleHandler,
        onMigrationLegacy: migrationLegacyHandler,
      });
      clear(renderArea);
      // The help page is read BEFORE one has a workbook: that is precisely when
      // one wonders what the tool expects.
      if (state.view === "help") {
        const result = el("button", { class: "export-button" }, ["Back"]);
        result.addEventListener("click", () => setState(withView(state, "group-to-group")));
        renderArea.appendChild(el("div", { class: "help-standalone" }, [result, buildAide()]));
      } else {
        renderArea.appendChild(
          buildDropTarget(downloadSampleHandler, () => setState(withView(state, "help")))
        );
      }
      renderBanner(banner, state, false, exportHandlers);
      return;
    }

    try {
      renderContent(state.file);
    } catch (err) {
      // An unanticipated data case must never leave a blank, mute screen
      // (§9/§10.3) — the previous view stays replaced (the drop succeeded), but a
      // message is shown rather than a silent exception. The rail is NOT cleared:
      // renderContent() would have rebuilt it as its last step, so the old one
      // stays displayed and stays navigable — clearing it would turn a view into
      // a dead end with no navigation.
      console.error(err);
      clear(renderArea);
      renderArea.appendChild(el("p", { class: "no-flow" }, ["Unexpected error while rendering this view."]));
    }

    renderBanner(banner, state, currentSvg() !== null, exportHandlers);
  }

  function renderContent(file: LoadedFile): void {
    const model = file.model;
    // The displayed milestone's rank, resolved once: it is what runs through the
    // views, the filters and the exports.
    const rank = state.shownMilestone === null ? null : rankOfMilestone(model, state.shownMilestone) ?? null;
    // Resolved once, here, and passed to everything that draws (views, rail
    // filters): it is the Reading (rank, mode) that decides the flows AND the
    // actors, never a view.
    const reading = readingOfMode(model, rank, state.mode);
    const options = { ...state.options };
    currentMatrix = null;
    clear(renderArea);
    let currentTechnologies: string[] = [];

    if (state.view === "upgrade") {
      renderArea.appendChild(
        buildUpgradeScreen(model.schemaVersion, SCHEMA_VERSION, () => {
          const name = file.name.replace(/\.(xlsx|xlsm)$/i, "");
          downloadTemplateXlsx(`${name}-v${SCHEMA_VERSION}.xlsx`, upgrade(model));
        })
      );
    } else if (state.view === "changes") {
      // The two milestones compared; with no axis declared, there is nothing to compare.
      const comparedRank = state.comparedMilestone === null ? null : rankOfMilestone(model, state.comparedMilestone) ?? null;
      if (rank === null || comparedRank === null) {
        // One milestone is not "no milestone": comparing asks for two bounds, but
        // the workbook is not silent about its time axis for all that -- lending it
        // that absence would be a false cause.
        const text =
          model.milestones.length === 0
            ? "This workbook declares no milestones, so there is no change to measure."
            : "This workbook declares only one milestone; comparing needs two.";
        renderArea.appendChild(el("p", { class: "no-flow" }, [text]));
      } else {
        renderArea.appendChild(
          buildEcartsReport(
            computeChanges(model, comparedRank, rank, state.mode),
            state.comparedMilestone!,
            state.shownMilestone!
          )
        );
        // The diagram comes after the listing: one first reads what changed, then
        // goes to see where. It arrives later, the layout being asynchronous, and a
        // generation counter protects it from a stale display.
        const generation = ++renderGeneration;
        const changesView = buildEcartsView(model, comparedRank, rank, state.mode);
        if (changesView.edges.length > 0) {
          const colours = coloursOfModel(model);
          renderArea.appendChild(buildChangesDiagramTitle(state.comparedMilestone!, state.shownMilestone!));
          computeLayout(changesView.nodes, changesView.edges).then((positioned) => {
            if (generation !== renderGeneration) return;
            renderArea.appendChild(
              buildGraphSvg(positioned, (t) => colours.get(t) ?? "#000", diagramContext(state, file, changesView))
            );
            // The change diagram exports like the others. The buttons depend on it,
            // and it did not yet exist when the banner was rendered.
            renderBanner(banner, state, true, exportHandlers);
          });
        }
      }
    } else if (state.view === "help") {
      renderArea.appendChild(buildAide());
    } else if (state.view === "checks") {
      renderArea.appendChild(buildIntegrityReport(file.report));
    } else if (state.view === "roadmap") {
      // No ELK: a roadmap is a grid, an axis and one row per subject. The layout
      // engine would have nothing to place there.
      const timeline = buildRoadmap(model, state.roadmapSubject);
      if (timeline.segments.length === 0) {
        renderArea.appendChild(el("p", { class: "no-flow" }, ["This workbook declares no milestones, so there is no timeline to draw."]));
      } else {
        const svg = buildRoadmapSvg(timeline, state.shownMilestone, {
          ...diagramContext(state, file, { nodes: [], edges: [] }),
          detail: `${timeline.segments.length} ${state.roadmapSubject === "actors" ? "actors" : "interfaces"}, ${timeline.milestones.length} milestones`,
        });
        renderArea.appendChild(svg);
        renderArea.appendChild(buildZoomControls(brancherZoom(svg)));
        renderBanner(banner, state, true, exportHandlers);
      }
    } else if (state.view === "matrix") {
      const matrix = buildMatrixView(model, reading, {
        mode: state.mode,
        grain: state.matrixFilters.grain,
        order: state.matrixFilters.order,
        masquerExternes: state.matrixFilters.masquerExternes,
        hiddenActors: state.matrixFilters.hiddenActors,
      });
      currentMatrix = matrix;
      currentTechnologies = [...new Set(matrix.rows.flatMap((l) => [...l.cells.values()].flat().map((c) => c.technology)))];
      // The table first, the colour second. The palette stays indexed on the
      // types declared in the workbook, and not on the mere survivors of the
      // filtering: otherwise a technology would change colour from one filter to
      // the next, and between the matrix and the diagrams.
      const colours = coloursOfModel(model);
      renderArea.appendChild(
        buildMatrixTable(matrix, (t) => colours.get(t) ?? "#000", titleBlockText(diagramContext(state, file, { nodes: [], edges: [] })).title)
      );
    } else {
      // The SAME construction for the displayed milestone and for the union of
      // all milestones: that is what guarantees the two views correspond node for
      // node, hence that the union's layout restricts itself without inventing
      // anything.
      const buildView = (reading: Reading): ViewResult => {
      let view: ViewResult;
      if (state.view === "group-to-group") {
        view = buildGroupToGroupView(model, reading, options);
      } else if (state.view === "platform-detail") {
        view = buildPlatformDetailView(model, reading, options);
      } else if (state.view === "platform-only") {
        view = buildPlatformOnlyView(model, reading, options);
      } else if (state.view === "chain") {
        const chains = availableChains(model, rank);
        const kept = chains.find((c) => c.id === state.chainSelection);
        if (!kept && chains.length > 0) {
          defaultChain = chains[0].id;
        }
        view = kept ? buildChainView(model, kept) : { nodes: [], edges: [] };
      } else if (state.view === "by-actor") {
        // The same list as the rail's selector (§5.2): a default picked outside it
        // would name an actor the user cannot even see.
        const availableActors = reading.actors;
        if (!state.actorSelection && availableActors.length > 0) {
          defaultActor = [...availableActors].sort((a, b) => a.name.localeCompare(b.name, "fr"))[0].name;
        }
        view = state.actorSelection
          ? buildByActorView(model, reading.flows, state.actorSelection, {
              hiddenTechnologies: state.actorFilters.hiddenTechnologies,
              hiddenActors: state.actorFilters.hiddenActors,
              neighbourhood: state.actorFilters.neighbourhood,
            })
          : { nodes: [], edges: [] };
      } else {
        if (!state.technologySelection && model.flowTypes.length > 0) {
          besoinDeSelectionTechnologie = true;
        }
        view = state.technologySelection
          ? buildByTechnologyView(model, reading.flows, state.technologySelection, {
              counters: options.counters,
              edgeLabelMode: options.edgeLabelMode,
              masquerExternes: state.technologyFilters.masquerExternes,
              hiddenActors: state.technologyFilters.hiddenActors,
            })
          : { nodes: [], edges: [] };
      }
      return view;
      };

      let besoinDeSelectionTechnologie = false;
      let defaultActor: string | null = null;
      let defaultChain: string | null = null;
      const view = buildView(reading);
      if (defaultChain) {
        setState(withChainSelection(state, defaultChain));
        return;
      }
      if (defaultActor) {
        setState(withActorSelection(state, defaultActor));
        return;
      }
      if (besoinDeSelectionTechnologie) {
        setState(withTechnologySelection(state, [...model.flowTypes].sort((a, b) => a.type.localeCompare(b.type, "fr"))[0].type));
        return;
      }

      // An isolated business actor (§5.2) produces one node and zero edges: that
      // is not nothing to show, it is PRECISELY what must be shown. The message
      // only applies to a genuinely empty selection.
      if (view.nodes.length === 0) {
        renderArea.appendChild(el("p", { class: "no-flow" }, ["No flow to display for this selection."]));
      } else {
        // A board that has outgrown what node-link serves well must SAY so, and
        // offer somewhere to go. Never block, never truncate.
        const hint = scaleHint(view.nodes.filter((n) => n.kind !== "boundary").length, view.edges.length);
        if (hint) {
          const bandeauEchelle = el("div", { class: "scale-hint" }, [hint.message]);
          for (const target of hint.views) {
            const button = el("button", { type: "button" }, [VIEW_LABEL[target]]);
            button.addEventListener("click", () => setState(withView(withMessageBandeau(state, null), target)));
            bandeauEchelle.appendChild(button);
          }
          renderArea.appendChild(bandeauEchelle);
        }
        // The layout computation is asynchronous (ELK). A generation counter
        // protects against a stale render: if the user changes view during the
        // computation, the diagram arriving late must not display over the top.
        const generation = ++renderGeneration;
        const colours = coloursOfModel(model);
        const viewForComputation = view;
        // The UNION of all milestones is laid out once, and each milestone shows
        // only its subset: a box present at both milestones then does not move by a
        // pixel. The memo key therefore does NOT contain the milestone -- it is
        // precisely from one milestone to the next that continuity is wanted.
        //
        const layoutKey = JSON.stringify([
          state.view, state.mode, state.actorSelection, state.technologySelection, state.chainSelection,
          state.actorFilters, state.technologyFilters, options,
        ]);
        const unionView = buildView(unionReading(model, state.mode));
        const placement = placements.get(layoutKey) ?? computeLayout(unionView.nodes, unionView.edges);
        placements.set(layoutKey, placement);
        placement
          .then((union) => {
            if (generation !== renderGeneration) return;
            const positioned = restrictLayout(union, viewForComputation);
            const svg = buildGraphSvg(positioned, (t) => colours.get(t) ?? "#000", diagramContext(state, file, viewForComputation), {
              weightByCriticality: state.options.weightByCriticality,
            });
            renderArea.appendChild(svg);
            renderArea.appendChild(buildZoomControls(brancherZoom(svg)));
            // The export buttons depend on the presence of the SVG, which did not yet
            // exist when the banner was rendered.
            renderBanner(banner, state, true, exportHandlers);
          })
          .catch((err) => {
            if (generation !== renderGeneration) return;
            console.error(err);
            clear(renderArea);
            renderArea.appendChild(el("p", { class: "no-flow" }, ["Unexpected error while rendering this view."]));
          });
        currentTechnologies = [...new Set(view.edges.map((e) => e.technology))];
      }
    }

    renderRail(rail, state, reading, currentTechnologies.sort((a, b) => a.localeCompare(b, "fr")), {
      onMode: (mode) => setState(withMode(state, mode)),
      onView: (view) => setState(withView(withMessageBandeau(state, null), view)),
      onActorSelection: (name) => setState(withActorSelection(withMessageBandeau(state, null), name)),
      onWeightByCriticality: (value) => setState(withOptions(withMessageBandeau(state, null), { weightByCriticality: value })),
      onRoadmapSubject: (value) => setState(withSujetFrise(withMessageBandeau(state, null), value)),
      onNeighbourhood: (value) => setState(withVoisinage(withMessageBandeau(state, null), value)),
      onChainSelection: (chain) => setState(withChainSelection(withMessageBandeau(state, null), chain)),
      onTechnologySelection: (type) => setState(withTechnologySelection(withMessageBandeau(state, null), type)),
      onDisplayedMilestone: (milestone) => setState(recomputeReport(withDisplayedMilestone(withMessageBandeau(state, null), milestone))),
      onComparedMilestone: (milestone) => setState(withComparedMilestone(withMessageBandeau(state, null), milestone)),
      onCounterOption: (value) => setState(withOptions(withMessageBandeau(state, null), { counters: value })),
      onEdgeLabel: (value) => setState(withOptions(withMessageBandeau(state, null), { edgeLabelMode: value })),
      onDownloadTemplate: downloadTemplateHandler,
      onDownloadSample: downloadSampleHandler,
      onMigrationLegacy: migrationLegacyHandler,
      onTechnologyHidden: (tech, hidden) => setState(withTechnoMasquee(withMessageBandeau(state, null), tech, hidden)),
      onActorHidden: (actor, hidden) => setState(withActorHidden(withMessageBandeau(state, null), actor, hidden)),
      onMasquerExternes: (value) => setState(withMasquerExternes(withMessageBandeau(state, null), value)),
      onActorHiddenForTechnology: (actor, hidden) =>
        setState(withActorHiddenForTechnology(withMessageBandeau(state, null), actor, hidden)),
      onHideExternalsInMatrix: (value) => setState(withMasquerExternesMatrice(withMessageBandeau(state, null), value)),
      onActorHiddenInMatrix: (actor, hidden) =>
        setState(withActorHiddenInMatrix(withMessageBandeau(state, null), actor, hidden)),
      onPngScale: (value) => setState(withOptions(withMessageBandeau(state, null), { pngScale: value })),
      onMatrixOrder: (value) => setState(withMatrixOrder(withMessageBandeau(state, null), value)),
      onMatrixGrain: (grain) => setState(withMatrixGrain(withMessageBandeau(state, null), grain)),
    });
  }

  render();
}
