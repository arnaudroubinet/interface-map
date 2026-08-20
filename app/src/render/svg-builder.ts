import { ICONES, ICONE_PAR_DEFAUT } from "./icones";
import type { LayoutResult, LayoutEdge, LayoutNode } from "../layout/graph-layout";
import {
  lignesDescription,
  nomTronque,
  hauteurTexteNoeud,
  HAUTEUR_LIGNE_NOM,
  HAUTEUR_LIGNE_TYPE,
  HAUTEUR_LIGNE_VIDE,
  HAUTEUR_LIGNE_DESC,
  HAUTEUR_PASTILLE,
  largeurPastille,
  sousLibellé as sousLibelléDe,
  taillePastille,
} from "../layout/graph-layout";
import { normalizeText } from "../shared/text";

const SVG_NS = "http://www.w3.org/2000/svg";
// Fixe, indépendant du thème de l'appli : un export doit rester lisible
// ouvert seul, hors de toute page qui l'habillerait en clair/sombre (§8).
const PAPIER = "#ffffff";
const ENCRE = "#14181f";
// La même pile que la page (index.html) : les constantes de largeur des
// étiquettes sont calibrées dessus, un export en serif les met en défaut.
const POLICE = 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function rect(x: number, y: number, w: number, h: number, fill: string, stroke: string, strokeWidth: number): SVGRectElement {
  const r = el("rect");
  r.setAttribute("x", String(x));
  r.setAttribute("y", String(y));
  r.setAttribute("width", String(w));
  r.setAttribute("height", String(h));
  r.setAttribute("rx", "8");
  r.setAttribute("fill", fill);
  r.setAttribute("stroke", stroke);
  r.setAttribute("stroke-width", String(strokeWidth));
  return r;
}

// Épaisseur uniforme pour tous les traits. Faire varier l'épaisseur avec le
// nombre de flux agrégés produisait un effet de gras sur les troncs fusionnés,
// qui écrasait visuellement leurs voisins ; le volume se lit dans le « ×N » du
// libellé, pas dans la graisse du trait.
const ÉPAISSEUR_TRAIT = 2;

type Point = { x: number; y: number };

// --- Interruption d'un tracé par les boîtes --------------------------------
//
// Le libellé s'inscrit DANS le trait : celui-ci s'interrompt devant le texte
// et reprend derrière, ce qui l'attache à sa flèche sans le moindre doute.
//
//     ----- texte ------>
//
// Une pastille posée à côté du trait, même opaque, laisse toujours la question
// « laquelle va avec laquelle » quand plusieurs flux sont voisins.
const JEU_INTERRUPTION = 5;
// Ce qu'un libellé ne mange jamais à l'abord de la cible : de quoi poser la
// pointe sur un morceau qui aborde vraiment la boîte.
const RESTE_AVANT_CIBLE = 14;

// Portion d'un segment située dans un rectangle, sous forme d'intervalle de
// paramètre [0,1], ou null si le segment l'évite. Le segment étant orthogonal,
// on traite les deux axes séparément (algorithme de la tranche).
function traverseeDuRect(a: Point, b: Point, r: Rect): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  for (const [depart, arrivee, min, max] of [
    [a.x, b.x, r.x0, r.x1],
    [a.y, b.y, r.y0, r.y1],
  ] as [number, number, number, number][]) {
    const d = arrivee - depart;
    if (Math.abs(d) < 1e-9) {
      if (depart < min || depart > max) return null;
      continue;
    }
    const u0 = (min - depart) / d;
    const u1 = (max - depart) / d;
    t0 = Math.max(t0, Math.min(u0, u1));
    t1 = Math.min(t1, Math.max(u0, u1));
    if (t0 > t1) return null;
  }
  return t0 < t1 ? [t0, t1] : null;
}

const surSegment = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Découpe un tracé en morceaux visibles, en retirant ce qui tombe dans un
// rectangle, plus un jeu de part et d'autre.
export function interrompreLeTrace(points: Point[], obstacles: Rect[]): Point[][] {
  const morceaux: Point[][] = [];
  let courant: Point[] = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const longueur = Math.hypot(b.x - a.x, b.y - a.y);
    if (longueur < 1e-9) continue;
    const jeu = JEU_INTERRUPTION / longueur;

    // Coupures sur ce segment, ordonnées, fusionnées quand elles se touchent.
    //
    // Sur le DERNIER segment la coupure ne va jamais jusqu'au bout : la pointe
    // se pose sur le dernier morceau visible, et sans ce reste ce morceau
    // devenait celui d'AVANT le libellé -- la flèche s'arrêtait à son étiquette
    // au lieu de la boîte visée.
    const plafond =
      i === points.length - 2 ? 1 - Math.min(0.5, RESTE_AVANT_CIBLE / longueur) : 1;
    const coupures: [number, number][] = [];
    for (const r of obstacles) {
      const t = traverseeDuRect(a, b, r);
      if (!t) continue;
      const debut = Math.max(0, t[0] - jeu);
      const fin = Math.min(plafond, t[1] + jeu);
      if (fin > debut) coupures.push([debut, fin]);
    }
    coupures.sort((x, y) => x[0] - y[0]);
    const fusionnées: [number, number][] = [];
    for (const c of coupures) {
      const dernier = fusionnées[fusionnées.length - 1];
      if (dernier && c[0] <= dernier[1]) dernier[1] = Math.max(dernier[1], c[1]);
      else fusionnées.push([...c]);
    }

    for (const [debut, fin] of fusionnées) {
      if (debut > 0) courant.push(surSegment(a, b, debut));
      if (courant.length > 1) morceaux.push(courant);
      courant = fin < 1 ? [surSegment(a, b, fin)] : [];
    }
    if (courant.length === 0) courant = [b];
    else courant.push(b);
  }

  if (courant.length > 1) morceaux.push(courant);
  return morceaux;
}

// Rayon des coudes. Une polyligne orthogonale brute donne un rendu anguleux ;
// quelques pixels d'arrondi suffisent à adoucir la planche entière.
const RAYON_ANGLE = 6;

// Chemin SVG suivant une polyligne orthogonale, coudes arrondis.
//
// On normalise les directions plutôt que d'utiliser Math.sign : ça reste juste
// si ELK émet un segment très légèrement oblique, là où le signe seul
// produirait un point de contrôle aberrant. Deux cas sont écartés
// explicitement -- trois points alignés (pas de coude à arrondir, et le point
// de contrôle tomberait sur le sommet) et les segments de longueur nulle.
function cheminArrondi(points: Point[], rayon = RAYON_ANGLE): string {
  if (points.length === 0) return "";
  if (points.length < 3) return "M " + points.map((p) => `${p.x},${p.y}`).join(" L ");

  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const précédent = points[i - 1];
    const coude = points[i];
    const suivant = points[i + 1];
    const avant = Math.hypot(coude.x - précédent.x, coude.y - précédent.y);
    const après = Math.hypot(suivant.x - coude.x, suivant.y - coude.y);
    const alignés = Math.abs((coude.x - précédent.x) * (suivant.y - coude.y) - (coude.y - précédent.y) * (suivant.x - coude.x)) < 0.01;

    if (alignés || avant < 0.01 || après < 0.01) {
      d += ` L ${coude.x},${coude.y}`;
      continue;
    }
    const ra = Math.min(rayon, avant / 2);
    const rb = Math.min(rayon, après / 2);
    const entrée = { x: coude.x + ((précédent.x - coude.x) / avant) * ra, y: coude.y + ((précédent.y - coude.y) / avant) * ra };
    const sortie = { x: coude.x + ((suivant.x - coude.x) / après) * rb, y: coude.y + ((suivant.y - coude.y) / après) * rb };
    d += ` L ${entrée.x},${entrée.y} Q ${coude.x},${coude.y} ${sortie.x},${sortie.y}`;
  }
  const dernier = points[points.length - 1];
  return d + ` L ${dernier.x},${dernier.y}`;
}

interface RenderEdge {
  points: { x: number; y: number }[];
  // Centre de la pastille, placé par le moteur de layout.
  centreLibellé?: { x: number; y: number };
  // Extrémités conservées : la contrainte d'obstacles s'applique APRÈS la
  // fusion, donc sur ces arêtes-là, et doit savoir quels nœuds sont
  // légitimement accostés. Un tronc de fusion n'a pas de nœud d'origine.
  from?: string;
  to?: string;
  technologie: string;
  count: number;
  // La pointe se pose au DÉPART du trait : le consommateur interroge le
  // fournisseur, mais la donnée descend toujours dans l'autre sens.
  tire?: boolean;
  // Les échanges que ce trait rassemble, pour l'infobulle.
  noms?: string[];
  atténué: boolean;
  ecart?: "ajout" | "retrait";
  label?: string;
  fleche: boolean;
  // Le tronc d'un groupe fusionné part d'un point de confluence, pas d'un
  // vrai nœud -- pas de point de départ à marquer dans ce cas.
  estTronc?: boolean;
}

// Jeu conservé entre la pointe de la flèche et la boîte visée : la flèche
// pointe le nœud, elle ne s'y superpose pas.
const ÉCART_POINTE = 4;

type Rect = { x0: number; y0: number; x1: number; y1: number };

function pointDansRect(p: Point, r: Rect): boolean {
  return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
}

function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function segmentsSeCroisent(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = orientation(c, d, a);
  const d2 = orientation(c, d, b);
  const d3 = orientation(a, b, c);
  const d4 = orientation(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function segmentIntersecteRect(a: Point, b: Point, r: Rect): boolean {
  if (pointDansRect(a, r) || pointDansRect(b, r)) return true;
  const coins: [Point, Point][] = [
    [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }],
    [{ x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }],
    [{ x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }],
    [{ x: r.x0, y: r.y1 }, { x: r.x0, y: r.y0 }],
  ];
  return coins.some(([c, d]) => segmentsSeCroisent(a, b, c, d));
}

// Distance, avant le nœud cible, à laquelle les flux de même (cible, techno,
// atténuation) se rejoignent en un tronc commun -- eux gardent leur tracé et
// leur nom jusque là, seul le tronc porte la pointe de flèche. Doit rester
// supérieure à TIGE_MAX, sinon la confluence tomberait à l'intérieur de la
// tige d'entrée qu'elle remplace.
const DISTANCE_CONFLUENCE = 34;

// Nombre de flux distincts touchant chaque nœud (source ou cible confondues)
// -- sert à décider de quel côté un libellé risque le plus de se retrouver
// dans un attroupement, pour le placer plutôt de l'autre côté.

function fusionnerParTechnologieVersCible(edges: LayoutEdge[]): RenderEdge[] {
  const groupes = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    // L'atténuation fait partie de la clé : un flux à transformer ne se
    // fusionne jamais avec un flux actif, même même cible/techno.
    // Un trait tiré ne se fusionne pas : la confluence se pose à la CIBLE, là où
    // sa pointe n'est justement pas. On le distingue donc par sa propre clé.
    const clé = JSON.stringify([edge.to, edge.technologie, edge.atténué, edge.tire === true]);
    const groupe = groupes.get(clé) ?? [];
    groupe.push(edge);
    groupes.set(clé, groupe);
  }

  const résultat: RenderEdge[] = [];

  // Un flux dessiné tel quel, avec sa propre pointe.
  const seul = (edge: LayoutEdge) => {
      résultat.push({ points: edge.points, centreLibellé: edge.centreLibellé, from: edge.from, to: edge.to, technologie: edge.technologie, count: edge.count, tire: edge.tire, noms: edge.noms, atténué: edge.atténué, ecart: edge.ecart, label: edge.label, fleche: true });
  };

  for (const groupe of groupes.values()) {
    // Un trait tiré ne se fusionne pas : la confluence se pose à la CIBLE, là
    // où sa pointe n'est justement pas. Chacun se dessine donc pour lui-même --
    // et TOUS, sans quoi le groupe perdrait tout sauf son premier.
    if (groupe[0].tire === true) {
      for (const edge of groupe) seul(edge);
      continue;
    }
    if (groupe.length < 2) {
      const edge = groupe[0];
      // Pas de fusion, mais l'un des deux bouts peut quand même être un nœud
      // très fréquenté (ex. un hub qui a aussi des flux sortants) : on place
      // le libellé plutôt du côté le moins encombré.
      résultat.push({ points: edge.points, centreLibellé: edge.centreLibellé, from: edge.from, to: edge.to, technologie: edge.technologie, count: edge.count, tire: edge.tire, noms: edge.noms, atténué: edge.atténué, ecart: edge.ecart, label: edge.label, fleche: true });
      continue;
    }

    // Les branches partagent le même port d'entrée, donc normalement la même
    // approche finale, et la confluence se pose dans son prolongement. Mais
    // dès qu'un conteneur entre en jeu, le moteur peut les faire arriver par
    // des segments différents : remplacer alors leur extrémité par une
    // confluence commune fabriquerait un raccourci qui coupe à travers les
    // boîtes. On ne fusionne que lorsque l'approche est effectivement commune.
    const référence = groupe[0].points;
    const cible = référence[référence.length - 1];
    const avant = référence[référence.length - 2];
    const mêmeApproche = groupe.every((e) => {
      const a = e.points[e.points.length - 2];
      const c = e.points[e.points.length - 1];
      return a && c && Math.abs(a.x - avant.x) < 0.5 && Math.abs(a.y - avant.y) < 0.5 && Math.abs(c.x - cible.x) < 0.5 && Math.abs(c.y - cible.y) < 0.5;
    });
    if (!mêmeApproche) {
      for (const edge of groupe) seul(edge);
      continue;
    }
    const longueur = Math.hypot(cible.x - avant.x, cible.y - avant.y) || 1;
    // Jamais au-delà de la moitié du dernier segment : sinon la confluence
    // passerait derrière le coude précédent et la branche repartirait en
    // arrière juste avant le tronc.
    const recul = Math.min(DISTANCE_CONFLUENCE, longueur / 2);
    const confluence = {
      x: cible.x - ((cible.x - avant.x) / longueur) * recul,
      y: cible.y - ((cible.y - avant.y) / longueur) * recul,
    };

    for (const edge of groupe) {
      // On remplace le seul point d'arrivée par la confluence, qui est située
      // sur ce même dernier segment : la branche reste donc orthogonale. Tous
      // les points de routage produits par le moteur sont conservés.
      const points = [...edge.points.slice(0, -1), confluence];
      // Toutes les branches convergent vers la même confluence encombrée :
      // le libellé se place près de sa propre source, là où les branches sont
      // encore écartées les unes des autres (à leurs ports de sortie).
      résultat.push({ points, centreLibellé: edge.centreLibellé, from: edge.from, to: edge.to, technologie: edge.technologie, count: edge.count, tire: edge.tire, noms: edge.noms, atténué: edge.atténué, label: edge.label, fleche: false });
    }

    résultat.push({
      points: [confluence, cible],
      to: groupe[0].to,
      technologie: groupe[0].technologie,
      count: groupe.reduce((s, e) => s + e.count, 0),
      noms: [...new Set(groupe.flatMap((e) => e.noms ?? []))],
      atténué: groupe[0].atténué,
      fleche: true,
      estTronc: true,
    });
  }
  return résultat;
}

function idMarqueurFlèche(couleur: string): string {
  return "fleche-" + couleur.replace(/[^a-zA-Z0-9]/g, "");
}

// Le moteur place les libellés lui-même, en leur réservant de la place le long
// du tracé (elk.edgeLabels.placement). Le placement maison qui vivait ici --
// milieu du plus long segment, puis dégagement des boîtes, puis écartement
// mutuel -- finissait par éloigner la pastille de sa propre flèche, au point
// qu'on ne savait plus laquelle allait avec laquelle.
function placerLesLibellés(edges: RenderEdge[]): Map<RenderEdge, Point> {
  const placements = new Map<RenderEdge, Point>();
  for (const e of edges) {
    if (e.label && e.centreLibellé) placements.set(e, e.centreLibellé);
  }
  return placements;
}

// Le texte occupe le blanc laissé par le trait ; il n'a donc plus besoin d'une
// pastille pour se détacher du sien. Un liseré blanc le protège en revanche des
// AUTRES traits qui passeraient derrière -- « paint-order: stroke » peint ce
// liseré sous les lettres, ce qui évite de les épaissir.
function construireLibelléArête(
  cx: number,
  cy: number,
  texte: string,
  sousTexte: string | undefined,
  couleur: string,
  atténué: boolean
): SVGGElement {
  const g = el("g");
  const hauteur = HAUTEUR_PASTILLE + (sousTexte ? 10 : 0);
  const yTexte = sousTexte ? cy - hauteur / 2 + 9 : cy + 3.5;

  const poser = (contenu: string, y: number, taille: string, remplissage: string, gras: boolean) => {
    const t = el("text");
    t.setAttribute("x", String(cx));
    t.setAttribute("y", String(y));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", taille);
    if (gras) t.setAttribute("font-weight", "600");
    t.setAttribute("fill", remplissage);
    t.setAttribute("stroke", PAPIER);
    t.setAttribute("stroke-width", "3");
    t.setAttribute("stroke-linejoin", "round");
    t.setAttribute("paint-order", "stroke");
    if (atténué) t.setAttribute("opacity", "0.7");
    t.textContent = contenu;
    g.appendChild(t);
  };

  poser(texte, yTexte, "10", couleur, true);
  if (sousTexte) poser(sousTexte, yTexte + 10, "8.5", "#6b7480", false);
  return g;
}

// Le marker-end s'ancre au point final du tracé et se dessine par-dessus,
// mais un trait plus large que le dos (concave) de la pointe adoucie
// dépasse visuellement sur les côtés : on raccourcit donc le TRAIT lui-même
// jusqu'à la base de la pointe, et c'est le marker (ancré via refX="0", donc
// posé par sa base) qui parcourt seul les derniers TAILLE_POINTE unités
// jusqu'au vrai point de contact. Le dernier segment est rectiligne par
// construction (cf. segmentsCubiques), donc ce recul le long de sa direction
// est exact.
// La pointe d'un trait tiré est à son DÉPART : c'est donc là qu'il faut lui
// réserver sa place, sans quoi elle se dessinerait par-dessus la boîte de
// départ au lieu de l'aborder.
function reculerPourLaPointe(points: Point[], longueur: number, tire: boolean): Point[] {
  if (!tire) return pointsAvantPointe(points, longueur);
  return pointsAvantPointe([...points].reverse(), longueur).reverse();
}

function pointsAvantPointe(points: Point[], longueur: number): Point[] {
  const n = points.length;
  const avantDernier = points[n - 2];
  const dernier = points[n - 1];
  const dx = dernier.x - avantDernier.x;
  const dy = dernier.y - avantDernier.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return points;
  const recul = Math.min(longueur, dist * 0.95);
  const t = (dist - recul) / dist;
  const point = { x: avantDernier.x + dx * t, y: avantDernier.y + dy * t };
  return [...points.slice(0, n - 1), point];
}

// Un trait qui apparaît ou disparaît entre deux paliers porte sa propre
// couleur : la technologie n'est plus l'information principale, le changement
// l'est. Ailleurs, rien ne change.
// Écrites en clair, pas en variables CSS : celles-ci ne sont définies que dans
// la page de l'appli. Hors d'elle -- un .svg ouvert seul, un PNG rastérisé --
// le trait se résolvait à « none » et le schéma Écarts sortait SANS AUCUN
// TRAIT, flèches noires et pastille de légende vide. C'est aussi ce que dit
// PAPIER/ENCRE plus haut : un export ne suit pas le thème de qui l'affiche.
const COULEUR_ECART: Record<"ajout" | "retrait", string> = {
  ajout: "#1a7f43",
  retrait: "#d03b3b",
};

function couleurArête(edge: RenderEdge, colorFor: (tech: string) => string): string {
  return edge.ecart ? COULEUR_ECART[edge.ecart] : colorFor(edge.technologie);
}

function buildEdgeElement(edge: RenderEdge, colorFor: (tech: string) => string, rectLibellé: Rect | null): SVGGElement {
  const g = el("g");
  const couleur = couleurArête(edge, colorFor);

  // L'étiquette ne nomme que les premiers échanges du trait -- au-delà elle
  // mangerait le dessin. La liste entière se lit ici, au survol, dans le
  // navigateur comme dans un .svg ouvert seul.
  if (edge.noms && edge.noms.length > 1) {
    const infobulle = el("title");
    infobulle.textContent = edge.noms.join("\n");
    g.appendChild(infobulle);
  }

  const pointsTracé = edge.fleche ? reculerPourLaPointe(edge.points, TAILLE_POINTE + ÉCART_POINTE, edge.tire === true) : edge.points;
  const morceaux = interrompreLeTrace(pointsTracé, rectLibellé ? [rectLibellé] : []);

  morceaux.forEach((morceau, i) => {
    const path = el("path");
    path.setAttribute("d", cheminArrondi(morceau));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", couleur);
    path.setAttribute("stroke-width", String(ÉPAISSEUR_TRAIT));
    // La pointe ne va que sur le morceau qui aborde celui qu'elle désigne : le
    // dernier quand le fournisseur pousse, le premier quand le consommateur
    // appelle. Le marqueur s'oriente seul (auto-start-reverse), une seule
    // définition sert les deux.
    if (edge.fleche) {
      if (edge.tire && i === 0) path.setAttribute("marker-start", `url(#${idMarqueurFlèche(couleur)})`);
      if (!edge.tire && i === morceaux.length - 1) path.setAttribute("marker-end", `url(#${idMarqueurFlèche(couleur)})`);
    }
    if (edge.atténué) {
      path.setAttribute("stroke-dasharray", "6 4");
      path.setAttribute("opacity", "0.5");
    }
    g.appendChild(path);
  });

  // Point de départ : marque explicitement le nœud d'origine, à l'image de
  // la pointe qui marque l'arrivée -- un tronc de fusion part d'un point de
  // confluence, pas d'un vrai nœud, donc n'en porte pas.
  if (!edge.estTronc) {
    const départ = el("circle");
    départ.setAttribute("cx", String(edge.points[0].x));
    départ.setAttribute("cy", String(edge.points[0].y));
    départ.setAttribute("r", "2.75");
    départ.setAttribute("fill", couleur);
    if (edge.atténué) départ.setAttribute("opacity", "0.6");
    g.appendChild(départ);
  }

  return g;
}

// Palette par kind, dans l'esprit C4 (Structurizr) : gris-bleu neutre pour
// un système de contexte, bleu soutenu pour ce qui est mis en avant
// (plateforme, acteur sélectionné), fond clair + texte sombre sinon.
interface StyleNoeud {
  fond: string;
  bord: string;
  texteClair: boolean;
  épaisseurBord: number;
}

// La couleur code le PÉRIMÈTRE, pas la technologie : bleu plein pour ce qui
// appartient à la plateforme, gris pour ce qui lui est extérieur. C'est le
// levier de lisibilité le plus fort quand une plateforme centrale est entourée
// de systèmes tiers -- la technologie, elle, est déjà portée par la couleur
// des traits et par la légende.
function styleDuNoeud(node: LayoutNode): StyleNoeud {
  // Couleurs relevées dans la source du gabarit C4 de draw.io (Sidebar-C4.js).
  if (node.kind === "acteur-selectionne") {
    return { fond: "#083F75", bord: "#06315C", texteClair: true, épaisseurBord: 2 };
  }
  if (node.externe) {
    return { fond: "#8C8496", bord: "#736782", texteClair: true, épaisseurBord: 1 };
  }
  if (node.kind === "plateforme") {
    return { fond: "#23A2D9", bord: "#0E7DAD", texteClair: true, épaisseurBord: 1 };
  }
  return { fond: "#1061B0", bord: "#0D5091", texteClair: true, épaisseurBord: 1 };
}




function construireIcône(nom: string, x: number, y: number, taille: number, couleur: string): SVGGElement {
  const g = el("g");
  const échelle = taille / 24;
  g.setAttribute("transform", `translate(${x},${y}) scale(${échelle})`);
  g.setAttribute("fill", "none");
  g.setAttribute("stroke", couleur);
  g.setAttribute("stroke-width", "2");
  g.setAttribute("stroke-linecap", "round");
  g.setAttribute("stroke-linejoin", "round");
  // Un nom inconnu retombe sur le jeton neutre plutôt que de ne rien dessiner :
  // une boîte sans icône se lirait comme un oubli, pas comme une erreur de
  // saisie -- que les contrôles d'intégrité signalent par ailleurs.
  for (const élément of ICONES[nom] ?? ICONES[ICONE_PAR_DEFAUT]) {
    const e = el(élément.tag);
    for (const [attr, val] of Object.entries(élément.attrs)) e.setAttribute(attr, val);
    g.appendChild(e);
  }
  return g;
}

// Chip arrondi (style C4 « type » / « externe ») : fond teinté à faible
// opacité, texte de la même couleur que la bordure du nœud.
function construireChip(x: number, y: number, texte: string, couleur: string): { élément: SVGGElement; largeur: number } {
  const largeur = texte.length * 5.3 + 14;
  const hauteur = 15;
  const g = el("g");
  const fond = el("rect");
  fond.setAttribute("x", String(x));
  fond.setAttribute("y", String(y));
  fond.setAttribute("width", String(largeur));
  fond.setAttribute("height", String(hauteur));
  fond.setAttribute("rx", String(hauteur / 2));
  fond.setAttribute("fill", couleur);
  fond.setAttribute("opacity", "0.16");
  g.appendChild(fond);
  const text = el("text");
  text.setAttribute("x", String(x + largeur / 2));
  text.setAttribute("y", String(y + hauteur / 2 + 3.2));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "9");
  text.setAttribute("font-weight", "600");
  text.setAttribute("fill", couleur);
  text.textContent = texte;
  g.appendChild(text);
  return { élément: g, largeur };
}

// Frontière au sens C4 : un cadre en pointillés autour des composants du
// produit, son libellé en haut à gauche. Elle n'a ni fond ni icône -- c'est un
// contour, pas une boîte, et elle se dessine avant tout le reste pour rester
// dessous.
function buildFrontiereElement(node: LayoutNode): SVGGElement {
  const g = el("g");
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;

  const cadre = rect(x, y, node.width, node.height, "none", "#7a828d", 1.5);
  cadre.setAttribute("stroke-dasharray", "8 5");
  g.appendChild(cadre);

  const libellé = el("text");
  libellé.setAttribute("x", String(x + 12));
  libellé.setAttribute("y", String(y + 17));
  libellé.setAttribute("font-size", "11");
  libellé.setAttribute("font-weight", "600");
  libellé.setAttribute("letter-spacing", "0.4");
  libellé.setAttribute("fill", "#6b7480");
  libellé.textContent = node.label;
  g.appendChild(libellé);

  return g;
}

function buildNodeElement(node: LayoutNode): SVGGElement {
  const g = el("g");
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;
  const style = styleDuNoeud(node);
  const estExterne = !!node.externe;

  const boîte = rect(x, y, node.width, node.height, style.fond, style.bord, style.épaisseurBord);
  boîte.setAttribute("rx", "10"); // arcSize=10 dans le gabarit draw.io
  // Le trait discontinu redit « externe » par la forme : la couleur seule ne
  // suffit pas en noir et blanc ni pour un daltonien.
  if (estExterne) boîte.setAttribute("stroke-dasharray", "8 5");
  g.appendChild(boîte);

  const blanc = "#ffffff";
  const grisDesc = "#cccccc";
  const cx = node.x;

  // Bloc de texte centré dans la boîte : nom en 16 gras, [Type] en dessous,
  // ligne vide, puis description en 11 gris clair -- la maquette draw.io.
  const lignes = lignesDescription(node.description);
  let curseur = node.y - hauteurTexteNoeud(node) / 2;

  const tailleIcône = 16;
  const nomAffiché = nomTronque(node.label);
  const largeurNom = nomAffiché.length * 8.2;
  g.appendChild(construireIcône(node.icone ?? ICONE_PAR_DEFAUT, cx - largeurNom / 2 - tailleIcône - 6, curseur + 1, tailleIcône, blanc));

  const texteNom = el("text");
  texteNom.setAttribute("x", String(cx + tailleIcône / 2 + 3));
  texteNom.setAttribute("y", String(curseur + 14));
  texteNom.setAttribute("text-anchor", "middle");
  texteNom.setAttribute("font-size", "16");
  texteNom.setAttribute("font-weight", "700");
  texteNom.setAttribute("fill", blanc);
  texteNom.textContent = nomAffiché;
  g.appendChild(texteNom);
  // Tronqué, le nom reste lisible au survol de la boîte entière -- dans le
  // navigateur comme dans un .svg ouvert seul. Posé sur le groupe et non sur
  // l'élément texte : là, il s'ajouterait au textContent du nom.
  if (nomAffiché !== node.label) {
    const infobulle = el("title");
    infobulle.textContent = node.label;
    g.appendChild(infobulle);
  }
  curseur += HAUTEUR_LIGNE_NOM;

  if (node.sousTitre) {
    const texteType = el("text");
    texteType.setAttribute("x", String(cx));
    texteType.setAttribute("y", String(curseur + 12));
    texteType.setAttribute("text-anchor", "middle");
    texteType.setAttribute("font-size", "12");
    texteType.setAttribute("fill", blanc);
    texteType.textContent = `[${node.sousTitre}${estExterne ? " · External" : ""}]`;
    g.appendChild(texteType);
    curseur += HAUTEUR_LIGNE_TYPE;
  }

  if (lignes.length) curseur += HAUTEUR_LIGNE_VIDE;
  for (const ligne of lignes) {
    const texteDesc = el("text");
    texteDesc.setAttribute("x", String(cx));
    texteDesc.setAttribute("y", String(curseur + 11));
    texteDesc.setAttribute("text-anchor", "middle");
    texteDesc.setAttribute("font-size", "11");
    texteDesc.setAttribute("fill", grisDesc);
    texteDesc.textContent = ligne;
    g.appendChild(texteDesc);
    curseur += HAUTEUR_LIGNE_DESC;
  }

  return g;
}

// Dard adouci, dans la même boîte englobante (0..10, pointe en (10,5)) que
// le marker "c4-arrow" de c4hero (src/components/canvas/Canvas.tsx) dont on
// part. refX="0" ancre le marker par sa BASE, pas sa pointe : c'est
// pointsAvantPointe (buildEdgeElement) qui raccourcit le trait jusqu'à cette
// base, et le marker seul parcourt les TAILLE_POINTE derniers unités jusqu'au
// vrai point de contact -- sinon un trait épais dépasse visuellement du dos
// concave, plus étroit que le dos plat du triangle d'origine.
//
// markerUnits="userSpaceOnUse" : par défaut un marker se mesure en multiples
// de stroke-width, donc la pointe d'un tronc fusionné épais (stroke-width
// jusqu'à 6) faisait 48px de large -- elle écrasait le nœud visé, mangeait
// l'écart avant contact et recouvrait les pointes voisines. Taille fixe : la
// force d'un flux se lit à l'épaisseur du trait, pas à la taille de sa pointe.
const TAILLE_POINTE = 12;

function ajouterMarqueurFlèche(defs: SVGDefsElement, couleur: string): void {
  const marker = el("marker");
  marker.setAttribute("id", idMarqueurFlèche(couleur));
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "0");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", String(TAILLE_POINTE));
  marker.setAttribute("markerHeight", String(TAILLE_POINTE));
  marker.setAttribute("orient", "auto-start-reverse");
  // Dard adouci : côtés légèrement convexes vers la pointe, dos légèrement
  // concave (encoche) plutôt que les trois arêtes droites d'un triangle brut.
  // Même boîte englobante (0..10, pointe en (10,5)) que l'ancienne forme :
  // aucun impact sur le calcul de l'écart avant contact.
  const arrowPath = el("path");
  arrowPath.setAttribute("d", "M 0,0 Q 6,1 10,5 Q 6,9 0,10 Q 2.5,5 0,0 Z");
  arrowPath.setAttribute("fill", couleur);
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
}

// Marge autour du contenu réel du diagramme (traits, pastilles de libellé,
// pointes de flèche). Les dimensions que rend le moteur de layout ne
// couvrent que les nœuds et leur tracé brut -- une fois les flux répartis en
// enveloppe (jusque sur les faces haut/bas) et détournés, le dessin peut
// largement déborder de ce cadre-là.
const MARGE_CADRE = 24;

function calculerBornes(nodes: LayoutNode[], edges: RenderEdge[], libellés: Map<RenderEdge, Point>): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const étendre = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const n of nodes) {
    étendre(n.x - n.width / 2, n.y - n.height / 2);
    étendre(n.x + n.width / 2, n.y + n.height / 2);
  }
  for (const e of edges) {
    // Le tracé suit exactement ses points de passage (polyligne orthogonale,
    // arrondis compris puisqu'ils restent dans le coude) : plus de débordement
    // à anticiper comme avec une spline.
    for (const p of e.points) étendre(p.x, p.y);
    if (e.fleche) {
      // La pointe s'étale autour de l'extrémité du tracé, dans une direction
      // qui dépend de l'orientation du trait : on réserve son gabarit entier.
      const bout = e.points[e.points.length - 1];
      étendre(bout.x - TAILLE_POINTE, bout.y - TAILLE_POINTE);
      étendre(bout.x + TAILLE_POINTE, bout.y + TAILLE_POINTE);
    }
    // La pastille d'un libellé déborde largement de son seul point d'ancrage
    // (ex. "Fichier + ETL (dépôt)") -- compter sa vraie largeur, pas juste ce point.
    const pos = libellés.get(e);
    if (pos) {
      const taille = taillePastille(e.label, e.technologie);
      étendre(pos.x - taille.width / 2, pos.y - taille.height / 2);
      étendre(pos.x + taille.width / 2, pos.y + taille.height / 2);
    }
  }

  if (!Number.isFinite(x0)) return { x0: 0, y0: 0, x1: 100, y1: 100 };
  return { x0: x0 - MARGE_CADRE, y0: y0 - MARGE_CADRE, x1: x1 + MARGE_CADRE, y1: y1 + MARGE_CADRE };
}

// --- Légende ---------------------------------------------------------------
//
// Elle est DANS le SVG, pas dans l'interface : le code couleur doit voyager
// avec le schéma. Tant qu'elle vivait dans le rail, chaque export vers Word ou
// PowerPoint partait sans elle, et il fallait l'expliquer à chaque diffusion.
const LEGENDE_LIGNE = 16;
const LEGENDE_PAD = 10;
const LEGENDE_ECHANTILLON = 22;

function largeurLegende(entrées: string[]): number {
  const texte = Math.max(0, ...entrées.map((e) => e.length * 5.6));
  return LEGENDE_PAD * 2 + LEGENDE_ECHANTILLON + 8 + texte;
}

// Ce que la légende annonce doit être ce que le dessin utilise. Sur un schéma
// d'écart, aucun trait ne porte de couleur de technologie -- ils sont tous
// verts ou rouges -- et énumérer les technologies annoncerait un code couleur
// qu'on ne trouve nulle part.
const LIBELLE_ECART: Record<"ajout" | "retrait", string> = {
  ajout: "+n : flows added",
  retrait: "−n : flows removed",
};

function construireLegende(
  ecarts: readonly ("ajout" | "retrait")[],
  technologies: string[],
  colorFor: (tech: string) => string,
  périmètres: boolean,
  x: number,
  y: number,
  largeur: number,
  hauteur: number
): SVGGElement {
  const g = el("g");
  g.setAttribute("class", "fx-legende");

  const cadre = rect(x, y, largeur, hauteur, PAPIER, "#c8cdd5", 1);
  g.appendChild(cadre);

  let ligne = y + LEGENDE_PAD + LEGENDE_LIGNE / 2;
  const poser = (échantillon: SVGElement, texte: string) => {
    g.appendChild(échantillon);
    const t = el("text");
    t.setAttribute("x", String(x + LEGENDE_PAD + LEGENDE_ECHANTILLON + 8));
    t.setAttribute("y", String(ligne + 3.5));
    t.setAttribute("font-size", "10");
    t.setAttribute("fill", ENCRE);
    t.textContent = texte;
    g.appendChild(t);
    ligne += LEGENDE_LIGNE;
  };

  const traitDeLegende = (couleur: string): SVGLineElement => {
    const trait = el("line");
    trait.setAttribute("x1", String(x + LEGENDE_PAD));
    trait.setAttribute("y1", String(ligne));
    trait.setAttribute("x2", String(x + LEGENDE_PAD + LEGENDE_ECHANTILLON));
    trait.setAttribute("y2", String(ligne));
    trait.setAttribute("stroke", couleur);
    trait.setAttribute("stroke-width", String(ÉPAISSEUR_TRAIT));
    return trait;
  };

  for (const ecart of ecarts) {
    poser(traitDeLegende(COULEUR_ECART[ecart]), LIBELLE_ECART[ecart]);
  }

  for (const tech of technologies) {
    const trait = el("line");
    trait.setAttribute("x1", String(x + LEGENDE_PAD));
    trait.setAttribute("y1", String(ligne));
    trait.setAttribute("x2", String(x + LEGENDE_PAD + LEGENDE_ECHANTILLON));
    trait.setAttribute("y2", String(ligne));
    trait.setAttribute("stroke", colorFor(tech));
    trait.setAttribute("stroke-width", String(ÉPAISSEUR_TRAIT));
    poser(trait, tech);
  }

  if (périmètres) {
    for (const [libellé, externe] of [["Platform", false], ["External", true]] as [string, boolean][]) {
      const style = styleDuNoeud({ externe } as LayoutNode);
      const carré = rect(x + LEGENDE_PAD, ligne - 5, LEGENDE_ECHANTILLON, 10, style.fond, style.bord, 1);
      if (externe) carré.setAttribute("stroke-dasharray", "3 2");
      poser(carré, libellé);
    }
  }

  return g;
}

export function buildGraphSvg(layout: LayoutResult, colorFor: (tech: string) => string): SVGSVGElement {
  // Les tracés viennent d'ELK : ports répartis sur le côté imposé et routage
  // orthogonal évitant les boîtes par construction. Il ne reste qu'à fusionner
  // les flux de même technologie vers une même cible.
  const renderEdges = fusionnerParTechnologieVersCible(layout.edges);
  const libellés = placerLesLibellés(renderEdges);

  const bornes = calculerBornes(layout.nodes, renderEdges, libellés);

  // La légende occupe un coin réservé sous le dessin : on l'ajoute aux bornes
  // plutôt que de la poser par-dessus le schéma.
  // On n'énumère que ce qui sert : un trait marqué d'un écart ne porte plus la
  // couleur de sa technologie, celle-ci n'a donc rien à faire dans la légende.
  // Et une technologie vide n'en est pas une -- le mode fonctionnel vide
  // `technologie` sur toutes ses arêtes, une entrée sans nom n'annoncerait
  // qu'un code couleur introuvable sur le dessin.
  const ecarts = (["ajout", "retrait"] as const).filter((e) => renderEdges.some((r) => r.ecart === e));
  const technologies = [...new Set(renderEdges.filter((e) => !e.ecart && e.technologie !== "").map((e) => e.technologie))].sort(
    (a, b) => a.localeCompare(b, "fr")
  );
  const dessinables = layout.nodes.filter((n) => n.kind !== "frontiere");
  const périmètres = dessinables.some((n) => n.externe) && dessinables.some((n) => !n.externe);
  const entrées = [...ecarts.map((e) => LIBELLE_ECART[e]), ...technologies, ...(périmètres ? ["Platform", "External"] : [])];
  const légendeL = entrées.length ? largeurLegende(entrées) : 0;
  const légendeH = entrées.length ? LEGENDE_PAD * 2 + entrées.length * LEGENDE_LIGNE : 0;

  if (entrées.length) {
    bornes.y1 += MARGE_CADRE + légendeH;
    bornes.x0 = Math.min(bornes.x0, bornes.x1 - légendeL);
  }

  const largeur = bornes.x1 - bornes.x0;
  const hauteur = bornes.y1 - bornes.y0;

  const svg = el("svg");
  svg.setAttribute("xmlns", SVG_NS);
  // Le fichier nomme sa police : hérité de la page, il retombait en serif dès
  // qu'on l'ouvrait seul, alors que les largeurs d'étiquettes sont calibrées
  // pour cette pile-là.
  svg.setAttribute("font-family", POLICE);
  svg.setAttribute("viewBox", `${bornes.x0} ${bornes.y0} ${largeur} ${hauteur}`);
  svg.setAttribute("width", String(largeur));
  svg.setAttribute("height", String(hauteur));

  const defs = el("defs");
  const couleursAvecFlèche = new Set(renderEdges.filter((e) => e.fleche).map((e) => couleurArête(e, colorFor)));
  for (const couleur of couleursAvecFlèche) ajouterMarqueurFlèche(defs, couleur);
  svg.appendChild(defs);

  const background = rect(bornes.x0, bornes.y0, largeur, hauteur, PAPIER, "none", 0);
  svg.appendChild(background);

  // Rectangle occupé par chaque libellé : c'est là que son trait s'interrompt.
  const rectDuLibellé = (e: RenderEdge): Rect | null => {
    const centre = libellés.get(e);
    if (!centre || !e.label) return null;
    const t = taillePastille(e.label, e.technologie);
    return { x0: centre.x - t.width / 2, y0: centre.y - t.height / 2, x1: centre.x + t.width / 2, y1: centre.y + t.height / 2 };
  };

  const coucheArêtes = el("g");
  coucheArêtes.setAttribute("class", "fx-aretes");
  for (const edge of renderEdges) coucheArêtes.appendChild(buildEdgeElement(edge, colorFor, rectDuLibellé(edge)));
  svg.appendChild(coucheArêtes);

  // Les frontières passent sous les arêtes : ce sont des repères de fond, pas
  // des objets à survoler.
  const coucheFrontieres = el("g");
  coucheFrontieres.setAttribute("class", "fx-frontieres");
  for (const node of layout.nodes.filter((n) => n.kind === "frontiere")) {
    coucheFrontieres.appendChild(buildFrontiereElement(node));
  }
  svg.insertBefore(coucheFrontieres, coucheArêtes);

  const coucheNoeuds = el("g");
  coucheNoeuds.setAttribute("class", "fx-noeuds");
  for (const node of layout.nodes.filter((n) => n.kind !== "frontiere")) {
    coucheNoeuds.appendChild(buildNodeElement(node));
  }
  svg.appendChild(coucheNoeuds);

  // Ordre de dessin : frontières, arêtes, boîtes, puis libellés. Les libellés
  // passent en dernier pour qu'aucun trait ni aucune boîte ne les recouvre --
  // tant qu'ils vivaient dans le groupe de leur arête, une boîte posée après
  // pouvait les masquer.
  const coucheLibellés = el("g");
  coucheLibellés.setAttribute("class", "fx-libelles");
  for (const edge of renderEdges) {
    const ancre = libellés.get(edge);
    if (!edge.label || !ancre) continue;
    coucheLibellés.appendChild(
      construireLibelléArête(ancre.x, ancre.y, edge.label, sousLibelléDe(edge.label, edge.technologie), couleurArête(edge, colorFor), edge.atténué)
    );
  }
  svg.appendChild(coucheLibellés);

  if (entrées.length) {
    svg.appendChild(
      construireLegende(
        ecarts,
        technologies,
        colorFor,
        périmètres,
        bornes.x1 - légendeL,
        bornes.y1 - légendeH,
        légendeL,
        légendeH
      )
    );
  }

  return svg;
}
