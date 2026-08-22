import type { LayoutNode } from "../layout/graph-layout";

// Fixe, indépendant du thème de l'appli : un export doit rester lisible
// ouvert seul, hors de toute page qui l'habillerait en clair/sombre (§8).
export const PAPIER = "#ffffff";
export const ENCRE = "#14181f";

// Épaisseur uniforme pour tous les traits. Faire varier l'épaisseur avec le
// nombre de flux agrégés produisait un effet de gras sur les troncs fusionnés,
// qui écrasait visuellement leurs voisins ; le volume se lit dans le « ×N » du
// libellé, pas dans la graisse du trait.
export const ÉPAISSEUR_TRAIT = 2;

// Un écart ne porte pas la couleur de sa technologie : il porte celle de son
// sens. C'est aussi ce que dit PAPIER/ENCRE -- un export ne suit pas le thème
// de qui l'affiche.
export const COULEUR_ECART: Record<"ajout" | "retrait", string> = {
  ajout: "#1a7f43",
  retrait: "#d03b3b",
};

export interface StyleNoeud {
  fond: string;
  bord: string;
  texteClair: boolean;
  épaisseurBord: number;
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
export function styleDuNoeud(node: Pick<LayoutNode, "kind" | "externe">): StyleNoeud {
  if (node.kind === "acteur-selectionne") {
    return { fond: "#083F75", bord: "#06315C", texteClair: true, épaisseurBord: 2 };
  }
  if (node.externe) {
    return { fond: "#6E6579", bord: "#514A5A", texteClair: true, épaisseurBord: 1 };
  }
  if (node.kind === "plateforme") {
    return { fond: "#0E7DAD", bord: "#0A5E82", texteClair: true, épaisseurBord: 1 };
  }
  return { fond: "#1061B0", bord: "#0D5091", texteClair: true, épaisseurBord: 1 };
}
