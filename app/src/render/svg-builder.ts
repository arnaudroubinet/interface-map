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
import {
  cheminArrondi,
  interrompreLeTrace,
  reculerPourLaPointe,
  segmentIntersecteRect,
  RAYON_ANGLE,
  type Point,
  type Rect,
} from "./geometrie";
import { PAPIER, ENCRE, ÉPAISSEUR_TRAIT, COULEUR_ECART, styleDuNoeud } from "./styles-noeud";
import { entreesDeLegende, type EntreeLegende, type ÉchantillonLegende } from "./legende";
import { construireCartouche, descriptionAccessible, libelléCartouche, HAUTEUR_CARTOUCHE, type ContexteSchema } from "./cartouche";

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

// La pointe doit TENIR dans le segment qui la porte. ELK sort d'une boîte par
// un stub perpendiculaire à la face -- parfois 5 px -- puis tourne : une pointe
// de 12 px y dépassait le coude et se plantait sur le segment suivant, de
// côté, comme si le trait arrivait par le flanc de la flèche. Sur le classeur
// d'exemple, 14 arêtes sur 24 étaient dans ce cas.
//
// On la rétrécit par paliers plutôt que continûment : une taille par arête
// ferait autant de définitions de marqueur que d'arêtes.
const TAILLES_POINTE = [12, 8, 5, 3] as const;

// L'écart avant contact suit la pointe : gardé à 4 px sous une pointe de 3, il
// mangerait plus que la pointe elle-même.
function écartDePointe(taille: number): number {
  return Math.min(ÉCART_POINTE, taille / 3);
}

function tailleDePointe(longueurApproche: number): number {
  return TAILLES_POINTE.find((t) => longueurApproche >= t + écartDePointe(t)) ?? TAILLES_POINTE[TAILLES_POINTE.length - 1];
}

// La longueur DROITE réellement disponible au bout du trait pour y poser la
// pointe. Deux retranchements, et oublier le second était l'erreur : le
// segment brut d'ELK perd de la longueur dans l'arrondi du coude qui le
// précède -- jusqu'à RAYON_ANGLE, ou la moitié du segment s'il est court.
function longueurDApproche(edge: RenderEdge): number {
  const p = edge.points;
  const [a, b] = edge.tire ? [p[0], p[1]] : [p[p.length - 1], p[p.length - 2]];
  if (!a || !b) return 0;
  const brute = Math.hypot(b.x - a.x, b.y - a.y);
  return brute - Math.min(RAYON_ANGLE, brute / 2);
}

function idMarqueurFlèche(couleur: string, creuse = false, taille = TAILLE_POINTE): string {
  return `${creuse ? "fleche-creuse" : "fleche"}-${taille}-${couleur.replace(/[^a-zA-Z0-9]/g, "")}`;
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
// Le rappel de couleur passe par un DISQUE, pas par l'encre du texte : les
// huit teintes de la palette échouent toutes à 4,5:1 comme texte, et écrire en
// couleur rendait le schéma illisible en niveaux de gris. C'est exactement ce
// que la matrice fait déjà. Une couleur d'écart, elle, reste l'encre : là, la
// teinte EST le message, et les deux passent le seuil (5,05 et 4,80).
function construireLibelléArête(
  cx: number,
  cy: number,
  texte: string,
  sousTexte: string | undefined,
  couleur: string,
  atténué: boolean,
  pastilleCouleur: boolean
): SVGGElement {
  const g = el("g");
  const hauteur = HAUTEUR_PASTILLE + (sousTexte ? 10 : 0);
  const yTexte = sousTexte ? cy - hauteur / 2 + 9 : cy + 3.5;
  const décalage = pastilleCouleur ? LARGEUR_DISQUE : 0;

  const poser = (contenu: string, y: number, taille: string, remplissage: string, gras: boolean) => {
    const t = el("text");
    t.setAttribute("x", String(cx + décalage / 2));
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

  if (pastilleCouleur) {
    const disque = el("circle");
    disque.setAttribute("cx", String(cx - largeurPastille(texte) / 2 - décalage / 2 + RAYON_DISQUE + 7));
    disque.setAttribute("cy", String(yTexte - 3.5));
    disque.setAttribute("r", String(RAYON_DISQUE));
    disque.setAttribute("fill", couleur);
    disque.setAttribute("stroke", PAPIER);
    disque.setAttribute("stroke-width", "1.5");
    if (atténué) disque.setAttribute("opacity", "0.7");
    g.appendChild(disque);
  }

  poser(texte, yTexte, "11", pastilleCouleur ? ENCRE : couleur, true);
  // 8,5 px en gris pâle : le plus petit texte du schéma était aussi le moins
  // contrasté. 10 px et un ardoise franc (10,16:1 contre 4,74:1).
  if (sousTexte) poser(sousTexte, yTexte + 11, "10", GRIS_SECONDAIRE, false);
  return g;
}



// Un trait qui apparaît ou disparaît entre deux paliers porte sa propre
// couleur : la technologie n'est plus l'information principale, le changement
// l'est. Ailleurs, rien ne change.
// Les couleurs elles-mêmes vivent dans styles-noeud.ts : écrites en clair, pas
// en variables CSS -- celles-ci ne sont définies que dans la page de l'appli.
// Hors d'elle -- un .svg ouvert seul, un PNG rastérisé -- le trait se résolvait
// à « none » et le schéma Écarts sortait SANS AUCUN TRAIT.

function couleurArête(edge: RenderEdge, colorFor: (tech: string) => string): string {
  return edge.ecart ? COULEUR_ECART[edge.ecart] : colorFor(edge.technologie);
}

function buildEdgeElement(edge: RenderEdge, colorFor: (tech: string) => string, rectLibellé: Rect | null): SVGGElement {
  const g = el("g");
  const couleur = couleurArête(edge, colorFor);

  // Le nom de l'échange se lit ici, au survol, dans le navigateur comme dans
  // un .svg ouvert seul. La condition « au moins deux noms » en privait toute
  // arête simple, c'est-à-dire la quasi-totalité d'entre elles : sur le
  // classeur d'exemple, 23 arêtes sur 24 étaient muettes.
  if (edge.noms && edge.noms.length > 0) {
    const infobulle = el("title");
    infobulle.textContent = edge.noms.join("\n");
    g.appendChild(infobulle);
  }

  const taillePointe = tailleDePointe(longueurDApproche(edge));
  const pointsTracé = edge.fleche
    ? reculerPourLaPointe(edge.points, taillePointe + écartDePointe(taillePointe), edge.tire === true)
    : edge.points;
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
      if (edge.tire && i === 0) path.setAttribute("marker-start", `url(#${idMarqueurFlèche(couleur, true, taillePointe)})`);
      if (!edge.tire && i === morceaux.length - 1) path.setAttribute("marker-end", `url(#${idMarqueurFlèche(couleur, false, taillePointe)})`);
    }
    if (edge.atténué) {
      path.setAttribute("stroke-dasharray", "6 4");
      path.setAttribute("opacity", "0.5");
    }
    // Un retrait n'était que ROUGE, un ajout que vert : à l'impression, les
    // deux devenaient le même gris. Le tiret long dit « ce trait s'en va »
    // sans dépendre de la couleur.
    if (edge.ecart === "retrait") path.setAttribute("stroke-dasharray", "10 5");
    g.appendChild(path);
  });



  // Point de départ : marque explicitement le nœud d'origine, à l'image de
  // la pointe qui marque l'arrivée -- un tronc de fusion part d'un point de
  // confluence, pas d'un vrai nœud, donc n'en porte pas.

  return g;
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
  libellé.setAttribute("fill", GRIS_SECONDAIRE);
  libellé.textContent = node.label;
  g.appendChild(libellé);

  return g;
}

function buildNodeElement(node: LayoutNode): SVGGElement {
  const g = el("g");
  if (node.attenuation !== undefined) g.setAttribute("opacity", String(node.attenuation));
  const x = node.x - node.width / 2;
  const y = node.y - node.height / 2;
  const style = styleDuNoeud(node);
  const estExterne = !!node.externe;

  // Un groupe replié se dessine en PILE : deux boîtes décalées derrière la
  // sienne. Le lecteur voit d'un coup d'œil que ce nœud en contient plusieurs,
  // là où seul le sous-titre « 4 actors » le disait.
  if (node.agrégat && node.agrégat > 1) {
    const pile = el("g");
    pile.setAttribute("class", "fx-pile");
    for (const décalage of [8, 4]) {
      const derrière = rect(x + décalage, y - décalage, node.width, node.height, style.fond, style.bord, style.épaisseurBord);
      derrière.setAttribute("rx", "10");
      derrière.setAttribute("opacity", "0.55");
      pile.appendChild(derrière);
    }
    g.appendChild(pile);
  }

  // Un acteur TECHNIQUE porte un coin coupé, comme un composant. C'est la
  // convention qu'ArchiMate a déjà tranchée (§3.9) : la forme redit ce que la
  // couleur dit, et la couleur seule ne dit rien en noir et blanc ni pour un
  // daltonien (WCAG 1.4.1, technique G111).
  const COUPE = 14;
  let boîte: SVGElement;
  if (node.technique) {
    const chemin = el("path");
    chemin.setAttribute("class", "fx-coin-coupe");
    chemin.setAttribute(
      "d",
      `M${x + 10} ${y} H${x + node.width - COUPE} L${x + node.width} ${y + COUPE} V${y + node.height - 10}` +
        ` a10 10 0 0 1 -10 10 H${x + 10} a10 10 0 0 1 -10 -10 V${y + 10} a10 10 0 0 1 10 -10 Z`
    );
    chemin.setAttribute("fill", style.fond);
    chemin.setAttribute("stroke", style.bord);
    chemin.setAttribute("stroke-width", String(style.épaisseurBord));
    chemin.setAttribute("stroke-linejoin", "round");
    boîte = chemin;
  } else {
    const r = rect(x, y, node.width, node.height, style.fond, style.bord, style.épaisseurBord);
    r.setAttribute("rx", "10"); // arcSize=10 dans le gabarit draw.io
    boîte = r;
  }
  // Le trait discontinu redit « externe » par la forme : la couleur seule ne
  // suffit pas en noir et blanc ni pour un daltonien.
  if (estExterne) boîte.setAttribute("stroke-dasharray", "8 5");
  g.appendChild(boîte);

  const blanc = "#ffffff";
  // Blanc, pas gris. #cccccc tombait à 1,81:1 ; une demi-teinte ne suffit pas
  // non plus -- #e8eef2 ne donne que 3,94:1. La hiérarchie visuelle est déjà
  // portée par la taille (16 px gras, 12 px, 11 px), la couleur n'a pas à la
  // porter en plus.
  const grisDesc = "#ffffff";
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
function ajouterMarqueurFlèche(defs: SVGDefsElement, couleur: string, creuse = false, taille = TAILLE_POINTE): void {
  const marker = el("marker");
  marker.setAttribute("id", idMarqueurFlèche(couleur, creuse, taille));
  marker.setAttribute("viewBox", "0 0 10 10");
  marker.setAttribute("refX", "0");
  marker.setAttribute("refY", "5");
  marker.setAttribute("markerUnits", "userSpaceOnUse");
  marker.setAttribute("markerWidth", String(taille));
  marker.setAttribute("markerHeight", String(taille));
  marker.setAttribute("orient", "auto-start-reverse");
  // Même boîte englobante dans les deux cas (0..10, pointe en (10,5)) : le
  // recul du trait avant contact ne dépend donc pas de la forme.
  const arrowPath = el("path");
  if (creuse) {
    // Le V : deux traits ouverts, aucun remplissage, aucune base. Rien à voir
    // avec la silhouette du dard, même de loin.
    arrowPath.setAttribute("d", "M 0.5,0 L 10,5 L 0.5,10");
    arrowPath.setAttribute("fill", "none");
    arrowPath.setAttribute("stroke", couleur);
    arrowPath.setAttribute("stroke-width", "2");
    arrowPath.setAttribute("stroke-linecap", "round");
    arrowPath.setAttribute("stroke-linejoin", "round");
  } else {
    // Dard adouci : côtés légèrement convexes vers la pointe, dos légèrement
    // concave plutôt que les trois arêtes droites d'un triangle brut.
    arrowPath.setAttribute("d", "M 0,0 Q 6,1 10,5 Q 6,9 0,10 Q 2.5,5 0,0 Z");
    arrowPath.setAttribute("fill", couleur);
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
const GRIS_SECONDAIRE = "#39424f";

const RAYON_DISQUE = 3.5;
// Le disque plus son écart au texte : la place que taillePastille doit réserver.
const LARGEUR_DISQUE = RAYON_DISQUE * 2 + 4;

const ID_TITRE = "fx-titre";
const ID_DESC = "fx-desc";

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
// La légende porte désormais la NOTATION en plus du code couleur : une
// douzaine d'entrées là où il y en avait cinq. À 10 px elle était le plus
// petit texte de la planche, celui qu'on lit en dernier alors qu'il explique
// tout le reste.
const LEGENDE_TAILLE_TEXTE = 12;
const LEGENDE_LIGNE = 19;
const LEGENDE_PAD = 12;
const LEGENDE_ECHANTILLON = 26;
// Largeur moyenne d'un caractère à cette taille, dans la pile de polices du
// schéma. Sous-estimée, le texte déborde du cadre.
const LEGENDE_LARGEUR_CAR = 6.7;

function largeurLegende(entrées: string[]): number {
  const texte = Math.max(0, ...entrées.map((e) => e.length * LEGENDE_LARGEUR_CAR));
  return LEGENDE_PAD * 2 + LEGENDE_ECHANTILLON + 10 + texte;
}

function construireLegende(entrées: readonly EntreeLegende[], x: number, y: number, largeur: number, hauteur: number): SVGGElement {
  const g = el("g");
  g.setAttribute("class", "fx-legende");
  g.appendChild(rect(x, y, largeur, hauteur, PAPIER, "#c8cdd5", 1));

  let ligne = y + LEGENDE_PAD + LEGENDE_LIGNE / 2;

  const trait = (é: Extract<ÉchantillonLegende, { forme: "trait" }>): SVGElement => {
    const l = el("line");
    // La pointe DÉBORDE du bout du trait, de TAILLE_POINTE. Sans ce
    // raccourcissement elle empiétait sur le texte de l'entrée -- une légende
    // qui se chevauche elle-même.
    const marge = é.pointe ? TAILLE_POINTE : 0;
    l.setAttribute("x1", String(x + LEGENDE_PAD + (é.pointe === "debut" ? marge : 0)));
    l.setAttribute("y1", String(ligne));
    l.setAttribute("x2", String(x + LEGENDE_PAD + LEGENDE_ECHANTILLON - (é.pointe === "fin" ? marge : 0)));
    l.setAttribute("y2", String(ligne));
    l.setAttribute("stroke", é.couleur);
    l.setAttribute("stroke-width", String(ÉPAISSEUR_TRAIT));
    if (é.pointillé) l.setAttribute("stroke-dasharray", "6 4");
    if (é.pointe === "fin") l.setAttribute("marker-end", `url(#${idMarqueurFlèche(é.couleur)})`);
    if (é.pointe === "debut") l.setAttribute("marker-start", `url(#${idMarqueurFlèche(é.couleur, true)})`);
    return l;
  };

  // L'échantillon MONTRE la forme qu'il annonce : une boîte ordinaire sous
  // « cut corner » serait une entrée de légende aussi muette que le signe
  // qu'elle prétend expliquer.
  const boite = (é: Extract<ÉchantillonLegende, { forme: "boite" }>): SVGElement => {
    const x0 = x + LEGENDE_PAD;
    const y0 = ligne - 5;
    const l = LEGENDE_ECHANTILLON;
    const h = 10;
    if (é.pile) {
      const g2 = el("g");
      for (const [dx, dy, op] of [[4, -3, "0.55"], [0, 0, "1"]] as [number, number, string][]) {
        const r = rect(x0 + dx, y0 + dy, l - 4, h, é.fond, é.bord, 1);
        r.setAttribute("opacity", op);
        g2.appendChild(r);
      }
      return g2;
    }
    if (é.coinCoupé) {
      const coupe = 4;
      const p2 = el("path");
      p2.setAttribute("d", `M${x0} ${y0} H${x0 + l - coupe} L${x0 + l} ${y0 + coupe} V${y0 + h} H${x0} Z`);
      p2.setAttribute("fill", é.fond);
      p2.setAttribute("stroke", é.bord);
      p2.setAttribute("stroke-width", "1");
      return p2;
    }
    const r = rect(x0, y0, l, h, é.fond, é.bord, 1);
    if (é.pointillé) r.setAttribute("stroke-dasharray", "3 2");
    return r;
  };

  for (const entrée of entrées) {
    g.appendChild(entrée.échantillon.forme === "trait" ? trait(entrée.échantillon) : boite(entrée.échantillon));
    const t = el("text");
    t.setAttribute("x", String(x + LEGENDE_PAD + LEGENDE_ECHANTILLON + 10));
    t.setAttribute("y", String(ligne + 4));
    t.setAttribute("font-size", String(LEGENDE_TAILLE_TEXTE));
    t.setAttribute("fill", ENCRE);
    t.textContent = entrée.texte;
    g.appendChild(t);
    ligne += LEGENDE_LIGNE;
  }

  return g;
}

export function buildGraphSvg(
  layout: LayoutResult,
  colorFor: (tech: string) => string,
  // Ce que le schéma dit de lui-même. `null` pour les appels qui n'ont rien à
  // en dire -- un test de rendu, un fragment -- plutôt qu'un cartouche vide.
  contexte: ContexteSchema | null = null
): SVGSVGElement {
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
  const entrées = entreesDeLegende(renderEdges, layout.nodes, colorFor);
  const légendeL = entrées.length ? largeurLegende(entrées.map((e) => e.texte)) : 0;
  const légendeH = entrées.length ? LEGENDE_PAD * 2 + entrées.length * LEGENDE_LIGNE : 0;

  if (entrées.length) {
    bornes.y1 += MARGE_CADRE + légendeH;
    bornes.x0 = Math.min(bornes.x0, bornes.x1 - légendeL);
  }

  // Le cartouche occupe une bande réservée au-dessus du dessin, comme la
  // légende occupe la sienne au-dessous.
  if (contexte) bornes.y0 -= MARGE_CADRE + HAUTEUR_CARTOUCHE;

  const largeur = bornes.x1 - bornes.x0;
  const hauteur = bornes.y1 - bornes.y0;

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
  svg.setAttribute("viewBox", `${bornes.x0} ${bornes.y0} ${largeur} ${hauteur}`);
  svg.setAttribute("width", String(largeur));
  svg.setAttribute("height", String(hauteur));

  // Le patron d'accessibilité n°11 de l'étude Deque, le plus fiable des douze
  // testés sur l'ensemble navigateurs x lecteurs d'écran. Deux exigences :
  // <title> et <desc> doivent être ENFANTS DIRECTS de <svg> -- SVG-AAM ne
  // remonte pas plus profond -- et aria-labelledby prime sur <title> seul,
  // notoirement peu fiable en NVDA + Firefox.
  if (contexte) {
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-labelledby", `${ID_TITRE} ${ID_DESC}`);
    const titre = el("title");
    titre.setAttribute("id", ID_TITRE);
    titre.textContent = libelléCartouche(contexte).titre;
    svg.appendChild(titre);
    const desc = el("desc");
    desc.setAttribute("id", ID_DESC);
    desc.textContent = descriptionAccessible(contexte);
    svg.appendChild(desc);
  }

  const defs = el("defs");
  // Une définition par (couleur, forme, taille) réellement employée.
  const marqueurs = new Map<string, { couleur: string; creuse: boolean; taille: number }>();
  const déclarer = (couleur: string, creuse: boolean, taille: number) =>
    marqueurs.set(idMarqueurFlèche(couleur, creuse, taille), { couleur, creuse, taille });
  for (const e of renderEdges) {
    if (!e.fleche) continue;
    déclarer(couleurArête(e, colorFor), e.tire === true, tailleDePointe(longueurDApproche(e)));
  }
  // La légende dessine ses propres échantillons fléchés : leur marqueur doit
  // exister dans <defs>, sans quoi l'entrée sort sans pointe -- c'est-à-dire
  // qu'elle explique une notation en ne la montrant pas. Son échantillon est
  // assez long pour la taille pleine.
  for (const e of entrées) {
    if (e.échantillon.forme !== "trait" || !e.échantillon.pointe) continue;
    déclarer(e.échantillon.couleur, e.échantillon.pointe === "debut", TAILLE_POINTE);
  }
  for (const m of marqueurs.values()) ajouterMarqueurFlèche(defs, m.couleur, m.creuse, m.taille);
  svg.appendChild(defs);

  const background = rect(bornes.x0, bornes.y0, largeur, hauteur, PAPIER, "none", 0);
  svg.appendChild(background);

  if (contexte) svg.appendChild(construireCartouche(contexte, bornes.x0 + MARGE_CADRE, bornes.y0 + MARGE_CADRE));

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
      construireLibelléArête(
        ancre.x,
        ancre.y,
        edge.label,
        sousLibelléDe(edge.label, edge.technologie),
        couleurArête(edge, colorFor),
        edge.atténué,
        !edge.ecart && edge.technologie.trim() !== ""
      )
    );
  }
  svg.appendChild(coucheLibellés);

  if (entrées.length) {
    svg.appendChild(construireLegende(entrées, bornes.x1 - légendeL, bornes.y1 - légendeH, légendeL, légendeH));
  }

  return svg;
}
