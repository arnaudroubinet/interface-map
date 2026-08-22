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
  centreLibellé?: { x: number; y: number };
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
export const LARGEUR_NOEUD = 240;
export const HAUTEUR_MIN_NOEUD = 120;

export const PAD_NOEUD = 14;
export const HAUTEUR_LIGNE_NOM = 21;
export const HAUTEUR_LIGNE_TYPE = 16;
export const HAUTEUR_LIGNE_VIDE = 8;
export const HAUTEUR_LIGNE_DESC = 14;

// Largeur utile pour la description, et approximation de la largeur d'un
// caractère à sa taille de rendu (9.5px).
const LARGEUR_UTILE = LARGEUR_NOEUD - 2 * PAD_NOEUD;
const LARGEUR_CARACTERE_DESC = 5.6;
const MAX_LIGNES_DESC = 3;

// Le nom, ramené à ce qui tient dans la boîte. Sa largeur est fixe
// (LARGEUR_NOEUD) et le nom n'était ni mesuré ni tronqué, contrairement à la
// description : un nom long débordait, recouvrait la boîte voisine et se
// faisait couper par le cadre du dessin. L'icône et son écart se réservent
// leur place au passage.
const LARGEUR_CARACTERE_NOM = 8.2;
const PLACE_ICONE = 16 + 9;

export function nomTronque(label: string): string {
  const parCaractere = Math.max(4, Math.floor((LARGEUR_UTILE - PLACE_ICONE) / LARGEUR_CARACTERE_NOM));
  return label.length <= parCaractere ? label : `${label.slice(0, parCaractere - 1).trimEnd()}…`;
}

// Découpe la description en lignes tenant dans la largeur utile, sans couper
// un mot. Au-delà du nombre de lignes admis, la dernière est tronquée.
export function lignesDescription(texte: string | undefined): string[] {
  if (!texte) return [];
  const parCaractere = Math.max(1, Math.floor(LARGEUR_UTILE / LARGEUR_CARACTERE_DESC));
  const lignes: string[] = [];
  let courante = "";
  for (const mot of texte.split(/\s+/)) {
    const essai = courante ? `${courante} ${mot}` : mot;
    if (essai.length <= parCaractere) {
      courante = essai;
      continue;
    }
    if (courante) lignes.push(courante);
    courante = mot;
  }
  if (courante) lignes.push(courante);
  if (lignes.length <= MAX_LIGNES_DESC) return lignes;
  const gardées = lignes.slice(0, MAX_LIGNES_DESC);
  gardées[MAX_LIGNES_DESC - 1] = gardées[MAX_LIGNES_DESC - 1].slice(0, parCaractere - 1).trimEnd() + "…";
  return gardées;
}

// --- Gabarit d'une pastille de libellé -------------------------------------
// Déclarées à ELK, les tailles doivent être connues avant le placement : c'est
// lui qui positionne les libellés, en leur réservant de la place le long du
// tracé. Le rendu importe ces mesures pour dessiner exactement la même boîte.
export const HAUTEUR_PASTILLE = 15;
const HAUTEUR_SOUS_LIGNE = 10;

export function largeurPastille(texte: string): number {
  return texte.length * 5.6 + 14;
}

// La technologie n'est rappelée sous le libellé que si celui-ci dit autre
// chose qu'elle : dans les vues agrégées le libellé EST la technologie.
export function sousLibellé(label: string | undefined, technologie: string): string | undefined {
  if (!label) return undefined;
  const tech = technologie.trim();
  return tech && !label.startsWith(tech) ? `[${tech}]` : undefined;
}

// Le disque de rappel de la technologie vit devant le texte : sa place se
// réserve ICI, avant le placement. Réservée trop courte, l'étiquette déborde
// de la boîte qu'ELK lui a gardée.
const LARGEUR_DISQUE = 11;

export function taillePastille(label: string | undefined, technologie: string): { width: number; height: number } {
  if (!label) return { width: 0, height: 0 };
  const sous = sousLibellé(label, technologie);
  const disque = technologie.trim() !== "" ? LARGEUR_DISQUE : 0;
  return {
    width: Math.max(largeurPastille(label) + disque, sous ? largeurPastille(sous) : 0),
    height: HAUTEUR_PASTILLE + (sous ? HAUTEUR_SOUS_LIGNE : 0),
  };
}

export function hauteurTexteNoeud(node: GraphNode): number {
  const lignes = lignesDescription(node.description).length;
  return (
    HAUTEUR_LIGNE_NOM +
    (node.sousTitre ? HAUTEUR_LIGNE_TYPE : 0) +
    (lignes ? HAUTEUR_LIGNE_VIDE + lignes * HAUTEUR_LIGNE_DESC : 0)
  );
}

export function hauteurNoeud(node: GraphNode): number {
  return Math.max(HAUTEUR_MIN_NOEUD, 2 * PAD_NOEUD + hauteurTexteNoeud(node));
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
function workerDeRepliNode(): new (url?: string) => Worker {
  const module = { exports: {} as { Worker?: new (url?: string) => Worker } };
  new Function("module", "exports", elkWorkerSource)(module, module.exports);
  const FauxWorker = module.exports.Worker;
  if (!FauxWorker) {
    throw new Error("elk-worker.min.js n'a pas exposé de Worker de repli (environnement inattendu).");
  }
  return FauxWorker;
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
function fabriqueElk() {
  if (typeof Worker === "undefined" || typeof URL === "undefined" || !URL.createObjectURL) {
    // Node/jsdom (tests) : aucun Worker natif utilisable. On rejoue le repli
    // qu'elkjs sait construire lui-même pour ce cas (workerDeRepliNode) plutôt
    // que d'embarquer une seconde copie de l'algorithme pour l'obtenir.
    const FauxWorker = workerDeRepliNode();
    return new ELK({ workerFactory: (u) => new FauxWorker(u) });
  }
  // elk-api.js (contrairement à l'ELKNode d'elk.bundled.js) construit lui-même
  // un vrai Worker dès qu'on lui fournit workerUrl, sans détection foireuse à
  // court-circuiter : plus besoin de fournir workerFactory ici.
  const url = URL.createObjectURL(new Blob([elkWorkerSource], { type: "text/javascript" }));
  return new ELK({ workerUrl: url });
}

const elk = fabriqueElk();

const MARGE = 20;

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
  "elk.padding": `[top=${MARGE},left=${MARGE},bottom=${MARGE},right=${MARGE}]`,
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

type CôtéRetour = "NORTH" | "SOUTH";

interface PortElk {
  id: string;
  width: number;
  height: number;
  layoutOptions: Record<string, string>;
}

// Place qu'occupe un trait sur la façade d'une boîte.
const TAILLE_ACCROCHE = 4;

// Pas minimal entre deux accroches, et air réservée en haut et en bas de la face.
const PAS_ACCROCHE = 14;
const MARGE_ACCROCHES = 10;

// Hauteur nécessaire pour aligner n traits sur une face.
function hauteurPourAccroches(n: number): number {
  return n <= 0 ? 0 : 2 * MARGE_ACCROCHES + n * TAILLE_ACCROCHE + (n - 1) * PAS_ACCROCHE;
}


// Les flux de même (cible, technologie, atténuation) sont fusionnés au rendu
// en un tronc unique. Pour que ça ait un sens géométrique, ils doivent
// converger : on leur donne ici un port d'entrée COMMUN, et c'est ELK qui les
// fait se rejoindre. Sans ce partage, chaque flux arrive sur son propre port
// et la « confluence » du rendu ne serait qu'une diagonale plaquée par-dessus
// un routage orthogonal.
function cléEntrée(edge: GraphEdge): string {
  return JSON.stringify([edge.to, edge.technologie, edge.atténué]);
}

interface NoeudElk {
  id: string;
  width: number;
  height: number;
  x?: number;
  y?: number;
  ports?: PortElk[];
  children?: NoeudElk[];
  layoutOptions?: Record<string, string>;
}

interface SectionElk {
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
  sections?: SectionElk[];
  labels?: LabelElk[];
  // ELK reparente une arête dans le plus petit conteneur qui englobe ses deux
  // extrémités, et exprime alors ses coordonnées dans le repère de celui-ci.
  container?: string;
}

interface GrapheElk {
  id: string;
  layoutOptions?: Record<string, string>;
  ports?: PortElk[];
  children?: NoeudElk[];
  edges?: AreteElk[];
  width?: number;
  height?: number;
}

// ELK positionne par le coin haut-gauche ; le reste du code raisonne en
// centre de boîte, plus commode pour exprimer un ancrage (vecteur depuis le
// centre) ou une borne (distance au centre) qu'un décalage depuis un coin.
function centre(n: NoeudElk): { x: number; y: number } {
  return { x: (n.x ?? 0) + n.width / 2, y: (n.y ?? 0) + n.height / 2 };
}

function pointsDeLArete(
  arete: AreteElk | undefined,
  départ: LayoutNode,
  arrivée: LayoutNode,
  décalage: { x: number; y: number }
): { x: number; y: number }[] {
  const section = arete?.sections?.[0];
  if (!section) {
    // ELK n'a pas produit de tracé (cas dégénéré, p. ex. une boucle) : on
    // relie les deux centres, faute de mieux.
    return [
      { x: départ.x, y: départ.y },
      { x: arrivée.x, y: arrivée.y },
    ];
  }
  return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
    x: p.x + décalage.x,
    y: p.y + décalage.y,
  }));
}

type Point = { x: number; y: number };

// Nombre de PAIRES d'arêtes qui se croisent. C'est l'arbitre entre deux
// dispositions : un croisement est ce que le lecteur paie le plus cher.
function croisements(tracés: Point[][]): number {
  const bornes = tracés.map((pts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x);
      y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
    }
    return { x0, y0, x1, y1 };
  });
  const côté = (a: Point, b: Point, c: Point) =>
    Math.sign((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
  const seCroisent = (a: Point, b: Point, c: Point, d: Point) =>
    côté(a, b, c) !== côté(a, b, d) && côté(c, d, a) !== côté(c, d, b);

  let total = 0;
  for (let i = 0; i < tracés.length; i++) {
    for (let j = i + 1; j < tracés.length; j++) {
      // Sans ce filtre par boîte englobante, le comptage est quadratique en
      // segments et fige le rendu sur les grandes vues.
      const A = bornes[i], B = bornes[j];
      if (A.x1 < B.x0 || B.x1 < A.x0 || A.y1 < B.y0 || B.y1 < A.y0) continue;
      const P = tracés[i], Q = tracés[j];
      let trouvé = false;
      for (let k = 0; k + 1 < P.length && !trouvé; k++) {
        for (let l = 0; l + 1 < Q.length; l++) {
          if (seCroisent(P[k], P[k + 1], Q[l], Q[l + 1])) { trouvé = true; break; }
        }
      }
      if (trouvé) total++;
    }
  }
  return total;
}

// Marge intérieure d'une frontière, et place réservée en haut pour son
// libellé (posé en haut à gauche, convention C4).
const PAD_FRONTIERE = 24;
const ENTETE_FRONTIERE = 22;

// La clé d'une arête, indépendante de son libellé : celui-ci porte le compteur
// « ×N », qui n'est pas le même sur l'union et sur un palier.
function cléArête(e: { from: string; to: string; technologie: string }): string {
  return JSON.stringify([e.from, e.to, e.technologie]);
}

// Le placement de l'union, restreint à ce qu'un palier montre. Les positions ne
// sont PAS recalculées : c'est tout l'objet -- une boîte présente aux deux
// paliers ne bouge pas d'un pixel. Les libellés, eux, viennent de la vue du
// palier : « HTTP ×2 » à v1 n'est pas « HTTP ×3 » à v2.
export function restreindreLayout(union: LayoutResult, vue: { nodes: GraphNode[]; edges: GraphEdge[] }): LayoutResult {
  const idsVivants = new Set(vue.nodes.map((n) => n.id));
  const arêtesVivantes = new Map(vue.edges.map((e) => [cléArête(e), e]));
  return {
    // La taille reste celle de l'UNION : c'est ce qui garde le cadre immobile
    // d'un palier à l'autre, et donc les boîtes à la même place à l'écran.
    width: union.width,
    height: union.height,
    nodes: union.nodes.filter((n) => idsVivants.has(n.id) || n.kind === "frontiere"),
    edges: union.edges
      .filter((e) => arêtesVivantes.has(cléArête(e)))
      .map((e) => {
        const vivante = arêtesVivantes.get(cléArête(e))!;
        return { ...e, label: vivante.label, count: vivante.count, noms: vivante.noms, atténué: vivante.atténué, ecart: vivante.ecart };
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
  const construireNoeud = (node: GraphNode, retours: Map<number, CôtéRetour>): NoeudElk => {
      // Seules les arêtes de retour portent des ports. Les déclarer sur TOUTES
      // les arêtes a été essayé et mesuré : la vue groupe y gagne 6 croisements,
      // mais « Par acteur » en prend 10 de plus et la vue détaillée 30, pour
      // 14 % de surface en plus. Les autres arêtes suivent donc PortSideProcessor.
      const ports: PortElk[] = [];
      for (const [i, côté] of retours) {
        if (edges[i].to === node.id) {
          ports.push({ id: `pe${i}`, width: TAILLE_ACCROCHE, height: TAILLE_ACCROCHE, layoutOptions: { "elk.port.side": côté } });
        }

      }
      // La hauteur est celle du côté le PLUS chargé, pas la somme des deux.
      // Laissée à ELK (nodeSize.constraints PORTS), elle additionnait les deux
      // façades : la boîte doublait de hauteur, aux deux tiers vide.
      const nOuest = new Set(edges.filter((e) => e.to === node.id).map(cléEntrée)).size;
      const nEst = edges.filter((e) => e.from === node.id).length;
      const hauteur = Math.max(hauteurNoeud(node), hauteurPourAccroches(Math.max(nOuest, nEst)));
      return {
        id: node.id,
        width: LARGEUR_NOEUD,
        height: hauteur,
        // Option NODALE : posée sur le graphe, elle ne descendrait pas
        // jusqu'aux nœuds. Une boîte C4 fait 56 à 68 px de haut ; un moyeu qui
        // reçoit onze flux ne peut pas les écarter sur une façade si courte, et
        // tout se concentre en un point.
        ports: ports.length ? ports : undefined,
        layoutOptions: {
          ...(ports.length ? { "elk.portConstraints": "FIXED_SIDE" } : {}),
          "elk.nodeSize.constraints": "MINIMUM_SIZE",
          "elk.nodeSize.minimum": `(${LARGEUR_NOEUD},${hauteur})`,
        },
      };
  };

  const enfantsDe = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    if (!node.parent) continue;
    const liste = enfantsDe.get(node.parent) ?? [];
    liste.push(node);
    enfantsDe.set(node.parent, liste);
  }

  const construireGraphe = (retours: Map<number, CôtéRetour>): GrapheElk => ({
    id: "root",
    layoutOptions: OPTIONS,
    children: nodes
      .filter((node) => !node.parent)
      .map((node) => {
        const enfants = enfantsDe.get(node.id);
        if (!enfants) return construireNoeud(node, retours);
        // Une frontière n'a pas de taille propre : ELK la dimensionne d'après
        // ses enfants. On réserve seulement la marge et la hauteur du libellé.
        return {
          id: node.id,
          width: 0,
          height: 0,
          layoutOptions: {
            "elk.padding": `[top=${ENTETE_FRONTIERE + PAD_FRONTIERE},left=${PAD_FRONTIERE},bottom=${PAD_FRONTIERE},right=${PAD_FRONTIERE}]`,
          },
          children: enfants.map((enfant) => construireNoeud(enfant, retours)),
        } as NoeudElk;
      }),
    // Un identifiant par arête, indépendant du couple (from, to) : deux flux
    // de technologies différentes relient les mêmes nœuds et doivent rester
    // deux arêtes distinctes.
    edges: edges.map((edge, i) => {
      const taille = taillePastille(edge.label, edge.technologie);
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
                width: taille.width,
                height: taille.height,
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
  const poser = async (retours: Map<number, CôtéRetour>) =>
    (await elk.layout(construireGraphe(retours) as unknown as never)) as unknown as GrapheElk;

  // ELK place un enfant RELATIVEMENT à son parent : on cumule les décalages
  // pour ramener tout le monde dans le même repère que les arêtes.
  const aplatirEn = (r: GrapheElk) => {
    const m = new Map<string, NoeudElk>();
    const parcourir = (liste: NoeudElk[] | undefined, dx: number, dy: number) => {
      for (const n of liste ?? []) {
        const absolu = { ...n, x: (n.x ?? 0) + dx, y: (n.y ?? 0) + dy };
        m.set(n.id, absolu);
        parcourir(n.children, absolu.x, absolu.y);
      }
    };
    parcourir(r.children, 0, 0);
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

  const libre = await poser(new Map());
  const idsLibre = aplatirEn(libre);

  // Face par laquelle une arête aboutit sur sa cible, dans une disposition
  // donnée. Seule « EAST » nous intéresse : c'est la face réservée aux sorties.
  const entreParLEst = (r: GrapheElk, ids: Map<string, NoeudElk>, i: number): boolean => {
    const arete = (r.edges ?? []).find((e) => e.id === `e${i}`);
    const fin = arete?.sections?.[0]?.endPoint;
    const cible = ids.get(edges[i].to);
    if (!fin || !cible) return false;
    const conteneur = arete?.container ? ids.get(arete.container) : undefined;
    const x = fin.x + (conteneur?.x ?? 0);
    const y = fin.y + (conteneur?.y ?? 0);
    const gauche = cible.x ?? 0;
    const haut = cible.y ?? 0;
    if (y < haut || y > haut + cible.height) return false;
    return Math.abs(x - (gauche + cible.width)) < Math.abs(x - gauche);
  };

  // Polyligne de chaque arête, dans le repère du graphe : de quoi comparer deux
  // dispositions avant d'en choisir une.
  const tracés = (r: GrapheElk, ids: Map<string, NoeudElk>): Point[][] =>
    (r.edges ?? []).map((arete) => {
      const section = arete.sections?.[0];
      if (!section) return [];
      const conteneur = arete.container ? ids.get(arete.container) : undefined;
      const dx = conteneur?.x ?? 0;
      const dy = conteneur?.y ?? 0;
      return [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map((p) => ({
        x: p.x + dx,
        y: p.y + dy,
      }));
    });

  const retours = new Map<number, CôtéRetour>();
  edges.forEach((edge, i) => {
    if (!entreParLEst(libre, idsLibre, i)) return;
    const source = idsLibre.get(edge.from);
    const cible = idsLibre.get(edge.to);
    if (!source || !cible) return;
    // Par le haut ou par le bas « suivant par où elle passe » : du côté d'où
    // vient le flux.
    const côté = (source.y ?? 0) + source.height / 2 <= (cible.y ?? 0) + cible.height / 2;
    retours.set(i, côté ? "NORTH" : "SOUTH");
  });

  let résultat = libre;
  let parId = idsLibre;


  if (retours.size > 0) {
    const orienté = await poser(retours);
    const idsOrienté = aplatirEn(orienté);
    const avant = croisements(tracés(libre, idsLibre));
    const après = croisements(tracés(orienté, idsOrienté));
    if (après <= avant + BUDGET_PAR_ARETE * retours.size) {
      résultat = orienté;
      parId = idsOrienté;
    }
  }

  const layoutNodes: LayoutNode[] = nodes.map((node) => {
    const n = parId.get(node.id);
    const largeur = n?.width ?? LARGEUR_NOEUD;
    const hauteur = n?.height ?? hauteurNoeud(node);
    const c = n ? centre(n) : { x: 0, y: 0 };
    return { ...node, x: c.x, y: c.y, width: largeur, height: hauteur };
  });

  const noeudsParId = new Map(layoutNodes.map((n) => [n.id, n]));
  const arêtesParId = new Map((résultat.edges ?? []).map((e) => [e.id, e]));

  // Origine du repère dans lequel une arête est exprimée : celle de son
  // conteneur quand ELK l'y a reparentée, l'origine du graphe sinon. Sans ce
  // décalage, un flux interne à la frontière était dessiné à côté de ses deux
  // nœuds -- un trait qui part et arrive dans le vide.
  const origineDe = (arete: AreteElk | undefined): { x: number; y: number } => {
    const conteneur = arete?.container ? parId.get(arete.container) : undefined;
    return conteneur ? { x: conteneur.x ?? 0, y: conteneur.y ?? 0 } : { x: 0, y: 0 };
  };

  const layoutEdges: LayoutEdge[] = edges.map((edge, i) => {
    const départ = noeudsParId.get(edge.from);
    const arrivée = noeudsParId.get(edge.to);
    if (!départ || !arrivée) return { ...edge, points: [] };
    const arete = arêtesParId.get(`e${i}`);
    const décalage = origineDe(arete);
    const étiquette = arete?.labels?.[0];
    return {
      ...edge,
      points: pointsDeLArete(arete, départ, arrivée, décalage),
      centreLibellé:
        étiquette && étiquette.x !== undefined && étiquette.y !== undefined
          ? {
              x: étiquette.x + (étiquette.width ?? 0) / 2 + décalage.x,
              y: étiquette.y + (étiquette.height ?? 0) / 2 + décalage.y,
            }
          : undefined,
    };
  });

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    width: résultat.width ?? 400,
    height: résultat.height ?? 300,
  };
}
