// elk-api.js est la seule API dont le code a besoin (construction, promesses,
// types) : 10 Ko, sans l'algorithme. elk.bundled.js contenait le même API
// PLUS une copie complète de l'algorithme pour son propre repli sans Worker
// -- une seconde copie, en plus de celle importée juste en dessous pour le
// vrai Worker du navigateur. En import(ant) l'API seule, l'algorithme n'est
// plus embarqué qu'une fois.
import ELK from "elkjs/lib/elk-api.js";
// Code source du worker GWT d'elkjs (l'algorithme lui-même), inliné en chaîne
// à la compilation (voir le plugin esbuild dans esbuild.build.mjs) pour
// pouvoir en faire une Blob URL au runtime sans jamais charger de fichier .js
// séparé. Cette même chaîne sert aussi de repli sans Worker (voir
// workerDeRepliNode ci-dessous) : c'est la seule copie de l'algorithme dans
// tout le livrable.
import elkWorkerSource from "elkjs/lib/elk-worker.min.js?raw";
import type { GraphNode, GraphEdge } from "../aggregation/core";

export interface LayoutNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge extends GraphEdge {
  points: { x: number; y: number }[];
  // Centre de la pastille, tel que placé par le moteur. Absent si l'arête n'a
  // pas de libellé ou si le moteur n'a rien renvoyé.
  labelCentreOf?: { x: number; y: number };
}

export interface LayoutResult {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
}

// --- Gabarit d'une boîte C4 ------------------------------------------------
//
// Largeur FIXE, hauteur variable selon le texte : c'est cette régularité de
// largeur qui rend une planche lisible, bien plus qu'une taille uniforme.
// Les métriques vivent ici parce que le placement doit connaître la taille des
// boîtes avant de les positionner ; le rendu les importe, jamais l'inverse.
// Gabarit C4 de draw.io, relevé dans sa source (Sidebar-C4.js) :
//   géométrie 240 x 120, texte centré, nom 16px gras, [Type] en dessous,
//   ligne vide, puis description 11px en #cccccc.
export const NODE_WIDTH = 240;
export const MIN_NODE_HEIGHT = 120;

export const NODE_PAD = 14;
export const NAME_LINE_HEIGHT = 21;
export const TYPE_LINE_HEIGHT = 16;
export const EMPTY_LINE_HEIGHT = 8;
export const DESC_LINE_HEIGHT = 14;

// Largeur utile pour la description, et approximation de la largeur d'un
// caractère à sa taille de rendu (9.5px).
const USABLE_WIDTH = NODE_WIDTH - 2 * NODE_PAD;
const DESC_CHAR_WIDTH = 5.6;
const MAX_DESC_LINES = 3;

// Le nom, ramené à ce qui tient dans la boîte. Sa largeur est fixe
// (LARGEUR_NOEUD) et le nom n'était ni mesuré ni tronqué, contrairement à la
// description : un nom long débordait, recouvrait la boîte voisine et se
// faisait couper par le cadre du dessin. L'icône et son écart se réservent
// leur place au passage.
const NAME_CHAR_WIDTH = 8.2;
const ICON_SLOT = 16 + 9;

export function truncatedName(label: string): string {
  const parCaractere = Math.max(4, Math.floor((USABLE_WIDTH - ICON_SLOT) / NAME_CHAR_WIDTH));
  return label.length <= parCaractere ? label : `${label.slice(0, parCaractere - 1).trimEnd()}…`;
}

// Découpe la description en lignes tenant dans la largeur utile, sans couper
// un mot. Au-delà du nombre de lignes admis, la dernière est tronquée.
export function descriptionLines(text: string | undefined): string[] {
  if (!text) return [];
  const parCaractere = Math.max(1, Math.floor(USABLE_WIDTH / DESC_CHAR_WIDTH));
  const rows: string[] = [];
  let courante = "";
  for (const word of text.split(/\s+/)) {
    const essai = courante ? `${courante} ${word}` : word;
    if (essai.length <= parCaractere) {
      courante = essai;
      continue;
    }
    if (courante) rows.push(courante);
    courante = word;
  }
  if (courante) rows.push(courante);
  if (rows.length <= MAX_DESC_LINES) return rows;
  const kept = rows.slice(0, MAX_DESC_LINES);
  kept[MAX_DESC_LINES - 1] = kept[MAX_DESC_LINES - 1].slice(0, parCaractere - 1).trimEnd() + "…";
  return kept;
}

// --- Gabarit d'une pastille de libellé -------------------------------------
// Déclarées à ELK, les tailles doivent être connues avant le placement : c'est
// lui qui positionne les libellés, en leur réservant de la place le long du
// tracé. Le rendu importe ces mesures pour dessiner exactement la même boîte.
export const CHIP_HEIGHT = 16;
const SUB_LINE_HEIGHT = 12;

// Largeur moyenne d'un caractère à la taille du libellé, dans la pile de
// polices du schéma. Sous-estimée, le texte déborde de la place qu'ELK lui a
// réservée -- c'est ICI que la taille du texte se paie.
const LABEL_CHAR_WIDTH = 6.2;

export function chipWidth(text: string): number {
  return text.length * LABEL_CHAR_WIDTH + 14;
}

// La technologie n'est rappelée sous le libellé que si celui-ci dit autre
// chose qu'elle : dans les vues agrégées le libellé EST la technologie.
export function subLabel(label: string | undefined, technology: string): string | undefined {
  if (!label) return undefined;
  const tech = technology.trim();
  return tech && !label.startsWith(tech) ? `[${tech}]` : undefined;
}

// Le disque de rappel de la technologie vit devant le texte : sa place se
// réserve ICI, avant le placement. Réservée trop courte, l'étiquette déborde
// de la boîte qu'ELK lui a gardée.
const DISC_WIDTH = 11;

export function chipSize(label: string | undefined, technology: string): { width: number; height: number } {
  if (!label) return { width: 0, height: 0 };
  const sous = subLabel(label, technology);
  const disc = technology.trim() !== "" ? DISC_WIDTH : 0;
  return {
    width: Math.max(chipWidth(label) + disc, sous ? chipWidth(sous) : 0),
    height: CHIP_HEIGHT + (sous ? SUB_LINE_HEIGHT : 0),
  };
}

export function nodeTextHeight(node: GraphNode): number {
  const rows = descriptionLines(node.description).length;
  return (
    NAME_LINE_HEIGHT +
    (node.subtitle ? TYPE_LINE_HEIGHT : 0) +
    (rows ? EMPTY_LINE_HEIGHT + rows * DESC_LINE_HEIGHT : 0)
  );
}

export function nodeHeight(node: GraphNode): number {
  return Math.max(MIN_NODE_HEIGHT, 2 * NODE_PAD + nodeTextHeight(node));
}

// elk-worker.min.js sait déjà se comporter en repli sans Worker : sa toute
// dernière fonction (dHd, visible en clair dans la version non minifiée,
// elk-worker.js) regarde à l'exécution si elle tourne dans un vrai Worker
// (`self` existe, `document` non -- elle branche alors self.onmessage
// directement) ou en CommonJS (`module.exports` existe -- elle y dépose une
// classe Worker de repli, qui exécute l'algorithme en mémoire et relie
// postMessage/onmessage à la main au lieu d'un vrai thread). C'est
// exactement ce que faisait elk.bundled.js pour Node, sauf qu'il embarquait
// pour cela sa propre copie de l'algorithme. En évaluant ici la MÊME chaîne
// déjà inlinée pour le Blob du vrai Worker, avec un `module` local pour
// déclencher la branche CommonJS, Node/jsdom obtient le même repli sans
// jamais dupliquer l'algorithme.
function nodeFallbackWorker(): new (url?: string) => Worker {
  const module = { exports: {} as { Worker?: new (url?: string) => Worker } };
  new Function("module", "exports", elkWorkerSource)(module, module.exports);
  const FakeWorker = module.exports.Worker;
  if (!FakeWorker) {
    throw new Error("elk-worker.min.js n'a pas exposé de Worker de repli (environnement inattendu).");
  }
  return FakeWorker;
}

// Sans Worker, elkjs calcule sur le thread principal et tranche son travail
// par setTimeout(fn, 0), avec une auto-interruption de l'algorithme toutes les
// ~2 s. Dans un onglet caché, Chrome ne relance ce setTimeout(0) qu'une fois
// par seconde environ (throttling) : chaque tranche de quelques ms de calcul
// attend alors une seconde pleine, quelle que soit la taille du graphe -- un
// export qui enchaîne des dizaines de mises en page en devient interminable
// dès que l'onglet passe en arrière-plan. Un vrai Worker tourne sur son propre
// thread, hors de portée de ce throttling.
//
// Un Worker a normalement besoin d'un fichier .js séparé, incompatible avec la
// contrainte d'un livrable en un seul .html. Le code source du worker GWT
// d'elkjs est donc inliné dans le bundle (import ci-dessus) et transformé en
// Blob URL au runtime : aucune requête réseau, aucun fichier annexe.
function elkFactory() {
  if (typeof Worker === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    // Node/jsdom (tests) : aucun Worker natif utilisable. On rejoue le repli
    // qu'elkjs sait construire lui-même pour ce cas (workerDeRepliNode) plutôt
    // que d'embarquer une seconde copie de l'algorithme pour l'obtenir.
    const FakeWorker = nodeFallbackWorker();
    return new ELK({ workerFactory: (u) => new FakeWorker(u) });
  }
  // elk-api.js (contrairement à l'ELKNode d'elk.bundled.js) construit lui-même
  // un vrai Worker dès qu'on lui fournit workerUrl, sans détection foireuse à
  // court-circuiter : plus besoin de fournir workerFactory ici.
  const url = URL.createObjectURL(new Blob([elkWorkerSource], { type: "text/javascript" }));
  return new ELK({ workerUrl: url });
}

const elk = elkFactory();

const MARGIN = 20;

// « layered » est l'implémentation moderne du schéma de Sugiyama : rangs,
// minimisation des croisements, puis routage. randomSeed fixe garantit que le
// même classeur redonne exactement le même schéma d'un export à l'autre.
const OPTIONS: Record<string, string> = {
  "elk.algorithm": "layered",
  "elk.direction": "RIGHT",
  "elk.randomSeed": "1",
  "elk.layered.thoroughness": "20",
  // Le greedy switch échange deux voisins quand ça retire des croisements. Sa
  // valeur par défaut TWO_SIDED ne s'applique PAS ici : la doc du source dit
  // que sous hierarchyHandling INCLUDE_CHILDREN c'est greedySwitchHierarchical
  // qui prend la main, et celui-là vaut OFF par défaut. Le seuil, lui, coupe
  // l'heuristique au-delà de 40 nœuds ; 0 la force.
  "elk.layered.crossingMinimization.greedySwitchHierarchical.type": "TWO_SIDED",
  "elk.layered.crossingMinimization.greedySwitch.activationThreshold": "0",
  // Liens à angle droit : c'est le routage qu'ELK sait faire en respectant les
  // contraintes de ports, et celui qui se lit le mieux sur un schéma
  // d'architecture. Il rend inutile tout l'évitement d'obstacles fait à la main.
  "elk.edgeRouting": "ORTHOGONAL",
  // Nécessaire dès qu'un nœud en contient d'autres : sans ça, une arête qui
  // traverse la frontière d'un groupe est routée n'importe comment. Le retirer
  // sur les vues à plat a été essayé : +25 % de croisements, +22 % de surface.
  "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  "elk.spacing.nodeNode": "40",
  "elk.layered.spacing.nodeNodeBetweenLayers": "70",
  "elk.spacing.edgeNode": "20",
  "elk.spacing.edgeEdge": "12",
  // ELK place lui-même les libellés d'arêtes et leur réserve de la place dans
  // le layout : le libellé tient sur son trait par construction, au lieu d'être
  // posé après coup puis écarté jusqu'à perdre le lien avec sa flèche.
  "elk.spacing.edgeLabel": "6",
  // Une boîte C4 fait 56 à 68 px de haut : sur un côté aussi court, un moyeu
  // qui reçoit onze flux ne PEUT pas écarter ses points d'accroche, et tout se
  // concentre en un point. On contraint donc la taille du nœud par ses ports :
  // la boîte grandit en hauteur autant qu'il faut pour les répartir, sans
  // jamais descendre sous le gabarit C4 (MINIMUM_SIZE).
  "elk.padding": `[top=${MARGIN},left=${MARGIN},bottom=${MARGIN},right=${MARGIN}]`,
};

// Ce qui a été mesuré pour resserrer la planche -- son rapport de forme atteint
// 3,6 sur la vue détaillée -- et ÉCARTÉ, faute d'un échange qui vaille :
//
//   - elk.aspectRatio vaut DÉJÀ 1.6 par défaut sous layered, et ne pilote que
//     l'empaquetage des composantes connexes : sur un graphe connexe il ne fait
//     rien, ce que la mesure confirme ;
//   - wrapping.strategy en SINGLE_EDGE ne change rien du tout ; en MULTI_EDGE
//     il ramène « plateforme seule » de 3,92 à 1,61, mais en passant de 2 à 5
//     croisements pour 36 % de surface en plus. Une planche plus carrée et plus
//     enchevêtrée est un mauvais échange ;
//   - layering.nodePromotion.strategy n'a rien changé sur les cinq vues ;
//   - compaction.postCompaction.strategy=LEFT gagnait 2 à 6 % de surface sans
//     un croisement de plus... et fait LEVER ELK sur un multigraphe
//     (« Invalid hitboxes for scanline constraint calculation »). Un plantage
//     ne s'achète pas avec 4 % de surface.
//
// Le levier qui reste est le zoom, livré par ailleurs.

type ReturnSide = "NORTH" | "SOUTH";

interface PortElk {
  id: string;
  width: number;
  height: number;
  layoutOptions: Record<string, string>;
}

// Place qu'occupe un trait sur la façade d'une boîte.
const PORT_SIZE = 4;

// Pas minimal entre deux accroches, et air réservée en haut et en bas de la face.
const PORT_STEP = 14;
const PORT_MARGIN = 10;

// Hauteur nécessaire pour aligner n traits sur une face.
function heightForPorts(n: number): number {
  return n <= 0 ? 0 : 2 * PORT_MARGIN + n * PORT_SIZE + (n - 1) * PORT_STEP;
}


// Les flux de même (cible, technologie, atténuation) sont fusionnés au rendu
// en un tronc unique. Pour que ça ait un sens géométrique, ils doivent
// converger : on leur donne ici un port d'entrée COMMUN, et c'est ELK qui les
// fait se rejoindre. Sans ce partage, chaque flux arrive sur son propre port
// et la « confluence » du rendu ne serait qu'une diagonale plaquée par-dessus
// un routage orthogonal.
function inputKey(edge: GraphEdge): string {
  return JSON.stringify([edge.to, edge.technology, edge.attenuated]);
}

interface ElkNode {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  ports?: PortElk[];
  children?: ElkNode[];
  layoutOptions?: Record<string, string>;
}

interface ElkSection {
  startPoint: { x: number; y: number };
  endPoint: { x: number; y: number };
  bendPoints?: { x: number; y: number }[];
}


interface LabelElk {
  text?: string;
  layoutOptions?: Record<string, string>;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

interface AreteElk {
  id: string;
  sources: string[];
  targets: string[];
  sourcePort?: string;
  targetPort?: string;
  sections?: ElkSection[];
  labels?: LabelElk[];
  // ELK reparente une arête dans le plus petit conteneur qui englobe ses deux
  // extrémités, et exprime alors ses coordonnées dans le repère de celui-ci.
  container?: string;
}

interface ElkGraph {
  id: string;
  layoutOptions?: Record<string, string>;
  ports?: PortElk[];
  children?: ElkNode[];
  edges?: AreteElk[];
  width?: number;
  height?: number;
}

// ELK positionne par le coin haut-gauche ; le reste du code raisonne en
// centre de boîte, plus commode pour exprimer un ancrage (vecteur depuis le
// centre) ou une borne (distance au centre) qu'un décalage depuis un coin.
function centreOf(n: ElkNode): { x: number; y: number } {
  return { x: (n.x ?? 0) + n.width / 2, y: (n.y ?? 0) + n.height / 2 };
}

function edgePoints(
  arete: AreteElk | undefined,
  start: LayoutNode,
  arrival: LayoutNode,
  offset: { x: number; y: number }
): { x: number; y: number }[] {
  const section = arete?.sections?.[0];
  if (!section) {
    // ELK n'a pas produit de tracé (cas dégénéré, p. ex. une boucle) : on
    // relie les deux centres, faute de mieux.
    return [
      { x: start.x, y: start.y },
      { x: arrival.x, y: arrival.y },
    ];
  }
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
    x: p.x + offset.x,
    y: p.y + offset.y,
  }));
}

type Point = { x: number; y: number };

// Nombre de PAIRES d'arêtes qui se croisent. C'est l'arbitre entre deux
// dispositions : un croisement est ce que le lecteur paie le plus cher.
function croisements(traces: Point[][]): number {
  const bounds = traces.map((pts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  });
  const side = (a: Point, b: Point, c: Point) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const cross = (a: Point, b: Point, c: Point, d: Point) =>
    side(a, b, c) !== side(a, b, d) && side(c, d, a) !== side(c, d, b);

  let total = 0;
  for (let i = 0; i < traces.length; i++) {
    for (let j = i + 1; j < traces.length; j++) {
      // Sans ce filtre par boîte englobante, le comptage est quadratique en
      // segments et fige le rendu sur les grandes vues.
      const A = bounds[i], B = bounds[j];
      if (A.x1 < B.x0 || B.x1 < A.x0 || A.y1 < B.y0 || B.y1 < A.y0) continue;
      const P = traces[i], Q = traces[j];
      let found = false;
      for (let k = 0; k + 1 < P.length && !found; k++) {
        for (let l = 0; l + 1 < Q.length; l++) {
          if (cross(P[k], P[k + 1], Q[l], Q[l + 1])) { found = true; break; }
        }
      }
      if (found) total++;
    }
  }
  return total;
}

// Marge intérieure d'une frontière, et place réservée en haut pour son
// libellé (posé en haut à gauche, convention C4).
const BOUNDARY_PAD = 24;
const BOUNDARY_HEADER = 22;

// La clé d'une arête, indépendante de son libellé : celui-ci porte le compteur
// « ×N », qui n'est pas le même sur l'union et sur un palier.
function edgeKey(e: { from: string; to: string; technology: string }): string {
  return JSON.stringify([e.from, e.to, e.technology]);
}

// Le placement de l'union, restreint à ce qu'un palier montre. Les positions ne
// sont PAS recalculées : c'est tout l'objet -- une boîte présente aux deux
// paliers ne bouge pas d'un pixel. Les libellés, eux, viennent de la vue du
// palier : « HTTP ×2 » à v1 n'est pas « HTTP ×3 » à v2.
export function restrictLayout(union: LayoutResult, view: { nodes: GraphNode[]; edges: GraphEdge[] }): LayoutResult {
  const liveIds = new Set(view.nodes.map((n) => n.id));
  const liveEdges = new Map(view.edges.map((e) => [edgeKey(e), e]));
  return {
    // La taille reste celle de l'UNION : c'est ce qui garde le cadre immobile
    // d'un palier à l'autre, et donc les boîtes à la même place à l'écran.
    width: union.width,
    height: union.height,
    nodes: union.nodes.filter((n) => liveIds.has(n.id) || n.kind === "boundary"),
    edges: union.edges
      .filter((e) => liveEdges.has(edgeKey(e)))
      .map((e) => {
        const live = liveEdges.get(edgeKey(e))!;
        return { ...e, label: live.label, count: live.count, names: live.names, attenuated: live.attenuated, change: live.change };
      }),
  };
}

export async function computeLayout(nodes: GraphNode[], edges: GraphEdge[]): Promise<LayoutResult> {
  // Deux règles de lecture, portées par des ports posés aux deux bouts des
  // arêtes de RETOUR (celles dont la source est plus à droite que la cible) :
  //
  //   - on sort toujours par la droite      -> port EAST côté source ;
  //   - la droite étant réservée aux sorties, un flux qui vient de la droite
  //     entre par le haut ou par le bas     -> port NORTH/SOUTH côté cible.
  //
  // ELK sait faire les deux : NorthSouthPortPreprocessor insère un nœud fictif
  // au-dessus ou au-dessous de la cible, et InvertedPortProcessor fait
  // contourner le nœud source -- une arête de retour étant inversée au cycle
  // breaking, son port de sortie est un port « inversé ». La précondition des
  // deux est la même : « nodes have fixed port sides », d'où FIXED_SIDE.
  const buildElkNode = (node: GraphNode, retours: Map<number, ReturnSide>): ElkNode => {
      // Seules les arêtes de retour portent des ports. Les déclarer sur TOUTES
      // les arêtes a été essayé et mesuré : la vue groupe y gagne 6 croisements,
      // mais « Par acteur » en prend 10 de plus et la vue détaillée 30, pour
      // 14 % de surface en plus. Les autres arêtes suivent donc PortSideProcessor.
      const ports: PortElk[] = [];
      for (const [i, side] of retours) {
        if (edges[i].to === node.id) {
          ports.push({ id: `pe${i}`, width: PORT_SIZE, height: PORT_SIZE, layoutOptions: { "elk.port.side": side } });
        }

      }
      // La hauteur est celle du côté le PLUS chargé, pas la somme des deux.
      // Laissée à ELK (nodeSize.constraints PORTS), elle additionnait les deux
      // façades : la boîte doublait de hauteur, aux deux tiers vide.
      const nWest = new Set(edges.filter((e) => e.to === node.id).map(inputKey)).size;
      const nEast = edges.filter((e) => e.from === node.id).length;
      const height = Math.max(nodeHeight(node), heightForPorts(Math.max(nWest, nEast)));
      return {
        id: node.id,
        width: NODE_WIDTH,
        height: height,
        // Option NODALE : posée sur le graphe, elle ne descendrait pas
        // jusqu'aux nœuds. Une boîte C4 fait 56 à 68 px de haut ; un moyeu qui
        // reçoit onze flux ne peut pas les écarter sur une façade si courte, et
        // tout se concentre en un point.
        ports: ports.length ? ports : undefined,
        layoutOptions: {
          ...(ports.length ? { "elk.portConstraints": "FIXED_SIDE" } : {}),
          "elk.nodeSize.constraints": "MINIMUM_SIZE",
          "elk.nodeSize.minimum": `(${NODE_WIDTH},${height})`,
        },
      };
  };

  const childrenOf = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!node.parent) continue;
    const list = childrenOf.get(node.parent) ?? [];
    list.push(node);
    childrenOf.set(node.parent, list);
  }

  const buildElkGraph = (retours: Map<number, ReturnSide>): ElkGraph => ({
    id: "root",
    layoutOptions: OPTIONS,
    children: nodes
      .filter((node) => !node.parent)
      .map((node) => {
        const enfants = childrenOf.get(node.id);
        if (!enfants) return buildElkNode(node, retours);
        // Une frontière n'a pas de taille propre : ELK la dimensionne d'après
        // ses enfants. On réserve seulement la marge et la hauteur du libellé.
        return {
          id: node.id,
          width: 0,
          height: 0,
          layoutOptions: {
            "elk.padding": `[top=${BOUNDARY_HEADER + BOUNDARY_PAD},left=${BOUNDARY_PAD},bottom=${BOUNDARY_PAD},right=${BOUNDARY_PAD}]`,
          },
          children: enfants.map((child) => buildElkNode(child, retours)),
        } as ElkNode;
      }),
    // Un identifiant par arête, indépendant du couple (from, to) : deux flux
    // de technologies différentes relient les mêmes nœuds et doivent rester
    // deux arêtes distinctes.
    edges: edges.map((edge, i) => {
      const size = chipSize(edge.label, edge.technology);
      return {
        id: `e${i}`,
        sources: [edge.from],
        // Format « extended edge » : l'identifiant du PORT se met dans le
        // tableau, à la place de celui du nœud. Le champ targetPort n'existe
        // que pour les « primitive edges » (source/target au singulier) et est
        // ignoré en silence ici -- ELK posait alors le port au bon endroit mais
        // raccordait l'arête au nœud, donc à sa façade ouest.
        targets: [retours.has(i) ? `pe${i}` : edge.to],

        // Ces options s'appliquent AU LIBELLÉ, pas au graphe.
        labels: edge.label
          ? [
              {
                text: edge.label,
                width: size.width,
                height: size.height,
                layoutOptions: {
                  "elk.edgeLabels.placement": "CENTER",
                  // Le libellé est posé SUR le trait, pas à côté. La
                  // documentation le conditionne à ce que le rendu empêche le
                  // trait de le traverser : c'est exactement ce que fait
                  // interrompreLeTrace, qui ouvre un blanc à sa place.
                  "elk.edgeLabels.inline": "true",
                },
              },
            ]
          : undefined,
      };
    }),
  });

  // Les types publiés par elkjs décrivent mal le graphe d'entrée/sortie ; on
  // passe par unknown plutôt que de plier notre modèle aux leurs.
  const apply = async (retours: Map<number, ReturnSide>) =>
    (await elk.layout(buildElkGraph(retours) as unknown as never)) as unknown as ElkGraph;

  // ELK place un enfant RELATIVEMENT à son parent : on cumule les décalages
  // pour ramener tout le monde dans le même repère que les arêtes.
  const aplatirEn = (r: ElkGraph) => {
    const m = new Map<string, ElkNode>();
    const walk = (list: ElkNode[] | undefined, dx: number, dy: number) => {
      for (const n of list ?? []) {
        const absolute = { ...n, x: (n.x ?? 0) + dx, y: (n.y ?? 0) + dy };
        m.set(n.id, absolute);
        walk(n.children, absolute.x, absolute.y);
      }
    };
    walk(r.children, 0, 0);
    return m;
  };

  // Une PRÉFÉRENCE, pas une règle : mieux vaut entrer par le haut ou par le bas
  // que par la droite, mais pas au prix du dessin. On pose donc librement, on
  // regarde qui entre malgré tout par la droite, on repose en redirigeant
  // ceux-là, et on garde la seconde disposition seulement si elle ne coûte pas
  // plus de croisements qu'elle ne redresse d'arêtes. Imposée sans ce garde-fou,
  // la redirection créait à elle seule 28 croisements sur une vue qui n'en avait
  // aucun.
  const BUDGET_PAR_ARETE = 1;

  const freeOnes = await apply(new Map());
  const freeIds = aplatirEn(freeOnes);

  // Face par laquelle une arête aboutit sur sa cible, dans une disposition
  // donnée. Seule « EAST » nous intéresse : c'est la face réservée aux sorties.
  const entersFromEast = (r: ElkGraph, ids: Map<string, ElkNode>, i: number): boolean => {
    const arete = (r.edges ?? []).find((e) => e.id === `e${i}`);
    const end = arete?.sections?.[0]?.endPoint;
    const target = ids.get(edges[i].to);
    if (!end || !target) return false;
    const container = arete?.container ? ids.get(arete.container) : undefined;
    const x = end.x + (container?.x ?? 0);
    const y = end.y + (container?.y ?? 0);
    const left = target.x ?? 0;
    const top = target.y ?? 0;
    if (y < top || y > top + target.height) return false;
    return Math.abs(x - (left + target.width)) < Math.abs(x - left);
  };

  // Polyligne de chaque arête, dans le repère du graphe : de quoi comparer deux
  // dispositions avant d'en choisir une.
  const traces = (r: ElkGraph, ids: Map<string, ElkNode>): Point[][] =>
    (r.edges ?? []).map((arete) => {
      const section = arete.sections?.[0];
      if (!section) return [];
      const container = arete.container ? ids.get(arete.container) : undefined;
      const dx = container?.x ?? 0;
      const dy = container?.y ?? 0;
      return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
        x: p.x + dx,
        y: p.y + dy,
      }));
    });

  const retours = new Map<number, ReturnSide>();
  edges.forEach((edge, i) => {
    if (!entersFromEast(freeOnes, freeIds, i)) return;
    const source = freeIds.get(edge.from);
    const target = freeIds.get(edge.to);
    if (!source || !target) return;
    // Par le haut ou par le bas « suivant par où elle passe » : du côté d'où
    // vient le flux.
    const side = (source.y ?? 0) + source.height / 2 <= (target.y ?? 0) + target.height / 2;
    retours.set(i, side ? "NORTH" : "SOUTH");
  });

  let result = freeOnes;
  let parId = freeIds;


  if (retours.size > 0) {
    const oriented = await apply(retours);
    const orientedIds = aplatirEn(oriented);
    const before = croisements(traces(freeOnes, freeIds));
    const after = croisements(traces(oriented, orientedIds));
    if (after <= before + BUDGET_PAR_ARETE * retours.size) {
      result = oriented;
      parId = orientedIds;
    }
  }

  const layoutNodes: LayoutNode[] = nodes.map((node) => {
    const n = parId.get(node.id);
    const width = n?.width ?? NODE_WIDTH;
    const height = n?.height ?? nodeHeight(node);
    const c = n ? centreOf(n) : { x: 0, y: 0 };
    return { ...node, x: c.x, y: c.y, width: width, height: height };
  });

  const nodesById = new Map(layoutNodes.map((n) => [n.id, n]));
  const edgesById = new Map((result.edges ?? []).map((e) => [e.id, e]));

  // Origine du repère dans lequel une arête est exprimée : celle de son
  // conteneur quand ELK l'y a reparentée, l'origine du graphe sinon. Sans ce
  // décalage, un flux interne à la frontière était dessiné à côté de ses deux
  // nœuds -- un trait qui part et arrive dans le vide.
  const originOf = (arete: AreteElk | undefined): { x: number; y: number } => {
    const container = arete?.container ? parId.get(arete.container) : undefined;
    return container ? { x: container.x ?? 0, y: container.y ?? 0 } : { x: 0, y: 0 };
  };

  const layoutEdges: LayoutEdge[] = edges.map((edge, i) => {
    const start = nodesById.get(edge.from);
    const arrival = nodesById.get(edge.to);
    if (!start || !arrival) return { ...edge, points: [] };
    const arete = edgesById.get(`e${i}`);
    const offset = originOf(arete);
    const tag = arete?.labels?.[0];
    return {
      ...edge,
      points: edgePoints(arete, start, arrival, offset),
      labelCentreOf:
        tag && tag.x !== undefined && tag.y !== undefined
          ? {
              x: tag.x + (tag.width ?? 0) / 2 + offset.x,
              y: tag.y + (tag.height ?? 0) / 2 + offset.y,
            }
          : undefined,
    };
  });

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: result.width ?? 400,
    height: result.height ?? 300,
  };
}
