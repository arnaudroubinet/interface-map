import { el, clear } from "../shared/dom";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel, SCHEMA_VERSION } from "../parsing/build-model";
import { rankOfMilestone } from "../aggregation/milestones";
import { reading as readingOfMode } from "../aggregation/reading";
import { computeChanges, buildChangesView } from "../aggregation/changes";
import { buildChangesReport, buildChangesDiagramTitle } from "../render/changes-report";
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
import { computeLayout, restrictLayout, type LayoutResult } from "../layout/graph-layout";
import { allBoards } from "../aggregation/boards";
import { buildGraphSvg } from "../render/svg-builder";
import { isoBoard, buildIsoSvg } from "../render/iso-view";
import { annealPlacement } from "../render/iso-anneal";
import type { FossflowView } from "../export/fossflow-json";
import { titleBlockText, type DiagramContext } from "../render/title-block";
import { wireZoom } from "../render/zoom";
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
import { downloadTemplateXlsx, writeTemplate } from "../export/template-export";
import { readReferentialWorkbook, referentialDrifted } from "../parsing/referential-workbook";
import type { ReferentialRows } from "../parsing/referential-shape";
import { SAMPLE_DATA } from "../export/sample-data";
import { downloadSvg } from "../export/svg-export";
import { exportPng, downloadPngBlob } from "../export/png-export";
import { reportToMarkdown } from "../export/markdown-report";
import { downloadText, downloadWorkbook } from "../export/download";
import { buildDrawio } from "../export/drawio-export";
import { modelToStructurizr } from "../export/c4-dsl";
import { modelToLikeC4 } from "../export/likec4-dsl";
import { buildDropTarget, wireDropZone } from "./drop-zone";
import { buildUpgradeScreen } from "../render/upgrade-screen";
import { buildHelp } from "../render/help";
import { upgrade, dataFromModel } from "../export/schema-upgrade";
import { renderBanner } from "./banner";
import { handlersExport } from "./export-handlers";
import { renderRail, renderRailFoot } from "./rail";
import { openMigration } from "./upgrade-dialog";
import {
  initialState,
  withLoadedFile,
  withComparedFile,
  withView,
  withMode,
  withOptions,
  withActorSelection,
  withTechnologySelection,
  withChainSelection,
  withNeighbourhood,
  withRoadmapSubject,
  withTechnologyHidden,
  withActorHidden,
  withHideExternals,
  withActorHiddenForTechnology,
  withHideExternalsInMatrix,
  withActorHiddenInMatrix,
  withMatrixGrain,
  withMatrixOrder,
  withDisplayedMilestone,
  withComparedMilestone,
  withBannerMessage,
  withReferentialCheck,
  viewOnLoad,
  VIEW_LABEL,
  type AppState,
  type LoadedFile,
  type ReferentialCheck,
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
    date: file.modifiedAt ? file.modifiedAt.toISOString().slice(0, 10) : "save date unknown",
    components: view.nodes.filter((n) => n.kind !== "boundary").length,
    flows: view.edges.length,
    technologies: new Set(view.edges.map((e) => e.technology).filter(Boolean)).size,
    // The by-actor board is the C4 context view: "the nearest inbound and
    // outbound dependencies". elk.direction RIGHT already lays the inbound on
    // the left and the outbound on the right -- it just never said so, and a
    // reader had no reason to think the two sides meant anything.
    layoutNote: state.view === "by-actor" ? "inbound left, outbound right" : undefined,
  };
}

// What reading a workbook actually needs of a File: its name, and its bytes.
// The sample is not a File -- it is written in memory -- and must nonetheless
// go through the very same path as a dropped one, refusals included.
type WorkbookSource = { name: string; arrayBuffer: () => Promise<ArrayBuffer> };

// A dropped file, once told apart. Two kinds of workbook land on the same
// target -- the cartography and its referential -- and the tool, not the
// reader, says which is which: they are recognised by their shape, never by
// their name or by the order they were dropped in.
type DroppedFile =
  | { kind: "cartography"; loaded: LoadedFile }
  | { kind: "referential"; name: string; rows: ReferentialRows }
  | { kind: "refused"; message: string };

// The name the refreshed workbook is handed back under: the one it came in
// with, so that replacing the file on disk is a matter of saying yes. An .xlsm
// comes back as .xlsx -- the tool writes no macro, and has not for some time.
function refreshedName(name: string): string {
  return `${name.replace(/\.(xlsx|xlsm)$/i, "")}.xlsx`;
}

// One name for the sample, whether it is downloaded or opened: the title block
// of every diagram carries it, and two names for the same workbook would read
// as two workbooks.
const SAMPLE_FILENAME = "carto-interfaces-exemple.xlsx";

export function mountApp(root: HTMLElement): void {
  let state: AppState = initialState();

  root.innerHTML = "";
  const banner = el("header", { class: "banner" });
  const rail = el("aside", { class: "rail" });
  const renderArea = el("main", { class: "render-area" });
  const layout = el("div", { class: "layout" }, [rail, renderArea]);
  root.appendChild(banner);
  root.appendChild(layout);

  // On a phone the rail is a drawer: a floating button opens it, picking a
  // view closes it, and so does touching the board behind it. On a desktop
  // none of this exists -- the button is display:none and the class inert.
  const railToggle = el("button", { class: "rail-toggle", type: "button", "aria-expanded": "false" }, ["☰ Views"]);
  const setDrawer = (open: boolean) => {
    layout.classList.toggle("rail-open", open);
    railToggle.setAttribute("aria-expanded", String(open));
  };
  railToggle.addEventListener("click", () => setDrawer(!layout.classList.contains("rail-open")));
  root.appendChild(railToggle);
  rail.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest(".rail-view-item")) setDrawer(false);
  });
  layout.addEventListener("click", (e) => {
    if (!layout.classList.contains("rail-open")) return;
    if ((e.target as HTMLElement).closest(".rail")) return;
    setDrawer(false);
  });

  wireDropZone(root, handleFiles);

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

  // Read a dropped workbook, or say why it cannot be read. Both the main drop
  // target and the "compare with" field go through here: the same file must be
  // refused for the same reason and in the same words, whichever of the two it
  // was handed to.
  //
  // A referential is told apart BEFORE the cartography's model is built: it
  // shares three sheet names with a cartography, and read as one it would be
  // refused for lacking an interface catalogue -- which is exactly what it is
  // supposed to lack.
  async function readWorkbook(file: WorkbookSource): Promise<DroppedFile> {
    if (!/\.(xlsx|xlsm)$/i.test(file.name)) {
      return { kind: "refused", message: "That is not an Excel workbook. Drop an .xlsx or .xlsm file." };
    }

    let parsed;
    try {
      parsed = parseWorkbook(await file.arrayBuffer());
    } catch {
      return { kind: "refused", message: "Workbook unreadable or corrupted." };
    }

    const referential = readReferentialWorkbook(parsed);
    if (referential) return { kind: "referential", name: file.name, rows: referential };

    const built = buildModel(parsed);
    if (!built.ok) return { kind: "refused", message: built.errors.map((e) => e.message).join(" ") };

    // A workbook from a newer version is not read at all: guessing the shape
    // of a format one does not know would produce wrong diagrams, which is
    // worse than showing nothing.
    if (built.model.schemaVersion > SCHEMA_VERSION) {
      return {
        kind: "refused",
        message: `This workbook follows model v${built.model.schemaVersion}, produced by a newer version of the tool. Update the tool to open it.`,
      };
    }

    return {
      kind: "cartography",
      loaded: {
        name: file.name,
        model: built.model,
        report: runIntegrityChecks(built.model),
        modifiedAt: parsed.savedAt,
      },
    };
  }

  // The cartography's copy of the referential, held against what the dropped
  // referential publishes.
  //
  // Up to date, nothing moves: the verdict is all that is kept. Drifted, the
  // workbook is REBUILT with the referential's rows -- through the same path as
  // an upgrade, so a stale workbook comes out at the current model as well --
  // and read back through readWorkbook like any dropped file: what the screen
  // shows is the file that will be downloaded, not a model patched in memory
  // that the file on disk would then contradict.
  async function checkedAgainst(
    loaded: LoadedFile,
    referential: { name: string; rows: ReferentialRows }
  ): Promise<{ loaded: LoadedFile; check: ReferentialCheck }> {
    const held = dataFromModel(loaded.model).referentialRows ?? {};
    if (!referentialDrifted(held, referential.rows)) {
      return { loaded, check: { referential: referential.name, drifted: false } };
    }
    const bytes = writeTemplate({ ...upgrade(loaded.model), referentialRows: referential.rows });
    const reread = await readWorkbook({ name: loaded.name, arrayBuffer: async () => bytes });
    // The tool has just written this file: not reading it back is its own bug,
    // and the safety net in handleFiles says so rather than showing a stale view
    // beside a fresh download.
    if (reread.kind !== "cartography") throw new Error(`refreshed workbook not readable: ${reread.kind}`);
    return {
      loaded: reread.loaded,
      check: { referential: referential.name, drifted: true, filename: refreshedName(loaded.name), bytes },
    };
  }

  // The workbook the Changes view measures against. It is read exactly like the
  // main one -- same refusals, same words -- but it never replaces what is on
  // screen: it is a second term, not a new subject.
  async function handleComparedFile(file: WorkbookSource | null): Promise<void> {
    if (file === null) {
      setState(withComparedFile(state, null));
      return;
    }
    try {
      const read = await readWorkbook(file);
      if (read.kind === "refused") {
        setState(withBannerMessage(state, read.message));
        return;
      }
      if (read.kind === "referential") {
        setState(withBannerMessage(state, `${read.name} is a referential, not a cartography: there is nothing to compare it with.`));
        return;
      }
      setState(withComparedFile(withBannerMessage(state, null), read.loaded));
    } catch (err) {
      console.error(err);
      setState(withBannerMessage(state, "Workbook unreadable or corrupted."));
    }
  }

  // A cartography takes the screen: what it replaces, it replaces whole. The
  // verdict on the referential, when one came with it, is set AFTER
  // withLoadedFile, which clears the previous one -- another file, another
  // verdict due.
  function showLoaded(loaded: LoadedFile, check: ReferentialCheck | null): void {
    // One estate's positions mean nothing on another.
    placements.clear();
    annealed.clear();

    // The report carried by withLoadedFile is not yet set on the current
    // milestone (recomputeReport replaces it right afterwards): the landing
    // view must therefore be decided again on the final report, otherwise an
    // anomaly that exists only at a retired milestone opens on a checks screen
    // showing (0) everywhere.
    let next = recomputeReport(withReferentialCheck(withLoadedFile(state, loaded), check));
    if (next.file) next = withView(next, viewOnLoad(next.file));
    setState(next);
  }

  // Everything dropped, in one gesture, whatever it holds. One cartography at
  // most, one referential at most -- the tool draws ONE workbook, and two
  // referentials would be two truths -- and any refusal stops the lot: reading
  // half of a drop would leave the reader to guess which half.
  //
  // A referential on its own applies to the workbook already on screen, when
  // there is one: dropping the two together and dropping the second afterwards
  // must come to the same, or the order of a gesture would carry a meaning.
  async function handleFiles(files: WorkbookSource[]): Promise<void> {
    try {
      const read = await Promise.all(files.map((f) => readWorkbook(f)));
      const refused = read.find((r): r is DroppedFile & { kind: "refused" } => r.kind === "refused");
      if (refused) {
        setState(withBannerMessage(state, refused.message));
        return;
      }
      const cartographies = read.filter((r): r is DroppedFile & { kind: "cartography" } => r.kind === "cartography");
      const referentials = read.filter((r): r is DroppedFile & { kind: "referential" } => r.kind === "referential");
      if (cartographies.length > 1) {
        setState(withBannerMessage(state, "Several cartographies dropped at once: drop one, with its referential if you like."));
        return;
      }
      if (referentials.length > 1) {
        setState(withBannerMessage(state, "Several referentials dropped at once: a cartography follows one."));
        return;
      }

      const referential = referentials[0];
      const cartography = cartographies[0];
      if (cartography) {
        const { loaded, check } = referential ? await checkedAgainst(cartography.loaded, referential) : { loaded: cartography.loaded, check: null };
        showLoaded(loaded, check);
        return;
      }

      // Nothing at all: the drop zones never hand over an empty drop, and the
      // sample always comes as one file, so this is a guard, not a case.
      if (!referential) return;

      // A referential, and nothing to apply it to.
      if (!state.file) {
        setState(
          withBannerMessage(state, `${referential.name} is a referential. Drop the cartography workbook it applies to — with it, or before it.`)
        );
        return;
      }
      const { loaded, check } = await checkedAgainst(state.file, referential);
      if (check.drifted) showLoaded(loaded, check);
      else setState(withReferentialCheck(withBannerMessage(state, null), check));
    } catch (err) {
      // A safety net: a well-formed workbook whose content triggers an
      // unexpected exception further down the pipeline must never leave an
      // unhandled promise rejection (§9 — never a silent failure).
      console.error(err);
      setState(withBannerMessage(state, "Workbook unreadable or corrupted."));
    }
  }

  // Incremented at every diagram request: only the last one may write into
  // the render area.
  let renderGeneration = 0;
  // The layouts already computed, by (view, reading, filters) -- without the
  // milestone. Cleared when another workbook is loaded: one estate's positions
  // mean nothing on another.
  const placements = new Map<string, Promise<LayoutResult>>();
  // The isometric placements the background search has already improved, by
  // (layout, milestone): a board once annealed comes back as it was left,
  // and the search is not paid twice for one board.
  const annealed = new Map<string, FossflowView>();
  // The displayed matrix, kept for the export: recomputing it on click would
  // risk delivering something other than what is on screen.
  let currentMatrix: MatrixResult | null = null;

  function currentSvg(): SVGSVGElement | null {
    return renderArea.querySelector("svg");
  }










  function downloadTemplateHandler(): void {
    downloadTemplateXlsx("carto-interfaces-modele.xlsx");
  }

  function legacyMigrationHandler(): void {
    openMigration();
  }

  function downloadSampleHandler(): void {
    downloadTemplateXlsx(SAMPLE_FILENAME, SAMPLE_DATA);
  }

  // The landing screen's offer is to SEE the tool at work: it used to hand back
  // a file to download, which on a phone lands in a folder the page cannot
  // reach -- the offer led nowhere. The sample is written in memory and read
  // through the very same path as a dropped workbook, so it is checked, dated
  // and reported on exactly like one. The rail's foot still offers to download
  // it, for whoever wants the file itself.
  function openSampleHandler(): void {
    const bytes = writeTemplate(SAMPLE_DATA);
    void handleFiles([{ name: SAMPLE_FILENAME, arrayBuffer: async () => bytes }]);
  }

  // The workbook rebuilt with the referential's rows, as the banner offers it.
  // The bytes are the ones on screen -- checkedAgainst read them back -- so
  // what is downloaded is what is shown, to the byte.
  function downloadRefreshedHandler(): void {
    const check = state.referentialCheck;
    if (!check || !check.drifted) return;
    downloadWorkbook(check.bytes, check.filename);
  }

  // The nine exports live in their own module: they depend only on the state,
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
  // The banner's one action that is not an export: handing back the workbook
  // refreshed from a dropped referential.
  const bannerActions = { ...exportHandlers, onDownloadRefreshed: downloadRefreshedHandler };

  function render(): void {
    if (!state.file) {
      clear(rail);
      renderRailFoot(rail, {
        onDownloadTemplate: downloadTemplateHandler,
        onDownloadSample: downloadSampleHandler,
        onMigrationLegacy: legacyMigrationHandler,
      });
      clear(renderArea);
      // The help page is read BEFORE one has a workbook: that is precisely when
      // one wonders what the tool expects.
      if (state.view === "help") {
        const result = el("button", { class: "export-button" }, ["Back"]);
        result.addEventListener("click", () => setState(withView(state, "group-to-group")));
        renderArea.appendChild(el("div", { class: "help-standalone" }, [result, buildHelp()]));
      } else {
        renderArea.appendChild(
          buildDropTarget({
            onFiles: handleFiles,
            onOpenSample: openSampleHandler,
            onHelp: () => setState(withView(state, "help")),
          })
        );
      }
      renderBanner(banner, state, false, bannerActions);
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

    renderBanner(banner, state, currentSvg() !== null, bannerActions);
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
      const compared = state.comparedFile;
      if (compared) {
        // Two workbooks: both sides read WHOLE. Their milestone names have no
        // reason to match, and picking one on either side would state an
        // equivalence nobody entered -- the report says so in its first line.
        const comparison = { before: compared.name, after: file.name, kind: "workbook" as const };
        const before = { model: compared.model, rank: null };
        const after = { model, rank: null };
        renderArea.appendChild(buildChangesReport(computeChanges(before, after, state.mode), comparison));

        const generation = ++renderGeneration;
        const changesView = buildChangesView(before, after, state.mode);
        if (changesView.edges.length > 0) {
          const colours = coloursOfModel(model);
          renderArea.appendChild(buildChangesDiagramTitle(comparison));
          // An exported SVG travels alone: its title block is the only thing
          // that says what it shows. Both sides are read whole here, so the
          // displayed milestone has nothing to do with this drawing --
          // announcing it would be a plain falsehood, in the one place the
          // reader has nothing else to check it against.
          const context = {
            ...diagramContext(state, file, changesView),
            title: `Changes: ${compared.name} → ${file.name}`,
            milestone: null,
          };
          computeLayout(changesView.nodes, changesView.edges).then((positioned) => {
            if (generation !== renderGeneration) return;
            renderArea.appendChild(buildGraphSvg(positioned, (t) => colours.get(t) ?? "#000", context));
            renderBanner(banner, state, true, bannerActions);
          });
        }
      } else if (rank === null || comparedRank === null) {
        // One milestone is not "no milestone": comparing asks for two bounds, but
        // the workbook is not silent about its time axis for all that -- lending it
        // that absence would be a false cause.
        // Since A6 the milestone axis is no longer the only way to measure a
        // change: saying "there is nothing to measure" while a second workbook
        // would answer the question would be telling half the truth.
        const text =
          model.milestones.length === 0
            ? "This workbook declares no milestones. Compare it with another workbook to see what changed."
            : "This workbook declares only one milestone; comparing needs two — or another workbook.";
        renderArea.appendChild(el("p", { class: "no-flow" }, [text]));
      } else {
        renderArea.appendChild(
          buildChangesReport(
            computeChanges({ model, rank: comparedRank }, { model, rank }, state.mode),
            { before: state.comparedMilestone!, after: state.shownMilestone!, kind: "milestone" }
          )
        );
        // The diagram comes after the listing: one first reads what changed, then
        // goes to see where. It arrives later, the layout being asynchronous, and a
        // generation counter protects it from a stale display.
        const generation = ++renderGeneration;
        const changesView = buildChangesView({ model, rank: comparedRank }, { model, rank }, state.mode);
        if (changesView.edges.length > 0) {
          const colours = coloursOfModel(model);
          renderArea.appendChild(
            buildChangesDiagramTitle({ before: state.comparedMilestone!, after: state.shownMilestone!, kind: "milestone" })
          );
          computeLayout(changesView.nodes, changesView.edges).then((positioned) => {
            if (generation !== renderGeneration) return;
            renderArea.appendChild(
              buildGraphSvg(positioned, (t) => colours.get(t) ?? "#000", diagramContext(state, file, changesView))
            );
            // The change diagram exports like the others. The buttons depend on it,
            // and it did not yet exist when the banner was rendered.
            renderBanner(banner, state, true, bannerActions);
          });
        }
      }
    } else if (state.view === "help") {
      renderArea.appendChild(buildHelp());
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
        renderArea.appendChild(buildZoomControls(wireZoom(svg)));
        renderBanner(banner, state, true, bannerActions);
      }
    } else if (state.view === "matrix") {
      const matrix = buildMatrixView(model, reading, {
        mode: state.mode,
        grain: state.matrixFilters.grain,
        order: state.matrixFilters.order,
        hideExternals: state.matrixFilters.hideExternals,
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
          needsTechnologySelection = true;
        }
        view = state.technologySelection
          ? buildByTechnologyView(model, reading.flows, state.technologySelection, {
              counters: options.counters,
              edgeLabelMode: options.edgeLabelMode,
              hideExternals: state.technologyFilters.hideExternals,
              hiddenActors: state.technologyFilters.hiddenActors,
            })
          : { nodes: [], edges: [] };
      }
      return view;
      };

      let needsTechnologySelection = false;
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
      if (needsTechnologySelection) {
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
          const scaleHint = el("div", { class: "scale-hint" }, [hint.message]);
          for (const target of hint.views) {
            const button = el("button", { type: "button" }, [VIEW_LABEL[target]]);
            button.addEventListener("click", () => setState(withView(withBannerMessage(state, null), target)));
            scaleHint.appendChild(button);
          }
          renderArea.appendChild(scaleHint);
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
            const colorFor = (t: string) => colours.get(t) ?? "#000";
            const context = diagramContext(state, file, viewForComputation);
            // The isometric rendering draws the SAME positioned board: one
            // layout, two painters, so ticking the option never reshuffles
            // what the flat view had settled.
            if (state.options.isometric) {
              const { model, view } = isoBoard(positioned, colorFor, VIEW_LABEL[state.view]);
              const boardKey = `${layoutKey}|${state.shownMilestone}`;
              const remembered = annealed.get(boardKey);
              let svg = buildIsoSvg(model, remembered ?? view, context);
              let controls = buildZoomControls(wireZoom(svg));
              renderArea.appendChild(svg);
              renderArea.appendChild(controls);
              // The board is on screen; its better self is searched in the
              // background (iso-anneal.ts) and takes its place if found --
              // unless the reader has moved on meanwhile.
              if (!remembered) {
                void annealPlacement(view).then((result) => {
                  annealed.set(boardKey, result.view);
                  if (generation !== renderGeneration || !result.improved) return;
                  const better = buildIsoSvg(model, result.view, context);
                  const betterControls = buildZoomControls(wireZoom(better));
                  svg.replaceWith(better);
                  controls.replaceWith(betterControls);
                  svg = better;
                  controls = betterControls;
                });
              }
            } else {
              const svg = buildGraphSvg(positioned, colorFor, context, { weightByCriticality: state.options.weightByCriticality });
              renderArea.appendChild(svg);
              renderArea.appendChild(buildZoomControls(wireZoom(svg)));
            }
            // The export buttons depend on the presence of the SVG, which did not yet
            // exist when the banner was rendered.
            renderBanner(banner, state, true, bannerActions);
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
      onView: (view) => setState(withView(withBannerMessage(state, null), view)),
      onActorSelection: (name) => setState(withActorSelection(withBannerMessage(state, null), name)),
      onWeightByCriticality: (value) => setState(withOptions(withBannerMessage(state, null), { weightByCriticality: value })),
      onIsometric: (value) => setState(withOptions(withBannerMessage(state, null), { isometric: value })),
      onRoadmapSubject: (value) => setState(withRoadmapSubject(withBannerMessage(state, null), value)),
      onNeighbourhood: (value) => setState(withNeighbourhood(withBannerMessage(state, null), value)),
      onChainSelection: (chain) => setState(withChainSelection(withBannerMessage(state, null), chain)),
      onTechnologySelection: (type) => setState(withTechnologySelection(withBannerMessage(state, null), type)),
      onDisplayedMilestone: (milestone) => setState(recomputeReport(withDisplayedMilestone(withBannerMessage(state, null), milestone))),
      onComparedMilestone: (milestone) => setState(withComparedMilestone(withBannerMessage(state, null), milestone)),
      onComparedFile: (chosen) => void handleComparedFile(chosen),
      onCounterOption: (value) => setState(withOptions(withBannerMessage(state, null), { counters: value })),
      onEdgeLabel: (value) => setState(withOptions(withBannerMessage(state, null), { edgeLabelMode: value })),
      onDownloadTemplate: downloadTemplateHandler,
      onDownloadSample: downloadSampleHandler,
      onMigrationLegacy: legacyMigrationHandler,
      onTechnologyHidden: (tech, hidden) => setState(withTechnologyHidden(withBannerMessage(state, null), tech, hidden)),
      onActorHidden: (actor, hidden) => setState(withActorHidden(withBannerMessage(state, null), actor, hidden)),
      onHideExternals: (value) => setState(withHideExternals(withBannerMessage(state, null), value)),
      onActorHiddenForTechnology: (actor, hidden) =>
        setState(withActorHiddenForTechnology(withBannerMessage(state, null), actor, hidden)),
      onHideExternalsInMatrix: (value) => setState(withHideExternalsInMatrix(withBannerMessage(state, null), value)),
      onActorHiddenInMatrix: (actor, hidden) =>
        setState(withActorHiddenInMatrix(withBannerMessage(state, null), actor, hidden)),
      onPngScale: (value) => setState(withOptions(withBannerMessage(state, null), { pngScale: value })),
      onMatrixOrder: (value) => setState(withMatrixOrder(withBannerMessage(state, null), value)),
      onMatrixGrain: (grain) => setState(withMatrixGrain(withBannerMessage(state, null), grain)),
    });
  }

  render();
}
