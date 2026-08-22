import type { LayoutNode } from "../layout/graph-layout";

// Fixe, indépendant du thème de l'appli : un export doit rester lisible
// ouvert seul, hors de toute page qui l'habillerait en clair/sombre (§8).
export const PAPER = "#ffffff";
export const INK = "#14181f";

// Épaisseur uniforme pour tous les traits. Faire varier l'épaisseur avec le
// nombre de flux agrégés produisait un effet de gras sur les troncs fusionnés,
// qui écrasait visuellement leurs voisins ; le volume se lit dans le « ×N » du
// libellé, pas dans la graisse du trait.
export const STROKE_WIDTH = 2;

// Un écart ne porte pas la couleur de sa technologie : il porte celle de son
// sens. C'est aussi ce que dit PAPIER/ENCRE -- un export ne suit pas le thème
// de qui l'affiche.
export const CHANGE_COLOUR: Record<"added" | "removed", string> = {
  added: "#1a7f43",
  removed: "#d03b3b",
};

export interface NodeStyle {
  fill: string;
  stroke: string;
  lightText: boolean;
  strokeWidth: number;
}

// Palette par kind, dans l'esprit C4 (Structurizr) : gris-bleu neutre pour un
// système de contexte, bleu soutenu pour ce qui est mis en avant (plateforme,
// acteur sélectionné).
//
// La couleur code le PÉRIMÈTRE, pas la technologie : c'est le levier de
// lisibilité le plus fort quand une plateforme centrale est entourée de
// systèmes tiers -- la technologie, elle, est déjà portée par la couleur des
// traits et par la légende.
//
// Couleurs relevées dans la source du gabarit C4 de draw.io (Sidebar-C4.js),
// puis assombries : le texte des boîtes est toujours blanc, et deux de ces
// fonds ne le portaient pas -- blanc sur #23A2D9 donnait 2,90:1 et blanc sur
// #8C8496 3,59:1, pour un seuil de 4,5:1. Chacun reprend la teinte de sa
// PROPRE BORDURE ou son équivalent : la famille de couleur ne change pas,
// seule sa clarté descend. #0E7DAD donne 4,61:1 et #6E6579 donne 5,53:1.
export function styleOfNode(node: Pick<LayoutNode, "kind" | "external">): NodeStyle {
  if (node.kind === "focus-actor") {
    return { fill: "#083F75", stroke: "#06315C", lightText: true, strokeWidth: 2 };
  }
  if (node.external) {
    return { fill: "#6E6579", stroke: "#514A5A", lightText: true, strokeWidth: 1 };
  }
  if (node.kind === "platform") {
    return { fill: "#0E7DAD", stroke: "#0A5E82", lightText: true, strokeWidth: 1 };
  }
  return { fill: "#1061B0", stroke: "#0D5091", lightText: true, strokeWidth: 1 };
}
