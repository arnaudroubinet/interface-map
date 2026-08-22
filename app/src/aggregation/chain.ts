import type { ParsedModel } from "../parsing/model";
import { interfaceLabel, type FlowInstance, type GraphEdge, type GraphNode } from "./core";
import { consommationsMetier, chainesDuFlux, type Maillon } from "./reading";
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
  label: string;
  flows: FlowInstance;
  hops: Maillon[];
}

// Un échange peut remonter à PLUSIEURS sources -- un bus qui agrège en est le
// cas courant. Chacune est une chaîne, et elles se distinguent par leur source.
export function chainesDisponibles(model: ParsedModel, rank: number | null): ChaineDisponible[] {
  const chains: ChaineDisponible[] = [];
  const views = new Set<string>();
  // On part des consommations MÉTIER, c'est-à-dire des extrémités aval de
  // chaque chaîne : c'est de là qu'on remonte. Partir d'un flux fonctionnel ne
  // marcherait pas, son interface ayant déjà été remplacée par la source.
  for (const f of consommationsMetier(model, rank)) {
    for (const hops of chainesDuFlux(model, rank, f)) {
      if (hops.length === 0) continue;
      const dernier = hops[hops.length - 1];
      const label = `${hops[0].provider} → ${dernier.consumer} : ${interfaceLabel(
        dernier.interfaceName,
        dernier.version
      )}`;
      if (views.has(label)) continue;
      views.add(label);
      chains.push({ id: label, label, flows: f, hops });
    }
  }
  return chains.sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

// Un rang par maillon, un seul chemin : zéro croisement par construction.
export function buildChainView(model: ParsedModel, chain: ChaineDisponible): ViewResult {
  const actors = [chain.hops[0]?.provider, ...chain.hops.map((m) => m.consumer)].filter(
    (name): name is string => Boolean(name)
  );
  const nodes: GraphNode[] = [...new Set(actors)].map((name) => {
    const actor = model.actors.find((a) => a.name.trim() === name);
    return {
      id: name,
      label: name,
      // Les deux bouts de la chaîne sont ce qu'on est venu voir ; ce qu'il y a
      // entre eux est la plomberie qu'on traverse.
      kind: name === actors[0] || name === actors[actors.length - 1] ? "focus-actor" : "actor",
      subtitle: actor?.actorType.trim() || undefined,
      technique: actors.indexOf(name) > 0 && actors.indexOf(name) < actors.length - 1 ? true : undefined,
    };
  });

  const edges: GraphEdge[] = chain.hops.map((m) => ({
    from: m.provider,
    to: m.consumer,
    technology: m.technology,
    count: 1,
    // Le nom SOUS LEQUEL il circule à cet endroit : c'est ce qui change d'un
    // maillon à l'autre, et c'est précisément ce que la vue est venue montrer.
    label: interfaceLabel(m.interfaceName, m.version),
    names: [interfaceLabel(m.interfaceName, m.version)],
    attenuated: m.attenuated,
  }));

  return { nodes, edges };
}
