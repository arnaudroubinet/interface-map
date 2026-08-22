import type { FlowInstance } from "./core";

// Le rayon d'impact : « si X tombe, qui est touché ? », et sa réciproque
// « de quoi X dépend-il ? ». Le graphe de dépendances existait déjà dans les
// contrôles d'intégrité, où il ne servait qu'à détecter les cycles.
//
// C'est du degree-of-interest au sens de Furnas (« Generalized fisheye views »,
// CHI '86) : on part d'un point d'intérêt et on étend, plutôt que de tout
// afficher d'abord. Van Ham & Perer (IEEE TVCG 15(6), 2009) montrent que c'est
// la stratégie qui tient sur les grands graphes, là où l'« overview first » de
// Shneiderman ne tient pas.
export type Voisinage = "direct" | "amont" | "aval";

// Le sens des arcs : du CONSOMMATEUR vers le FOURNISSEUR, c'est-à-dire le sens
// de la dépendance -- pas celui de la donnée. Un consommateur dépend de son
// fournisseur ; si le fournisseur tombe, c'est le consommateur qui souffre.
function arcs(flux: readonly FlowInstance[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const f of flux) {
    const de = f.consommateur.trim();
    const vers = f.exposant.trim();
    if (!de || !vers || de === vers) continue;
    if (!m.has(de)) m.set(de, new Set());
    m.get(de)!.add(vers);
  }
  return m;
}

function inverser(m: Map<string, Set<string>>): Map<string, Set<string>> {
  const inverse = new Map<string, Set<string>>();
  for (const [de, vers] of m) {
    for (const v of vers) {
      if (!inverse.has(v)) inverse.set(v, new Set());
      inverse.get(v)!.add(de);
    }
  }
  return inverse;
}

// L'acteur vers sa distance en sauts. Le départ est à zéro : il fait partie de
// son propre rayon, sans quoi la vue perdrait ce qu'elle est venue montrer.
//
// Un parcours en LARGEUR, pas en profondeur : c'est la distance qui nous
// intéresse, et un parcours en profondeur la fausserait sur un graphe qui
// boucle -- le classeur d'exemple en contient un, à quatre composants.
export function rayon(flux: readonly FlowInstance[], depart: string, sens: Voisinage): Map<string, number> {
  const depuis = depart.trim();
  const dependances = arcs(flux);
  const distances = new Map<string, number>([[depuis, 0]]);

  if (sens === "direct") {
    // Les deux côtés à un saut : ce que la vue par acteur montrait déjà.
    for (const v of dependances.get(depuis) ?? []) distances.set(v, 1);
    for (const v of inverser(dependances).get(depuis) ?? []) distances.set(v, 1);
    return distances;
  }

  // « amont » : ce dont le départ dépend, transitivement. « aval » : ce qui
  // dépend de lui -- ceux que sa chute touche.
  const suivants = sens === "amont" ? dependances : inverser(dependances);
  let front = [depuis];
  let saut = 0;
  while (front.length > 0) {
    saut += 1;
    const prochain: string[] = [];
    for (const courant of front) {
      for (const v of suivants.get(courant) ?? []) {
        if (distances.has(v)) continue;
        distances.set(v, saut);
        prochain.push(v);
      }
    }
    front = prochain;
  }
  return distances;
}
