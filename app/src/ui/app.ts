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
import { computeLayout, restreindreLayout, type LayoutResult } from "../layout/graph-layout";
import { toutesLesPlanches } from "../aggregation/planches";
import { buildGraphSvg } from "../render/svg-builder";
import { libelléCartouche, type ContexteSchema } from "../render/cartouche";
import { brancherZoom } from "../render/zoom";
import { conseilDEchelle } from "./echelle";
import { chainesDisponibles, buildChainView } from "../aggregation/chaine";
import type { Lecture } from "../aggregation/fonctionnel";
import { lectureUnion } from "../aggregation/fonctionnel";
import type { ViewResult } from "../aggregation/views";
import type { GraphNode, GraphEdge } from "../aggregation/core";
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
import { handlersExport } from "./export-handlers";
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
  withSelectionChaine,
  withVoisinage,
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
// non dans le bandeau parce qu'elles pilotent CE schéma-là, qui vient d'être
// construit.
function construireCommandesZoom(commandes: { ajuster: () => void; zoomer: (f: number) => void }): HTMLElement {
  const barre = el("div", { class: "commandes-zoom" });
  const bouton = (libellé: string, titre: string, action: () => void) => {
    const b = el("button", { type: "button", title: titre }, [libellé]);
    b.addEventListener("click", action);
    barre.appendChild(b);
  };
  bouton("Fit", "Fit the whole board", commandes.ajuster);
  bouton("−", "Zoom out", () => commandes.zoomer(1 / 1.3));
  bouton("+", "Zoom in", () => commandes.zoomer(1.3));
  return barre;
}

// Ce que le schéma dira de lui-même. Tout vient de l'état : la vue, la
// lecture, le palier affiché, le nom du fichier et sa date de sauvegarde --
// c'est l'âge de la DONNÉE qui compte, pas celui de l'impression.
function contexteDuSchema(state: AppState, fichier: FichierCharge, view: { nodes: GraphNode[]; edges: GraphEdge[] }): ContexteSchema {
  return {
    titre: LIBELLE_VUE[state.vue],
    lecture: state.mode === "fonctionnel" ? "functional" : "architecture",
    palier: state.palierAffiche,
    source: fichier.nom,
    date: fichier.dateModification ? fichier.dateModification.toISOString().slice(0, 10) : "save date unknown",
    composants: view.nodes.filter((n) => n.kind !== "frontiere").length,
    flux: view.edges.length,
    technologies: new Set(view.edges.map((e) => e.technologie).filter(Boolean)).size,
  };
}

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

      // Les positions d'un parc n'ont aucun sens sur un autre.
      placements.clear();

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
  // Les placements déjà calculés, par (vue, lecture, filtres) -- sans le
  // palier. Vidée au chargement d'un autre classeur : les positions d'un parc
  // n'ont aucun sens sur un autre.
  const placements = new Map<string, Promise<LayoutResult>>();
  // La matrice affichée, gardée pour l'export : la recalculer au clic risquerait
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
  // l'état, de quoi le remplacer, du schéma à l'écran et de la matrice
  // affichée. On les fabrique une fois, avec des lectures paresseuses -- un
  // gestionnaire câblé au premier rendu doit lire l'état du clic, pas celui de
  // sa construction.
  const exportHandlers = handlersExport({
    etat: () => state,
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
      if (state.vue === "aide") {
        const retour = el("button", { class: "bouton-export" }, ["Back"]);
        retour.addEventListener("click", () => setState(withVue(state, "groupe-a-groupe")));
        zoneRendu.appendChild(el("div", { class: "aide-seule" }, [retour, buildAide()]));
      } else {
        zoneRendu.appendChild(
          buildDropTarget(telechargerExempleHandler, () => setState(withVue(state, "aide")))
        );
      }
      renderBanner(bandeau, state, false, exportHandlers);
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

    renderBanner(bandeau, state, currentSvg() !== null, exportHandlers);
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
            zoneRendu.appendChild(
              buildGraphSvg(positioned, (t) => couleurs.get(t) ?? "#000", contexteDuSchema(state, fichier, vueEcarts))
            );
            // Le schéma d'écart s'exporte comme les autres. Les boutons en
            // dépendent, et il n'existait pas encore au rendu du bandeau.
            renderBanner(bandeau, state, true, exportHandlers);
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
        ordre: state.filtresMatrice.ordre,
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
      zoneRendu.appendChild(
        buildMatrixTable(matrix, (t) => couleurs.get(t) ?? "#000", libelléCartouche(contexteDuSchema(state, fichier, { nodes: [], edges: [] })).titre)
      );
    } else {
      // La MÊME construction pour le palier affiché et pour l'union de tous
      // les paliers : c'est ce qui garantit que les deux vues se correspondent
      // nœud pour nœud, donc que le placement de l'union se restreint sans
      // rien inventer.
      const construireVue = (lecture: Lecture): ViewResult => {
      let view: ViewResult;
      if (state.vue === "groupe-a-groupe") {
        view = buildGroupToGroupView(model, lecture, options);
      } else if (state.vue === "plateforme-detaillee") {
        view = buildPlatformDetailView(model, lecture, options);
      } else if (state.vue === "plateforme-seule") {
        view = buildPlatformOnlyView(model, lecture, options);
      } else if (state.vue === "chaine") {
        const chaînes = chainesDisponibles(model, rang);
        const retenue = chaînes.find((c) => c.id === state.selectionChaine);
        if (!retenue && chaînes.length > 0) {
          chaineParDefaut = chaînes[0].id;
        }
        view = retenue ? buildChainView(model, retenue) : { nodes: [], edges: [] };
      } else if (state.vue === "par-acteur") {
        // Même liste que le sélecteur du rail (§5.2) : un défaut piochant hors
        // d'elle désignerait un acteur que l'utilisateur ne peut même pas voir.
        const acteursDisponibles = lecture.acteurs;
        if (!state.selectionActeur && acteursDisponibles.length > 0) {
          acteurParDefaut = [...acteursDisponibles].sort((a, b) => a.nom.localeCompare(b.nom, "fr"))[0].nom;
        }
        view = state.selectionActeur
          ? buildByActorView(model, lecture.flux, state.selectionActeur, {
              technosMasquees: state.filtresActeur.technosMasquees,
              acteursMasques: state.filtresActeur.acteursMasques,
              voisinage: state.filtresActeur.voisinage,
            })
          : { nodes: [], edges: [] };
      } else {
        if (!state.selectionTechnologie && model.typesFlux.length > 0) {
          besoinDeSelectionTechnologie = true;
        }
        view = state.selectionTechnologie
          ? buildByTechnologyView(model, lecture.flux, state.selectionTechnologie, {
              compteurs: options.compteurs,
              libelléArête: options.libelléArête,
              masquerExternes: state.filtresTechnologie.masquerExternes,
              acteursMasques: state.filtresTechnologie.acteursMasques,
            })
          : { nodes: [], edges: [] };
      }
      return view;
      };

      let besoinDeSelectionTechnologie = false;
      let acteurParDefaut: string | null = null;
      let chaineParDefaut: string | null = null;
      const view = construireVue(lecture);
      if (chaineParDefaut) {
        setState(withSelectionChaine(state, chaineParDefaut));
        return;
      }
      if (acteurParDefaut) {
        setState(withSelectionActeur(state, acteurParDefaut));
        return;
      }
      if (besoinDeSelectionTechnologie) {
        setState(withSelectionTechnologie(state, [...model.typesFlux].sort((a, b) => a.type.localeCompare(b.type, "fr"))[0].type));
        return;
      }

      // Un acteur métier isolé (§5.2) produit un nœud seul, zéro arête : ce
      // n'est pas rien à montrer, c'est PRÉCISÉMENT ce qu'il faut montrer. Le
      // message ne vaut que pour une sélection réellement vide.
      if (view.nodes.length === 0) {
        zoneRendu.appendChild(el("p", { class: "aucun-flux" }, ["No flow to display for this selection."]));
      } else {
        // Une planche qui a dépassé ce que le nœud-lien sert bien doit le
        // DIRE, et proposer où aller. Jamais bloquer, jamais tronquer.
        const conseil = conseilDEchelle(view.nodes.filter((n) => n.kind !== "frontiere").length, view.edges.length);
        if (conseil) {
          const bandeauEchelle = el("div", { class: "conseil-echelle" }, [conseil.message]);
          for (const cible of conseil.vues) {
            const bouton = el("button", { type: "button" }, [LIBELLE_VUE[cible]]);
            bouton.addEventListener("click", () => setState(withVue(withMessageBandeau(state, null), cible)));
            bandeauEchelle.appendChild(bouton);
          }
          zoneRendu.appendChild(bandeauEchelle);
        }
        // Le calcul de placement est asynchrone (ELK). Une génération protège
        // d'un rendu périmé : si l'utilisateur change de vue pendant le calcul,
        // le schéma qui arrive en retard ne doit pas s'afficher par-dessus.
        const génération = ++générationRendu;
        const couleurs = couleursDuModele(model);
        const vueDuCalcul = view;
        // On place l'UNION de tous les paliers, une seule fois, et chaque
        // palier n'en montre que son sous-ensemble : une boîte présente aux
        // deux paliers ne bouge alors pas d'un pixel. La clé de mémoire ne
        // contient donc PAS le palier -- c'est précisément d'un palier à
        // l'autre qu'on veut la continuité.
        const cléPlacement = JSON.stringify([
          state.vue, state.mode, state.selectionActeur, state.selectionTechnologie, state.selectionChaine,
          state.filtresActeur, state.filtresTechnologie, options,
        ]);
        const vueUnion = construireVue(lectureUnion(model, state.mode));
        const placement = placements.get(cléPlacement) ?? computeLayout(vueUnion.nodes, vueUnion.edges);
        placements.set(cléPlacement, placement);
        placement
          .then((union) => {
            if (génération !== générationRendu) return;
            const positioned = restreindreLayout(union, vueDuCalcul);
            const svg = buildGraphSvg(positioned, (t) => couleurs.get(t) ?? "#000", contexteDuSchema(state, fichier, vueDuCalcul), {
              graisseParCriticite: state.options.graisseParCriticite,
            });
            zoneRendu.appendChild(svg);
            zoneRendu.appendChild(construireCommandesZoom(brancherZoom(svg)));
            // Les boutons d'export dépendent de la présence du SVG, qui
            // n'existait pas encore au moment du rendu du bandeau.
            renderBanner(bandeau, state, true, exportHandlers);
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

    renderRail(rail, state, lecture, technologiesCourantes.sort((a, b) => a.localeCompare(b, "fr")), {
      onMode: (mode) => setState(withMode(state, mode)),
      onVue: (vue) => setState(withVue(withMessageBandeau(state, null), vue)),
      onSelectionActeur: (nom) => setState(withSelectionActeur(withMessageBandeau(state, null), nom)),
      onGraisseParCriticite: (value) => setState(withOptions(withMessageBandeau(state, null), { graisseParCriticite: value })),
      onVoisinage: (value) => setState(withVoisinage(withMessageBandeau(state, null), value)),
      onSelectionChaine: (chaîne) => setState(withSelectionChaine(withMessageBandeau(state, null), chaîne)),
      onSelectionTechnologie: (type) => setState(withSelectionTechnologie(withMessageBandeau(state, null), type)),
      onPalierAffiche: (palier) => setState(recalculerRapport(withPalierAffiche(withMessageBandeau(state, null), palier))),
      onPalierCompare: (palier) => setState(withPalierCompare(withMessageBandeau(state, null), palier)),
      onOptionCompteurs: (value) => setState(withOptions(withMessageBandeau(state, null), { compteurs: value })),
      onLibelléArête: (value) => setState(withOptions(withMessageBandeau(state, null), { libelléArête: value })),
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
      onEchellePng: (value) => setState(withOptions(withMessageBandeau(state, null), { echellePng: value })),
      onOrdreMatrice: (value) => setState(withOrdreMatrice(withMessageBandeau(state, null), value)),
      onGranulariteMatrice: (granularite) => setState(withGranulariteMatrice(withMessageBandeau(state, null), granularite)),
    });
  }

  render();
}
