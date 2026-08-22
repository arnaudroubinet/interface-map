import type { Acteur, InterfaceCatalogue, ParsedModel, Consommation, ValiditePalier } from "../parsing/model";
import { intervalleDeVie, estVivant } from "./paliers";
import { normalizeText } from "../shared/text";
import { PERIMETRE_PLATEFORME, PERIMETRE_EXTERNE, VOCABULAIRE_CRITICITE } from "./vocabulaires";

export type NodeId = string;
export type NodeKind = "groupe" | "plateforme" | "acteur" | "acteur-selectionne" | "frontiere";

export interface GraphNode {
  id: NodeId;
  label: string;
  kind: NodeKind;
  // Style C4 : « Type » et description courte affichés sous le nom, quand
  // le nœud correspond à un acteur réel (pas un groupe agrégé).
  sousTitre?: string;
  description?: string;
  externe?: boolean;
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
  technologie: string;
  count: number;
  // La criticité la plus forte portée par ce trait, quand la vue veut la
  // dessiner. Saisie, contrôlée et exportée depuis toujours, elle n'était
  // jamais dessinée -- c'est pourtant la donnée la plus décisionnelle du
  // classeur.
  criticite?: string;
  label: string;
  atténué: boolean;
  // La pointe va au départ du trait plutôt qu'à son arrivée : le consommateur
  // interroge le fournisseur, mais la donnée descend toujours dans l'autre sens.
  tire?: boolean;
  // Les échanges que ce trait rassemble. L'étiquette n'en nomme que les
  // premiers ; la liste entière se lit au survol, sans quoi la vue métier
  // cacherait ce qu'elle est censée montrer.
  noms?: string[];
  // Marque de la vue Écarts : ce trait apparaît ou disparaît entre les deux
  // paliers comparés. Absent partout ailleurs -- ce n'est pas une propriété du
  // flux, c'est le résultat d'une comparaison.
  ecart?: "ajout" | "retrait";
}

export interface FlowInstance {
  interfaceNom: string;
  // La version du contrat exposé, telle qu'elle figure au catalogue -- pas
  // celle saisie côté consommation : c'est l'interface qu'on nomme.
  version: string;
  typeDeFlux: string;
  exposant: string;
  consommateur: string;
  sens: "exposant-consommateur" | "consommateur-exposant";
  atténué: boolean;
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
export function libelleInterface(nomDuFlux: string, version: string): string {
  const nom = nomDuFlux.trim();
  const v = version.trim();
  return v ? `${nom} ${v}` : nom;
}

// Combien d'échanges se nomment sur un trait fusionné avant qu'on ne compte le
// reste. Deux tiennent dans la largeur d'une boîte ; au-delà, l'étiquette
// mangerait le dessin -- l'infobulle du trait porte alors la liste entière.
const ECHANGES_NOMMES = 2;

// Le libellé d'un trait fusionné, partagé par la matrice (écran et export) et
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
export type LibelléArête = "technology" | "exchanges" | "both";

function échangesNommés(noms: readonly string[]): string {
  const nommés = noms.slice(0, ECHANGES_NOMMES).join(", ");
  const reste = noms.length - ECHANGES_NOMMES;
  return reste > 0 ? `${nommés} +${reste}` : nommés;
}

export function libelleCellule(
  technologie: string,
  count: number,
  noms: readonly string[] = [],
  quoi: LibelléArête = "technology"
): string {
  const tuyau = technologie ? (count > 1 ? `${technologie} ×${count}` : technologie) : "";
  // Sans technologie -- le cas du mode fonctionnel, qui la vide pour que les
  // traits d'une même paire fusionnent -- « technology » retomberait sur un
  // compteur seul. Or « 2 » n'apprend ni ce qui circule ni pourquoi.
  if (quoi === "technology" && tuyau) return tuyau;
  if (noms.length === 0) return tuyau || String(count);
  const échanges = échangesNommés(noms);
  if (quoi === "both" && tuyau) return `${échanges} — ${tuyau}`;
  return échanges;
}

function isATransformer(decision: string): boolean {
  return normalizeText(decision) === normalizeText("Transform");
}

function acteurByNom(model: ParsedModel): Map<string, Acteur> {
  const map = new Map<string, Acteur>();
  for (const a of model.acteurs) map.set(a.nom.trim(), a);
  return map;
}

// Le périmètre se lit sur le GROUPE, jamais sur l'acteur : « Socle » est la
// plateforme, donc chacun de ses composants en fait partie. Lu acteur par
// acteur, un groupe mixte se peignait aux couleurs de la plateforme tout en
// n'affichant qu'une partie de ses membres.
function perimetreDuGroupe(model: ParsedModel, groupe: string): string {
  const nom = normalizeText(groupe);
  return model.groupes.find((g) => normalizeText(g.nom) === nom)?.perimetre ?? "";
}

export function groupeEstPlateforme(model: ParsedModel, groupe: string): boolean {
  return normalizeText(perimetreDuGroupe(model, groupe)) === normalizeText(PERIMETRE_PLATEFORME);
}

export function groupeEstExterne(model: ParsedModel, groupe: string): boolean {
  return normalizeText(perimetreDuGroupe(model, groupe)) === normalizeText(PERIMETRE_EXTERNE);
}

export function acteurEstPlateforme(model: ParsedModel, acteur: Acteur): boolean {
  return groupeEstPlateforme(model, acteur.groupe);
}

// Icône déclarée pour un type d'acteur. Le classeur fait foi ; sans
// déclaration, le rendu retombe sur le jeton neutre.
export function icôneDuTypeActeur(model: ParsedModel, typeActeur: string): string | undefined {
  const cherché = normalizeText(typeActeur);
  if (!cherché) return undefined;
  return model.typesActeur.find((t) => normalizeText(t.type) === cherché)?.icone || undefined;
}

export function nomEstExterne(model: ParsedModel, nom: string): boolean {
  const acteur = model.acteurs.find((a) => a.nom.trim() === nom.trim());
  return acteur ? groupeEstExterne(model, acteur.groupe) : false;
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

function cle(...parties: string[]): string {
  return JSON.stringify(parties.map(normalizeText));
}

export function interfaceKey(feuille: string, nomDuFlux: string, version: string): string {
  return cle(feuille, nomDuFlux, version);
}

export function nomVersionKey(nomDuFlux: string, version: string): string {
  return cle(nomDuFlux, version);
}

// Le nom seul, normalisé comme les deux autres clés. Il l'était par un simple
// trim, quand le rattachement, lui, normalise : un « Order status » écrit
// « ORDER STATUS » dans une consommation était bel et bien dessiné, et le
// rapport le déclarait pourtant absent du catalogue.
export function nomKey(nomDuFlux: string): string {
  return cle(nomDuFlux);
}

export function buildInterfaceLookup(model: ParsedModel): InterfaceLookup {
  const byKey = new Map<string, InterfaceCatalogue>();
  const byNomVersion = new Map<string, InterfaceCatalogue>();
  const byNom = new Map<string, InterfaceCatalogue>();
  const nomVersionAmbigu = new Set<string>();
  for (const i of model.interfaces) {
    byKey.set(interfaceKey(i.feuilleAttendue, i.nomDuFlux, i.version), i);
    const kNomVersion = nomVersionKey(i.nomDuFlux, i.version);
    const déjà = byNomVersion.get(kNomVersion);
    if (!déjà) byNomVersion.set(kNomVersion, i);
    else if (normalizeText(déjà.acteurExposant) !== normalizeText(i.acteurExposant)) nomVersionAmbigu.add(kNomVersion);
    if (!byNom.has(nomKey(i.nomDuFlux))) byNom.set(nomKey(i.nomDuFlux), i);
  }
  return { byKey, byNomVersion, byNom, nomVersionAmbigu };
}

export function findInterfaceForConsommation(lookup: InterfaceLookup, c: Consommation): InterfaceCatalogue | undefined {
  const parOnglet = lookup.byKey.get(interfaceKey(c.feuille, c.nomDuFlux, c.version));
  if (parOnglet) return parOnglet;
  // Le repli par le nom ne joue que si ce nom ne désigne qu'un seul exposant.
  // Plusieurs, et le rattacher au premier ferait signer ce consommateur chez
  // quelqu'un qu'il n'a pas choisi : on ne résout pas, et le contrôle de
  // référence le dit clairement.
  const kNomVersion = nomVersionKey(c.nomDuFlux, c.version);
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
export function buildFlowInstances(model: ParsedModel, rang: number | null = null): FlowInstance[] {
  const acteurs = acteurByNom(model);
  const sensParType = new Map(model.typesFlux.map((t) => [t.type.trim(), t.sensRepresentation]));
  const lookup = buildInterfaceLookup(model);
  const flows: FlowInstance[] = [];

  for (const consommation of model.consommations) {
    const iface = findInterfaceForConsommation(lookup, consommation);
    if (!iface) continue;

    const sens = sensParType.get(iface.typeDeFlux.trim());
    if (!sens) continue;

    const exposantActeur = acteurs.get(iface.acteurExposant.trim());
    const consommateurActeur = acteurs.get(consommation.acteurConsommateur.trim());

    if (rang !== null) {
      const vivant = (v: ValiditePalier | undefined) =>
        v === undefined || estVivant(intervalleDeVie(model, v), rang);
      if (!vivant(iface) || !vivant(consommation) || !vivant(exposantActeur) || !vivant(consommateurActeur)) {
        continue;
      }
    }

    flows.push({
      interfaceNom: iface.nomDuFlux,
      version: iface.version,
      typeDeFlux: iface.typeDeFlux,
      exposant: iface.acteurExposant,
      consommateur: consommation.acteurConsommateur,
      sens,
      atténué: isATransformer(consommation.decision),
      iface,
      conso: consommation,
    });
  }

  return flows;
}

export type NodeKeyFn = (acteurNom: string) => NodeId;

export function identityNodeKey(acteurNom: string): NodeId {
  return acteurNom;
}

// Une chaîne vide est le sentinel "pas de nœud" : un acteur connu mais sans
// Groupe renseigné est absent des vues agrégées (§7.4), pas replié sur son
// propre nom — groupFlows() élimine les flux dont une extrémité y résout.
export function groupNodeKey(model: ParsedModel): NodeKeyFn {
  const acteurs = acteurByNom(model);
  return (nom: string) => {
    const acteur = acteurs.get(nom.trim());
    if (!acteur) return nom;
    return acteur.groupe.trim();
  };
}

export function platformDetailNodeKey(model: ParsedModel): NodeKeyFn {
  const acteurs = acteurByNom(model);
  return (nom: string) => {
    const acteur = acteurs.get(nom.trim());
    if (!acteur) return nom;
    // Un acteur d'un groupe « Plateforme » est détaillé sous son propre nom ;
    // tout le reste est replié sur son groupe.
    return acteurEstPlateforme(model, acteur) ? acteur.nom : acteur.groupe.trim();
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
  return { from: nodeKey(flow.exposant), to: nodeKey(flow.consommateur) };
}

// Le consommateur prend l'initiative : la pointe se pose à l'autre bout du
// trait, sur le fournisseur qu'il interroge.
const estTire = (flow: FlowInstance) => flow.sens === "consommateur-exposant";

export interface EdgeGroup {
  from: NodeId;
  to: NodeId;
  technologie: string;
  count: number;
  atténué: boolean;
  // La pointe se pose au DÉPART du trait : c'est le consommateur qui appelle.
  tire: boolean;
  // Les échanges rassemblés sous ce trait, dans l'ordre où ils se présentent et
  // sans doublon : c'est d'eux que le libellé tire son sens quand la
  // technologie n'est plus là pour le porter.
  noms: string[];
  // La criticité la PLUS FORTE des consommations rassemblées sous ce trait :
  // un trait qui porte un flux vital et deux flux ordinaires est vital.
  criticite?: string;
}

// L'ordre du vocabulaire, du plus critique au moins. On le lit dans la liste
// elle-même plutôt que d'en tenir une seconde : les deux divergeraient.
function rangDeCriticite(valeur: string): number {
  const i = VOCABULAIRE_CRITICITE.findIndex((v) => normalizeText(v) === normalizeText(valeur));
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
    const key = JSON.stringify([from, to, flow.typeDeFlux]);
    const nom = libelleInterface(flow.interfaceNom, flow.version);
    const existing = groups.get(key);
    if (existing) {
      existing.count += 1;
      existing.atténué = existing.atténué && flow.atténué;
      existing.criticite = laPlusForte(existing.criticite, flow.conso.criticite);
      if (!existing.noms.includes(nom)) existing.noms.push(nom);
    } else {
      groups.set(key, {
        from,
        to,
        technologie: flow.typeDeFlux,
        count: 1,
        atténué: flow.atténué,
        tire: estTire(flow),
        noms: [nom],
        criticite: flow.conso.criticite.trim() || undefined,
      });
    }
  }

  return [...groups.values()];
}

// Les deux lectures du parc. L'architecture répond à « par quoi ça passe », le
// fonctionnel à « qui alimente qui » : mêmes données, deux questions.
export type Mode = "architecture" | "fonctionnel";

// Le mode ne s'y lit plus (§ Lecture, fonctionnel.ts) : une vue qui agrège
// des flux déjà résolus au bon (rang, mode) n'a plus besoin de la redemander.
export interface AggregationOptions {
  compteurs: boolean;
  libelléArête?: LibelléArête;
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
    technologie: g.technologie,
    count: g.count,
    criticite: g.criticite,
    // Sans compteur on ne nomme que le tuyau, sauf si l'utilisateur a demandé
    // autre chose : « counters » décide du ×N, pas de ce qui est nommé.
    label:
      options.compteurs || (options.libelléArête ?? "technology") !== "technology"
        ? libelleCellule(g.technologie, g.count, g.noms, options.libelléArête ?? "technology")
        : g.technologie,
    atténué: g.atténué,
    tire: g.tire,
    noms: g.noms,
  }));
}

export function nodesFromEdges(
  edges: (GraphEdge | EdgeGroup)[],
  labelFor: (id: NodeId) => string,
  kindFor: (id: NodeId) => NodeKind,
  detailsFor: (id: NodeId) => { sousTitre?: string; description?: string } = () => ({})
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
