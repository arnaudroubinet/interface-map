import { el, clear } from "../shared/dom";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel, SCHEMA_VERSION } from "../parsing/build-model";
import { rankOfMilestone } from "../aggregation/milestones";
import { reading as lectureDuMode } from "../aggregation/reading";
import { computeChanges, buildEcartsView } from "../aggregation/changes";
import { buildEcartsReport, buildEcartsTitreSchema } from "../render/ecarts-report";
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
import { toutesLesPlanches } from "../aggregation/boards";
import { buildGraphSvg } from "../render/svg-builder";
import { titleBlockText, type DiagramContext } from "../render/title-block";
import { brancherZoom } from "../render/zoom";
import { scaleHint } from "./scale";
import { availableChains, buildChainView } from "../aggregation/chain";
import { buildRoadmap } from "../aggregation/roadmap";
import { buildRoadmapSvg } from "../render/roadmap";
import type { Reading } from "../aggregation/reading";
import { lectureUnion } from "../aggregation/reading";
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
import { rapportEnMarkdown } from "../export/rapport-markdown";
import { downloadText } from "../export/download";
import { buildDrawio } from "../export/drawio-export";
import { modelToStructurizr } from "../export/c4-dsl";
import { modelToLikeC4 } from "../export/likec4-dsl";
import { buildDropTarget, wireDropZone } from "./drop-zone";
import { buildEcranMiseANiveau } from "../render/mise-a-niveau";
import { buildAide } from "../render/help";
import { upgrade } from "../export/schema-upgrade";
import { renderBanner } from "./banner";
import { handlersExport } from "./export-handlers";
import { renderRail, renderPiedDeRail } from "./rail";
import { openMigration } from "./upgrade-dialog";
import {
  initialState,
  withLoadedFile,
  withVue,
  withMode,
  withOptions,
  withActorSelection,
  withTechnologySelection,
  withChainSelection,
  withVoisinage,
  withSujetFrise,
  withTechnoMasquee,
  withActeurMasque,
  withMasquerExternes,
  withActeurMasqueTechnologie,
  withMasquerExternesMatrice,
  withActorHiddenInMatrix,
  withMatrixGrain,
  withOrdreMatrice,
  withDisplayedMilestone,
  withPalierCompare,
  withMessageBandeau,
  viewOnLoad,
  VIEW_LABEL,
  type AppState,
  type LoadedFile,
  type Vue,
} from "./state";


// Les trois commandes de cadrage, posées sous le schéma : « Fit » ramène au
// cadre complet, les deux autres zooment autour du centre. Elles vivent ici et
// non dans le banner parce qu'elles pilotent CE schéma-là, qui vient d'être
// construit.
function buildZoomControls(commandes: { ajuster: () => void; zoomBy: (f: number) => void }): HTMLElement {
  const barre = el("div", { class: "zoom-controls" });
  const bouton = (label: string, title: string, action: () => void) => {
    const b = el("button", { type: "button", title: title }, [label]);
    b.addEventListener("click", action);
    barre.appendChild(b);
  };
  bouton("Fit", "Fit the whole board", commandes.ajuster);
  bouton("−", "Zoom out", () => commandes.zoomBy(1 / 1.3));
  bouton("+", "Zoom in", () => commandes.zoomBy(1.3));
  return barre;
}

// Ce que le schéma dira de lui-même. Tout vient de l'état : la vue, la
// lecture, le palier affiché, le nom du fichier et sa date de sauvegarde --
// c'est l'âge de la DONNÉE qui compte, pas celui de l'impression.
function diagramContext(state: AppState, file: LoadedFile, view: { nodes: GraphNode[]; edges: GraphEdge[] }): DiagramContext {
  return {
    title: VIEW_LABEL[state.view],
    reading: state.mode === "functional" ? "functional" : "architecture",
    milestone: state.shownMilestone,
    source: file.name,
    date: file.dateModification ? file.dateModification.toISOString().slice(0, 10) : "save date unknown",
    composants: view.nodes.filter((n) => n.kind !== "boundary").length,
    flows: view.edges.length,
    technologies: new Set(view.edges.map((e) => e.technology).filter(Boolean)).size,
  };
}

export function mountApp(root: HTMLElement): void {
  let state: AppState = initialState();

  root.innerHTML = "";
  const banner = el("header", { class: "banner" });
  const rail = el("aside", { class: "rail" });
  const zoneRendu = el("main", { class: "render-area" });
  const layout = el("div", { class: "layout" }, [rail, zoneRendu]);
  root.appendChild(banner);
  root.appendChild(layout);

  wireDropZone(root, handleFile);

  // Le rapport dépend du palier affiché pour sa part « état de la plateforme »
  // (§7.1) : il se recalcule donc à chaque changement de palier, et pas
  // seulement au chargement.
  function recalculerRapport(s: AppState): AppState {
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

      // Un classeur venu d'une version plus récente n'est pas lu du tout :
      // deviner la forme d'un format qu'on ne connaît pas produirait des
      // schémas faux, ce qui est pire que de ne rien afficher.
      if (built.model.schemaVersion > SCHEMA_VERSION) {
        setState(
          withMessageBandeau(
            state,
            `This workbook follows model v${built.model.schemaVersion}, produced by a newer version of the tool. Update the tool to open it.`
          )
        );
        return;
      }

      // Les positions d'un parc n'ont aucun sens sur un autre.
      placements.clear();

      const report = runIntegrityChecks(built.model);
      // Le rapport porté par withFichierCharge n'est pas encore calé sur le
      // palier courant (recalculerRapport le remplace juste après) : la vue
      // d'atterrissage doit donc être redécidée sur le rapport final, sinon
      // une anomalie qui n'existe qu'à un palier retiré ouvre sur un écran de
      // contrôles qui affiche (0) partout.
      let loaded = recalculerRapport(
        withLoadedFile(state, {
          name: file.name,
          model: built.model,
          report,
          dateModification: parsed.savedAt,
        })
      );
      if (loaded.file) loaded = withVue(loaded, viewOnLoad(loaded.file));
      setState(loaded);
    } catch (err) {
      // Filet de sécurité : un classeur formé mais dont le contenu déclenche
      // une exception inattendue plus loin dans le pipeline ne doit jamais
      // laisser un rejet de promesse non traité (§9 — jamais d'échec muet).
      console.error(err);
      setState(withMessageBandeau(state, "Workbook unreadable or corrupted."));
    }
  }

  // Incrémentée à chaque demande de schéma : seule la dernière a le droit
  // d'écrire dans la zone de rendu.
  let renderGeneration = 0;
  // Les placements déjà calculés, par (vue, lecture, filtres) -- sans le
  // palier. Vidée au chargement d'un autre classeur : les positions d'un parc
  // n'ont aucun sens sur un autre.
  const placements = new Map<string, Promise<LayoutResult>>();
  // La matrix affichée, gardée pour l'export : la recalculer au clic risquerait
  // de livrer autre chose que ce qui est à l'écran.
  let matriceCourante: MatrixResult | null = null;

  function currentSvg(): SVGSVGElement | null {
    return zoneRendu.querySelector("svg");
  }










  function telechargerModeleHandler(): void {
    downloadTemplateXlsx("carto-interfaces-modele.xlsx");
  }

  function migrationLegacyHandler(): void {
    openMigration();
  }

  function telechargerExempleHandler(): void {
    downloadTemplateXlsx("carto-interfaces-exemple.xlsx", SAMPLE_DATA);
  }

  // Les sept exports vivent dans leur propre module : ils ne dépendent que de
  // l'état, de quoi le remplacer, du schéma à l'écran et de la matrix
  // affichée. On les fabrique une fois, avec des lectures paresseuses -- un
  // gestionnaire câblé au premier rendu doit lire l'état du clic, pas celui de
  // sa construction.
  const exportHandlers = handlersExport({
    legacyState: () => state,
    setState,
    svgCourant: currentSvg,
    matriceCourante: () => matriceCourante,
  });

  function render(): void {
    if (!state.file) {
      clear(rail);
      renderPiedDeRail(rail, {
        onTelechargerModele: telechargerModeleHandler,
        onTelechargerExemple: telechargerExempleHandler,
        onMigrationLegacy: migrationLegacyHandler,
      });
      clear(zoneRendu);
      // La page d'aide se lit AVANT d'avoir un classeur : c'est justement là
      // qu'on se demande ce que l'outil attend.
      if (state.view === "help") {
        const retour = el("button", { class: "export-button" }, ["Back"]);
        retour.addEventListener("click", () => setState(withVue(state, "group-to-group")));
        zoneRendu.appendChild(el("div", { class: "help-standalone" }, [retour, buildAide()]));
      } else {
        zoneRendu.appendChild(
          buildDropTarget(telechargerExempleHandler, () => setState(withVue(state, "help")))
        );
      }
      renderBanner(banner, state, false, exportHandlers);
      return;
    }

    try {
      renderContenu(state.file);
    } catch (err) {
      // Un cas de données non anticipé ne doit jamais laisser un écran vide
      // et muet (§9/§10.3) — la vue précédente reste remplacée (le dépôt a
      // réussi), mais on affiche un message plutôt qu'une exception muette.
      // Le rail n'est PAS effacé : renderContenu() l'aurait reconstruit en
      // dernière étape, donc l'ancien reste affiché et reste navigable —
      // l'effacer transformerait une vue en cul-de-sac sans navigation.
      console.error(err);
      clear(zoneRendu);
      zoneRendu.appendChild(el("p", { class: "no-flow" }, ["Unexpected error while rendering this view."]));
    }

    renderBanner(banner, state, currentSvg() !== null, exportHandlers);
  }

  function renderContenu(file: LoadedFile): void {
    const model = file.model;
    // Le rang du palier affiché, résolu une fois : c'est lui qui traverse les
    // vues, les filtres et les exports.
    const rank = state.shownMilestone === null ? null : rankOfMilestone(model, state.shownMilestone) ?? null;
    // Résolu une fois, ici, et transmis à tout ce qui dessine (vues, filtres du
    // rail) : c'est la Lecture (rang, mode) qui décide des flux ET des
    // acteurs, jamais une vue.
    const reading = lectureDuMode(model, rank, state.mode);
    const options = { ...state.options };
    matriceCourante = null;
    clear(zoneRendu);
    let currentTechnologies: string[] = [];

    if (state.view === "upgrade") {
      zoneRendu.appendChild(
        buildEcranMiseANiveau(model.schemaVersion, SCHEMA_VERSION, () => {
          const name = file.name.replace(/\.(xlsx|xlsm)$/i, "");
          downloadTemplateXlsx(`${name}-v${SCHEMA_VERSION}.xlsx`, upgrade(model));
        })
      );
    } else if (state.view === "changes") {
      // Les deux paliers comparés ; sans axe déclaré, il n'y a rien à comparer.
      const rangCompare = state.comparedMilestone === null ? null : rankOfMilestone(model, state.comparedMilestone) ?? null;
      if (rank === null || rangCompare === null) {
        // Un seul palier n'est pas « aucun palier » : comparer réclame deux
        // bornes, mais le classeur n'est pas silencieux sur son axe du temps
        // pour autant -- lui prêter cette absence serait une fausse cause.
        const text =
          model.milestones.length === 0
            ? "This workbook declares no milestones, so there is no change to measure."
            : "This workbook declares only one milestone; comparing needs two.";
        zoneRendu.appendChild(el("p", { class: "no-flow" }, [text]));
      } else {
        zoneRendu.appendChild(
          buildEcartsReport(
            computeChanges(model, rangCompare, rank, state.mode),
            state.comparedMilestone!,
            state.shownMilestone!
          )
        );
        // Le schéma vient après le relevé : on lit d'abord ce qui a changé,
        // puis on va voir où. Il arrive en différé, le placement étant
        // asynchrone, et une génération le protège d'un affichage périmé.
        const generation = ++renderGeneration;
        const changesView = buildEcartsView(model, rangCompare, rank, state.mode);
        if (changesView.edges.length > 0) {
          const colours = coloursOfModel(model);
          zoneRendu.appendChild(buildEcartsTitreSchema(state.comparedMilestone!, state.shownMilestone!));
          computeLayout(changesView.nodes, changesView.edges).then((positioned) => {
            if (generation !== renderGeneration) return;
            zoneRendu.appendChild(
              buildGraphSvg(positioned, (t) => colours.get(t) ?? "#000", diagramContext(state, file, changesView))
            );
            // Le schéma d'écart s'exporte comme les autres. Les boutons en
            // dépendent, et il n'existait pas encore au rendu du banner.
            renderBanner(banner, state, true, exportHandlers);
          });
        }
      }
    } else if (state.view === "help") {
      zoneRendu.appendChild(buildAide());
    } else if (state.view === "checks") {
      zoneRendu.appendChild(buildIntegrityReport(file.report));
    } else if (state.view === "roadmap") {
      // Pas d'ELK : une frise est une grille, un axe et une ligne par sujet.
      // Le moteur de placement n'y aurait rien à placer.
      const timeline = buildRoadmap(model, state.roadmapSubject);
      if (timeline.segments.length === 0) {
        zoneRendu.appendChild(el("p", { class: "no-flow" }, ["This workbook declares no milestones, so there is no timeline to draw."]));
      } else {
        const svg = buildRoadmapSvg(timeline, state.shownMilestone, {
          ...diagramContext(state, file, { nodes: [], edges: [] }),
          detail: `${timeline.segments.length} ${state.roadmapSubject === "actors" ? "actors" : "interfaces"}, ${timeline.milestones.length} milestones`,
        });
        zoneRendu.appendChild(svg);
        zoneRendu.appendChild(buildZoomControls(brancherZoom(svg)));
        renderBanner(banner, state, true, exportHandlers);
      }
    } else if (state.view === "matrix") {
      const matrix = buildMatrixView(model, reading, {
        mode: state.mode,
        grain: state.filtresMatrice.grain,
        order: state.filtresMatrice.order,
        masquerExternes: state.filtresMatrice.masquerExternes,
        hiddenActors: state.filtresMatrice.hiddenActors,
      });
      matriceCourante = matrix;
      currentTechnologies = [...new Set(matrix.rows.flatMap((l) => [...l.cellules.values()].flat().map((c) => c.technology)))];
      // Le tableau d'abord, la couleur ensuite. La palette reste indexée sur
      // les types déclarés au classeur, et non sur les seuls survivants du
      // filtrage : sinon une technologie changerait de couleur d'un filtre à
      // l'autre, et entre la matrix et les schémas.
      const colours = coloursOfModel(model);
      zoneRendu.appendChild(
        buildMatrixTable(matrix, (t) => colours.get(t) ?? "#000", titleBlockText(diagramContext(state, file, { nodes: [], edges: [] })).title)
      );
    } else {
      // La MÊME construction pour le palier affiché et pour l'union de tous
      // les paliers : c'est ce qui garantit que les deux vues se correspondent
      // nœud pour nœud, donc que le placement de l'union se restreint sans
      // rien inventer.
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
        const retenue = chains.find((c) => c.id === state.chainSelection);
        if (!retenue && chains.length > 0) {
          defaultChain = chains[0].id;
        }
        view = retenue ? buildChainView(model, retenue) : { nodes: [], edges: [] };
      } else if (state.view === "by-actor") {
        // Même liste que le sélecteur du rail (§5.2) : un défaut piochant hors
        // d'elle désignerait un acteur que l'utilisateur ne peut même pas voir.
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

      // Un acteur métier isolé (§5.2) produit un nœud seul, zéro arête : ce
      // n'est pas rien à montrer, c'est PRÉCISÉMENT ce qu'il faut montrer. Le
      // message ne vaut que pour une sélection réellement vide.
      if (view.nodes.length === 0) {
        zoneRendu.appendChild(el("p", { class: "no-flow" }, ["No flow to display for this selection."]));
      } else {
        // Une planche qui a dépassé ce que le nœud-lien sert bien doit le
        // DIRE, et proposer où aller. Jamais bloquer, jamais tronquer.
        const hint = scaleHint(view.nodes.filter((n) => n.kind !== "boundary").length, view.edges.length);
        if (hint) {
          const bandeauEchelle = el("div", { class: "scale-hint" }, [hint.message]);
          for (const target of hint.views) {
            const bouton = el("button", { type: "button" }, [VIEW_LABEL[target]]);
            bouton.addEventListener("click", () => setState(withVue(withMessageBandeau(state, null), target)));
            bandeauEchelle.appendChild(bouton);
          }
          zoneRendu.appendChild(bandeauEchelle);
        }
        // Le calcul de placement est asynchrone (ELK). Une génération protège
        // d'un rendu périmé : si l'utilisateur change de vue pendant le calcul,
        // le schéma qui arrive en retard ne doit pas s'afficher par-dessus.
        const generation = ++renderGeneration;
        const colours = coloursOfModel(model);
        const vueDuCalcul = view;
        // On place l'UNION de tous les paliers, une seule fois, et chaque
        // palier n'en montre que son sous-ensemble : une boîte présente aux
        // deux paliers ne bouge alors pas d'un pixel. La clé de mémoire ne
        // contient donc PAS le palier -- c'est précisément d'un palier à
        // l'autre qu'on veut la continuité.
        const layoutKey = JSON.stringify([
          state.view, state.mode, state.actorSelection, state.technologySelection, state.chainSelection,
          state.actorFilters, state.technologyFilters, options,
        ]);
        const vueUnion = buildView(lectureUnion(model, state.mode));
        const placement = placements.get(layoutKey) ?? computeLayout(vueUnion.nodes, vueUnion.edges);
        placements.set(layoutKey, placement);
        placement
          .then((union) => {
            if (generation !== renderGeneration) return;
            const positioned = restrictLayout(union, vueDuCalcul);
            const svg = buildGraphSvg(positioned, (t) => colours.get(t) ?? "#000", diagramContext(state, file, vueDuCalcul), {
              weightByCriticality: state.options.weightByCriticality,
            });
            zoneRendu.appendChild(svg);
            zoneRendu.appendChild(buildZoomControls(brancherZoom(svg)));
            // Les boutons d'export dépendent de la présence du SVG, qui
            // n'existait pas encore au moment du rendu du banner.
            renderBanner(banner, state, true, exportHandlers);
          })
          .catch((err) => {
            if (generation !== renderGeneration) return;
            console.error(err);
            clear(zoneRendu);
            zoneRendu.appendChild(el("p", { class: "no-flow" }, ["Unexpected error while rendering this view."]));
          });
        currentTechnologies = [...new Set(view.edges.map((e) => e.technology))];
      }
    }

    renderRail(rail, state, reading, currentTechnologies.sort((a, b) => a.localeCompare(b, "fr")), {
      onMode: (mode) => setState(withMode(state, mode)),
      onVue: (view) => setState(withVue(withMessageBandeau(state, null), view)),
      onActorSelection: (name) => setState(withActorSelection(withMessageBandeau(state, null), name)),
      onWeightByCriticality: (value) => setState(withOptions(withMessageBandeau(state, null), { weightByCriticality: value })),
      onRoadmapSubject: (value) => setState(withSujetFrise(withMessageBandeau(state, null), value)),
      onVoisinage: (value) => setState(withVoisinage(withMessageBandeau(state, null), value)),
      onChainSelection: (chain) => setState(withChainSelection(withMessageBandeau(state, null), chain)),
      onTechnologySelection: (type) => setState(withTechnologySelection(withMessageBandeau(state, null), type)),
      onDisplayedMilestone: (milestone) => setState(recalculerRapport(withDisplayedMilestone(withMessageBandeau(state, null), milestone))),
      onPalierCompare: (milestone) => setState(withPalierCompare(withMessageBandeau(state, null), milestone)),
      onOptionCompteurs: (value) => setState(withOptions(withMessageBandeau(state, null), { counters: value })),
      onEdgeLabel: (value) => setState(withOptions(withMessageBandeau(state, null), { edgeLabelMode: value })),
      onTelechargerModele: telechargerModeleHandler,
      onTelechargerExemple: telechargerExempleHandler,
      onMigrationLegacy: migrationLegacyHandler,
      onTechnologyHidden: (tech, hidden) => setState(withTechnoMasquee(withMessageBandeau(state, null), tech, hidden)),
      onActorHidden: (actor, hidden) => setState(withActeurMasque(withMessageBandeau(state, null), actor, hidden)),
      onMasquerExternes: (value) => setState(withMasquerExternes(withMessageBandeau(state, null), value)),
      onActorHiddenForTechnology: (actor, hidden) =>
        setState(withActeurMasqueTechnologie(withMessageBandeau(state, null), actor, hidden)),
      onMasquerExternesMatrice: (value) => setState(withMasquerExternesMatrice(withMessageBandeau(state, null), value)),
      onActorHiddenInMatrix: (actor, hidden) =>
        setState(withActorHiddenInMatrix(withMessageBandeau(state, null), actor, hidden)),
      onEchellePng: (value) => setState(withOptions(withMessageBandeau(state, null), { echellePng: value })),
      onOrdreMatrice: (value) => setState(withOrdreMatrice(withMessageBandeau(state, null), value)),
      onMatrixGrain: (grain) => setState(withMatrixGrain(withMessageBandeau(state, null), grain)),
    });
  }

  render();
}
