import type { Vue } from "./state";

// Le seuil se CALCULE, il ne se devine pas. La littérature donne la formule :
// densité d = |E| / |V|². Au-delà de vingt nœuds, une planche dense se lit
// mieux en matrix ; une planche creuse se lit mieux acteur par acteur -- là,
// c'est la surface qui gêne, pas l'enchevêtrement.
//
// Sur le classeur d'exemple : |V| = 15 et d = 27/225 = 0,12, donc rien ne
// s'affiche. C'est le bon comportement : un avertissement qui crie sur un
// petit parc apprend surtout à être ignoré.
const SEUIL_NOEUDS = 20;
const SEUIL_DENSITE = 0.15;

export interface ConseilEchelle {
  message: string;
  views: Vue[];
}

export function conseilDEchelle(nbNoeuds: number, nbAretes: number): ConseilEchelle | null {
  if (nbNoeuds <= SEUIL_NOEUDS) return null;
  const density = nbAretes / (nbNoeuds * nbNoeuds);
  const dense = density > SEUIL_DENSITE;
  return {
    message: `${nbNoeuds} components and ${nbAretes} flows on one board — ${
      dense ? "the Matrix view" : "a By-actor view"
    } will read better.`,
    // On ne bloque ni ne tronque jamais : on dit, et on propose.
    views: dense ? ["matrix", "by-actor"] : ["by-actor"],
  };
}
