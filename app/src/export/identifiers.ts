// Les DSL d'architecture nomment leurs éléments par un mot ; le classeur, lui,
// laisse écrire ce qu'on veut -- « Jakku », « Sonde réseau », « IF -
// PRS ». La correspondance se fait ici, une fois, pour que les deux exports
// nomment le même acteur de la même façon.
//
// L'unicité compte autant que la forme : deux noms distincts qui se réduisent
// au même mot laisseraient un seul élément dans le fichier produit, et la
// moitié des flux pointerait à côté sans que rien ne le dise.
export function identifiants(names: string[]): Map<string, string> {
  const pris = new Set<string>();
  const table = new Map<string, string>();

  for (const name of names) {
    const base = name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    const mot = /^[a-z]/.test(base) ? base : `e${base}`;

    let candidat = mot;
    let suite = 2;
    while (pris.has(candidat)) candidat = `${mot}_${suite++}`;
    pris.add(candidat);
    table.set(name, candidat);
  }

  return table;
}
