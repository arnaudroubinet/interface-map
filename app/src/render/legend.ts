import type { LayoutNode } from "../layout/graph-layout";
import { CHANGE_COLOUR, INK, styleOfNode } from "./node-styles";
import { normalizeText } from "../shared/text";

// Ce que la légende annonce doit être ce que le dessin utilise. Elle vit ici,
// en DONNÉES, et non dans le constructeur SVG : le fichier draw.io doit
// dessiner exactement la même, et deux légendes divergentes pour un même
// schéma sont précisément ce qu'on veut rendre impossible.
export type LegendSample =
  | { shape: "line"; colour: string; dashed?: boolean; head?: "start" | "end"; thickness?: number }
  | { shape: "box"; fill: string; stroke: string; dashed?: boolean; cutCorner?: boolean; pile?: boolean };

export interface LegendEntry {
  sample: LegendSample;
  text: string;
}

// Le strict nécessaire pour décider d'une entrée : la légende ne connaît pas
// le type interne du constructeur SVG, et n'a pas à le connaître.
export interface LegendableNode {
  kind: LayoutNode["kind"];
  external?: boolean;
  technical?: boolean;
  aggregate?: number;
}

export interface LegendableEdge {
  technology: string;
  criticality?: string;
  change?: "added" | "removed";
  // La pointe et le pointillé sont de la NOTATION : ils disent qui appelle et
  // si le contenu change en route. La couleur, elle, n'est qu'un rappel.
  //
  // `fleche` dit si CE trait en porte une : un tronc fusionné n'en a pas, et
  // la légende n'annonce que ce que le dessin montre.
  arrow?: boolean;
  pulled?: boolean;
  attenuated?: boolean;
}

const CHANGE_LABEL: Record<"added" | "removed", string> = {
  added: "+n : flows added",
  removed: "−n : flows removed",
};

export function legendEntries(
  edges: readonly LegendableEdge[],
  nodes: readonly LegendableNode[],
  colorFor: (tech: string) => string,
  weightByCriticality = false
): LegendEntry[] {
  const inputs: LegendEntry[] = [];

  for (const change of ["added", "removed"] as const) {
    if (edges.some((e) => e.change === change)) {
      inputs.push({
        // Le retrait porte aussi le tiret long : sans lui, vert et rouge
        // deviennent le même gris à l'impression.
        sample: { shape: "line", colour: CHANGE_COLOUR[change], dashed: change === "removed" },
        text: CHANGE_LABEL[change],
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
  const drawing = edges.filter((e) => !e.change && e.arrow);
  if (drawing.some((e) => e.pulled === true)) {
    inputs.push({
      sample: { shape: "line", colour: INK, head: "end" },
      text: "provider pushes",
    });
    inputs.push({
      sample: { shape: "line", colour: INK, head: "start" },
      text: "consumer pulls",
    });
  }
  // Une graisse non annoncée est une notation muette de plus, exactement ce
  // que la pointe était avant.
  if (weightByCriticality) {
    for (const [value, thickness] of [
      ["1 - Critical", 3.5],
      ["2 - Important", 2],
      ["3 - Standard", 1],
    ] as [string, number][]) {
      if (!edges.some((e) => normalizeText(e.criticality ?? "") === normalizeText(value))) continue;
      inputs.push({ sample: { shape: "line", colour: INK, thickness }, text: `criticality: ${value}` });
    }
  }

  if (edges.some((e) => !e.change && e.attenuated === true)) {
    inputs.push({
      sample: { shape: "line", colour: INK, dashed: true },
      text: "decision: Transform — content changes on the way",
    });
  }

  // Un trait marqué d'un écart ne porte plus la couleur de sa technologie :
  // l'annoncer désignerait un code couleur absent du dessin. Et une
  // technologie vide n'en est pas une -- la lecture fonctionnelle la vide sur
  // toutes ses arêtes.
  const technologies = [...new Set(edges.filter((e) => !e.change && e.technology !== "").map((e) => e.technology))].sort((a, b) =>
    a.localeCompare(b, "fr")
  );
  for (const tech of technologies) {
    inputs.push({ sample: { shape: "line", colour: colorFor(tech) }, text: tech });
  }

  // La frontière de plateforme est un repère de fond, pas un acteur : la
  // compter ferait apparaître « External » toute seule.
  const drawable = nodes.filter((n) => n.kind !== "boundary");

  // Une forme non annoncée est une notation muette de plus, exactement ce que
  // la pointe était avant.
  if (drawable.some((n) => n.technical)) {
    const style = styleOfNode({ kind: "actor", external: false });
    inputs.push({
      sample: { shape: "box", fill: style.fill, stroke: style.stroke, cutCorner: true },
      text: "cut corner: technical component",
    });
  }
  if (drawable.some((n) => (n.aggregate ?? 0) > 1)) {
    const style = styleOfNode({ kind: "actor", external: false });
    inputs.push({
      sample: { shape: "box", fill: style.fill, stroke: style.stroke, pile: true },
      text: "stacked box: several components",
    });
  }

  if (drawable.some((n) => n.external) && drawable.some((n) => !n.external)) {
    for (const [text, external] of [["Platform", false], ["External", true]] as [string, boolean][]) {
      const style = styleOfNode({ kind: "actor", external });
      inputs.push({ sample: { shape: "box", fill: style.fill, stroke: style.stroke, dashed: external }, text });
    }
  }

  return inputs;
}
