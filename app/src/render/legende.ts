import type { LayoutNode } from "../layout/graph-layout";
import { COULEUR_ECART, styleDuNoeud } from "./styles-noeud";

// Ce que la légende annonce doit être ce que le dessin utilise. Elle vit ici,
// en DONNÉES, et non dans le constructeur SVG : le fichier draw.io doit
// dessiner exactement la même, et deux légendes divergentes pour un même
// schéma sont précisément ce qu'on veut rendre impossible.
export type ÉchantillonLegende =
  | { forme: "trait"; couleur: string; pointillé?: boolean; pointe?: "debut" | "fin" }
  | { forme: "boite"; fond: string; bord: string; pointillé?: boolean };

export interface EntreeLegende {
  échantillon: ÉchantillonLegende;
  texte: string;
}

// Le strict nécessaire pour décider d'une entrée : la légende ne connaît pas
// le type interne du constructeur SVG, et n'a pas à le connaître.
export interface ArêteLegendable {
  technologie: string;
  ecart?: "ajout" | "retrait";
}

const LIBELLE_ECART: Record<"ajout" | "retrait", string> = {
  ajout: "+n : flows added",
  retrait: "−n : flows removed",
};

export function entreesDeLegende(
  edges: readonly ArêteLegendable[],
  nodes: readonly Pick<LayoutNode, "kind" | "externe">[],
  colorFor: (tech: string) => string
): EntreeLegende[] {
  const entrées: EntreeLegende[] = [];

  for (const ecart of ["ajout", "retrait"] as const) {
    if (edges.some((e) => e.ecart === ecart)) {
      entrées.push({ échantillon: { forme: "trait", couleur: COULEUR_ECART[ecart] }, texte: LIBELLE_ECART[ecart] });
    }
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
  if (dessinables.some((n) => n.externe) && dessinables.some((n) => !n.externe)) {
    for (const [texte, externe] of [["Platform", false], ["External", true]] as [string, boolean][]) {
      const style = styleDuNoeud({ kind: "acteur", externe });
      entrées.push({ échantillon: { forme: "boite", fond: style.fond, bord: style.bord, pointillé: externe }, texte });
    }
  }

  return entrées;
}
