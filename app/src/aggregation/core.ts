import type { Actor, InterfaceCatalogue, ParsedModel, Consommation, ValiditePalier } from "../parsing/model";
import { lifespanOf, isLiveAt } from "./milestones";
import { normalizeText } from "../shared/text";
import { PERIMETRE_PLATEFORME, PERIMETRE_EXTERNE, VOCABULAIRE_CRITICITE } from "./vocabularies";

export type NodeId = string;
export type NodeKind = "group" | "platform" | "actor" | "focus-actor" | "boundary";

export interface GraphNode {
  id: NodeId;
  label: string;
  kind: NodeKind;
  // Style C4 : « Type » et description courte affichés sous le nom, quand
  // le nœud correspond à un acteur réel (pas un groupe agrégé).
  subtitle?: string;
  description?: string;
  external?: boolean;
  // Ce que la FORME doit redire, faute de quoi la couleur reste seule à le
  // porter -- donc rien du tout à l'impression et pour un daltonien (WCAG
  // 1.4.1). Deux variantes, pas plus : au-delà on tombe dans le zoo UML.
  //
  // `technique` : l'acteur est de la plomberie (nature Technical).
  // `agrégat` : le nœud replie plusieurs acteurs, et combien.
  technique?: boolean;
  agrégat?: number;
  // Opacité du nœud, quand la vue veut mettre en retrait sans faire
  // disparaître : ce qui est loin du point d'intérêt reste visible mais cesse
  // de lui disputer l'attention.
  attenuation?: number;
  // Nom d'icône, résolu depuis l'onglet TypesActeur du classeur. Le rendu ne
  // décide plus quelle icône va à quel type : il l'applique.
  icone?: string;
  // Nœud conteneur (style C4 : la frontière de la plateforme). Les enfants
  // sont placés à l'intérieur par le moteur, et la frontière est dessinée
  // autour d'eux.
  parent?: string;
}

export interface GraphEdge {
  from: NodeId;
  to: NodeId;
  technology: string;
  count: number;
  // La criticité la plus forte portée par ce trait, quand la vue veut la
  // dessiner. Saisie, contrôlée et exportée depuis toujours, elle n'était
  // jamais dessinée -- c'est pourtant la donnée la plus décisionnelle du
  // classeur.
  criticality?: string;
  label: string;
  attenuated: boolean;
  // La pointe va au départ du trait plutôt qu'à son arrivée : le consommateur
  // interroge le fournisseur, mais la donnée descend toujours dans l'autre sens.
  pulled?: boolean;
  // Les échanges que ce trait rassemble. L'étiquette n'en nomme que les
  // premiers ; la liste entière se lit au hover, sans quoi la vue métier
  // cacherait ce qu'elle est censée montrer.
  names?: string[];
  // Marque de la vue Écarts : ce trait apparaît ou disparaît entre les deux
  // paliers comparés. Absent partout ailleurs -- ce n'est pas une propriété du
  // flux, c'est le résultat d'une comparaison.
  ecart?: "added" | "removed";
}

export interface FlowInstance {
  interfaceName: string;
  // La version du contrat exposé, telle qu'elle figure au catalogue -- pas
  // celle saisie côté consommation : c'est l'interface qu'on nomme.
  version: string;
  flowType: string;
  provider: string;
  consumer: string;
  direction: "provider-to-consumer" | "consumer-to-provider";
  attenuated: boolean;
  // Les deux lignes du classeur d'où ce flux vient. Les schémas n'en ont pas
  // besoin -- ils ne dessinent qu'un trait -- mais les exports vers un outil
  // d'architecture, eux, y trouvent tout ce que le trait ne montre pas :
  // contrat, usage, criticité, décision, paliers.
  iface: InterfaceCatalogue;
  conso: Consommation;
}

// Comment on nomme une interface, partout : « Authent 1.0 », ou « Authent »
// tout court si elle n'est pas versionnée. Une seule définition, pour que le
// schéma et le rapport ne désignent pas la même interface de deux façons.
export function interfaceLabel(flowName: string, version: string): string {
  const name = flowName.trim();
  const v = version.trim();
  return v ? `${name} ${v}` : name;
}

// Combien d'échanges se nomment sur un trait fusionné avant qu'on ne compte le
// reste. Deux tiennent dans la largeur d'une boîte ; au-delà, l'étiquette
// mangerait le dessin -- l'infobulle du trait porte alors la liste entière.
const ECHANGES_NOMMES = 2;

// Le libellé d'un trait fusionné, partagé par la matrix (écran et export) et
// les schémas.
//
// Sans technologie -- le cas du mode fonctionnel, qui la vide pour que les
// traits d'une même paire fusionnent -- le compteur restait seul. Or « 2 »
// n'apprend ni ce qui circule ni pourquoi : ce sont les échanges eux-mêmes qui
// portent le sens dès lors que le medium a disparu.
//
// Ce que le trait NOMME est un choix de lecture : le tuyau (« Kafka ×2 »), ce
// qui y circule (« Policy events 1.0, Claims 2.0 »), ou les deux. Nommer le
// seul protocole faisait une carte des tuyaux là où on attend une carte des
// échanges.
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
  // Sans technologie -- le cas du mode fonctionnel, qui la vide pour que les
  // traits d'une même paire fusionnent -- « technology » retomberait sur un
  // compteur seul. Or « 2 » n'apprend ni ce qui circule ni pourquoi.
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

// Le périmètre se lit sur le GROUPE, jamais sur l'acteur : « Socle » est la
// plateforme, donc chacun de ses composants en fait partie. Lu acteur par
// acteur, un groupe mixte se peignait aux couleurs de la plateforme tout en
// n'affichant qu'une partie de ses membres.
function perimetreDuGroupe(model: ParsedModel, group: string): string {
  const name = normalizeText(group);
  return model.groups.find((g) => normalizeText(g.name) === name)?.perimeter ?? "";
}

export function groupIsPlatform(model: ParsedModel, group: string): boolean {
  return normalizeText(perimetreDuGroupe(model, group)) === normalizeText(PERIMETRE_PLATEFORME);
}

export function groupIsExternal(model: ParsedModel, group: string): boolean {
  return normalizeText(perimetreDuGroupe(model, group)) === normalizeText(PERIMETRE_EXTERNE);
}

export function actorIsPlatform(model: ParsedModel, actor: Actor): boolean {
  return groupIsPlatform(model, actor.group);
}

// Icône déclarée pour un type d'acteur. Le classeur fait foi ; sans
// déclaration, le rendu retombe sur le jeton neutre.
export function iconForActorType(model: ParsedModel, typeActeur: string): string | undefined {
  const sought = normalizeText(typeActeur);
  if (!sought) return undefined;
  return model.typesActeur.find((t) => normalizeText(t.type) === sought)?.icone || undefined;
}

export function nomEstExterne(model: ParsedModel, name: string): boolean {
  const actor = model.actors.find((a) => a.name.trim() === name.trim());
  return actor ? groupIsExternal(model, actor.group) : false;
}

// Rattachement (feuille, nom du flux) plutôt que nom seul (§3.3) : deux
// interfaces homonymes dans des onglets différents ne doivent jamais se
// résoudre à la mauvaise (un cas déjà signalé comme anomalie par ailleurs,
// mais qui ne doit pas en plus fausser le diagramme). byKey est la
// correspondance exacte ; byName est un repli best-effort uniquement pour
// une consommation rangée dans le mauvais onglet.
// Trois entrées parce qu'il y a trois questions distinctes à poser, et que
// les confondre ferait dire au rapport le contraire du diagramme :
//   byKey        -- la correspondance exacte (feuille, nom, version) ;
//   byNomVersion -- repli pour une consommation rangée dans le mauvais onglet ;
//   byNom        -- sert seulement à distinguer « nom absent du catalogue »
//                   de « ce nom existe, mais pas dans cette version ».
// Le repli ne descend jamais jusqu'à byNom : à version inconnue, on ne devine
// pas laquelle était visée -- ce serait rattacher un consommateur à un contrat
// qu'il n'a pas signé.
export interface InterfaceLookup {
  byKey: Map<string, InterfaceCatalogue>;
  byNomVersion: Map<string, InterfaceCatalogue>;
  byNom: Map<string, InterfaceCatalogue>;
  // Les (nom, version) que PLUSIEURS exposants publient. Deux acteurs peuvent
  // nommer pareil sans s'être concertés : ce sont deux interfaces distinctes,
  // et le nom seul ne tranche donc plus entre elles.
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

// Le nom seul, normalisé comme les deux autres clés. Il l'était par un simple
// trim, quand le rattachement, lui, normalise : un « Order status » écrit
// « ORDER STATUS » dans une consommation était bel et bien dessiné, et le
// rapport le déclarait pourtant absent du catalogue.
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

export function findInterfaceForConsommation(lookup: InterfaceLookup, c: Consommation): InterfaceCatalogue | undefined {
  const parOnglet = lookup.byKey.get(interfaceKey(c.sheet, c.flowName, c.version));
  if (parOnglet) return parOnglet;
  // Le repli par le nom ne joue que si ce nom ne désigne qu'un seul exposant.
  // Plusieurs, et le rattacher au premier ferait signer ce consommateur chez
  // quelqu'un qu'il n'a pas choisi : on ne résout pas, et le contrôle de
  // référence le dit clairement.
  const kNomVersion = nomVersionKey(c.flowName, c.version);
  if (lookup.nomVersionAmbigu.has(kNomVersion)) return undefined;
  return lookup.byNomVersion.get(kNomVersion);
}

// Un flux orphelin (nom absent du catalogue) ou de type inconnu (sens
// indéterminable) ne peut pas être dessiné — ces cas sont déjà signalés par
// integrity/checks.ts (7.2), on les ignore simplement ici.
// Le rang affiché filtre : ne sont retenus que les flux dont TOUTE la chaîne
// -- exposant, interface, consommation, consommateur -- est vivante à ce rang.
// `null` veut dire « aucun palier affiché » : rien n'est filtré, et un classeur
// qui ne déclare aucun palier se comporte donc exactement comme avant.
export function buildFlowInstances(model: ParsedModel, rank: number | null = null): FlowInstance[] {
  const actors = actorByName(model);
  const sensParType = new Map(model.flowTypes.map((t) => [t.type.trim(), t.sensRepresentation]));
  const lookup = buildInterfaceLookup(model);
  const flows: FlowInstance[] = [];

  for (const consumption of model.consumptions) {
    const iface = findInterfaceForConsommation(lookup, consumption);
    if (!iface) continue;

    const direction = sensParType.get(iface.flowType.trim());
    if (!direction) continue;

    const exposantActeur = actors.get(iface.providerName.trim());
    const consommateurActeur = actors.get(consumption.consumerName.trim());

    if (rank !== null) {
      const live = (v: ValiditePalier | undefined) =>
        v === undefined || isLiveAt(lifespanOf(model, v), rank);
      if (!live(iface) || !live(consumption) || !live(exposantActeur) || !live(consommateurActeur)) {
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
      conso: consumption,
    });
  }

  return flows;
}

export type NodeKeyFn = (actorName: string) => NodeId;

export function identityNodeKey(actorName: string): NodeId {
  return actorName;
}

// Une chaîne vide est le sentinel "pas de nœud" : un acteur connu mais sans
// Groupe renseigné est absent des vues agrégées (§7.4), pas replié sur son
// propre nom — groupFlows() élimine les flux dont une extrémité y résout.
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
    // Un acteur d'un groupe « Plateforme » est détaillé sous son propre nom ;
    // tout le reste est replié sur son groupe.
    return actorIsPlatform(model, actor) ? actor.name : actor.group.trim();
  };
}

// Le tracé suit la DONNÉE : du fournisseur vers le consommateur, toujours.
//
// Il portait autrefois le sens de l'APPEL, celui que déclare la technologie. Un
// flux tiré -- HTTP, « consumer → provider » -- voyait donc son tracé inversé
// en même temps que sa pointe : la donnée semblait remonter le tuyau, et un
// fournisseur interrogé n'avait rien qui sorte de lui. Sur une chaîne de
// relais, un maillon paraissait ne rien produire.
//
// L'initiative n'est pas perdue pour autant : elle passe sur la pointe, posée
// au départ du trait quand c'est le consommateur qui appelle. Deux
// informations, deux supports.
function directedEndpoints(flow: FlowInstance, nodeKey: NodeKeyFn): { from: NodeId; to: NodeId } {
  return { from: nodeKey(flow.provider), to: nodeKey(flow.consumer) };
}

// Le consommateur prend l'initiative : la pointe se pose à l'autre bout du
// trait, sur le fournisseur qu'il interroge.
const estTire = (flow: FlowInstance) => flow.direction === "consumer-to-provider";

export interface EdgeGroup {
  from: NodeId;
  to: NodeId;
  technology: string;
  count: number;
  attenuated: boolean;
  // La pointe se pose au DÉPART du trait : c'est le consommateur qui appelle.
  pulled: boolean;
  // Les échanges rassemblés sous ce trait, dans l'ordre où ils se présentent et
  // sans doublon : c'est d'eux que le libellé tire son sens quand la
  // technologie n'est plus là pour le porter.
  names: string[];
  // La criticité la PLUS FORTE des consommations rassemblées sous ce trait :
  // un trait qui porte un flux vital et deux flux ordinaires est vital.
  criticality?: string;
}

// L'ordre du vocabulaire, du plus critique au moins. On le lit dans la liste
// elle-même plutôt que d'en tenir une seconde : les deux divergeraient.
function rangDeCriticite(value: string): number {
  const i = VOCABULAIRE_CRITICITE.findIndex((v) => normalizeText(v) === normalizeText(value));
  return i < 0 ? VOCABULAIRE_CRITICITE.length : i;
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

    // Clé directionnelle : (from, to) n'est jamais normalisée en paire non
    // ordonnée, pour que deux sens opposés restent deux traits distincts (§4.5).
    // JSON.stringify plutôt qu'une concaténation avec séparateur : un nœud ou
    // une techno peut contenir un espace ("Ryloth") ou même un saut de
    // ligne (Excel autorise Alt+Entrée dans une cellule) ; JSON.stringify évite
    // toute ambiguïté sans introduire de caractère de contrôle dans le code source.
    const key = JSON.stringify([from, to, flow.flowType]);
    const name = interfaceLabel(flow.interfaceName, flow.version);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.attenuated = existing.attenuated && flow.attenuated;
      existing.criticality = laPlusForte(existing.criticality, flow.conso.criticality);
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
        criticality: flow.conso.criticality.trim() || undefined,
      });
    }
  }

  return [...groups.values()];
}

// Les deux lectures du parc. L'architecture répond à « par quoi ça passe », le
// fonctionnel à « qui alimente qui » : mêmes données, deux questions.
export type Mode = "architecture" | "functional";

// Le mode ne s'y lit plus (§ Lecture, fonctionnel.ts) : une vue qui agrège
// des flux déjà résolus au bon (rang, mode) n'a plus besoin de la redemander.
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
    // Sans compteur on ne nomme que le tuyau, sauf si l'utilisateur a demandé
    // autre chose : « counters » décide du ×N, pas de ce qui est nommé.
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
  // L'ordre de parcours des arêtes, et non l'ordre alphabétique. Trier a été
  // essayé et MESURÉ, comme prérequis de stabilité entre paliers : il coûtait
  // 16 % de surface sur la vue détaillée (1 573k contre 1 356k) et dégradait
  // le rapport de forme de 3,63 à 4,04. La stabilité vient d'ailleurs -- le
  // placement se fait une fois sur l'union des paliers (lectureUnion) -- donc
  // le tri ne payait plus que son coût.
  return [...ids].map((id) => ({ id, label: labelFor(id), kind: kindFor(id), ...detailsFor(id) }));
}
