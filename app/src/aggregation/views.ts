import type { ParsedModel, Actor } from "../parsing/model";
import {
  groupFlows,
  aggregateEdges,
  nodesFromEdges,
  groupNodeKey,
  platformDetailNodeKey,
  identityNodeKey,
  interfaceLabel,
  actorIsPlatform,
  groupIsExternal,
  nomEstExterne,
  iconForActorType,
  type GraphNode,
  type GraphEdge,
  type AggregationOptions,
  type FlowInstance,
  type NodeKeyFn,
  type NodeId,
  type NodeKind,
  type Mode,
} from "./core";
import type { Lecture } from "./reading";
import { isTechnicalActor } from "./nature";
import { radius, type Neighbourhood } from "./impact";
import { orderBy, type OrderContext, type MatrixOrder } from "./seriation";

// A node's opacity by its distance from the point of interest.
function attenuationDeDistance(hop: number): number | undefined {
  if (hop <= 1) return undefined;
  return hop === 2 ? 0.7 : 0.45;
}

export interface ViewResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

const LONGUEUR_DESCRIPTION_MAX = 60;

function tronquer(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1).trimEnd() + "…" : text;
}

// C4 style: "Type", description and external status under a real actor's name.
function actorDetails(
  model: ParsedModel,
  name: string
): { subtitle?: string; description?: string; external?: boolean; icon?: string; technique?: boolean } {
  const actor = model.actors.find((a) => a.name === name);
  if (!actor) return {};
  return {
    subtitle: actor.actorType.trim() || undefined,
    icon: iconForActorType(model, actor.actorType),
    description: actor.description.trim() ? tronquer(actor.description.trim(), LONGUEUR_DESCRIPTION_MAX) : undefined,
    external: groupIsExternal(model, actor.group) || undefined,
    // The nature is decided HERE, where the model is known: the rendering
    // applies a shape, it does not go looking for one.
    technique: isTechnicalActor(model, name) || undefined,
  };
}

// A "group" node aggregates several actors: no single type or description, but
// the number of actors it stands for is real data. `actors` is already the
// reading at the current (rank, mode) -- neither the plumbing nor a retired
// actor appears in it, so nothing to judge again here.
function groupDetails(
  model: ParsedModel,
  group: string,
  actors: readonly Actor[]
): { subtitle?: string; external?: boolean; agrégat?: number } {
  const membres = actors.filter((a) => a.group === group);
  if (membres.length === 0) return {};
  return {
    subtitle: `${membres.length} actor${membres.length > 1 ? "s" : ""}`,
    agrégat: membres.length,
    // The group's perimeter, and it alone: this is what makes the colour code
    // work on aggregated views, where the nodes are not actors.
    external: groupIsExternal(model, group) || undefined,
  };
}

// The platform boundary, in the C4 sense: a dashed container around the
// product's components, to tell them apart at a glance from the third-party
// systems around them.
const ID_FRONTIERE = "__frontiere__";

// A business actor left isolated -- whose exchanges all went through broken
// chains -- stays displayed, alone (§5.2): making it vanish would remove
// information silently. `nodeKey` is the same resolution that built the view's
// edges, so the actor reappears at the same scale (its group, or itself) as
// the rest.
function nodesIsoles(
  candidates: Actor[],
  nodeKey: NodeKeyFn,
  présents: ReadonlySet<NodeId>,
  kindFor: (id: NodeId) => NodeKind,
  detailsFor: (id: NodeId) => { subtitle?: string; description?: string; external?: boolean }
): GraphNode[] {
  const ids = new Set<NodeId>();
  for (const actor of candidates) {
    const id = nodeKey(actor.name);
    // "No node" sentinel (§7.4): an actor with no group has nothing to join in
    // a view folded onto groups.
    if (id && !présents.has(id)) ids.add(id);
  }
  return [...ids].map((id) => ({ id, label: id, kind: kindFor(id), ...detailsFor(id) }));
}

export function buildGroupToGroupView(model: ParsedModel, reading: Lecture, options: AggregationOptions): ViewResult {
  const key = groupNodeKey(model);
  const edges = aggregateEdges(reading.flows, key, options, true);
  const kindFor = () => "group" as const;
  const detailsFor = (id: NodeId) => groupDetails(model, id, reading.actors);
  const nodes = nodesFromEdges(edges, (id) => id, kindFor, detailsFor);
  const isolated = nodesIsoles(reading.actors, key, new Set(nodes.map((n) => n.id)), kindFor, detailsFor);
  return { nodes: [...nodes, ...isolated], edges };
}

export function buildPlatformDetailView(model: ParsedModel, reading: Lecture, options: AggregationOptions): ViewResult {
  const key = platformDetailNodeKey(model);
  const edges = aggregateEdges(reading.flows, key, options, true);
  const plateformeIds = new Set(
    reading.actors.filter((a) => actorIsPlatform(model, a)).map((a) => a.name)
  );
  const kindFor = (id: NodeId) => (plateformeIds.has(id) ? "platform" as const : "group" as const);
  const detailsFor = (id: NodeId) => (plateformeIds.has(id) ? actorDetails(model, id) : groupDetails(model, id, reading.actors));
  const nodes = nodesFromEdges(edges, (id) => id, kindFor, detailsFor);
  const isolated = nodesIsoles(reading.actors, key, new Set(nodes.map((n) => n.id)), kindFor, detailsFor);
  const nodesTotal = [...nodes, ...isolated];

  // The platform's components go inside the boundary; everything else orbits
  // around it. Without at least two components, a frame adds nothing.
  const dedans = nodesTotal.filter((n) => plateformeIds.has(n.id));
  if (dedans.length < 2) return { nodes: nodesTotal, edges };
  for (const n of dedans) n.parent = ID_FRONTIERE;
  return {
    nodes: [{ id: ID_FRONTIERE, label: "Platform", kind: "boundary" }, ...nodesTotal],
    edges,
  };
}

// The product alone, without its surroundings: only flows whose BOTH ends are
// in a "Platform" group are kept. No boundary here -- everything drawn is the
// platform, and a frame around all of it teaches nothing.
export function buildPlatformOnlyView(model: ParsedModel, reading: Lecture, options: AggregationOptions): ViewResult {
  const acteursPlateforme = reading.actors.filter((a) => actorIsPlatform(model, a));
  const interne = (name: string) => acteursPlateforme.some((a) => a.name.trim() === name.trim());
  const flows = reading.flows.filter((f) => interne(f.provider) && interne(f.consumer));
  const edges = aggregateEdges(flows, identityNodeKey, options, true);
  const kindFor = () => "platform" as const;
  const detailsFor = (id: NodeId) => actorDetails(model, id);
  const nodes = nodesFromEdges(edges, (id) => id, kindFor, detailsFor);
  const isolated = nodesIsoles(acteursPlateforme, identityNodeKey, new Set(nodes.map((n) => n.id)), kindFor, detailsFor);
  return { nodes: [...nodes, ...isolated], edges };
}

export interface OptionsVueTechnologie extends AggregationOptions {
  masquerExternes?: boolean;
  hiddenActors?: readonly string[];
}

// The actors that can be unticked for a given technology. The list follows the
// "externals" switch: when it hides, its actors leave the list -- and the
// switch alone brings them back, so nothing is lost.
export function optionsFiltreTechnologie(
  model: ParsedModel,
  flows: FlowInstance[],
  flowType: string,
  options: { masquerExternes?: boolean }
): string[] {
  const names = new Set<string>();
  for (const flow of flowsOfTechnology(flows, flowType)) {
    for (const name of [flow.provider, flow.consumer]) {
      if (options.masquerExternes && nomEstExterne(model, name)) continue;
      names.add(name);
    }
  }
  return [...names].sort((a, b) => a.localeCompare(b, "fr"));
}

function flowsOfTechnology(flows: FlowInstance[], flowType: string) {
  return flows.filter((f) => f.flowType.trim() === flowType.trim());
}

export function buildByTechnologyView(
  model: ParsedModel,
  allFlows: FlowInstance[],
  flowType: string,
  options: OptionsVueTechnologie
): ViewResult {
  const hiddenIds = new Set(options.hiddenActors ?? []);
  // A flow falls as soon as ONE of its two ends is hidden: a line to an absent
  // box means nothing.
  const isHidden = (name: string) => hiddenIds.has(name) || (options.masquerExternes === true && nomEstExterne(model, name));
  const flows = flowsOfTechnology(allFlows, flowType).filter(
    (f) => !isHidden(f.provider) && !isHidden(f.consumer)
  );
  const edges = aggregateEdges(flows, identityNodeKey, options, true);
  const nodes = nodesFromEdges(edges, (id) => id, () => "actor", (id) => actorDetails(model, id));
  return { nodes, edges };
}

// What can be unticked in the by-actor view: the COMPLETE list, computed
// before any filtering. Otherwise, hiding a technology would make its own
// checkbox vanish and there would be no way to bring it back.
export interface ActorFilters {
  technologies: string[];
  actors: string[];
}

export function actorFilterOptions(allFlows: FlowInstance[], actorName: string): ActorFilters {
  const technologies = new Set<string>();
  const actors = new Set<string>();
  for (const flow of flowsTouchingActor(allFlows, actorName)) {
    // An empty technology is not one: in functional mode every edge carries it
    // empty (§5.2), and offering it would give an unlabelled checkbox that
    // empties the whole diagram in one silent click.
    if (flow.flowType.trim() !== "") technologies.add(flow.flowType);
    const autre = flow.provider.trim() === actorName.trim() ? flow.consumer : flow.provider;
    if (autre.trim() !== actorName.trim()) actors.add(autre);
  }
  const byName = (a: string, b: string) => a.localeCompare(b, "fr");
  return { technologies: [...technologies].sort(byName), actors: [...actors].sort(byName) };
}

function flowsTouchingActor(flows: FlowInstance[], actorName: string) {
  return flows.filter(
    (f) => f.provider.trim() === actorName.trim() || f.consumer.trim() === actorName.trim()
  );
}

export interface ActorViewOptions {
  hiddenTechnologies?: readonly string[];
  hiddenActors?: readonly string[];
  // How far the eye reaches: the immediate neighbours, what the actor depends
  // on, or what depends on it -- that is, what its fall would touch.
  neighbourhood?: Neighbourhood;
}

export function buildByActorView(model: ParsedModel, allFlows: FlowInstance[], actorName: string, options: ActorViewOptions): ViewResult {
  const neighbourhood = options.neighbourhood ?? "direct";
  const distances = radius(allFlows, actorName, neighbourhood);
  // At direct range, the historical behaviour: the flows that TOUCH the actor.
  // Beyond that, every flow whose two ends are within the radius -- otherwise
  // the board would show boxes without the links that brought them there.
  const flows =
    neighbourhood === "direct"
      ? flowsTouchingActor(allFlows, actorName)
      : allFlows.filter((f) => distances.has(f.provider.trim()) && distances.has(f.consumer.trim()));
  const hiddenTechnologies = new Set(options.hiddenTechnologies ?? []);
  const hiddenActors = new Set(options.hiddenActors ?? []);

  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>([actorName]);

  for (const flow of flows) {
    // Hiding a technology removes its flows, hence the actors that were linked
    // only by it; hiding an actor removes the flows that led to it. Both
    // directions fall out of the same rule: nodes follow edges.
    if (hiddenTechnologies.has(flow.flowType)) continue;
    const autre = flow.provider.trim() === actorName.trim() ? flow.consumer : flow.provider;
    if (hiddenActors.has(autre)) continue;
    // The same rule as everywhere else: the line follows the DATA, from
    // provider to consumer, and the arrowhead says who calls. This view builds
    // its edges itself rather than through groupFlows, and it had kept the old
    // convention: it reversed the line on a pulled flow. One draw.io file thus
    // told two different architectures depending on the tab.
    //
    // This view ALREADY names the exchange rather than the pipe: a line here
    // carries a single flow, so the technology has nothing to aggregate and
    // reads as a sub-line. The "Label" setting does not concern it.
    const from = flow.provider;
    const to = flow.consumer;
    nodeIds.add(from);
    nodeIds.add(to);
    edges.push({
      from,
      to,
      technology: flow.flowType,
      count: 1,
      criticality: flow.consumption.criticality.trim() || undefined,
      pulled: flow.direction === "consumer-to-provider",
      label: interfaceLabel(flow.interfaceName, flow.version),
      attenuated: flow.attenuated,
    });
  }

  const nodes: GraphNode[] = [...nodeIds].map((id) => ({
    id,
    label: id,
    kind: id === actorName ? "focus-actor" : "actor",
    ...actorDetails(model, id),
    // Dimmed by distance: one hop at full, two at 70%, beyond at 45%. This is
    // degree-of-interest -- what is far stays visible but stops competing for
    // attention with the starting point.
    ...(neighbourhood === "direct" ? {} : { attenuation: attenuationDeDistance(distances.get(id) ?? 0) }),
  }));

  return { nodes, edges };
}

export interface MatrixCell {
  technology: string;
  count: number;
  attenuated: boolean;
  names: string[];
}

export interface MatrixRow {
  actor: string;
  cellules: Map<string, MatrixCell[]>;
}

// The two axes are each judged on their own: one row per real sender, one
// column per real receiver. What sends nothing has no row, what receives
// nothing has no column -- an entirely empty band takes up space and teaches
// nothing. The table that comes out of here is final: neither the display nor
// the export trims it again.
export interface MatrixResult {
  columns: string[];
  rows: MatrixRow[];
  // The table's margins: out-degree per row, in-degree per column. A matrix
  // without totals forces the eye to count cells to find out which is the hub.
  totauxLigne: Map<string, number>;
  totauxColonne: Map<string, number>;
}

// The matrix reads at the same three scales as the graphical views: actor by
// actor, everything folded onto groups, or the platform's components detailed
// against the groups around them.
export type MatrixGrain = "actor" | "group" | "platform";

export interface OptionsVueMatrice {
  mode: Mode;
  grain?: MatrixGrain;
  order?: MatrixOrder;
  masquerExternes?: boolean;
  hiddenActors?: readonly string[];
}

// Each grain has its own folding and its own reading of the perimeter: a row
// id is an actor name at "actor", a group name at "group", and either one at
// "platform".
function matrixFolding(
  model: ParsedModel,
  grain: MatrixGrain
): { key: NodeKeyFn; external: (id: string) => boolean } {
  if (grain === "group") {
    return { key: groupNodeKey(model), external: (id) => groupIsExternal(model, id) };
  }
  if (grain === "platform") {
    const plateforme = new Set(
      model.actors.filter((a) => actorIsPlatform(model, a)).map((a) => a.name.trim())
    );
    return {
      key: platformDetailNodeKey(model),
      external: (id) => !plateforme.has(id) && groupIsExternal(model, id),
    };
  }
  return { key: identityNodeKey, external: (id) => nomEstExterne(model, id) };
}

// The matrix rows that can be unticked: everything carrying at least one flow
// at the current grain, subject to the "externals" switch.
export function optionsFiltreMatrice(
  model: ParsedModel,
  flows: FlowInstance[],
  options: { grain?: MatrixGrain; masquerExternes?: boolean }
): string[] {
  const { key, external } = matrixFolding(model, options.grain ?? "actor");
  const ids = new Set<string>();
  for (const flow of flows) {
    for (const name of [flow.provider, flow.consumer]) {
      const id = key(name);
      // "No node" sentinel: an actor with no group is absent from the folded
      // views, so it has no checkbox.
      if (!id) continue;
      if (options.masquerExternes && external(id)) continue;
      ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b, "fr"));
}

export function buildMatrixView(model: ParsedModel, reading: Lecture, options: OptionsVueMatrice): MatrixResult {
  const { key, external } = matrixFolding(model, options.grain ?? "actor");
  const hiddenIds = new Set(options.hiddenActors ?? []);
  const isHidden = (id: string) => hiddenIds.has(id) || (options.masquerExternes === true && external(id));
  // A link falls as soon as one of its two ends is hidden: a row or a column
  // to an absent actor means nothing. Hiding applies to the folded id, so
  // unticking a group carries all its actors with it.
  const flows = reading.flows.filter((f) => !isHidden(key(f.provider)) && !isHidden(key(f.consumer)));
  const groups = groupFlows(flows, key, false);

  const byName = (a: string, b: string) => a.localeCompare(b, "fr");

  const lignesMap = new Map<string, MatrixRow>();
  for (const g of groups) {
    let row = lignesMap.get(g.from);
    if (!row) {
      row = { actor: g.from, cellules: new Map() };
      lignesMap.set(g.from, row);
    }
    const cell: MatrixCell = { technology: g.technology, count: g.count, attenuated: g.attenuated, names: g.names };
    const existing = row.cellules.get(g.to);
    if (existing) existing.push(cell);
    else row.cellules.set(g.to, [cell]);
  }

  // A business actor left isolated (§5.2) keeps its row, empty rather than
  // absent: vanishing from the matrix would remove information silently, as in
  // the graphical views.
  if (options.mode === "functional") {
    for (const actor of reading.actors) {
      const id = key(actor.name);
      if (!id || lignesMap.has(id) || isHidden(id)) continue;
      lignesMap.set(id, { actor: id, cellules: new Map() });
    }
  }

  // The order is decided HERE, once, and both display and export follow it:
  // "what is on screen is what is exported".
  const neighbourhood = new Map<string, Set<string>>();
  const ajouterVoisin = (a: string, b: string) => {
    const v = neighbourhood.get(a) ?? new Set<string>();
    v.add(b);
    neighbourhood.set(a, v);
  };
  for (const g of groups) {
    ajouterVoisin(g.from, g.to);
    ajouterVoisin(g.to, g.from);
  }
  const ctxOrdre: OrderContext = {
    groupOf: (id) => model.actors.find((a) => a.name.trim() === id)?.group.trim() ?? id,
    degree: (id) => neighbourhood.get(id)?.size ?? 0,
    neighbours: (id) => [...(neighbourhood.get(id) ?? [])],
  };
  const order = options.order ?? "alphabetical";
  const columns = orderBy([...new Set(groups.map((g) => g.to))], order, ctxOrdre);

  const rows = orderBy([...lignesMap.keys()], order, ctxOrdre).map((id) => lignesMap.get(id)!);
  for (const row of rows) {
    for (const cellules of row.cellules.values()) {
      cellules.sort((a, b) => byName(a.technology, b.technology));
    }
  }

  // The margins: how many flows leave each row, how many arrive on each
  // column. This is what NAMES the hub without counting cells by eye.
  const totauxLigne = new Map(rows.map((l) => [l.actor, [...l.cellules.values()].flat().reduce((n, c) => n + c.count, 0)]));
  const totauxColonne = new Map(
    columns.map((c) => [c, rows.reduce((n, l) => n + (l.cellules.get(c) ?? []).reduce((m, x) => m + x.count, 0), 0)])
  );

  return { columns, rows, totauxLigne, totauxColonne };
}
