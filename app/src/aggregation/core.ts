import type { Actor, InterfaceCatalogue, ParsedModel, Consumption, Validity } from "../parsing/model";
import { lifespanOf, isLiveAt } from "./milestones";
import { normalizeText } from "../shared/text";
import { PERIMETER_PLATFORM, PERIMETER_EXTERNAL, VOCABULARY_CRITICALITY } from "./vocabularies";

export type NodeId = string;
export type NodeKind = "group" | "platform" | "actor" | "focus-actor" | "boundary";

export interface GraphNode {
  id: NodeId;
  label: string;
  kind: NodeKind;
  // C4 style: "Type" and short description shown under the name, when the node
  // matches a real actor (not an aggregated group).
  subtitle?: string;
  description?: string;
  external?: boolean;
  // What the SHAPE must restate, failing which colour alone carries it -- so
  // nothing at all in print and for a colour-blind reader (WCAG 1.4.1). Two
  // variants, no more: beyond that lies the UML zoo.
  //
  // `technical`: the actor is plumbing (Technical nature).
  // `aggregate`: the node folds several actors, and how many.
  technique?: boolean;
  agrégat?: number;
  // The node's opacity, when the view wants to push back without making it
  // vanish: what is far from the point of interest stays visible but stops
  // competing with it for attention.
  attenuation?: number;
  // Icon name, resolved from the workbook's ActorTypes sheet. The rendering no
  // longer decides which icon goes with which type: it applies it.
  icon?: string;
  // Container node (C4 style: the platform boundary). The children are placed
  // inside by the engine, and the boundary is drawn around them.
  parent?: string;
}

export interface GraphEdge {
  from: NodeId;
  to: NodeId;
  technology: string;
  count: number;
  // The strongest criticality carried by this line, when the view wants to
  // draw it. Entered, checked and exported since day one, it was never drawn
  // -- and yet it is the workbook's most decision-bearing field.
  criticality?: string;
  label: string;
  attenuated: boolean;
  // The arrowhead goes at the line's start rather than its end: the consumer
  // queries the provider, but the data always travels the other way.
  pulled?: boolean;
  // The exchanges this line gathers. The label names only the first few; the
  // whole list reads on hover, without which the business view would hide what
  // it is meant to show.
  names?: string[];
  // Changes-view mark: this line appears or disappears between the two
  // milestones compared. Absent everywhere else -- it is not a property of the
  // flow, it is the result of a comparison.
  change?: "added" | "removed";
}

export interface FlowInstance {
  interfaceName: string;
  // The published contract's version, as it appears in the catalogue -- not the
  // one entered on the consumption side: it is the interface being named.
  version: string;
  flowType: string;
  provider: string;
  consumer: string;
  direction: "provider-to-consumer" | "consumer-to-provider";
  attenuated: boolean;
  // The two workbook rows this flow comes from. The diagrams do not need them
  // -- they draw only a line -- but exports to an architecture tool find in
  // them everything the line does not show: contract, usage, criticality,
  // decision, milestones.
  iface: InterfaceCatalogue;
  consumption: Consumption;
}

// How an interface is named, everywhere: "Authent 1.0", or plain "Authent" if
// it is not versioned. One single definition, so that the diagram and the
// report never name the same interface in two different ways.
export function interfaceLabel(flowName: string, version: string): string {
  const name = flowName.trim();
  const v = version.trim();
  return v ? `${name} ${v}` : name;
}

// How many exchanges are named on a merged line before the rest is merely
// counted. Two fit within a box's width; beyond that the label would eat the
// drawing -- the line's tooltip then carries the whole list.
const ECHANGES_NOMMES = 2;

// The label of a merged line, shared by the matrix (screen and export) and the
// diagrams.
//
// With no technology -- the functional-mode case, which empties it so that the
// lines of one pair merge -- the counter stood alone. But "2" teaches neither
// what travels nor why: once the medium is gone, the exchanges themselves are
// what carries the meaning.
//
// What the line NAMES is a reading choice: the pipe ("Kafka ×2"), what travels
// through it ("Policy events 1.0, Claims 2.0"), or both. Naming the protocol
// alone made a map of pipes where a map of exchanges is expected.
export type EdgeLabelMode = "technology" | "exchanges" | "both";

function namedExchanges(names: readonly string[]): string {
  const named = names.slice(0, ECHANGES_NOMMES).join(", ");
  const reste = names.length - ECHANGES_NOMMES;
  return reste > 0 ? `${named} +${reste}` : named;
}

export function cellLabel(
  technology: string,
  count: number,
  names: readonly string[] = [],
  what: EdgeLabelMode = "technology"
): string {
  const tuyau = technology ? (count > 1 ? `${technology} ×${count}` : technology) : "";
  // With no technology -- the functional-mode case, which empties it so that
  // the lines of one pair merge -- "technology" would fall back to a bare
  // counter. But "2" teaches neither what travels nor why.
  if (what === "technology" && tuyau) return tuyau;
  if (names.length === 0) return tuyau || String(count);
  const exchanges = namedExchanges(names);
  if (what === "both" && tuyau) return `${exchanges} — ${tuyau}`;
  return exchanges;
}

function isATransformer(decision: string): boolean {
  return normalizeText(decision) === normalizeText("Transform");
}

function actorByName(model: ParsedModel): Map<string, Actor> {
  const map = new Map<string, Actor>();
  for (const a of model.actors) map.set(a.name.trim(), a);
  return map;
}

// The perimeter is read on the GROUP, never on the actor: "Core" is the
// platform, so every one of its components belongs to it. Read actor by actor,
// a mixed group painted itself in the platform's colours while showing only
// part of its members.
function perimetreDuGroupe(model: ParsedModel, group: string): string {
  const name = normalizeText(group);
  return model.groups.find((g) => normalizeText(g.name) === name)?.perimeter ?? "";
}

export function groupIsPlatform(model: ParsedModel, group: string): boolean {
  return normalizeText(perimetreDuGroupe(model, group)) === normalizeText(PERIMETER_PLATFORM);
}

export function groupIsExternal(model: ParsedModel, group: string): boolean {
  return normalizeText(perimetreDuGroupe(model, group)) === normalizeText(PERIMETER_EXTERNAL);
}

export function actorIsPlatform(model: ParsedModel, actor: Actor): boolean {
  return groupIsPlatform(model, actor.group);
}

// The icon declared for an actor type. The workbook is authoritative; with no
// declaration, the rendering falls back to the neutral token.
export function iconForActorType(model: ParsedModel, actorType: string): string | undefined {
  const sought = normalizeText(actorType);
  if (!sought) return undefined;
  return model.actorTypes.find((t) => normalizeText(t.type) === sought)?.icon || undefined;
}

export function nomEstExterne(model: ParsedModel, name: string): boolean {
  const actor = model.actors.find((a) => a.name.trim() === name.trim());
  return actor ? groupIsExternal(model, actor.group) : false;
}

// Matching on (sheet, flow name) rather than name alone (§3.3): two interfaces
// sharing a name across different tabs must never resolve to the wrong one (a
// case already reported as an anomaly elsewhere, but which must not distort
// the diagram on top of that). byKey is the exact match; byName is a
// best-effort fallback, only for a consumption filed in the wrong tab.

// Three indexes because there are three distinct questions to ask, and
// conflating them would make the report contradict the diagram:
//   byKey         -- the exact match (sheet, name, version);
//   byNameVersion -- fallback for a consumption filed in the wrong tab;
//   byName        -- serves only to tell "name absent from the catalogue" apart
//                    from "that name exists, but not in that version".
// The fallback never goes down to byName: with an unknown version, there is no
// guessing which one was meant -- that would bind a consumer to a contract it
// never signed.
export interface InterfaceLookup {
  byKey: Map<string, InterfaceCatalogue>;
  byNomVersion: Map<string, InterfaceCatalogue>;
  byNom: Map<string, InterfaceCatalogue>;
  // The (name, version) pairs SEVERAL publishers expose. Two actors may name
  // alike without having agreed on it: these are two distinct interfaces, so
  // the name alone no longer decides between them.
  nomVersionAmbigu: Set<string>;
}

function key(...parties: string[]): string {
  return JSON.stringify(parties.map(normalizeText));
}

export function interfaceKey(sheet: string, flowName: string, version: string): string {
  return key(sheet, flowName, version);
}

export function nomVersionKey(flowName: string, version: string): string {
  return key(flowName, version);
}

// The bare name, normalised like the other two keys. It used to be normalised
// by a plain trim, while matching normalises: an "Order status" written
// "ORDER STATUS" in a consumption was indeed drawn, and yet the report
// declared it absent from the catalogue.
export function nomKey(flowName: string): string {
  return key(flowName);
}

export function buildInterfaceLookup(model: ParsedModel): InterfaceLookup {
  const byKey = new Map<string, InterfaceCatalogue>();
  const byNomVersion = new Map<string, InterfaceCatalogue>();
  const byNom = new Map<string, InterfaceCatalogue>();
  const nomVersionAmbigu = new Set<string>();
  for (const i of model.interfaces) {
    byKey.set(interfaceKey(i.expectedSheet, i.flowName, i.version), i);
    const kNomVersion = nomVersionKey(i.flowName, i.version);
    const already = byNomVersion.get(kNomVersion);
    if (!already) byNomVersion.set(kNomVersion, i);
    else if (normalizeText(already.providerName) !== normalizeText(i.providerName)) nomVersionAmbigu.add(kNomVersion);
    if (!byNom.has(nomKey(i.flowName))) byNom.set(nomKey(i.flowName), i);
  }
  return { byKey, byNomVersion, byNom, nomVersionAmbigu };
}

export function findInterfaceForConsommation(lookup: InterfaceLookup, c: Consumption): InterfaceCatalogue | undefined {
  const parOnglet = lookup.byKey.get(interfaceKey(c.sheet, c.flowName, c.version));
  if (parOnglet) return parOnglet;
  // The name fallback only applies if that name designates a single publisher.
  // With several, binding it to the first would have this consumer sign with
  // someone it did not choose: nothing is resolved, and the reference check
  // says so plainly.
  const kNomVersion = nomVersionKey(c.flowName, c.version);
  if (lookup.nomVersionAmbigu.has(kNomVersion)) return undefined;
  return lookup.byNomVersion.get(kNomVersion);
}

// An orphan flow (name absent from the catalogue) or one of unknown type
// (undeterminable direction) cannot be drawn — these cases are already reported
// by integrity/checks.ts (7.2), so they are simply ignored here.
// The displayed rank filters: only flows whose WHOLE chain -- publisher,
// interface, consumption, consumer -- is alive at that rank are kept.
// `null` means "no milestone displayed": nothing is filtered, so a workbook
// declaring no milestone behaves exactly as before.
export function buildFlowInstances(model: ParsedModel, rank: number | null = null): FlowInstance[] {
  const actors = actorByName(model);
  const sensParType = new Map(model.flowTypes.map((t) => [t.type.trim(), t.direction]));
  const lookup = buildInterfaceLookup(model);
  const flows: FlowInstance[] = [];

  for (const consumption of model.consumptions) {
    const iface = findInterfaceForConsommation(lookup, consumption);
    if (!iface) continue;

    const direction = sensParType.get(iface.flowType.trim());
    if (!direction) continue;

    const publisherActor = actors.get(iface.providerName.trim());
    const consumerActor = actors.get(consumption.consumerName.trim());

    if (rank !== null) {
      const live = (v: Validity | undefined) =>
        v === undefined || isLiveAt(lifespanOf(model, v), rank);
      if (!live(iface) || !live(consumption) || !live(publisherActor) || !live(consumerActor)) {
        continue;
      }
    }

    flows.push({
      interfaceName: iface.flowName,
      version: iface.version,
      flowType: iface.flowType,
      provider: iface.providerName,
      consumer: consumption.consumerName,
      direction,
      attenuated: isATransformer(consumption.decision),
      iface,
      consumption: consumption,
    });
  }

  return flows;
}

export type NodeKeyFn = (actorName: string) => NodeId;

export function identityNodeKey(actorName: string): NodeId {
  return actorName;
}

// An empty string is the "no node" sentinel: an actor that is known but has no
// Group filled in is absent from the aggregated views (§7.4), not folded onto
// its own name — groupFlows() drops the flows with an end resolving to it.
export function groupNodeKey(model: ParsedModel): NodeKeyFn {
  const actors = actorByName(model);
  return (name: string) => {
    const actor = actors.get(name.trim());
    if (!actor) return name;
    return actor.group.trim();
  };
}

export function platformDetailNodeKey(model: ParsedModel): NodeKeyFn {
  const actors = actorByName(model);
  return (name: string) => {
    const actor = actors.get(name.trim());
    if (!actor) return name;
    // An actor from a "Platform" group is detailed under its own name;
    // everything else is folded onto its group.
    return actorIsPlatform(model, actor) ? actor.name : actor.group.trim();
  };
}

// The line follows the DATA: from provider to consumer, always.
//
// It used to carry the direction of the CALL, the one the technology declares.
// A pulled flow -- HTTP, "consumer → provider" -- therefore had its line
// reversed along with its arrowhead: the data seemed to climb back up the
// pipe, and a queried provider had nothing coming out of it. On a relay chain,
// one hop appeared to produce nothing.
//
// The initiative is not lost for all that: it moves onto the arrowhead, placed
// at the line's start when it is the consumer that calls. Two pieces of
// information, two carriers.
function directedEndpoints(flow: FlowInstance, nodeKey: NodeKeyFn): { from: NodeId; to: NodeId } {
  return { from: nodeKey(flow.provider), to: nodeKey(flow.consumer) };
}

// The consumer takes the initiative: the arrowhead sits at the other end of
// the line, on the provider it queries.
const estTire = (flow: FlowInstance) => flow.direction === "consumer-to-provider";

export interface EdgeGroup {
  from: NodeId;
  to: NodeId;
  technology: string;
  count: number;
  attenuated: boolean;
  // The arrowhead sits at the line's START: the consumer is the caller.
  pulled: boolean;
  // The exchanges gathered under this line, in the order they appear and
  // without duplicates: they are where the label draws its meaning from once
  // the technology is no longer there to carry it.
  names: string[];
  // The STRONGEST criticality of the consumptions gathered under this line: a
  // line carrying one vital flow and two ordinary ones is vital.
  criticality?: string;
}

// The vocabulary's order, from most critical to least. It is read from the
// list itself rather than kept a second time: the two would drift apart.
function rangDeCriticite(value: string): number {
  const i = VOCABULARY_CRITICALITY.findIndex((v) => normalizeText(v) === normalizeText(value));
  return i < 0 ? VOCABULARY_CRITICALITY.length : i;
}

function laPlusForte(a: string | undefined, b: string): string | undefined {
  if (!a) return b.trim() ? b : undefined;
  if (!b.trim()) return a;
  return rangDeCriticite(b) < rangDeCriticite(a) ? b : a;
}

export function groupFlows(flows: FlowInstance[], nodeKey: NodeKeyFn, maskLoops: boolean): EdgeGroup[] {
  const groups = new Map<string, EdgeGroup>();

  for (const flow of flows) {
    const { from, to } = directedEndpoints(flow, nodeKey);
    if (!from || !to) continue;
    if (maskLoops && from === to) continue;

    // Directional key: (from, to) is never normalised into an unordered pair,
    // so that two opposite directions stay two distinct lines (§4.5).
    // JSON.stringify rather than a separator-joined string: a node or a
    // technology may contain a space ("Ryloth") or even a line break (Excel
    // allows Alt+Enter inside a cell); JSON.stringify avoids all ambiguity
    // without putting a control character in the source.
    const key = JSON.stringify([from, to, flow.flowType]);
    const name = interfaceLabel(flow.interfaceName, flow.version);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.attenuated = existing.attenuated && flow.attenuated;
      existing.criticality = laPlusForte(existing.criticality, flow.consumption.criticality);
      if (!existing.names.includes(name)) existing.names.push(name);
    } else {
      groups.set(key, {
        from,
        to,
        technology: flow.flowType,
        count: 1,
        attenuated: flow.attenuated,
        pulled: estTire(flow),
        names: [name],
        criticality: flow.consumption.criticality.trim() || undefined,
      });
    }
  }

  return [...groups.values()];
}

// The two readings of the estate. Architecture answers "what does it go
// through", functional answers "who feeds whom": same data, two questions.
export type Mode = "architecture" | "functional";

// The mode is no longer read here (§ Reading, reading.ts): a view aggregating
// flows already resolved at the right (rank, mode) need not ask again.
export interface AggregationOptions {
  counters: boolean;
  edgeLabelMode?: EdgeLabelMode;
}

export function aggregateEdges(
  flows: FlowInstance[],
  nodeKey: NodeKeyFn,
  options: AggregationOptions,
  maskLoops: boolean
): GraphEdge[] {
  return groupFlows(flows, nodeKey, maskLoops).map((g) => ({
    from: g.from,
    to: g.to,
    technology: g.technology,
    count: g.count,
    criticality: g.criticality,
    // With no counter only the pipe is named, unless the user asked for
    // something else: "counters" decides the ×N, not what gets named.
    label:
      options.counters || (options.edgeLabelMode ?? "technology") !== "technology"
        ? cellLabel(g.technology, g.count, g.names, options.edgeLabelMode ?? "technology")
        : g.technology,
    attenuated: g.attenuated,
    pulled: g.pulled,
    names: g.names,
  }));
}

export function nodesFromEdges(
  edges: (GraphEdge | EdgeGroup)[],
  labelFor: (id: NodeId) => string,
  kindFor: (id: NodeId) => NodeKind,
  detailsFor: (id: NodeId) => { subtitle?: string; description?: string } = () => ({})
): GraphNode[] {
  const ids = new Set<NodeId>();
  for (const e of edges) {
    ids.add(e.from);
    ids.add(e.to);
  }
  // Edge traversal order, not alphabetical order. Sorting was tried and
  // MEASURED, as a prerequisite for milestone-to-milestone stability: it cost
  // 16% more area on the detailed view (1,573k against 1,356k) and degraded the
  // aspect ratio from 3.63 to 4.04. Stability comes from elsewhere -- placement
  // happens once over the union of milestones (unionReading) -- so sorting was
  // left paying nothing but its own cost.
  return [...ids].map((id) => ({ id, label: labelFor(id), kind: kindFor(id), ...detailsFor(id) }));
}
