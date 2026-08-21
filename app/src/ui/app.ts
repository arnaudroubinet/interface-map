import { el, clear } from "../shared/dom";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel, VERSION_MODELE } from "../parsing/build-model";
import { rangDuPalier } from "../aggregation/paliers";
import { lecture as lectureDuMode } from "../aggregation/fonctionnel";
import { calculerEcarts, buildEcartsView } from "../aggregation/ecarts";
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
import { acteursMetier } from "../aggregation/nature";
import { computeLayout } from "../layout/graph-layout";
import { toutesLesPlanches } from "../aggregation/planches";
import { buildGraphSvg } from "../render/svg-builder";
import { buildMatrixTable } from "../render/matrix-table";
import { buildIntegrityReport } from "../render/integrity-report";
import { couleursDuModele } from "../render/colors";
import { buildExportFilename } from "../export/filename";
import { downloadMatrixXlsx } from "../export/xlsx-export";
import { downloadTemplateXlsx } from "../export/template-export";
import { DONNEES_EXEMPLE } from "../export/exemple-donnees";
import { downloadSvg } from "../export/svg-export";
import { exportPng, downloadPngBlob } from "../export/png-export";
import { rapportEnMarkdown } from "../export/rapport-markdown";
import { téléchargerTexte } from "../export/telechargement";
import { construireDrawio } from "../export/drawio-export";
import { modeleEnStructurizr } from "../export/c4-dsl";
import { modeleEnLikeC4 } from "../export/likec4-dsl";
import { buildDropTarget, wireDropZone } from "./drop-zone";
import { buildEcranMiseANiveau } from "../render/mise-a-niveau";
import { buildAide } from "../render/aide";
import { mettreANiveau } from "../export/migration-modele";
import { renderBanner } from "./banner";
import { renderRail, renderPiedDeRail } from "./rail";
import { ouvrirMigration } from "./migration-dialogue";
import {
  initialState,
  withFichierCharge,
  withVue,
  withMode,
  withOptions,
  withSelectionActeur,
  withSelectionTechnologie,
  withTechnoMasquee,
  withActeurMasque,
  withMasquerExternes,
  withActeurMasqueTechnologie,
  withMasquerExternesMatrice,
  withActeurMasqueMatrice,
  withGranulariteMatrice,
  withPalierAffiche,
  withPalierCompare,
  withMessageBandeau,
  vueAuChargement,
  type AppState,
  type FichierCharge,
  type Vue,
} from "./state";

const VUE_LABELS: Record<Vue, string> = {
  "groupe-a-groupe": "Group to group",
  "plateforme-detaillee": "Platform detail",
  "plateforme-seule": "Platform only",
  "par-acteur": "By actor",
  "par-technologie": "By technology",
  matrice: "Matrix",
  ecarts: "Changes",
  controles: "Integrity checks",
  aide: "How it works",
  "mise-a-niveau": "Upgrade",
};

export function mountApp(root: HTMLElement): void {
  let state: AppState = initialState();

  root.innerHTML = "";
  const bandeau = el("header", { class: "bandeau" });
  const rail = el("aside", { class: "rail" });
  const zoneRendu = el("main", { class: "zone-rendu" });
  const layout = el("div", { class: "mise-en-page" }, [rail, zoneRendu]);
  root.appendChild(bandeau);
  root.appendChild(layout);

  wireDropZone(root, handleFile);

  // Le rapport dépend du palier affiché pour sa part « état de la plateforme »
  // (§7.1) : il se recalcule donc à chaque changement de palier, et pas
  // seulement au chargement.
  function recalculerRapport(s: AppState): AppState {
    if (!s.fichier) return s;
    const rang = s.palierAffiche === null ? null : rangDuPalier(s.fichier.model, s.palierAffiche) ?? null;
    return { ...s, fichier: { ...s.fichier, report: runIntegrityChecks(s.fichier.model, rang) } };
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
        setState(withMessageBandeau(state, built.erreurs.map((e) => e.message).join(" ")));
        return;
      }

      // Un classeur venu d'une version plus récente n'est pas lu du tout :
      // deviner la forme d'un format qu'on ne connaît pas produirait des
      // schémas faux, ce qui est pire que de ne rien afficher.
      if (built.model.versionModele > VERSION_MODELE) {
        setState(
          withMessageBandeau(
            state,
            `This workbook follows model v${built.model.versionModele}, produced by a newer version of the tool. Update the tool to open it.`
          )
        );
        return;
      }

      const report = runIntegrityChecks(built.model);
      // Le rapport porté par withFichierCharge n'est pas encore calé sur le
      // palier courant (recalculerRapport le remplace juste après) : la vue
      // d'atterrissage doit donc être redécidée sur le rapport final, sinon
      // une anomalie qui n'existe qu'à un palier retiré ouvre sur un écran de
      // contrôles qui affiche (0) partout.
      let chargé = recalculerRapport(
        withFichierCharge(state, {
          nom: file.name,
          model: built.model,
          report,
          dateModification: parsed.fichierModifie,
        })
      );
      if (chargé.fichier) chargé = withVue(chargé, vueAuChargement(chargé.fichier));
      setState(chargé);
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
  let générationRendu = 0;
  // La matrice affichée, gardée pour l'export : la recalculer au clic risquerait
  // de livrer autre chose que ce qui est à l'écran.
  let matriceCourante: MatrixResult | null = null;

  function currentSvg(): SVGSVGElement | null {
    return zoneRendu.querySelector("svg");
  }

  function currentSelection(): string | null {
    if (state.vue === "par-acteur") return state.selectionActeur;
    if (state.vue === "par-technologie") return state.selectionTechnologie;
    // Un écart se lit entre deux paliers : le nom de fichier doit porter les
    // deux, sinon deux comparaisons différentes se téléchargent sous le même
    // nom. Le palier d'arrivée est déjà ajouté par ailleurs.
    if (state.vue === "ecarts") return state.palierCompare;
    return null;
  }

  function exportSvgHandler(): void {
    const svg = currentSvg();
    if (!svg || !state.fichier) return;
    const filename = buildExportFilename(VUE_LABELS[state.vue], currentSelection(), state.palierAffiche, "svg", state.mode);
    downloadSvg(svg, filename, "#ffffff");
  }

  async function exportPngHandler(): Promise<void> {
    const svg = currentSvg();
    if (!svg || !state.fichier) return;
    const result = await exportPng(svg, "#ffffff", 2);
    if (!result.ok) {
      setState(withMessageBandeau(state, "Ce navigateur refuse la conversion en PNG — utilisez l'export SVG."));
      return;
    }
    const filename = buildExportFilename(VUE_LABELS[state.vue], currentSelection(), state.palierAffiche, "png", state.mode);
    downloadPngBlob(result.blob, filename);
  }

  function exportXlsxHandler(): void {
    if (!matriceCourante || !state.fichier) return;
    const filename = buildExportFilename(VUE_LABELS[state.vue], null, state.palierAffiche, "xlsx", state.mode);
    downloadMatrixXlsx(matriceCourante, filename);
  }

  function exportMarkdownHandler(): void {
    if (!state.fichier) return;
    // Pas de mode ici : le rapport juge le classeur, pas une lecture du
    // classeur (§5.3) -- son contenu ne bouge pas d'un mode à l'autre, son nom
    // ne doit donc pas non plus bouger.
    const filename = buildExportFilename(VUE_LABELS[state.vue], null, state.palierAffiche, "md");
    téléchargerTexte(
      rapportEnMarkdown(state.fichier.report, state.fichier.nom, state.palierAffiche),
      filename
    );
  }

  // Le palier affiché vaut pour tout ce qui décrit le MODÈLE plutôt qu'une
  // planche : ces exports ne portent ni nom de vue ni sélection.
  function rangAffiché(): number | null {
    if (!state.fichier || state.palierAffiche === null) return null;
    return rangDuPalier(state.fichier.model, state.palierAffiche) ?? null;
  }

  // Le fichier draw.io porte TOUTES les planches, une par onglet : il ne
  // dépend donc pas de la vue ouverte. Les placements se calculent à la
  // demande -- une soixantaine de planches tient en moins d'une seconde, et les
  // garder au chaud voudrait dire les recalculer à chaque changement de palier.
  async function exportDrawioHandler(): Promise<void> {
    if (!state.fichier) return;
    const model = state.fichier.model;
    const couleurs = couleursDuModele(model);
    const placées = [];
    for (const planche of toutesLesPlanches(model, rangAffiché(), state.mode)) {
      placées.push({ titre: planche.titre, acteur: planche.acteur, layout: await computeLayout(planche.nodes, planche.edges) });
    }
    téléchargerTexte(
      construireDrawio(placées, (t) => couleurs.get(t) ?? "#000"),
      buildExportFilename("boards", null, state.palierAffiche, "drawio", state.mode)
    );
  }

  function exportStructurizrHandler(): void {
    if (!state.fichier) return;
    téléchargerTexte(
      modeleEnStructurizr(state.fichier.model, rangAffiché(), state.fichier.nom),
      buildExportFilename("model", null, state.palierAffiche, "dsl")
    );
  }

  function exportLikeC4Handler(): void {
    if (!state.fichier) return;
    téléchargerTexte(
      modeleEnLikeC4(state.fichier.model, rangAffiché()),
      buildExportFilename("model", null, state.palierAffiche, "c4")
    );
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
      if (state.vue === "aide") {
        const retour = el("button", { class: "bouton-export" }, ["Back"]);
        retour.addEventListener("click", () => setState(withVue(state, "groupe-a-groupe")));
        zoneRendu.appendChild(el("div", { class: "aide-seule" }, [retour, buildAide()]));
      } else {
        zoneRendu.appendChild(
          buildDropTarget(telechargerExempleHandler, () => setState(withVue(state, "aide")))
        );
      }
      renderBanner(bandeau, state, false, {
        onExportSvg: exportSvgHandler,
        onExportPng: exportPngHandler,
        onExportXlsx: exportXlsxHandler,
      onExportMarkdown: exportMarkdownHandler,
              onExportDrawio: exportDrawioHandler,
              onExportStructurizr: exportStructurizrHandler,
              onExportLikeC4: exportLikeC4Handler,
      });
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
      zoneRendu.appendChild(el("p", { class: "aucun-flux" }, ["Unexpected error while rendering this view."]));
    }

    renderBanner(bandeau, state, currentSvg() !== null, {
      onExportSvg: exportSvgHandler,
      onExportPng: exportPngHandler,
      onExportXlsx: exportXlsxHandler,
      onExportMarkdown: exportMarkdownHandler,
              onExportDrawio: exportDrawioHandler,
              onExportStructurizr: exportStructurizrHandler,
              onExportLikeC4: exportLikeC4Handler,
    });
  }

  function renderContenu(fichier: FichierCharge): void {
    const model = fichier.model;
    // Le rang du palier affiché, résolu une fois : c'est lui qui traverse les
    // vues, les filtres et les exports.
    const rang = state.palierAffiche === null ? null : rangDuPalier(model, state.palierAffiche) ?? null;
    // Résolu une fois, ici, et transmis à tout ce qui dessine (vues, filtres du
    // rail) : c'est la Lecture (rang, mode) qui décide des flux ET des
    // acteurs, jamais une vue.
    const lecture = lectureDuMode(model, rang, state.mode);
    const options = { ...state.options };
    matriceCourante = null;
    clear(zoneRendu);
    let technologiesCourantes: string[] = [];

    if (state.vue === "mise-a-niveau") {
      zoneRendu.appendChild(
        buildEcranMiseANiveau(model.versionModele, VERSION_MODELE, () => {
          const nom = fichier.nom.replace(/\.(xlsx|xlsm)$/i, "");
          downloadTemplateXlsx(`${nom}-v${VERSION_MODELE}.xlsx`, mettreANiveau(model));
        })
      );
    } else if (state.vue === "ecarts") {
      // Les deux paliers comparés ; sans axe déclaré, il n'y a rien à comparer.
      const rangCompare = state.palierCompare === null ? null : rangDuPalier(model, state.palierCompare) ?? null;
      if (rang === null || rangCompare === null) {
        // Un seul palier n'est pas « aucun palier » : comparer réclame deux
        // bornes, mais le classeur n'est pas silencieux sur son axe du temps
        // pour autant -- lui prêter cette absence serait une fausse cause.
        const texte =
          model.paliers.length === 0
            ? "This workbook declares no milestones, so there is no change to measure."
            : "This workbook declares only one milestone; comparing needs two.";
        zoneRendu.appendChild(el("p", { class: "aucun-flux" }, [texte]));
      } else {
        zoneRendu.appendChild(
          buildEcartsReport(
            calculerEcarts(model, rangCompare, rang, state.mode),
            state.palierCompare!,
            state.palierAffiche!
          )
        );
        // Le schéma vient après le relevé : on lit d'abord ce qui a changé,
        // puis on va voir où. Il arrive en différé, le placement étant
        // asynchrone, et une génération le protège d'un affichage périmé.
        const génération = ++générationRendu;
        const vueEcarts = buildEcartsView(model, rangCompare, rang, state.mode);
        if (vueEcarts.edges.length > 0) {
          const couleurs = couleursDuModele(model);
          zoneRendu.appendChild(buildEcartsTitreSchema(state.palierCompare!, state.palierAffiche!));
          computeLayout(vueEcarts.nodes, vueEcarts.edges).then((positioned) => {
            if (génération !== générationRendu) return;
            zoneRendu.appendChild(buildGraphSvg(positioned, (t) => couleurs.get(t) ?? "#000"));
            // Le schéma d'écart s'exporte comme les autres. Les boutons en
            // dépendent, et il n'existait pas encore au rendu du bandeau.
            renderBanner(bandeau, state, true, {
              onExportSvg: exportSvgHandler,
              onExportPng: exportPngHandler,
              onExportXlsx: exportXlsxHandler,
      onExportMarkdown: exportMarkdownHandler,
              onExportDrawio: exportDrawioHandler,
              onExportStructurizr: exportStructurizrHandler,
              onExportLikeC4: exportLikeC4Handler,
            });
          });
        }
      }
    } else if (state.vue === "aide") {
      zoneRendu.appendChild(buildAide());
    } else if (state.vue === "controles") {
      zoneRendu.appendChild(buildIntegrityReport(fichier.report));
    } else if (state.vue === "matrice") {
      const matrix = buildMatrixView(model, lecture, {
        mode: state.mode,
        granularite: state.filtresMatrice.granularite,
        masquerExternes: state.filtresMatrice.masquerExternes,
        acteursMasques: state.filtresMatrice.acteursMasques,
      });
      matriceCourante = matrix;
      technologiesCourantes = [...new Set(matrix.lignes.flatMap((l) => [...l.cellules.values()].flat().map((c) => c.technologie)))];
      // Le tableau d'abord, la couleur ensuite. La palette reste indexée sur
      // les types déclarés au classeur, et non sur les seuls survivants du
      // filtrage : sinon une technologie changerait de couleur d'un filtre à
      // l'autre, et entre la matrice et les schémas.
      const couleurs = couleursDuModele(model);
      zoneRendu.appendChild(buildMatrixTable(matrix, (t) => couleurs.get(t) ?? "#000"));
    } else {
      let view;
      if (state.vue === "groupe-a-groupe") {
        view = buildGroupToGroupView(model, lecture, options);
      } else if (state.vue === "plateforme-detaillee") {
        view = buildPlatformDetailView(model, lecture, options);
      } else if (state.vue === "plateforme-seule") {
        view = buildPlatformOnlyView(model, lecture, options);
      } else if (state.vue === "par-acteur") {
        // Même liste que le sélecteur du rail (§5.2) : un défaut piochant hors
        // d'elle désignerait un acteur que l'utilisateur ne peut même pas voir.
        const acteursDisponibles = state.mode === "fonctionnel" ? acteursMetier(model) : model.acteurs;
        if (!state.selectionActeur && acteursDisponibles.length > 0) {
          setState(withSelectionActeur(state, [...acteursDisponibles].sort((a, b) => a.nom.localeCompare(b.nom, "fr"))[0].nom));
          return;
        }
        view = state.selectionActeur
          ? buildByActorView(model, lecture.flux, state.selectionActeur, {
              technosMasquees: state.filtresActeur.technosMasquees,
              acteursMasques: state.filtresActeur.acteursMasques,
            })
          : { nodes: [], edges: [] };
      } else {
        if (!state.selectionTechnologie && model.typesFlux.length > 0) {
          setState(withSelectionTechnologie(state, [...model.typesFlux].sort((a, b) => a.type.localeCompare(b.type, "fr"))[0].type));
          return;
        }
        view = state.selectionTechnologie
          ? buildByTechnologyView(model, lecture.flux, state.selectionTechnologie, {
              compteurs: options.compteurs,
              masquerExternes: state.filtresTechnologie.masquerExternes,
              acteursMasques: state.filtresTechnologie.acteursMasques,
            })
          : { nodes: [], edges: [] };
      }

      // Un acteur métier isolé (§5.2) produit un nœud seul, zéro arête : ce
      // n'est pas rien à montrer, c'est PRÉCISÉMENT ce qu'il faut montrer. Le
      // message ne vaut que pour une sélection réellement vide.
      if (view.nodes.length === 0) {
        zoneRendu.appendChild(el("p", { class: "aucun-flux" }, ["No flow to display for this selection."]));
      } else {
        // Le calcul de placement est asynchrone (ELK). Une génération protège
        // d'un rendu périmé : si l'utilisateur change de vue pendant le calcul,
        // le schéma qui arrive en retard ne doit pas s'afficher par-dessus.
        const génération = ++générationRendu;
        const couleurs = couleursDuModele(model);
        const vueDuCalcul = view;
        computeLayout(vueDuCalcul.nodes, vueDuCalcul.edges)
          .then((positioned) => {
            if (génération !== générationRendu) return;
            zoneRendu.appendChild(buildGraphSvg(positioned, (t) => couleurs.get(t) ?? "#000"));
            // Les boutons d'export dépendent de la présence du SVG, qui
            // n'existait pas encore au moment du rendu du bandeau.
            renderBanner(bandeau, state, true, {
              onExportSvg: exportSvgHandler,
              onExportPng: exportPngHandler,
              onExportXlsx: exportXlsxHandler,
      onExportMarkdown: exportMarkdownHandler,
              onExportDrawio: exportDrawioHandler,
              onExportStructurizr: exportStructurizrHandler,
              onExportLikeC4: exportLikeC4Handler,
            });
          })
          .catch((err) => {
            if (génération !== générationRendu) return;
            console.error(err);
            clear(zoneRendu);
            zoneRendu.appendChild(el("p", { class: "aucun-flux" }, ["Unexpected error while rendering this view."]));
          });
        technologiesCourantes = [...new Set(view.edges.map((e) => e.technologie))];
      }
    }

    renderRail(rail, state, lecture.flux, technologiesCourantes.sort((a, b) => a.localeCompare(b, "fr")), {
      onMode: (mode) => setState(withMode(state, mode)),
      onVue: (vue) => setState(withVue(withMessageBandeau(state, null), vue)),
      onSelectionActeur: (nom) => setState(withSelectionActeur(withMessageBandeau(state, null), nom)),
      onSelectionTechnologie: (type) => setState(withSelectionTechnologie(withMessageBandeau(state, null), type)),
      onPalierAffiche: (palier) => setState(recalculerRapport(withPalierAffiche(withMessageBandeau(state, null), palier))),
      onPalierCompare: (palier) => setState(withPalierCompare(withMessageBandeau(state, null), palier)),
      onOptionCompteurs: (value) => setState(withOptions(withMessageBandeau(state, null), { compteurs: value })),
      onTelechargerModele: telechargerModeleHandler,
      onTelechargerExemple: telechargerExempleHandler,
      onMigrationLegacy: migrationLegacyHandler,
      onTechnoMasquee: (techno, masquée) => setState(withTechnoMasquee(withMessageBandeau(state, null), techno, masquée)),
      onActeurMasque: (acteur, masqué) => setState(withActeurMasque(withMessageBandeau(state, null), acteur, masqué)),
      onMasquerExternes: (value) => setState(withMasquerExternes(withMessageBandeau(state, null), value)),
      onActeurMasqueTechnologie: (acteur, masqué) =>
        setState(withActeurMasqueTechnologie(withMessageBandeau(state, null), acteur, masqué)),
      onMasquerExternesMatrice: (value) => setState(withMasquerExternesMatrice(withMessageBandeau(state, null), value)),
      onActeurMasqueMatrice: (acteur, masqué) =>
        setState(withActeurMasqueMatrice(withMessageBandeau(state, null), acteur, masqué)),
      onGranulariteMatrice: (granularite) => setState(withGranulariteMatrice(withMessageBandeau(state, null), granularite)),
    });
  }

  render();
}
