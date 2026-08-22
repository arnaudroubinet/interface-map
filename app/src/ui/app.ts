import { el, clear } from "../shared/dom";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel, VERSION_MODELE } from "../parsing/build-model";
import { rankOfMilestone } from "../aggregation/milestones";
import { reading as lectureDuMode } from "../aggregation/reading";
import { calculerEcarts, buildEcartsView } from "../aggregation/changes";
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
import { computeLayout, restreindreLayout, type LayoutResult } from "../layout/graph-layout";
import { toutesLesPlanches } from "../aggregation/boards";
import { buildGraphSvg } from "../render/svg-builder";
import { titleBlockText, type ContexteSchema } from "../render/title-block";
import { brancherZoom } from "../render/zoom";
import { conseilDEchelle } from "./scale";
import { availableChains, buildChainView } from "../aggregation/chain";
import { buildRoadmap } from "../aggregation/roadmap";
import { buildRoadmapSvg } from "../render/roadmap";
import type { Lecture } from "../aggregation/reading";
import { lectureUnion } from "../aggregation/reading";
import type { ViewResult } from "../aggregation/views";
import type { GraphNode, GraphEdge } from "../aggregation/core";
import { buildMatrixTable } from "../render/matrix-table";
import { buildIntegrityReport } from "../render/integrity-report";
import { couleursDuModele } from "../render/colors";
import { buildExportFilename } from "../export/filename";
import { downloadMatrixXlsx } from "../export/xlsx-export";
import { downloadTemplateXlsx } from "../export/template-export";
import { DONNEES_EXEMPLE } from "../export/sample-data";
import { downloadSvg } from "../export/svg-export";
import { exportPng, downloadPngBlob } from "../export/png-export";
import { rapportEnMarkdown } from "../export/rapport-markdown";
import { downloadText } from "../export/download";
import { buildDrawio } from "../export/drawio-export";
import { modeleEnStructurizr } from "../export/c4-dsl";
import { modeleEnLikeC4 } from "../export/likec4-dsl";
import { buildDropTarget, wireDropZone } from "./drop-zone";
import { buildEcranMiseANiveau } from "../render/mise-a-niveau";
import { buildAide } from "../render/help";
import { mettreANiveau } from "../export/schema-upgrade";
import { renderBanner } from "./banner";
import { handlersExport } from "./export-handlers";
import { renderRail, renderPiedDeRail } from "./rail";
import { ouvrirMigration } from "./upgrade-dialog";
import {
  initialState,
  withFichierCharge,
  withVue,
  withMode,
  withOptions,
  withSelectionActeur,
  withSelectionTechnologie,
  withSelectionChaine,
  withVoisinage,
  withSujetFrise,
  withTechnoMasquee,
  withActeurMasque,
  withMasquerExternes,
  withActeurMasqueTechnologie,
  withMasquerExternesMatrice,
  withActeurMasqueMatrice,
  withGranulariteMatrice,
  withOrdreMatrice,
  withPalierAffiche,
  withPalierCompare,
  withMessageBandeau,
  vueAuChargement,
  LIBELLE_VUE,
  type AppState,
  type FichierCharge,
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
function contexteDuSchema(state: AppState, fichier: FichierCharge, view: { nodes: GraphNode[]; edges: GraphEdge[] }): ContexteSchema {
  return {
    title: LIBELLE_VUE[state.view],
    reading: state.mode === "functional" ? "functional" : "architecture",
    milestone: state.shownMilestone,
    source: fichier.name,
    date: fichier.dateModification ? fichier.dateModification.toISOString().slice(0, 10) : "save date unknown",
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
    if (!s.fichier) return s;
    const rank = s.shownMilestone === null ? null : rankOfMilestone(s.fichier.model, s.shownMilestone) ?? null;
    return { ...s, fichier: { ...s.fichier, report: runIntegrityChecks(s.fichier.model, rank) } };
  }

  function setState(next: AppState): void {
    state = next;
    render();
  }

  async function handleFile(file: File): Promise<void> {
    try {
      const nomOk = /\.(xlsx|xlsm)$/i.test(file.name);
      if (!nomOk) {
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
      if (built.model.schemaVersion > VERSION_MODELE) {
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
        withFichierCharge(state, {
          name: file.name,
          model: built.model,
          report,
          dateModification: parsed.savedAt,
        })
      );
      if (loaded.fichier) loaded = withVue(loaded, vueAuChargement(loaded.fichier));
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
    ouvrirMigration();
  }

  function telechargerExempleHandler(): void {
    downloadTemplateXlsx("carto-interfaces-exemple.xlsx", DONNEES_EXEMPLE);
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
    if (!state.fichier) {
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
      renderContenu(state.fichier);
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

  function renderContenu(fichier: FichierCharge): void {
    const model = fichier.model;
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
    let technologiesCourantes: string[] = [];

    if (state.view === "upgrade") {
      zoneRendu.appendChild(
        buildEcranMiseANiveau(model.schemaVersion, VERSION_MODELE, () => {
          const name = fichier.name.replace(/\.(xlsx|xlsm)$/i, "");
          downloadTemplateXlsx(`${name}-v${VERSION_MODELE}.xlsx`, mettreANiveau(model));
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
            calculerEcarts(model, rangCompare, rank, state.mode),
            state.comparedMilestone!,
            state.shownMilestone!
          )
        );
        // Le schéma vient après le relevé : on lit d'abord ce qui a changé,
        // puis on va voir où. Il arrive en différé, le placement étant
        // asynchrone, et une génération le protège d'un affichage périmé.
        const generation = ++renderGeneration;
        const vueEcarts = buildEcartsView(model, rangCompare, rank, state.mode);
        if (vueEcarts.edges.length > 0) {
          const colours = couleursDuModele(model);
          zoneRendu.appendChild(buildEcartsTitreSchema(state.comparedMilestone!, state.shownMilestone!));
          computeLayout(vueEcarts.nodes, vueEcarts.edges).then((positioned) => {
            if (generation !== renderGeneration) return;
            zoneRendu.appendChild(
              buildGraphSvg(positioned, (t) => colours.get(t) ?? "#000", contexteDuSchema(state, fichier, vueEcarts))
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
      zoneRendu.appendChild(buildIntegrityReport(fichier.report));
    } else if (state.view === "roadmap") {
      // Pas d'ELK : une frise est une grille, un axe et une ligne par sujet.
      // Le moteur de placement n'y aurait rien à placer.
      const timeline = buildRoadmap(model, state.sujetFrise);
      if (timeline.segments.length === 0) {
        zoneRendu.appendChild(el("p", { class: "no-flow" }, ["This workbook declares no milestones, so there is no timeline to draw."]));
      } else {
        const svg = buildRoadmapSvg(timeline, state.shownMilestone, {
          ...contexteDuSchema(state, fichier, { nodes: [], edges: [] }),
          detail: `${timeline.segments.length} ${state.sujetFrise === "actors" ? "actors" : "interfaces"}, ${timeline.milestones.length} milestones`,
        });
        zoneRendu.appendChild(svg);
        zoneRendu.appendChild(buildZoomControls(brancherZoom(svg)));
        renderBanner(banner, state, true, exportHandlers);
      }
    } else if (state.view === "matrix") {
      const matrix = buildMatrixView(model, reading, {
        mode: state.mode,
        granularite: state.filtresMatrice.granularite,
        order: state.filtresMatrice.order,
        masquerExternes: state.filtresMatrice.masquerExternes,
        hiddenActors: state.filtresMatrice.hiddenActors,
      });
      matriceCourante = matrix;
      technologiesCourantes = [...new Set(matrix.rows.flatMap((l) => [...l.cellules.values()].flat().map((c) => c.technology)))];
      // Le tableau d'abord, la couleur ensuite. La palette reste indexée sur
      // les types déclarés au classeur, et non sur les seuls survivants du
      // filtrage : sinon une technologie changerait de couleur d'un filtre à
      // l'autre, et entre la matrix et les schémas.
      const colours = couleursDuModele(model);
      zoneRendu.appendChild(
        buildMatrixTable(matrix, (t) => colours.get(t) ?? "#000", titleBlockText(contexteDuSchema(state, fichier, { nodes: [], edges: [] })).title)
      );
    } else {
      // La MÊME construction pour le palier affiché et pour l'union de tous
      // les paliers : c'est ce qui garantit que les deux vues se correspondent
      // nœud pour nœud, donc que le placement de l'union se restreint sans
      // rien inventer.
      const buildView = (reading: Lecture): ViewResult => {
      let view: ViewResult;
      if (state.view === "group-to-group") {
        view = buildGroupToGroupView(model, reading, options);
      } else if (state.view === "platform-detail") {
        view = buildPlatformDetailView(model, reading, options);
      } else if (state.view === "platform-only") {
        view = buildPlatformOnlyView(model, reading, options);
      } else if (state.view === "chain") {
        const chains = availableChains(model, rank);
        const retenue = chains.find((c) => c.id === state.selectionChaine);
        if (!retenue && chains.length > 0) {
          chaineParDefaut = chains[0].id;
        }
        view = retenue ? buildChainView(model, retenue) : { nodes: [], edges: [] };
      } else if (state.view === "by-actor") {
        // Même liste que le sélecteur du rail (§5.2) : un défaut piochant hors
        // d'elle désignerait un acteur que l'utilisateur ne peut même pas voir.
        const availableActors = reading.actors;
        if (!state.selectionActeur && availableActors.length > 0) {
          defaultActor = [...availableActors].sort((a, b) => a.name.localeCompare(b.name, "fr"))[0].name;
        }
        view = state.selectionActeur
          ? buildByActorView(model, reading.flows, state.selectionActeur, {
              hiddenTechnologies: state.filtresActeur.hiddenTechnologies,
              hiddenActors: state.filtresActeur.hiddenActors,
              neighbourhood: state.filtresActeur.neighbourhood,
            })
          : { nodes: [], edges: [] };
      } else {
        if (!state.selectionTechnologie && model.flowTypes.length > 0) {
          besoinDeSelectionTechnologie = true;
        }
        view = state.selectionTechnologie
          ? buildByTechnologyView(model, reading.flows, state.selectionTechnologie, {
              counters: options.counters,
              edgeLabelMode: options.edgeLabelMode,
              masquerExternes: state.filtresTechnologie.masquerExternes,
              hiddenActors: state.filtresTechnologie.hiddenActors,
            })
          : { nodes: [], edges: [] };
      }
      return view;
      };

      let besoinDeSelectionTechnologie = false;
      let defaultActor: string | null = null;
      let chaineParDefaut: string | null = null;
      const view = buildView(reading);
      if (chaineParDefaut) {
        setState(withSelectionChaine(state, chaineParDefaut));
        return;
      }
      if (defaultActor) {
        setState(withSelectionActeur(state, defaultActor));
        return;
      }
      if (besoinDeSelectionTechnologie) {
        setState(withSelectionTechnologie(state, [...model.flowTypes].sort((a, b) => a.type.localeCompare(b.type, "fr"))[0].type));
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
        const conseil = conseilDEchelle(view.nodes.filter((n) => n.kind !== "boundary").length, view.edges.length);
        if (conseil) {
          const bandeauEchelle = el("div", { class: "scale-hint" }, [conseil.message]);
          for (const target of conseil.views) {
            const bouton = el("button", { type: "button" }, [LIBELLE_VUE[target]]);
            bouton.addEventListener("click", () => setState(withVue(withMessageBandeau(state, null), target)));
            bandeauEchelle.appendChild(bouton);
          }
          zoneRendu.appendChild(bandeauEchelle);
        }
        // Le calcul de placement est asynchrone (ELK). Une génération protège
        // d'un rendu périmé : si l'utilisateur change de vue pendant le calcul,
        // le schéma qui arrive en retard ne doit pas s'afficher par-dessus.
        const generation = ++renderGeneration;
        const colours = couleursDuModele(model);
        const vueDuCalcul = view;
        // On place l'UNION de tous les paliers, une seule fois, et chaque
        // palier n'en montre que son sous-ensemble : une boîte présente aux
        // deux paliers ne bouge alors pas d'un pixel. La clé de mémoire ne
        // contient donc PAS le palier -- c'est précisément d'un palier à
        // l'autre qu'on veut la continuité.
        const layoutKey = JSON.stringify([
          state.view, state.mode, state.selectionActeur, state.selectionTechnologie, state.selectionChaine,
          state.filtresActeur, state.filtresTechnologie, options,
        ]);
        const vueUnion = buildView(lectureUnion(model, state.mode));
        const placement = placements.get(layoutKey) ?? computeLayout(vueUnion.nodes, vueUnion.edges);
        placements.set(layoutKey, placement);
        placement
          .then((union) => {
            if (generation !== renderGeneration) return;
            const positioned = restreindreLayout(union, vueDuCalcul);
            const svg = buildGraphSvg(positioned, (t) => colours.get(t) ?? "#000", contexteDuSchema(state, fichier, vueDuCalcul), {
              graisseParCriticite: state.options.graisseParCriticite,
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
        technologiesCourantes = [...new Set(view.edges.map((e) => e.technology))];
      }
    }

    renderRail(rail, state, reading, technologiesCourantes.sort((a, b) => a.localeCompare(b, "fr")), {
      onMode: (mode) => setState(withMode(state, mode)),
      onVue: (view) => setState(withVue(withMessageBandeau(state, null), view)),
      onSelectionActeur: (name) => setState(withSelectionActeur(withMessageBandeau(state, null), name)),
      onGraisseParCriticite: (value) => setState(withOptions(withMessageBandeau(state, null), { graisseParCriticite: value })),
      onSujetFrise: (value) => setState(withSujetFrise(withMessageBandeau(state, null), value)),
      onVoisinage: (value) => setState(withVoisinage(withMessageBandeau(state, null), value)),
      onSelectionChaine: (chain) => setState(withSelectionChaine(withMessageBandeau(state, null), chain)),
      onSelectionTechnologie: (type) => setState(withSelectionTechnologie(withMessageBandeau(state, null), type)),
      onPalierAffiche: (milestone) => setState(recalculerRapport(withPalierAffiche(withMessageBandeau(state, null), milestone))),
      onPalierCompare: (milestone) => setState(withPalierCompare(withMessageBandeau(state, null), milestone)),
      onOptionCompteurs: (value) => setState(withOptions(withMessageBandeau(state, null), { counters: value })),
      onLibelléArête: (value) => setState(withOptions(withMessageBandeau(state, null), { edgeLabelMode: value })),
      onTelechargerModele: telechargerModeleHandler,
      onTelechargerExemple: telechargerExempleHandler,
      onMigrationLegacy: migrationLegacyHandler,
      onTechnoMasquee: (techno, hidden) => setState(withTechnoMasquee(withMessageBandeau(state, null), techno, hidden)),
      onActeurMasque: (actor, hidden) => setState(withActeurMasque(withMessageBandeau(state, null), actor, hidden)),
      onMasquerExternes: (value) => setState(withMasquerExternes(withMessageBandeau(state, null), value)),
      onActeurMasqueTechnologie: (actor, hidden) =>
        setState(withActeurMasqueTechnologie(withMessageBandeau(state, null), actor, hidden)),
      onMasquerExternesMatrice: (value) => setState(withMasquerExternesMatrice(withMessageBandeau(state, null), value)),
      onActeurMasqueMatrice: (actor, hidden) =>
        setState(withActeurMasqueMatrice(withMessageBandeau(state, null), actor, hidden)),
      onEchellePng: (value) => setState(withOptions(withMessageBandeau(state, null), { echellePng: value })),
      onOrdreMatrice: (value) => setState(withOrdreMatrice(withMessageBandeau(state, null), value)),
      onGranulariteMatrice: (granularite) => setState(withGranulariteMatrice(withMessageBandeau(state, null), granularite)),
    });
  }

  render();
}
