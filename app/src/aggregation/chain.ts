import type { ParsedModel } from "../parsing/model";
import { interfaceLabel, type FlowInstance, type GraphEdge, type GraphNode } from "./core";
import { businessConsumptions, chainsOfFlow, type Hop } from "./reading";
import type { ViewResult } from "./views";

// The Chain view: following ONE exchange end to end, through the plumbing it
// crosses. The tool already rebuilt that path in order to fold the functional
// reading, and kept only its two ends.
//
// It is the question asked during an incident -- "where does this flow go?" --
// and no other view answers it: architecture shows every link without saying
// which of them form a chain, and the functional reading shows the folded
// chain without saying where it goes.

export interface AvailableChain {
  // Enough to find it again in a selector, and to name it in a title.
  id: string;
  label: string;
  flows: FlowInstance;
  hops: Hop[];
}

// One exchange can lead back to SEVERAL sources -- an aggregating bus is the
// common case. Each is a chain, and they are told apart by their source.
export function availableChains(model: ParsedModel, rank: number | null): AvailableChain[] {
  const chains: AvailableChain[] = [];
  const views = new Set<string>();
  // We start from BUSINESS consumptions, that is, from the downstream end of
  // each chain: that is where the walk up begins. Starting from a functional
  // flow would not work, its interface having already been replaced by the source.
  for (const f of businessConsumptions(model, rank)) {
    for (const hops of chainsOfFlow(model, rank, f)) {
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

// One rank per hop, a single path: zero crossings by construction.
export function buildChainView(model: ParsedModel, chain: AvailableChain): ViewResult {
  const actors = [chain.hops[0]?.provider, ...chain.hops.map((m) => m.consumer)].filter(
    (name): name is string => Boolean(name)
  );
  const nodes: GraphNode[] = [...new Set(actors)].map((name) => {
    const actor = model.actors.find((a) => a.name.trim() === name);
    return {
      id: name,
      label: name,
      // The chain's two ends are what one came to see; what lies between them
      // is the plumbing being crossed.
      kind: name === actors[0] || name === actors[actors.length - 1] ? "focus-actor" : "actor",
      subtitle: actor?.actorType.trim() || undefined,
      technical: actors.indexOf(name) > 0 && actors.indexOf(name) < actors.length - 1 ? true : undefined,
    };
  });

  const edges: GraphEdge[] = chain.hops.map((m) => ({
    from: m.provider,
    to: m.consumer,
    technology: m.technology,
    count: 1,
    // The name it travels UNDER at this point: that is what changes from one
    // hop to the next, and precisely what this view came to show.
    label: interfaceLabel(m.interfaceName, m.version),
    names: [interfaceLabel(m.interfaceName, m.version)],
    attenuated: m.attenuated,
  }));

  return { nodes, edges };
}
