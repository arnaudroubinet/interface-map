import type { Actor, ParsedModel, InterfaceCatalogue, Consumption } from "../parsing/model";
import {
  buildFlowInstances,
  interfaceLabel,
  buildInterfaceLookup,
  findInterfaceForConsommation,
  type FlowInstance,
  type InterfaceLookup,
  type Mode,
} from "./core";
import { normalizeText } from "../shared/text";
import { isTechnicalActor } from "./nature";
import { lifespanOf, isLiveAt } from "./milestones";

// The functional reading of the estate: who feeds whom, with the plumbing
// removed.
//
// It is DERIVED from the architecture rather than entered separately -- that is
// what guarantees the two readings can never drift apart. The result has the
// shape of technical flows minus the technology, so that the existing views
// run on it without knowing the mode changed.
export interface ChaineCoupee {
  iface: InterfaceCatalogue;
  // "no-input": this republished interface is fed by no consumption. The chain
  // therefore stops there, and the functional link one expected from it does
  // not exist -- better said than left silent.
  reason: "no-input" | "loop";
}

// An actor unknown to the workbook is not judged here: the reference checks
// handle that over the whole workbook.
function actorIsLive(
  model: ParsedModel,
  name: string,
  rank: number | null,
): boolean {
  if (rank === null) return true;
  const a = model.actors.find((x) => x.name.trim() === name.trim());
  return a === undefined || isLiveAt(lifespanOf(model, a), rank);
}

// Walks up the segments as long as the publisher is technical. Returns the
// source interface when it is published by a business actor, otherwise the
// reason for the failure -- the integrity report needs it to say WHERE the
// chain breaks. `rank` filters just as buildFlowInstances does: an upstream
// segment retired at that milestone cuts the chain, `null` filters nothing.
// What a walk-up returns: the business sources reached, and the branches that
// led nowhere. Both at once, because a faulty branch must not carry the sound
// branches off with it -- losing the whole link over one badly entered row
// would be worse than the badly entered row.
interface Remontee {
  sources: InterfaceCatalogue[];
  // The PATH to each source, hop by hop, from the source downstream. The walk
  // already rebuilt it segment by segment and threw it away to keep only the
  // endpoints: it is the hardest information to get out of the workbook, and
  // the only one that answers "which way does this flow go?".
  paths: Map<InterfaceCatalogue, Hop[]>;
  cuts: ChaineCoupee[];
}

// The inputs of a republished interface: the consumptions of the actor that
// publishes it and that name it.
//
// The reading direction is what matters here. The information lives on the
// CONSUMPTION ROW, not on the interface row: that row is the one that knows
// which provider and which version the input comes from, and it is the one an
// ordinary drop-down can guide. A bus that aggregates has nothing special to
// write -- it simply has several rows naming the same interface.
// A chain segment: what travels over ONE hop, under the name and technology
// it carries at that point. This is precisely what the functional reading
// erases -- and what one is after when asking "which way does this flow go?".
export interface Hop {
  provider: string;
  consumer: string;
  interfaceName: string;
  version: string;
  technology: string;
  attenuated: boolean;
}

function hop(iface: InterfaceCatalogue, consumption: Consumption): Hop {
  return {
    provider: iface.providerName.trim(),
    consumer: consumption.consumerName.trim(),
    interfaceName: iface.flowName,
    version: iface.version,
    technology: iface.flowType,
    attenuated: normalizeText(consumption.decision) === normalizeText("Transform"),
  };
}

function entreesDe(
  model: ParsedModel,
  lookup: InterfaceLookup,
  republished: InterfaceCatalogue,
  rank: number | null
): { iface: InterfaceCatalogue; consumption: Consumption }[] {
  const live = (v: { introducedAt: string; retiredAt: string }) =>
    rank === null || isLiveAt(lifespanOf(model, v), rank);
  const relay = republished.providerName.trim();
  // Both the bare name and the versioned name are accepted: the drop-down
  // offers the latter, an older entry may carry the former.
  const designated = new Set([
    normalizeText(republished.flowName),
    normalizeText(interfaceLabel(republished.flowName, republished.version)),
  ]);

  const inputs: { iface: InterfaceCatalogue; consumption: Consumption }[] = [];
  for (const c of model.consumptions) {
    if (c.consumerName.trim() !== relay) continue;
    if (!designated.has(normalizeText(c.republishedAs))) continue;
    if (!live(c)) continue;
    const upstream = findInterfaceForConsommation(lookup, c);
    if (!upstream || !live(upstream) || !actorIsLive(model, upstream.providerName, rank)) continue;
    if (!inputs.some((e) => e.iface === upstream)) inputs.push({ iface: upstream, consumption: c });
  }
  return inputs;
}

// Walks up the segments as long as the publisher is technical, following EVERY
// input of the republished interface. `path` carries the route walked, not
// everything met along the way: two branches converging on the same source are
// not a loop, they are a diamond.
function walkUp(
  model: ParsedModel,
  lookup: InterfaceLookup,
  start: InterfaceCatalogue,
  rank: number | null,
  path: ReadonlySet<InterfaceCatalogue> = new Set()
): Remontee {
  if (!isTechnicalActor(model, start.providerName)) {
    return { sources: [start], paths: new Map([[start, []]]), cuts: [] };
  }
  if (path.has(start)) return { sources: [], paths: new Map(), cuts: [{ iface: start, reason: "loop" }] };

  const inputs = entreesDe(model, lookup, start, rank);
  if (inputs.length === 0) {
    return { sources: [], paths: new Map(), cuts: [{ iface: start, reason: "no-input" }] };
  }

  const walked = new Set(path).add(start);
  const sources: InterfaceCatalogue[] = [];
  const paths = new Map<InterfaceCatalogue, Hop[]>();
  const cuts: ChaineCoupee[] = [];
  for (const input of inputs) {
    const remontee = walkUp(model, lookup, input.iface, rank, walked);
    for (const source of remontee.sources) {
      if (!sources.includes(source)) sources.push(source);
      // The hop just crossed is appended DOWNSTREAM of what the walk-up
      // reported: the route reads from the source to the consumer, like the
      // line.
      if (!paths.has(source)) {
        paths.set(source, [...(remontee.paths.get(source) ?? []), hop(input.iface, input.consumption)]);
      }
    }
    cuts.push(...remontee.cuts);
  }
  return { sources, paths, cuts };
}

// The complete chain of a functional flow: one hop per segment, each carrying
// the name the exchange travels under AT THAT POINT and the technology that
// carries it there. A direct link is a one-hop chain: that is not a special
// case.
// `f` is the original BUSINESS consumption -- the one whose interface is the
// LAST hop. A functional flow will not do: its `iface` has already been
// replaced by the source, and the chain would collapse to a single hop.
export function chainsOfFlow(model: ParsedModel, rank: number | null, f: FlowInstance): Hop[][] {
  const lookup = buildInterfaceLookup(model);
  const walked = walkUp(model, lookup, f.iface, rank);
  return walked.sources
    .filter((source) => source.providerName.trim() !== f.consumer.trim())
    .map((source) => [...(walked.paths.get(source) ?? []), hop(f.iface, f.consumption)]);
}

// The consumptions that count: those of a BUSINESS actor. A consumption by a
// technical actor is not an endpoint but a segment, walked from downstream.
export function consommationsMetier(
  model: ParsedModel,
  rank: number | null,
): FlowInstance[] {
  return buildFlowInstances(model, rank).filter(
    (f) => !isTechnicalActor(model, f.consumer),
  );
}

export function buildFunctionalFlows(
  model: ParsedModel,
  rank: number | null,
): FlowInstance[] {
  const lookup = buildInterfaceLookup(model);
  const flows: FlowInstance[] = [];
  for (const f of consommationsMetier(model, rank)) {
    for (const source of walkUp(model, lookup, f.iface, rank).sources) {
      if (source.providerName.trim() === f.consumer.trim()) continue;
      flows.push({
        interfaceName: source.flowName,
        version: source.version,
        // Emptied: without it, the line-merging key no longer tells media
        // apart, and the technology legend has nothing left to show.
        flowType: "",
        provider: source.providerName,
        consumer: f.consumer,
        // In architecture the direction is a convention attached to the
        // technology; a chain crosses several, sometimes opposite ones. The
        // only rule that holds end to end: from provider to consumer.
        direction: "provider-to-consumer",
        attenuated: f.attenuated,
        iface: source,
        consumption: f.consumption,
      });
    }
  }
  return flows;
}

// The single entry point for consumers of flows. It lives here rather than in
// the views because the Changes view needs it too, without going through them.
export function flowsForReading(
  model: ParsedModel,
  rank: number | null,
  mode: Mode,
): FlowInstance[] {
  return mode === "functional"
    ? buildFunctionalFlows(model, rank)
    : buildFlowInstances(model, rank);
}

// The actor-side counterpart of flowsOfMode: the same two questions, (rank,
// mode), asked of the same list. Live at the displayed rank -- a retired actor
// is gone from it, like its flows -- and business in the functional reading,
// like the nodes the views draw there.
export function actorsForReading(
  model: ParsedModel,
  rank: number | null,
  mode: Mode,
): Actor[] {
  return model.actors.filter(
    (a) =>
      (mode !== "functional" || !isTechnicalActor(model, a.name)) &&
      (rank === null || isLiveAt(lifespanOf(model, a), rank)),
  );
}

// What a view reads in order to draw: its flows AND its actors, resolved once,
// at the same (rank, mode). A view handed a Reading can no longer go and fetch
// an unfiltered actor list itself -- it no longer has the model for that, only
// what it was given.
export interface Lecture {
  flows: FlowInstance[];
  actors: Actor[];
}

export function reading(
  model: ParsedModel,
  rank: number | null,
  mode: Mode,
): Lecture {
  return {
    flows: flowsForReading(model, rank, mode),
    actors: actorsForReading(model, rank, mode),
  };
}

// The UNION reading of every milestone. It is not there to draw: it is there
// to PLACE. Placement happens once over the union, then each milestone shows
// only its subset, at positions the reader already knows -- these are
// Structurizr's "filtered views" semantics.
//
// Without it, three extra edges were enough to move the same thirteen boxes by
// a median of 400 px between two milestones, and the time axis served only to
// read a text listing. No interactive ELK setting fixes this: on a board with
// a boundary, interactive mode does not even reproduce its own result (277 px
// median on identical input).
export function lectureUnion(model: ParsedModel, mode: Mode): Lecture {
  if (model.milestones.length === 0) return reading(model, null, mode);
  const flows: FlowInstance[] = [];
  const vus = new Set<string>();
  for (const milestone of model.milestones) {
    for (const f of flowsForReading(model, milestone.rank, mode)) {
      const key = JSON.stringify([f.provider, f.consumer, f.flowType, f.interfaceName, f.version]);
      if (vus.has(key)) continue;
      vus.add(key);
      flows.push(f);
    }
  }
  const actors = model.actors.filter((a) => model.milestones.some((p) => actorsForReading(model, p.rank, mode).includes(a)));
  return { flows, actors };
}

export function chainesCoupees(
  model: ParsedModel,
  rank: number | null,
): ChaineCoupee[] {
  const lookup = buildInterfaceLookup(model);
  const cut: ChaineCoupee[] = [];
  for (const f of consommationsMetier(model, rank)) {
    cut.push(...walkUp(model, lookup, f.iface, rank).cuts);
  }
  return cut;
}
