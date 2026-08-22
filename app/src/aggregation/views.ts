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

// L'opacité d'un nœud selon sa distance au point d'intérêt.
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

// Style C4 : « Type », description et statut externe sous le nom d'un acteur réel.
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
    // La nature se décide ICI, où le modèle est connu : le rendu applique une
    // forme, il ne va pas la chercher.
    technique: isTechnicalActor(model, name) || undefined,
  };
}

// Un nœud « groupe » agrège plusieurs acteurs : pas de type/description
// unique, mais le nombre d'acteurs qu'il représente est une donnée réelle.
// `acteurs` est déjà la lecture au (rang, mode) courant -- ni la plomberie ni
// un acteur retiré n'y figurent, donc pas à re-juger ici.
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
    // Le périmètre du groupe, et lui seul : c'est ce qui fait fonctionner le
    // code couleur sur les vues agrégées, où les nœuds ne sont pas des acteurs.
    external: groupIsExternal(model, group) || undefined,
  };
}

// Frontière de la plateforme, au sens C4 : un conteneur en pointillés autour
// des composants du produit, pour les distinguer d'un coup d'œil des systèmes
// tiers qui les entourent.
const ID_FRONTIERE = "__frontiere__";

// Un acteur métier devenu isolé -- dont les échanges passaient tous par des
// chaînes coupées -- reste affiché, seul (§5.2) : le faire disparaître
// retirerait de l'information sans le dire. `nodeKey` est la même résolution
// que celle qui a construit les arêtes de la vue, pour que l'acteur
// réapparaisse à la même échelle (son groupe, ou lui-même) que le reste.
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
    // Sentinel « pas de nœud » (§7.4) : un acteur sans groupe n'a rien à
    // rejoindre dans une vue repliée sur les groupes.
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

  // Les composants de la plateforme entrent dans la frontière ; tout le reste
  // gravite autour. Sans au moins deux composants, un cadre n'apporte rien.
  const dedans = nodesTotal.filter((n) => plateformeIds.has(n.id));
  if (dedans.length < 2) return { nodes: nodesTotal, edges };
  for (const n of dedans) n.parent = ID_FRONTIERE;
  return {
    nodes: [{ id: ID_FRONTIERE, label: "Platform", kind: "boundary" }, ...nodesTotal],
    edges,
  };
}

// Le produit seul, sans ce qui l'entoure : on ne garde que les flux dont les
// DEUX extrémités sont dans un groupe « Plateforme ». Pas de frontière ici --
// tout ce qui est dessiné est la plateforme, un cadre autour de tout n'apprend
// rien.
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

// Les acteurs décochables pour une technologie donnée. La liste suit
// l'interrupteur « externes » : quand il masque, ses acteurs quittent la liste
// -- et l'interrupteur seul suffit à les faire revenir, donc rien n'est perdu.
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
  // Un flux tombe dès qu'UNE de ses deux extrémités est masquée : un trait vers
  // une boîte absente ne veut rien dire.
  const isHidden = (name: string) => hiddenIds.has(name) || (options.masquerExternes === true && nomEstExterne(model, name));
  const flows = flowsOfTechnology(allFlows, flowType).filter(
    (f) => !isHidden(f.provider) && !isHidden(f.consumer)
  );
  const edges = aggregateEdges(flows, identityNodeKey, options, true);
  const nodes = nodesFromEdges(edges, (id) => id, () => "actor", (id) => actorDetails(model, id));
  return { nodes, edges };
}

// Ce qu'on peut décocher dans la vue par acteur : la liste COMPLÈTE, calculée
// avant tout filtrage. Sinon, masquer une technologie ferait disparaître sa
// propre case à cocher et il n'y aurait plus moyen de la rétablir.
export interface FiltresActeur {
  technologies: string[];
  actors: string[];
}

export function optionsFiltreActeur(allFlows: FlowInstance[], actorName: string): FiltresActeur {
  const technologies = new Set<string>();
  const actors = new Set<string>();
  for (const flow of flowsTouchingActor(allFlows, actorName)) {
    // Une technologie vide n'en est pas une : en mode fonctionnel, toutes les
    // arêtes la portent vide (§5.2), et la proposer donnerait une case à
    // cocher sans étiquette qui vide tout le schéma en un clic muet.
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

export interface OptionsVueActeur {
  hiddenTechnologies?: readonly string[];
  hiddenActors?: readonly string[];
  // Jusqu'où porte le regard : les voisins immédiats, ce dont l'acteur dépend,
  // ou ce qui dépend de lui -- c'est-à-dire ce que sa chute toucherait.
  neighbourhood?: Neighbourhood;
}

export function buildByActorView(model: ParsedModel, allFlows: FlowInstance[], actorName: string, options: OptionsVueActeur): ViewResult {
  const neighbourhood = options.neighbourhood ?? "direct";
  const distances = radius(allFlows, actorName, neighbourhood);
  // En direct, le comportement historique : les flux qui TOUCHENT l'acteur.
  // Au-delà, tout flux dont les deux bouts sont dans le rayon -- sinon la
  // planche montrerait des boîtes sans les liens qui les y ont amenées.
  const flows =
    neighbourhood === "direct"
      ? flowsTouchingActor(allFlows, actorName)
      : allFlows.filter((f) => distances.has(f.provider.trim()) && distances.has(f.consumer.trim()));
  const hiddenTechnologies = new Set(options.hiddenTechnologies ?? []);
  const hiddenActors = new Set(options.hiddenActors ?? []);

  const edges: GraphEdge[] = [];
  const nodeIds = new Set<string>([actorName]);

  for (const flow of flows) {
    // Masquer une technologie retire ses flux, donc les acteurs qui n'étaient
    // reliés que par elle ; masquer un acteur retire les flux qui y menaient.
    // Les deux sens tombent de la même règle : les nœuds suivent les arêtes.
    if (hiddenTechnologies.has(flow.flowType)) continue;
    const autre = flow.provider.trim() === actorName.trim() ? flow.consumer : flow.provider;
    if (hiddenActors.has(autre)) continue;
    // La même règle que partout ailleurs : le trait suit la DONNÉE, du
    // fournisseur vers le consommateur, et la pointe dit qui appelle. Cette vue
    // construit ses arêtes elle-même plutôt que par groupFlows, et elle avait
    // gardé l'ancienne convention : elle inversait le trait sur un flux tiré.
    // Un même fichier draw.io racontait donc deux architectures selon l'onglet.
    //
    // Cette vue nomme DÉJÀ l'échange plutôt que le tuyau : un trait y porte un
    // seul flux, donc la technologie n'a rien à agréger et se lit en
    // sous-ligne. Le réglage « Label » ne la concerne pas.
    const from = flow.provider;
    const to = flow.consumer;
    nodeIds.add(from);
    nodeIds.add(to);
    edges.push({
      from,
      to,
      technology: flow.flowType,
      count: 1,
      criticality: flow.conso.criticality.trim() || undefined,
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
    // Atténué selon la distance : un saut à plein, deux à 70 %, au-delà à
    // 45 %. C'est le degree-of-interest -- ce qui est loin reste visible mais
    // cesse de disputer l'attention au point de départ.
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

// Les deux axes sont jugés chacun de son côté : une ligne par émetteur réel,
// une colonne par destinataire réel. Ce qui n'émet rien n'a pas de ligne, ce
// qui ne reçoit rien n'a pas de colonne -- une bande entièrement vide occupe
// de la place sans rien apprendre. Le tableau qui sort d'ici est définitif :
// ni l'affichage ni l'export ne le retaillent.
export interface MatrixResult {
  columns: string[];
  rows: MatrixRow[];
  // Les marges du tableau : degré sortant par ligne, entrant par colonne. Une
  // matrix sans totaux oblige à compter des cases à l'œil pour savoir qui est
  // le moyeu.
  totauxLigne: Map<string, number>;
  totauxColonne: Map<string, number>;
}

// La matrix se lit aux mêmes trois échelles que les vues graphiques : acteur
// par acteur, tout replié sur les groupes, ou les composants de la plateforme
// détaillés face aux groupes qui les entourent.
export type GranulariteMatrice = "actor" | "group" | "platform";

export interface OptionsVueMatrice {
  mode: Mode;
  granularite?: GranulariteMatrice;
  order?: MatrixOrder;
  masquerExternes?: boolean;
  hiddenActors?: readonly string[];
}

// À chaque granularité son repli et sa lecture du périmètre : un id de ligne
// est un nom d'acteur en « acteur », un nom de groupe en « groupe », et l'un ou
// l'autre en « plateforme ».
function matrixFolding(
  model: ParsedModel,
  granularite: GranulariteMatrice
): { key: NodeKeyFn; external: (id: string) => boolean } {
  if (granularite === "group") {
    return { key: groupNodeKey(model), external: (id) => groupIsExternal(model, id) };
  }
  if (granularite === "platform") {
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

// Les lignes décochables de la matrix : tout ce qui porte au moins un flux à
// la granularité courante, sous réserve de l'interrupteur « externes ».
export function optionsFiltreMatrice(
  model: ParsedModel,
  flows: FlowInstance[],
  options: { granularite?: GranulariteMatrice; masquerExternes?: boolean }
): string[] {
  const { key, external } = matrixFolding(model, options.granularite ?? "actor");
  const ids = new Set<string>();
  for (const flow of flows) {
    for (const name of [flow.provider, flow.consumer]) {
      const id = key(name);
      // Sentinel « pas de nœud » : un acteur sans groupe est absent des vues
      // repliées, il n'a donc pas de case à cocher.
      if (!id) continue;
      if (options.masquerExternes && external(id)) continue;
      ids.add(id);
    }
  }
  return [...ids].sort((a, b) => a.localeCompare(b, "fr"));
}

export function buildMatrixView(model: ParsedModel, reading: Lecture, options: OptionsVueMatrice): MatrixResult {
  const { key, external } = matrixFolding(model, options.granularite ?? "actor");
  const hiddenIds = new Set(options.hiddenActors ?? []);
  const isHidden = (id: string) => hiddenIds.has(id) || (options.masquerExternes === true && external(id));
  // Un lien tombe dès qu'une de ses deux extrémités est masquée : une ligne ou
  // une colonne vers un acteur absent ne veut rien dire. Le masquage porte sur
  // l'id replié, donc décocher un groupe emporte tous ses acteurs.
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

  // Un acteur métier devenu isolé (§5.2) garde sa ligne, vide plutôt
  // qu'absente : disparaître de la matrix retirerait de l'information sans
  // le dire, comme dans les vues graphiques.
  if (options.mode === "functional") {
    for (const actor of reading.actors) {
      const id = key(actor.name);
      if (!id || lignesMap.has(id) || isHidden(id)) continue;
      lignesMap.set(id, { actor: id, cellules: new Map() });
    }
  }

  // L'ordre se décide ICI, une fois, et l'affichage comme l'export le suivent :
  // « ce qui est à l'écran est ce qui s'exporte ».
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

  // Les marges : combien de flux partent de chaque ligne, combien arrivent sur
  // chaque colonne. C'est ce qui NOMME le moyeu sans compter les cases à l'œil.
  const totauxLigne = new Map(rows.map((l) => [l.actor, [...l.cellules.values()].flat().reduce((n, c) => n + c.count, 0)]));
  const totauxColonne = new Map(
    columns.map((c) => [c, rows.reduce((n, l) => n + (l.cellules.get(c) ?? []).reduce((m, x) => m + x.count, 0), 0)])
  );

  return { columns, rows, totauxLigne, totauxColonne };
}
