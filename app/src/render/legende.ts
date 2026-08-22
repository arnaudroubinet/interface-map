import type { LayoutNode } from "../layout/graph-layout";
import { COULEUR_ECART, ENCRE, styleDuNoeud } from "./styles-noeud";
import { normalizeText } from "../shared/text";

// Ce que la légende annonce doit être ce que le dessin utilise. Elle vit ici,
// en DONNÉES, et non dans le constructeur SVG : le fichier draw.io doit
// dessiner exactement la même, et deux légendes divergentes pour un même
// schéma sont précisément ce qu'on veut rendre impossible.
export type ÉchantillonLegende =
  | { forme: "trait"; couleur: string; pointillé?: boolean; pointe?: "debut" | "fin"; épaisseur?: number }
  | { forme: "boite"; fond: string; bord: string; pointillé?: boolean; coinCoupé?: boolean; pile?: boolean };

export interface EntreeLegende {
  échantillon: ÉchantillonLegende;
  texte: string;
}

// Le strict nécessaire pour décider d'une entrée : la légende ne connaît pas
// le type interne du constructeur SVG, et n'a pas à le connaître.
export interface NoeudLegendable {
  kind: LayoutNode["kind"];
  externe?: boolean;
  technique?: boolean;
  agrégat?: number;
}

export interface ArêteLegendable {
  technologie: string;
  criticite?: string;
  ecart?: "ajout" | "retrait";
  // La pointe et le pointillé sont de la NOTATION : ils disent qui appelle et
  // si le contenu change en route. La couleur, elle, n'est qu'un rappel.
  //
  // `fleche` dit si CE trait en porte une : un tronc fusionné n'en a pas, et
  // la légende n'annonce que ce que le dessin montre.
  fleche?: boolean;
  tire?: boolean;
  atténué?: boolean;
}

const LIBELLE_ECART: Record<"ajout" | "retrait", string> = {
  ajout: "+n : flows added",
  retrait: "−n : flows removed",
};

export function entreesDeLegende(
  edges: readonly ArêteLegendable[],
  nodes: readonly NoeudLegendable[],
  colorFor: (tech: string) => string,
  graisseParCriticite = false
): EntreeLegende[] {
  const entrées: EntreeLegende[] = [];

  for (const ecart of ["ajout", "retrait"] as const) {
    if (edges.some((e) => e.ecart === ecart)) {
      entrées.push({
        // Le retrait porte aussi le tiret long : sans lui, vert et rouge
        // deviennent le même gris à l'impression.
        échantillon: { forme: "trait", couleur: COULEUR_ECART[ecart], pointillé: ecart === "retrait" },
        texte: LIBELLE_ECART[ecart],
      });
    }
  }

  // La notation avant le code couleur : un lecteur doit savoir lire la FORME
  // du trait avant de se demander ce que sa teinte veut dire. Sur un schéma
  // d'écart il n'y a pas de pointe à expliquer -- les traits n'y portent plus
  // ni technologie ni sens.
  //
  // Les DEUX pointes ne s'expliquent que si un flux tiré est dessiné : c'est
  // la pointe CREUSE qui surprend, et elle n'a de sens qu'opposée à la pleine.
  // Là où toutes les pointes sont pleines, elles se lisent comme le sens de la
  // donnée et n'appellent aucune explication. Surtout, la lecture fonctionnelle
  // pose « du fournisseur vers le consommateur » faute de mieux -- une chaîne
  // traverse plusieurs médias, parfois de sens opposés -- et y annoncer
  // « provider pushes » affirmerait ce que le schéma ne sait pas.
  const dessin = edges.filter((e) => !e.ecart && e.fleche);
  if (dessin.some((e) => e.tire === true)) {
    entrées.push({
      échantillon: { forme: "trait", couleur: ENCRE, pointe: "fin" },
      texte: "provider pushes",
    });
    entrées.push({
      échantillon: { forme: "trait", couleur: ENCRE, pointe: "debut" },
      texte: "consumer pulls",
    });
  }
  // Une graisse non annoncée est une notation muette de plus, exactement ce
  // que la pointe était avant.
  if (graisseParCriticite) {
    for (const [valeur, épaisseur] of [
      ["1 - Critical", 3.5],
      ["2 - Important", 2],
      ["3 - Standard", 1],
    ] as [string, number][]) {
      if (!edges.some((e) => normalizeText(e.criticite ?? "") === normalizeText(valeur))) continue;
      entrées.push({ échantillon: { forme: "trait", couleur: ENCRE, épaisseur }, texte: `criticality: ${valeur}` });
    }
  }

  if (edges.some((e) => !e.ecart && e.atténué === true)) {
    entrées.push({
      échantillon: { forme: "trait", couleur: ENCRE, pointillé: true },
      texte: "decision: Transform — content changes on the way",
    });
  }

  // Un trait marqué d'un écart ne porte plus la couleur de sa technologie :
  // l'annoncer désignerait un code couleur absent du dessin. Et une
  // technologie vide n'en est pas une -- la lecture fonctionnelle la vide sur
  // toutes ses arêtes.
  const technologies = [...new Set(edges.filter((e) => !e.ecart && e.technologie !== "").map((e) => e.technologie))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
  for (const tech of technologies) {
    entrées.push({ échantillon: { forme: "trait", couleur: colorFor(tech) }, texte: tech });
  }

  // La frontière de plateforme est un repère de fond, pas un acteur : la
  // compter ferait apparaître « External » toute seule.
  const dessinables = nodes.filter((n) => n.kind !== "frontiere");

  // Une forme non annoncée est une notation muette de plus, exactement ce que
  // la pointe était avant.
  if (dessinables.some((n) => n.technique)) {
    const style = styleDuNoeud({ kind: "acteur", externe: false });
    entrées.push({
      échantillon: { forme: "boite", fond: style.fond, bord: style.bord, coinCoupé: true },
      texte: "cut corner: technical component",
    });
  }
  if (dessinables.some((n) => (n.agrégat ?? 0) > 1)) {
    const style = styleDuNoeud({ kind: "acteur", externe: false });
    entrées.push({
      échantillon: { forme: "boite", fond: style.fond, bord: style.bord, pile: true },
      texte: "stacked box: several components",
    });
  }

  if (dessinables.some((n) => n.externe) && dessinables.some((n) => !n.externe)) {
    for (const [texte, externe] of [["Platform", false], ["External", true]] as [string, boolean][]) {
      const style = styleDuNoeud({ kind: "acteur", externe });
      entrées.push({ échantillon: { forme: "boite", fond: style.fond, bord: style.bord, pointillé: externe }, texte });
    }
  }

  return entrées;
}
