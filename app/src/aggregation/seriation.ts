// L'ordre des lignes et des colonnes d'une matrice. C'est le levier de lecture
// le plus fort dont elle dispose : à 18 % de densité, un ordre alphabétique
// disperse des blocs qu'un regroupement fait apparaître d'un coup.
//
// L'ordre d'implémentation suit celui que recommande la revue de référence --
// Behrisch, Bach, Henry Riche, Schreck & Fekete, « Matrix Reordering Methods
// for Table and Network Visualization », Computer Graphics Forum 35(3), 2016,
// https://doi.org/10.1111/cgf.12935, §11.1 : « fast algorithms first », et sa
// règle d'arrêt, « if a fast algorithm reveals desired patterns, a more
// sophisticated one is unlikely to improve on its quality significantly ».
export type OrdreMatrice = "alphabetique" | "groupe" | "degre" | "blocs";

export interface ContexteOrdre {
  groupeDe: (id: string) => string;
  degre: (id: string) => number;
  voisins: (id: string) => string[];
}

const parNom = (a: string, b: string) => a.localeCompare(b, "fr");

// Reverse Cuthill-McKee : un parcours en largeur depuis le sommet de plus
// faible degré, les voisins visités par degré croissant, puis on renverse.
// Linéaire, et « almost independently of the matrix density ».
//
// Son défaut est connu et assumé : la revue prévient qu'il « tends to produce
// strong bandwidth anti-patterns » -- une bande diagonale qui n'apprend rien.
// D'où deux règles : l'alphabétique reste le défaut, et il reste à un clic.
function rcm(ids: string[], ctx: ContexteOrdre): string[] {
  const restants = new Set(ids);
  const ordre: string[] = [];
  const parDegré = (a: string, b: string) => ctx.degre(a) - ctx.degre(b) || parNom(a, b);
  while (restants.size > 0) {
    const départ = [...restants].sort(parDegré)[0];
    const file = [départ];
    restants.delete(départ);
    while (file.length > 0) {
      const courant = file.shift()!;
      ordre.push(courant);
      for (const v of ctx.voisins(courant).filter((x) => restants.has(x)).sort(parDegré)) {
        restants.delete(v);
        file.push(v);
      }
    }
  }
  return ordre.reverse();
}

export function ordonner(ids: string[], ordre: OrdreMatrice, ctx: ContexteOrdre): string[] {
  const alphabetique = [...ids].sort(parNom);
  if (ordre === "alphabetique") return alphabetique;
  if (ordre === "groupe") {
    return alphabetique.sort((a, b) => parNom(ctx.groupeDe(a), ctx.groupeDe(b)) || parNom(a, b));
  }
  if (ordre === "degre") {
    return alphabetique.sort((a, b) => ctx.degre(b) - ctx.degre(a) || parNom(a, b));
  }
  return rcm(alphabetique, ctx);
}
