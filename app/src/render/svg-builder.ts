import { ICONS, DEFAULT_ICON } from "./icons";
import type { LayoutResult, LayoutEdge, LayoutNode } from "../layout/graph-layout";
import {
  lignesDescription,
  truncatedName,
  nodeTextHeight,
  NAME_LINE_HEIGHT,
  HAUTEUR_LIGNE_TYPE,
  EMPTY_LINE_HEIGHT,
  DESC_LINE_HEIGHT,
  HAUTEUR_PASTILLE,
  chipWidth,
  subLabel as subLabelOf,
  taillePastille,
} from "../layout/graph-layout";
import { normalizeText } from "../shared/text";
import {
  cheminArrondi,
  breakTheLine,
  reculerPourLaPointe,
  segmentIntersectsRect,
  RAYON_ANGLE,
  type Point,
  type Rect,
} from "./geometry";
import { PAPER, INK, STROKE_WIDTH, CHANGE_COLOUR, styleOfNode } from "./node-styles";
import { legendEntries, type LegendEntry, type LegendSample } from "./legend";
import { buildTitleBlock, descriptionAccessible, titleBlockText, HAUTEUR_CARTOUCHE, type DiagramContext } from "./title-block";

const SVG_NS = "http://www.w3.org/2000/svg";
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









interface RenderEdge {
  criticality?: string;
  points: { x: number; y: number }[];
  // Centre de la pastille, placé par le moteur de layout.
  labelCentre?: { x: number; y: number };
  // Extrémités conservées : la contrainte d'obstacles s'applique APRÈS la
  // fusion, donc sur ces arêtes-là, et doit savoir quels nœuds sont
  // légitimement accostés. Un tronc de fusion n'a pas de nœud d'origine.
  from?: string;
  to?: string;
  technology: string;
  count: number;
  // La pointe se pose au DÉPART du trait : le consommateur interroge le
  // fournisseur, mais la donnée descend toujours dans l'autre sens.
  pulled?: boolean;
  // Les échanges que ce trait rassemble, pour l'infobulle.
  names?: string[];
  attenuated: boolean;
  change?: "added" | "removed";
  label?: string;
  arrow: boolean;
  // Le tronc d'un groupe fusionné part d'un point de confluence, pas d'un
  // vrai nœud -- pas de point de départ à marquer dans ce cas.
  isTrunk?: boolean;
}

// Jeu conservé entre la pointe de la flèche et la boîte visée : la flèche
// pointe le nœud, elle ne s'y superpose pas.
const ARROW_GAP = 4;






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
  const groups = new Map<string, LayoutEdge[]>();
  for (const edge of edges) {
    // L'atténuation fait partie de la clé : un flux à transformer ne se
    // fusionne jamais avec un flux actif, même même cible/techno.
    // Un trait tiré ne se fusionne pas : la confluence se pose à la CIBLE, là où
    // sa pointe n'est justement pas. On le distingue donc par sa propre clé.
    const key = JSON.stringify([edge.to, edge.technology, edge.attenuated, edge.pulled === true]);
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }

  const result: RenderEdge[] = [];

  // Un flux dessiné tel quel, avec sa propre pointe.
  const alone = (edge: LayoutEdge) => {
      result.push({ points: edge.points, labelCentre: edge.labelCentre, from: edge.from, to: edge.to, technology: edge.technology, count: edge.count, pulled: edge.pulled, names: edge.names, attenuated: edge.attenuated, change: edge.change, label: edge.label, criticality: edge.criticality, arrow: true });
  };

  for (const group of groups.values()) {
    // Un trait tiré ne se fusionne pas : la confluence se pose à la CIBLE, là
    // où sa pointe n'est justement pas. Chacun se dessine donc pour lui-même --
    // et TOUS, sans quoi le groupe perdrait tout sauf son premier.
    if (group[0].pulled === true) {
      for (const edge of group) alone(edge);
      continue;
    }
    if (group.length < 2) {
      const edge = group[0];
      // Pas de fusion, mais l'un des deux bouts peut quand même être un nœud
      // très fréquenté (ex. un hub qui a aussi des flux sortants) : on place
      // le libellé plutôt du côté le moins encombré.
      result.push({ points: edge.points, labelCentre: edge.labelCentre, from: edge.from, to: edge.to, technology: edge.technology, count: edge.count, pulled: edge.pulled, names: edge.names, attenuated: edge.attenuated, change: edge.change, label: edge.label, criticality: edge.criticality, arrow: true });
      continue;
    }

    // Les branches partagent le même port d'entrée, donc normalement la même
    // approche finale, et la confluence se pose dans son prolongement. Mais
    // dès qu'un conteneur entre en jeu, le moteur peut les faire arriver par
    // des segments différents : remplacer alors leur extrémité par une
    // confluence commune fabriquerait un raccourci qui coupe à travers les
    // boîtes. On ne fusionne que lorsque l'approche est effectivement commune.
    const reference = group[0].points;
    const target = reference[reference.length - 1];
    const before = reference[reference.length - 2];
    const sameApproach = group.every((e) => {
      const a = e.points[e.points.length - 2];
      const c = e.points[e.points.length - 1];
      return a && c && Math.abs(a.x - before.x) < 0.5 && Math.abs(a.y - before.y) < 0.5 && Math.abs(c.x - target.x) < 0.5 && Math.abs(c.y - target.y) < 0.5;
    });
    if (!sameApproach) {
      for (const edge of group) alone(edge);
      continue;
    }
    const length = Math.hypot(target.x - before.x, target.y - before.y) || 1;
    // Jamais au-delà de la moitié du dernier segment : sinon la confluence
    // passerait derrière le coude précédent et la branche repartirait en
    // arrière juste avant le tronc.
    const setback = Math.min(DISTANCE_CONFLUENCE, length / 2);
    const confluence = {
      x: target.x - ((target.x - before.x) / length) * setback,
      y: target.y - ((target.y - before.y) / length) * setback,
    };

    for (const edge of group) {
      // On remplace le seul point d'arrivée par la confluence, qui est située
      // sur ce même dernier segment : la branche reste donc orthogonale. Tous
      // les points de routage produits par le moteur sont conservés.
      const points = [...edge.points.slice(0, -1), confluence];
      // Toutes les branches convergent vers la même confluence encombrée :
      // le libellé se place près de sa propre source, là où les branches sont
      // encore écartées les unes des autres (à leurs ports de sortie).
      result.push({ points, labelCentre: edge.labelCentre, from: edge.from, to: edge.to, technology: edge.technology, count: edge.count, pulled: edge.pulled, names: edge.names, attenuated: edge.attenuated, label: edge.label, criticality: edge.criticality, arrow: false });
    }

    result.push({
      points: [confluence, target],
      to: group[0].to,
      technology: group[0].technology,
      count: group.reduce((s, e) => s + e.count, 0),
      names: [...new Set(group.flatMap((e) => e.names ?? []))],
      attenuated: group[0].attenuated,
      // Le tronc porte la criticité la plus forte de ses branches : il tombe
      // avec la plus vitale d'entre elles.
      criticality: group.map((e) => e.criticality).find(Boolean),
      arrow: true,
      isTrunk: true,
    });
  }
  return result;
}

// La pointe doit TENIR dans le segment qui la porte. ELK sort d'une boîte par
// un stub perpendiculaire à la face -- parfois 5 px -- puis tourne : une pointe
// de 12 px y dépassait le coude et se plantait sur le segment suivant, de
// côté, comme si le trait arrivait par le flanc de la flèche. Sur le classeur
// d'exemple, 14 arêtes sur 24 étaient dans ce cas.
//
// On la rétrécit par paliers plutôt que continûment : une taille par arête
// ferait autant de définitions de marqueur que d'arêtes.
const HEAD_SIZES = [12, 8, 5, 3] as const;

// L'écart avant contact suit la pointe : gardé à 4 px sous une pointe de 3, il
// mangerait plus que la pointe elle-même.
function arrowGapFor(size: number): number {
  return Math.min(ARROW_GAP, size / 3);
}

function tailleDePointe(approachLength: number): number {
  return HEAD_SIZES.find((t) => approachLength >= t + arrowGapFor(t)) ?? HEAD_SIZES[HEAD_SIZES.length - 1];
}

// La longueur DROITE réellement disponible au bout du trait pour y poser la
// pointe. Deux retranchements, et oublier le second était l'erreur : le
// segment brut d'ELK perd de la longueur dans l'arrondi du coude qui le
// précède -- jusqu'à RAYON_ANGLE, ou la moitié du segment s'il est court.
function longueurDApproche(edge: RenderEdge): number {
  const p = edge.points;
  const [a, b] = edge.pulled ? [p[0], p[1]] : [p[p.length - 1], p[p.length - 2]];
  if (!a || !b) return 0;
  const brute = Math.hypot(b.x - a.x, b.y - a.y);
  return brute - Math.min(RAYON_ANGLE, brute / 2);
}

function arrowMarkerId(colour: string, hollow = false, size = HEAD_SIZE): string {
  return `${hollow ? "arrow-hollow" : "arrow"}-${size}-${colour.replace(/[^a-zA-Z0-9]/g, "")}`;
}

// Le moteur place les libellés lui-même, en leur réservant de la place le long
// du tracé (elk.edgeLabels.placement). Le placement maison qui vivait ici --
// milieu du plus long segment, puis dégagement des boîtes, puis écartement
// mutuel -- finissait par éloigner la pastille de sa propre flèche, au point
// qu'on ne savait plus laquelle allait avec laquelle.
function placeLabels(edges: RenderEdge[]): Map<RenderEdge, Point> {
  const placements = new Map<RenderEdge, Point>();
  for (const e of edges) {
    if (e.label && e.labelCentre) placements.set(e, e.labelCentre);
  }
  return placements;
}

// Le texte occupe le blanc laissé par le trait ; il n'a donc plus besoin d'une
// pastille pour se détacher du sien. Un liseré blanc le protège en revanche des
// AUTRES traits qui passeraient derrière -- « paint-order: stroke » peint ce
// liseré sous les lettres, ce qui évite de les épaissir.
// Le rappel de couleur passe par un DISQUE, pas par l'encre du texte : les
// huit teintes de la palette échouent toutes à 4,5:1 comme texte, et écrire en
// couleur rendait le schéma illisible en niveaux de gris. C'est exactement ce
// que la matrix fait déjà. Une couleur d'écart, elle, reste l'encre : là, la
// teinte EST le message, et les deux passent le seuil (5,05 et 4,80).
function buildEdgeLabel(
  cx: number,
  cy: number,
  text: string,
  subText: string | undefined,
  colour: string,
  attenuated: boolean,
  colourChip: boolean
): SVGGElement {
  const g = el("g");
  const height = HAUTEUR_PASTILLE + (subText ? 10 : 0);
  const textY = subText ? cy - height / 2 + 9 : cy + 3.5;
  const offset = colourChip ? DISC_WIDTH : 0;

  const apply = (content: string, y: number, size: string, fill: string, gras: boolean) => {
    const t = el("text");
    t.setAttribute("x", String(cx + offset / 2));
    t.setAttribute("y", String(y));
    t.setAttribute("text-anchor", "middle");
    t.setAttribute("font-size", size);
    if (gras) t.setAttribute("font-weight", "600");
    t.setAttribute("fill", fill);
    t.setAttribute("stroke", PAPER);
    t.setAttribute("stroke-width", "3");
    t.setAttribute("stroke-linejoin", "round");
    t.setAttribute("paint-order", "stroke");
    if (attenuated) t.setAttribute("opacity", "0.7");
    t.textContent = content;
    g.appendChild(t);
  };

  if (colourChip) {
    const disc = el("circle");
    disc.setAttribute("cx", String(cx - chipWidth(text) / 2 - offset / 2 + DISC_RADIUS + 7));
    disc.setAttribute("cy", String(textY - 3.5));
    disc.setAttribute("r", String(DISC_RADIUS));
    disc.setAttribute("fill", colour);
    disc.setAttribute("stroke", PAPER);
    disc.setAttribute("stroke-width", "1.5");
    if (attenuated) disc.setAttribute("opacity", "0.7");
    g.appendChild(disc);
  }

  apply(text, textY, "11", colourChip ? INK : colour, true);
  // 8,5 px en gris pâle : le plus petit texte du schéma était aussi le moins
  // contrasté. 10 px et un ardoise franc (10,16:1 contre 4,74:1).
  if (subText) apply(subText, textY + 11, "10", SECONDARY_GREY, false);
  return g;
}



// Un trait qui apparaît ou disparaît entre deux paliers porte sa propre
// couleur : la technologie n'est plus l'information principale, le changement
// l'est. Ailleurs, rien ne change.
// Les couleurs elles-mêmes vivent dans styles-noeud.ts : écrites en clair, pas
// en variables CSS -- celles-ci ne sont définies que dans la page de l'appli.
// Hors d'elle -- un .svg ouvert seul, un PNG rastérisé -- le trait se résolvait
// à « none » et le schéma Écarts sortait SANS AUCUN TRAIT.

function edgeColour(edge: RenderEdge, colorFor: (tech: string) => string): string {
  return edge.change ? CHANGE_COLOUR[edge.change] : colorFor(edge.technology);
}

// La graisse du trait est la variable de Bertin faite pour l'ORDRE. Elle est
// volontairement uniforme ailleurs -- faire varier l'épaisseur avec le NOMBRE
// de flux agrégés écrasait visuellement les voisins, et le volume se lit dans
// le « ×N ». Ce raisonnement valait pour un volume ; il ne vaut pas pour un
// ordre, et la criticité en est un.
const WIDTH_BY_CRITICALITY: Record<string, number> = {
  "1 - critical": 3.5,
  "2 - important": 2,
  "3 - standard": 1,
};

function strokeWidthOf(edge: RenderEdge, byCriticality: boolean): number {
  if (!byCriticality || !edge.criticality) return STROKE_WIDTH;
  return WIDTH_BY_CRITICALITY[normalizeText(edge.criticality)] ?? STROKE_WIDTH;
}

function buildEdgeElement(
  edge: RenderEdge,
  colorFor: (tech: string) => string,
  labelRect: Rect | null,
  byCriticality: boolean
): SVGGElement {
  const g = el("g");
  const colour = edgeColour(edge, colorFor);

  // Le nom de l'échange se lit ici, au hover, dans le navigateur comme dans
  // un .svg ouvert seul. La condition « au moins deux noms » en privait toute
  // arête simple, c'est-à-dire la quasi-totalité d'entre elles : sur le
  // classeur d'exemple, 23 arêtes sur 24 étaient muettes.
  if (edge.names && edge.names.length > 0) {
    const tooltip = el("title");
    tooltip.textContent = edge.names.join("\n");
    g.appendChild(tooltip);
  }

  const headSize = tailleDePointe(longueurDApproche(edge));
  const drawnPoints = edge.arrow
    ? reculerPourLaPointe(edge.points, headSize + arrowGapFor(headSize), edge.pulled === true)
    : edge.points;
  const pieces = breakTheLine(drawnPoints, labelRect ? [labelRect] : []);

  pieces.forEach((piece, i) => {
    const path = el("path");
    path.setAttribute("d", cheminArrondi(piece));
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", colour);
    path.setAttribute("stroke-width", String(strokeWidthOf(edge, byCriticality)));
    // La pointe ne va que sur le morceau qui aborde celui qu'elle désigne : le
    // dernier quand le fournisseur pousse, le premier quand le consommateur
    // appelle. Le marqueur s'oriente seul (auto-start-reverse), une seule
    // définition sert les deux.
    if (edge.arrow) {
      if (edge.pulled && i === 0) path.setAttribute("marker-start", `url(#${arrowMarkerId(colour, true, headSize)})`);
      if (!edge.pulled && i === pieces.length - 1) path.setAttribute("marker-end", `url(#${arrowMarkerId(colour, false, headSize)})`);
    }
    if (edge.attenuated) {
      path.setAttribute("stroke-dasharray", "6 4");
      path.setAttribute("opacity", "0.5");
    }
    // Un retrait n'était que ROUGE, un ajout que vert : à l'impression, les
    // deux devenaient le même gris. Le tiret long dit « ce trait s'en va »
    // sans dépendre de la couleur.
    if (edge.change === "removed") path.setAttribute("stroke-dasharray", "10 5");
    g.appendChild(path);
  });



  // Point de départ : marque explicitement le nœud d'origine, à l'image de
  // la pointe qui marque l'arrivée -- un tronc de fusion part d'un point de
  // confluence, pas d'un vrai nœud, donc n'en porte pas.

  return g;
}





function buildIcon(name: string, x: number, y: number, size: number, colour: string): SVGGElement {
  const g = el("g");
  const scale = size / 24;
  g.setAttribute("transform", `translate(${x},${y}) scale(${scale})`);
  g.setAttribute("fill", "none");
  g.setAttribute("stroke", colour);
  g.setAttribute("stroke-width", "2");
  g.setAttribute("stroke-linecap", "round");
  g.setAttribute("stroke-linejoin", "round");
  // Un nom inconnu retombe sur le jeton neutre plutôt que de ne rien dessiner :
  // une boîte sans icône se lirait comme un oubli, pas comme une erreur de
  // saisie -- que les contrôles d'intégrité signalent par ailleurs.
  for (const element of ICONS[name] ?? ICONS[DEFAULT_ICON]) {
    const e = el(element.tag);
    for (const [attr, val] of Object.entries(element.attrs)) e.setAttribute(attr, val);
    g.appendChild(e);
  }
  return g;
}

// Chip arrondi (style C4 « type » / « externe ») : fond teinté à faible
// opacité, texte de la même couleur que la bordure du nœud.
function buildChip(x: number, y: number, contenu: string, colour: string): { element: SVGGElement; width: number } {
  const width = contenu.length * 5.3 + 14;
  const height = 15;
  const g = el("g");
  const fill = el("rect");
  fill.setAttribute("x", String(x));
  fill.setAttribute("y", String(y));
  fill.setAttribute("width", String(width));
  fill.setAttribute("height", String(height));
  fill.setAttribute("rx", String(height / 2));
  fill.setAttribute("fill", colour);
  fill.setAttribute("opacity", "0.16");
  g.appendChild(fill);
  const text = el("text");
  text.setAttribute("x", String(x + width / 2));
  text.setAttribute("y", String(y + height / 2 + 3.2));
  text.setAttribute("text-anchor", "middle");
  text.setAttribute("font-size", "9");
  text.setAttribute("font-weight", "600");
  text.setAttribute("fill", colour);
  text.textContent = contenu;
  g.appendChild(text);
  return { element: g, width };
}

// Frontière au sens C4 : un cadre en pointillés autour des composants du
// produit, son libellé en haut à gauche. Elle n'a ni fond ni icône -- c'est un
// contour, pas une boîte, et elle se dessine avant tout le reste pour rester
// dessous.
function buildBoundaryElement(node: LayoutNode): SVGGElement {
  const g = el("g");
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;

  const frame = rect(x, y, node.width, node.height, "none", "#7a828d", 1.5);
  frame.setAttribute("stroke-dasharray", "8 5");
  g.appendChild(frame);

  const label = el("text");
  label.setAttribute("x", String(x + 12));
  label.setAttribute("y", String(y + 17));
  label.setAttribute("font-size", "11");
  label.setAttribute("font-weight", "600");
  label.setAttribute("letter-spacing", "0.4");
  label.setAttribute("fill", SECONDARY_GREY);
  label.textContent = node.label;
  g.appendChild(label);

  return g;
}

function buildNodeElement(node: LayoutNode): SVGGElement {
  const g = el("g");
  if (node.dimming !== undefined) g.setAttribute("opacity", String(node.dimming));
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;
  const style = styleOfNode(node);
  const isExternal = !!node.external;

  // Un groupe replié se dessine en PILE : deux boîtes décalées derrière la
  // sienne. Le lecteur voit d'un coup d'œil que ce nœud en contient plusieurs,
  // là où seul le sous-titre « 4 actors » le disait.
  if (node.aggregate && node.aggregate > 1) {
    const pile = el("g");
    pile.setAttribute("class", "fx-stack");
    for (const offset of [8, 4]) {
      const behind = rect(x + offset, y - offset, node.width, node.height, style.fill, style.stroke, style.strokeWidth);
      behind.setAttribute("rx", "10");
      behind.setAttribute("opacity", "0.55");
      pile.appendChild(behind);
    }
    g.appendChild(pile);
  }

  // Un acteur TECHNIQUE porte un coin coupé, comme un composant. C'est la
  // convention qu'ArchiMate a déjà tranchée (§3.9) : la forme redit ce que la
  // couleur dit, et la couleur seule ne dit rien en noir et blanc ni pour un
  // daltonien (WCAG 1.4.1, technique G111).
  const COUPE = 14;
  let box: SVGElement;
  if (node.technical) {
    const path = el("path");
    path.setAttribute("class", "fx-cut-corner");
    path.setAttribute(
      "d",
      `M${x + 10} ${y} H${x + node.width - COUPE} L${x + node.width} ${y + COUPE} V${y + node.height - 10}` +
        ` a10 10 0 0 1 -10 10 H${x + 10} a10 10 0 0 1 -10 -10 V${y + 10} a10 10 0 0 1 10 -10 Z`
    );
    path.setAttribute("fill", style.fill);
    path.setAttribute("stroke", style.stroke);
    path.setAttribute("stroke-width", String(style.strokeWidth));
    path.setAttribute("stroke-linejoin", "round");
    box = path;
  } else {
    const r = rect(x, y, node.width, node.height, style.fill, style.stroke, style.strokeWidth);
    r.setAttribute("rx", "10"); // arcSize=10 dans le gabarit draw.io
    box = r;
  }
  // Le trait discontinu redit « externe » par la forme : la couleur seule ne
  // suffit pas en noir et blanc ni pour un daltonien.
  if (isExternal) box.setAttribute("stroke-dasharray", "8 5");
  g.appendChild(box);

  const blanc = "#ffffff";
  // Blanc, pas gris. #cccccc tombait à 1,81:1 ; une demi-teinte ne suffit pas
  // non plus -- #e8eef2 ne donne que 3,94:1. La hiérarchie visuelle est déjà
  // portée par la taille (16 px gras, 12 px, 11 px), la couleur n'a pas à la
  // porter en plus.
  const descGrey = "#ffffff";
  const cx = node.x;

  // Bloc de texte centré dans la boîte : nom en 16 gras, [Type] en dessous,
  // ligne vide, puis description en 11 gris clair -- la maquette draw.io.
  const rows = lignesDescription(node.description);
  let cursor = node.y - nodeTextHeight(node) / 2;

  const iconSize = 16;
  const shownName = truncatedName(node.label);
  const nameWidth = shownName.length * 8.2;
  g.appendChild(buildIcon(node.icon ?? DEFAULT_ICON, cx - nameWidth / 2 - iconSize - 6, cursor + 1, iconSize, blanc));

  const nameText = el("text");
  nameText.setAttribute("x", String(cx + iconSize / 2 + 3));
  nameText.setAttribute("y", String(cursor + 14));
  nameText.setAttribute("text-anchor", "middle");
  nameText.setAttribute("font-size", "16");
  nameText.setAttribute("font-weight", "700");
  nameText.setAttribute("fill", blanc);
  nameText.textContent = shownName;
  g.appendChild(nameText);
  // Tronqué, le nom reste lisible au hover de la boîte entière -- dans le
  // navigateur comme dans un .svg ouvert seul. Posé sur le groupe et non sur
  // l'élément texte : là, il s'ajouterait au textContent du nom.
  if (shownName !== node.label) {
    const tooltip = el("title");
    tooltip.textContent = node.label;
    g.appendChild(tooltip);
  }
  cursor += NAME_LINE_HEIGHT;

  if (node.subtitle) {
    const typeText = el("text");
    typeText.setAttribute("x", String(cx));
    typeText.setAttribute("y", String(cursor + 12));
    typeText.setAttribute("text-anchor", "middle");
    typeText.setAttribute("font-size", "12");
    typeText.setAttribute("fill", blanc);
    typeText.textContent = `[${node.subtitle}${isExternal ? " · External" : ""}]`;
    g.appendChild(typeText);
    cursor += HAUTEUR_LIGNE_TYPE;
  }

  if (rows.length) cursor += EMPTY_LINE_HEIGHT;
  for (const row of rows) {
    const descText = el("text");
    descText.setAttribute("x", String(cx));
    descText.setAttribute("y", String(cursor + 11));
    descText.setAttribute("text-anchor", "middle");
    descText.setAttribute("font-size", "11");
    descText.setAttribute("fill", descGrey);
    descText.textContent = row;
    g.appendChild(descText);
    cursor += DESC_LINE_HEIGHT;
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
const HEAD_SIZE = 12;

// Deux pointes, et c'est ELLES qui disent qui appelle : un DARD PLEIN quand le
// fournisseur pousse, un V OUVERT quand le consommateur tire. La position de
// la pointe ne suffisait pas -- il aurait fallu savoir quel bout du trait était
// le fournisseur, ce que le dessin ne dit pas.
//
// Deux silhouettes, pas seulement deux remplissages : un dard évidé et un dard
// plein se confondent à petite taille et à l'impression. C'est le couple
// qu'UML emploie sur ses messages -- triangle plein pour un appel synchrone, V
// ouvert pour un message asynchrone -- et les deux DSL cibles savent l'écrire
// (normal / vee en LikeC4).
function addArrowMarker(defs: SVGDefsElement, colour: string, hollow = false, size = HEAD_SIZE): void {
  const marker = el("marker");
  marker.setAttribute("id", arrowMarkerId(colour, hollow, size));
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "0");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", String(size));
  marker.setAttribute("markerHeight", String(size));
  marker.setAttribute("orient", "auto-start-reverse");
  // Même boîte englobante dans les deux cas (0..10, pointe en (10,5)) : le
  // recul du trait avant contact ne dépend donc pas de la forme.
  const arrowPath = el("path");
  if (hollow) {
    // Le V : deux traits ouverts, aucun remplissage, aucune base. Rien à voir
    // avec la silhouette du dard, même de loin.
    arrowPath.setAttribute("d", "M 0.5,0 L 10,5 L 0.5,10");
    arrowPath.setAttribute("fill", "none");
    arrowPath.setAttribute("stroke", colour);
    arrowPath.setAttribute("stroke-width", "2");
    arrowPath.setAttribute("stroke-linecap", "round");
    arrowPath.setAttribute("stroke-linejoin", "round");
  } else {
    // Dard adouci : côtés légèrement convexes vers la pointe, dos légèrement
    // concave plutôt que les trois arêtes droites d'un triangle brut.
    arrowPath.setAttribute("d", "M 0,0 Q 6,1 10,5 Q 6,9 0,10 Q 2.5,5 0,0 Z");
    arrowPath.setAttribute("fill", colour);
  }
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
}

// Marge autour du contenu réel du diagramme (traits, pastilles de libellé,
// pointes de flèche). Les dimensions que rend le moteur de layout ne
// couvrent que les nœuds et leur tracé brut -- une fois les flux répartis en
// enveloppe (jusque sur les faces haut/bas) et détournés, le dessin peut
// largement déborder de ce cadre-là.
const MARGE_CADRE = 24;

// Le gris de tout ce qui est secondaire. Pas un gris pâle : #6b7480 tenait
// 4,74:1 sur blanc, à la limite du seuil et inconfortable en petit corps.
const SECONDARY_GREY = "#39424f";

const DISC_RADIUS = 3.5;
// Le disque plus son écart au texte : la place que taillePastille doit réserver.
const DISC_WIDTH = DISC_RADIUS * 2 + 4;

const ID_TITRE = "fx-titre";
const DESC_ID = "fx-desc";

function computeBounds(nodes: LayoutNode[], edges: RenderEdge[], labels: Map<RenderEdge, Point>): { x0: number; y0: number; x1: number; y1: number } {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const expand = (x: number, y: number) => {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  };
  for (const n of nodes) {
    expand(n.x - n.width / 2, n.y - n.height / 2);
    expand(n.x + n.width / 2, n.y + n.height / 2);
  }
  for (const e of edges) {
    // Le tracé suit exactement ses points de passage (polyligne orthogonale,
    // arrondis compris puisqu'ils restent dans le coude) : plus de débordement
    // à anticiper comme avec une spline.
    for (const p of e.points) expand(p.x, p.y);
    if (e.arrow) {
      // La pointe s'étale autour de l'extrémité du tracé, dans une direction
      // qui dépend de l'orientation du trait : on réserve son gabarit entier.
      const bout = e.points[e.points.length - 1];
      expand(bout.x - HEAD_SIZE, bout.y - HEAD_SIZE);
      expand(bout.x + HEAD_SIZE, bout.y + HEAD_SIZE);
    }
    // La pastille d'un libellé déborde largement de son seul point d'ancrage
    // (ex. "Fichier + ETL (dépôt)") -- compter sa vraie largeur, pas juste ce point.
    const pos = labels.get(e);
    if (pos) {
      const size = taillePastille(e.label, e.technology);
      expand(pos.x - size.width / 2, pos.y - size.height / 2);
      expand(pos.x + size.width / 2, pos.y + size.height / 2);
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
// La légende porte désormais la NOTATION en plus du code couleur : une
// douzaine d'entrées là où il y en avait cinq. À 10 px elle était le plus
// petit texte de la planche, celui qu'on lit en dernier alors qu'il explique
// tout le reste.
const LEGEND_TEXT_SIZE = 12;
const LEGEND_LINE = 19;
const LEGEND_PAD = 12;
const LEGEND_SAMPLE = 26;
// Largeur moyenne d'un caractère à cette taille, dans la pile de polices du
// schéma. Sous-estimée, le texte déborde du cadre.
const LEGEND_CHAR_WIDTH = 6.7;

function widthOfLegend(inputs: string[]): number {
  const text = Math.max(0, ...inputs.map((e) => e.length * LEGEND_CHAR_WIDTH));
  return LEGEND_PAD * 2 + LEGEND_SAMPLE + 10 + text;
}

function buildLegend(inputs: readonly LegendEntry[], x: number, y: number, width: number, height: number): SVGGElement {
  const g = el("g");
  g.setAttribute("class", "fx-legend");
  g.appendChild(rect(x, y, width, height, PAPER, "#c8cdd5", 1));

  let row = y + LEGEND_PAD + LEGEND_LINE / 2;

  const line = (e: Extract<LegendSample, { shape: "line" }>): SVGElement => {
    const l = el("line");
    // La pointe DÉBORDE du bout du trait, de TAILLE_POINTE. Sans ce
    // raccourcissement elle empiétait sur le texte de l'entrée -- une légende
    // qui se chevauche elle-même.
    const margin = e.head ? HEAD_SIZE : 0;
    l.setAttribute("x1", String(x + LEGEND_PAD + (e.head === "start" ? margin : 0)));
    l.setAttribute("y1", String(row));
    l.setAttribute("x2", String(x + LEGEND_PAD + LEGEND_SAMPLE - (e.head === "end" ? margin : 0)));
    l.setAttribute("y2", String(row));
    l.setAttribute("stroke", e.colour);
    l.setAttribute("stroke-width", String(e.thickness ?? STROKE_WIDTH));
    if (e.dashed) l.setAttribute("stroke-dasharray", "6 4");
    if (e.head === "end") l.setAttribute("marker-end", `url(#${arrowMarkerId(e.colour)})`);
    if (e.head === "start") l.setAttribute("marker-start", `url(#${arrowMarkerId(e.colour, true)})`);
    return l;
  };

  // L'échantillon MONTRE la forme qu'il annonce : une boîte ordinaire sous
  // « cut corner » serait une entrée de légende aussi muette que le signe
  // qu'elle prétend expliquer.
  const box = (e: Extract<LegendSample, { shape: "box" }>): SVGElement => {
    const x0 = x + LEGEND_PAD;
    const y0 = row - 5;
    const l = LEGEND_SAMPLE;
    const h = 10;
    if (e.pile) {
      const g2 = el("g");
      for (const [dx, dy, op] of [[4, -3, "0.55"], [0, 0, "1"]] as [number, number, string][]) {
        const r = rect(x0 + dx, y0 + dy, l - 4, h, e.fill, e.stroke, 1);
        r.setAttribute("opacity", op);
        g2.appendChild(r);
      }
      return g2;
    }
    if (e.cutCorner) {
      const coupe = 4;
      const p2 = el("path");
      p2.setAttribute("d", `M${x0} ${y0} H${x0 + l - coupe} L${x0 + l} ${y0 + coupe} V${y0 + h} H${x0} Z`);
      p2.setAttribute("fill", e.fill);
      p2.setAttribute("stroke", e.stroke);
      p2.setAttribute("stroke-width", "1");
      return p2;
    }
    const r = rect(x0, y0, l, h, e.fill, e.stroke, 1);
    if (e.dashed) r.setAttribute("stroke-dasharray", "3 2");
    return r;
  };

  for (const input of inputs) {
    g.appendChild(input.sample.shape === "line" ? line(input.sample) : box(input.sample));
    const t = el("text");
    t.setAttribute("x", String(x + LEGEND_PAD + LEGEND_SAMPLE + 10));
    t.setAttribute("y", String(row + 4));
    t.setAttribute("font-size", String(LEGEND_TEXT_SIZE));
    t.setAttribute("fill", INK);
    t.textContent = input.text;
    g.appendChild(t);
    row += LEGEND_LINE;
  }

  return g;
}

export function buildGraphSvg(
  layout: LayoutResult,
  colorFor: (tech: string) => string,
  // Ce que le schéma dit de lui-même. `null` pour les appels qui n'ont rien à
  // en dire -- un test de rendu, un fragment -- plutôt qu'un cartouche vide.
  context: DiagramContext | null = null,
  options?: { weightByCriticality?: boolean }
): SVGSVGElement {
  // Les tracés viennent d'ELK : ports répartis sur le côté imposé et routage
  // orthogonal évitant les boîtes par construction. Il ne reste qu'à fusionner
  // les flux de même technologie vers une même cible.
  const renderEdges = fusionnerParTechnologieVersCible(layout.edges);
  const labels = placeLabels(renderEdges);

  const bounds = computeBounds(layout.nodes, renderEdges, labels);

  // La légende occupe un coin réservé sous le dessin : on l'ajoute aux bornes
  // plutôt que de la poser par-dessus le schéma.
  // On n'énumère que ce qui sert : un trait marqué d'un écart ne porte plus la
  // couleur de sa technologie, celle-ci n'a donc rien à faire dans la légende.
  // Et une technologie vide n'en est pas une -- le mode fonctionnel vide
  // `technologie` sur toutes ses arêtes, une entrée sans nom n'annoncerait
  // qu'un code couleur introuvable sur le dessin.
  const inputs = legendEntries(renderEdges, layout.nodes, colorFor, options?.weightByCriticality === true);
  const legendWidth = inputs.length ? widthOfLegend(inputs.map((e) => e.text)) : 0;
  const legendHeight = inputs.length ? LEGEND_PAD * 2 + inputs.length * LEGEND_LINE : 0;

  if (inputs.length) {
    bounds.y1 += MARGE_CADRE + legendHeight;
    bounds.x0 = Math.min(bounds.x0, bounds.x1 - legendWidth);
  }

  // Le cartouche occupe une bande réservée au-dessus du dessin, comme la
  // légende occupe la sienne au-dessous.
  if (context) bounds.y0 -= MARGE_CADRE + HAUTEUR_CARTOUCHE;

  const width = bounds.x1 - bounds.x0;
  const height = bounds.y1 - bounds.y0;

  const svg = el("svg");
  svg.setAttribute("xmlns", SVG_NS);
  // Le fichier nomme sa police : hérité de la page, il retombait en serif dès
  // qu'on l'ouvrait seul, alors que les largeurs d'étiquettes sont calibrées
  // pour cette pile-là.
  svg.setAttribute("font-family", POLICE);
  // Le viewBox pilote le CADRAGE (zoom, panoramique) ; width et height fixent
  // la taille d'affichage, qui reste celle du dessin. Étirer le SVG à la
  // largeur de la fenêtre a été essayé : tout tenait à l'écran, et plus rien
  // n'était lisible -- 0,5x d'échelle, donc une légende à 5 px.
  svg.setAttribute("viewBox", `${bounds.x0} ${bounds.y0} ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  // Le patron d'accessibilité n°11 de l'étude Deque, le plus fiable des douze
  // testés sur l'ensemble navigateurs x lecteurs d'écran. Deux exigences :
  // <title> et <desc> doivent être ENFANTS DIRECTS de <svg> -- SVG-AAM ne
  // remonte pas plus profond -- et aria-labelledby prime sur <title> seul,
  // notoirement peu fiable en NVDA + Firefox.
  if (context) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", `${ID_TITRE} ${DESC_ID}`);
    const title = el("title");
    title.setAttribute("id", ID_TITRE);
    title.textContent = titleBlockText(context).title;
    svg.appendChild(title);
    const desc = el("desc");
    desc.setAttribute("id", DESC_ID);
    desc.textContent = descriptionAccessible(context);
    svg.appendChild(desc);
  }

  const defs = el("defs");
  // Une définition par (couleur, forme, taille) réellement employée.
  const marqueurs = new Map<string, { colour: string; hollow: boolean; size: number }>();
  const declare = (colour: string, hollow: boolean, size: number) =>
    marqueurs.set(arrowMarkerId(colour, hollow, size), { colour, hollow, size });
  for (const e of renderEdges) {
    if (!e.arrow) continue;
    declare(edgeColour(e, colorFor), e.pulled === true, tailleDePointe(longueurDApproche(e)));
  }
  // La légende dessine ses propres échantillons fléchés : leur marqueur doit
  // exister dans <defs>, sans quoi l'entrée sort sans pointe -- c'est-à-dire
  // qu'elle explique une notation en ne la montrant pas. Son échantillon est
  // assez long pour la taille pleine.
  for (const e of inputs) {
    if (e.sample.shape !== "line" || !e.sample.head) continue;
    declare(e.sample.colour, e.sample.head === "start", HEAD_SIZE);
  }
  for (const m of marqueurs.values()) addArrowMarker(defs, m.colour, m.hollow, m.size);
  svg.appendChild(defs);

  const background = rect(bounds.x0, bounds.y0, width, height, PAPER, "none", 0);
  svg.appendChild(background);

  if (context) svg.appendChild(buildTitleBlock(context, bounds.x0 + MARGE_CADRE, bounds.y0 + MARGE_CADRE));

  // Rectangle occupé par chaque libellé : c'est là que son trait s'interrompt.
  const labelRect = (e: RenderEdge): Rect | null => {
    const centre = labels.get(e);
    if (!centre || !e.label) return null;
    const t = taillePastille(e.label, e.technology);
    return { x0: centre.x - t.width / 2, y0: centre.y - t.height / 2, x1: centre.x + t.width / 2, y1: centre.y + t.height / 2 };
  };

  const edgeLayer = el("g");
  edgeLayer.setAttribute("class", "fx-edges");
  for (const edge of renderEdges) {
    edgeLayer.appendChild(buildEdgeElement(edge, colorFor, labelRect(edge), options?.weightByCriticality === true));
  }
  svg.appendChild(edgeLayer);

  // Les frontières passent sous les arêtes : ce sont des repères de fond, pas
  // des objets à survoler.
  const boundaryLayer = el("g");
  boundaryLayer.setAttribute("class", "fx-frontieres");
  for (const node of layout.nodes.filter((n) => n.kind === "boundary")) {
    boundaryLayer.appendChild(buildBoundaryElement(node));
  }
  svg.insertBefore(boundaryLayer, edgeLayer);

  const nodeLayer = el("g");
  nodeLayer.setAttribute("class", "fx-nodes");
  for (const node of layout.nodes.filter((n) => n.kind !== "boundary")) {
    nodeLayer.appendChild(buildNodeElement(node));
  }
  svg.appendChild(nodeLayer);

  // Ordre de dessin : frontières, arêtes, boîtes, puis libellés. Les libellés
  // passent en dernier pour qu'aucun trait ni aucune boîte ne les recouvre --
  // tant qu'ils vivaient dans le groupe de leur arête, une boîte posée après
  // pouvait les masquer.
  const labelLayer = el("g");
  labelLayer.setAttribute("class", "fx-labels");
  for (const edge of renderEdges) {
    const anchor = labels.get(edge);
    if (!edge.label || !anchor) continue;
    labelLayer.appendChild(
      buildEdgeLabel(
        anchor.x,
        anchor.y,
        edge.label,
        subLabelOf(edge.label, edge.technology),
        edgeColour(edge, colorFor),
        edge.attenuated,
        !edge.change && edge.technology.trim() !== ""
      )
    );
  }
  svg.appendChild(labelLayer);

  if (inputs.length) {
    svg.appendChild(buildLegend(inputs, bounds.x1 - legendWidth, bounds.y1 - legendHeight, legendWidth, legendHeight));
  }

  return svg;
}
