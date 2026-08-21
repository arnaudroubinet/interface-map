import type { AppState } from "./state";
import { LIBELLE_VUE, withMessageBandeau } from "./state";
import type { BannerCallbacks } from "./banner";
import type { MatrixResult } from "../aggregation/views";
import { rangDuPalier } from "../aggregation/paliers";
import { couleursDuModele } from "../render/colors";
import { toutesLesPlanches } from "../aggregation/planches";
import { computeLayout } from "../layout/graph-layout";
import { construireDrawio } from "../export/drawio-export";
import { modeleEnStructurizr } from "../export/c4-dsl";
import { modeleEnLikeC4 } from "../export/likec4-dsl";
import { rapportEnMarkdown } from "../export/rapport-markdown";
import { buildExportFilename } from "../export/filename";
import { downloadSvg } from "../export/svg-export";
import { exportPng, downloadPngBlob } from "../export/png-export";
import { downloadMatrixXlsx } from "../export/xlsx-export";
import { téléchargerTexte } from "../export/telechargement";

// Les sept exports, hors de la fermeture de mountApp.
//
// Ils y vivaient parmi dix-huit fonctions imbriquées, et l'on ne pouvait en
// éprouver aucun sans monter le DOM entier. Or ils ne dépendent que de quatre
// choses : l'état, de quoi le remplacer, le SVG à l'écran et la matrice
// affichée. C'est ce contrat-là qui est déclaré ci-dessous, et il tient en
// quatre lignes.
//
// Les fonctions sont demandées plutôt que les valeurs : l'état change à chaque
// rendu, et un gestionnaire câblé une fois doit lire l'état du moment où on
// clique, pas celui d'où on l'a construit.
export interface ContexteExport {
  etat: () => AppState;
  setState: (state: AppState) => void;
  // Le schéma à l'écran. Absent sur la matrice, le rapport et l'aide.
  svgCourant: () => SVGSVGElement | null;
  // La matrice AFFICHÉE, et non recalculée au clic : la recalculer risquerait
  // de livrer autre chose que ce que l'utilisateur a sous les yeux.
  matriceCourante: () => MatrixResult | null;
}

// Ce que le nom de fichier doit porter en plus de la vue : la sélection quand
// il y en a une, sans quoi deux lectures différentes se téléchargent sous le
// même nom.
function selectionDuNom(state: AppState): string | null {
  if (state.vue === "par-acteur") return state.selectionActeur;
  if (state.vue === "par-technologie") return state.selectionTechnologie;
  // Un écart se lit ENTRE deux paliers : le nom doit porter les deux. Le palier
  // d'arrivée est déjà ajouté par ailleurs.
  if (state.vue === "ecarts") return state.palierCompare;
  return null;
}

// Le palier affiché vaut pour tout ce qui décrit le MODÈLE plutôt qu'une
// planche : ces exports ne portent ni nom de vue ni sélection.
function rangAffiché(state: AppState): number | null {
  if (!state.fichier || state.palierAffiche === null) return null;
  return rangDuPalier(state.fichier.model, state.palierAffiche) ?? null;
}

export function handlersExport(ctx: ContexteExport): BannerCallbacks {
  const nomDeFichier = (extension: Parameters<typeof buildExportFilename>[3], avecMode = true) => {
    const state = ctx.etat();
    return buildExportFilename(
      LIBELLE_VUE[state.vue],
      selectionDuNom(state),
      state.palierAffiche,
      extension,
      avecMode ? state.mode : undefined
    );
  };

  return {
    onExportSvg() {
      const svg = ctx.svgCourant();
      if (!svg || !ctx.etat().fichier) return;
      downloadSvg(svg, nomDeFichier("svg"), "#ffffff");
    },

    async onExportPng() {
      const svg = ctx.svgCourant();
      if (!svg || !ctx.etat().fichier) return;
      const result = await exportPng(svg, "#ffffff", 2);
      if (!result.ok) {
        ctx.setState(
          withMessageBandeau(ctx.etat(), "Ce navigateur refuse la conversion en PNG — utilisez l'export SVG.")
        );
        return;
      }
      downloadPngBlob(result.blob, nomDeFichier("png"));
    },

    onExportXlsx() {
      const matrice = ctx.matriceCourante();
      if (!matrice || !ctx.etat().fichier) return;
      downloadMatrixXlsx(matrice, nomDeFichier("xlsx"));
    },

    onExportMarkdown() {
      const state = ctx.etat();
      if (!state.fichier) return;
      // Pas de mode ici : le rapport juge le CLASSEUR, pas une lecture du
      // classeur (§5.3). Son contenu ne bouge pas d'un mode à l'autre, son nom
      // ne doit donc pas bouger non plus.
      téléchargerTexte(
        rapportEnMarkdown(state.fichier.report, state.fichier.nom, state.palierAffiche),
        nomDeFichier("md", false)
      );
    },

    // Le fichier draw.io porte TOUTES les planches, une par onglet : il ne
    // dépend pas de la vue ouverte. Les placements se calculent à la demande --
    // une soixantaine de planches tient en moins d'une seconde, et les garder
    // au chaud obligerait à les refaire à chaque changement de palier.
    async onExportDrawio() {
      const state = ctx.etat();
      if (!state.fichier) return;
      const model = state.fichier.model;
      const couleurs = couleursDuModele(model);
      const placées = [];
      for (const planche of toutesLesPlanches(model, rangAffiché(state), state.mode)) {
        placées.push({
          titre: planche.titre,
          acteur: planche.acteur,
          layout: await computeLayout(planche.nodes, planche.edges),
        });
      }
      téléchargerTexte(
        construireDrawio(placées, (t) => couleurs.get(t) ?? "#000"),
        buildExportFilename("boards", null, state.palierAffiche, "drawio", state.mode)
      );
    },

    onExportStructurizr() {
      const state = ctx.etat();
      if (!state.fichier) return;
      téléchargerTexte(
        modeleEnStructurizr(state.fichier.model, rangAffiché(state), state.fichier.nom),
        buildExportFilename("model", null, state.palierAffiche, "dsl")
      );
    },

    onExportLikeC4() {
      const state = ctx.etat();
      if (!state.fichier) return;
      téléchargerTexte(
        modeleEnLikeC4(state.fichier.model, rangAffiché(state)),
        buildExportFilename("model", null, state.palierAffiche, "c4")
      );
    },
  };
}
