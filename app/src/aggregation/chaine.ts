import type { ParsedModel } from "../parsing/model";
import { libelleInterface, type FlowInstance, type GraphEdge, type GraphNode } from "./core";
import { consommationsMetier, chainesDuFlux, type Maillon } from "./fonctionnel";
import type { ViewResult } from "./views";

// La vue « Chaîne » : suivre UN échange de bout en bout, à travers la plomberie
// qu'il traverse. L'outil reconstruisait déjà ce trajet pour rabattre la
// lecture fonctionnelle, et n'en gardait que les extrémités.
//
// C'est la question qu'on pose en incident -- « par où passe ce flux ? » -- et
// aucune autre vue n'y répond : l'architecture montre tous les liens sans dire
// lesquels forment une chaîne, le fonctionnel montre la chaîne rabattue sans
// dire par où elle passe.

export interface ChaineDisponible {
  // De quoi la retrouver dans un sélecteur, et la nommer dans un titre.
  id: string;
  libellé: string;
  flux: FlowInstance;
  maillons: Maillon[];
}

// Un échange peut remonter à PLUSIEURS sources -- un bus qui agrège en est le
// cas courant. Chacune est une chaîne, et elles se distinguent par leur source.
export function chainesDisponibles(model: ParsedModel, rang: number | null): ChaineDisponible[] {
  const chaînes: ChaineDisponible[] = [];
  const vues = new Set<string>();
  // On part des consommations MÉTIER, c'est-à-dire des extrémités aval de
  // chaque chaîne : c'est de là qu'on remonte. Partir d'un flux fonctionnel ne
  // marcherait pas, son interface ayant déjà été remplacée par la source.
  for (const f of consommationsMetier(model, rang)) {
    for (const maillons of chainesDuFlux(model, rang, f)) {
      if (maillons.length === 0) continue;
      const dernier = maillons[maillons.length - 1];
      const libellé = `${maillons[0].exposant} → ${dernier.consommateur} : ${libelleInterface(
        dernier.interfaceNom,
        dernier.version
      )}`;
      if (vues.has(libellé)) continue;
      vues.add(libellé);
      chaînes.push({ id: libellé, libellé, flux: f, maillons });
    }
  }
  return chaînes.sort((a, b) => a.libellé.localeCompare(b.libellé, "fr"));
}

// Un rang par maillon, un seul chemin : zéro croisement par construction.
export function buildChainView(model: ParsedModel, chaîne: ChaineDisponible): ViewResult {
  const acteurs = [chaîne.maillons[0]?.exposant, ...chaîne.maillons.map((m) => m.consommateur)].filter(
    (nom): nom is string => Boolean(nom)
  );
  const nodes: GraphNode[] = [...new Set(acteurs)].map((nom) => {
    const acteur = model.acteurs.find((a) => a.nom.trim() === nom);
    return {
      id: nom,
      label: nom,
      // Les deux bouts de la chaîne sont ce qu'on est venu voir ; ce qu'il y a
      // entre eux est la plomberie qu'on traverse.
      kind: nom === acteurs[0] || nom === acteurs[acteurs.length - 1] ? "acteur-selectionne" : "acteur",
      sousTitre: acteur?.typeActeur.trim() || undefined,
      technique: acteurs.indexOf(nom) > 0 && acteurs.indexOf(nom) < acteurs.length - 1 ? true : undefined,
    };
  });

  const edges: GraphEdge[] = chaîne.maillons.map((m) => ({
    from: m.exposant,
    to: m.consommateur,
    technologie: m.technologie,
    count: 1,
    // Le nom SOUS LEQUEL il circule à cet endroit : c'est ce qui change d'un
    // maillon à l'autre, et c'est précisément ce que la vue est venue montrer.
    label: libelleInterface(m.interfaceNom, m.version),
    noms: [libelleInterface(m.interfaceNom, m.version)],
    atténué: m.atténué,
  }));

  return { nodes, edges };
}
