// La géométrie du tracé, sans le SVG.
//
// Ces fonctions ne connaissent que des points et des rectangles : elles ne
// touchent pas au DOM, ne savent rien des acteurs ni des technologies, et se
// vérifient donc sur des nombres. Elles vivaient au milieu de la construction
// SVG, dans un fichier de 960 lignes où l'on ne distinguait plus les deux
// métiers -- et elles portent pourtant la part la plus subtile du dessin :
// couper un trait sous une étiquette, réserver la place d'une pointe, arrondir
// un angle sans déformer le chemin.

export type Point = { x: number; y: number };

// --- Interruption d'un tracé par les boîtes --------------------------------
//
// Le libellé s'inscrit DANS le trait : celui-ci s'interrompt devant le texte
// et reprend derrière, ce qui l'attache à sa flèche sans le moindre doute.
//
//     ----- texte ------>
//
// Une pastille posée à côté du trait, même opaque, laisse toujours la question
// « laquelle va avec laquelle » quand plusieurs flux sont voisins.
export const BREAK_PLAY = 5;

// Ce qu'un libellé ne mange jamais à l'abord de la cible : de quoi poser la
// pointe sur un morceau qui aborde vraiment la boîte.
export const GAP_BEFORE_TARGET = 14;

// Portion d'un segment située dans un rectangle, sous forme d'intervalle de
// paramètre [0,1], ou null si le segment l'évite. Le segment étant orthogonal,
// on traite les deux axes séparément (algorithme de la tranche).
export function rectCrossing(a: Point, b: Point, r: Rect): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  for (const [from, arrivee, min, max] of [
    [a.x, b.x, r.x0, r.x1],
    [a.y, b.y, r.y0, r.y1],
  ] as [number, number, number, number][]) {
    const d = arrivee - from;
    if (Math.abs(d) < 1e-9) {
      if (from < min || from > max) return null;
      continue;
    }
    const u0 = (min - from) / d;
    const u1 = (max - from) / d;
    t0 = Math.max(t0, Math.min(u0, u1));
    t1 = Math.min(t1, Math.max(u0, u1));
    if (t0 > t1) return null;
  }
  return t0 < t1 ? [t0, t1] : null;
}

export const surSegment = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

// Découpe un tracé en morceaux visibles, en retirant ce qui tombe dans un
// rectangle, plus un jeu de part et d'autre.
export function breakTheLine(points: Point[], obstacles: Rect[]): Point[][] {
  const morceaux: Point[][] = [];
  let current: Point[] = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const longueur = Math.hypot(b.x - a.x, b.y - a.y);
    if (longueur < 1e-9) continue;
    const jeu = BREAK_PLAY / longueur;

    // Coupures sur ce segment, ordonnées, fusionnées quand elles se touchent.
    //
    // Sur le DERNIER segment la coupure ne va jamais jusqu'au bout : la pointe
    // se pose sur le dernier morceau visible, et sans ce reste ce morceau
    // devenait celui d'AVANT le libellé -- la flèche s'arrêtait à son étiquette
    // au lieu de la boîte visée.
    const plafond =
      i === points.length - 2 ? 1 - Math.min(0.5, GAP_BEFORE_TARGET / longueur) : 1;
    const cuts: [number, number][] = [];
    for (const r of obstacles) {
      const t = rectCrossing(a, b, r);
      if (!t) continue;
      const start = Math.max(0, t[0] - jeu);
      const end = Math.min(plafond, t[1] + jeu);
      if (end > start) cuts.push([start, end]);
    }
    cuts.sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const c of cuts) {
      const dernier = merged[merged.length - 1];
      if (dernier && c[0] <= dernier[1]) dernier[1] = Math.max(dernier[1], c[1]);
      else merged.push([...c]);
    }

    for (const [start, end] of merged) {
      if (start > 0) current.push(surSegment(a, b, start));
      if (current.length > 1) morceaux.push(current);
      current = end < 1 ? [surSegment(a, b, end)] : [];
    }
    if (current.length === 0) current = [b];
    else current.push(b);
  }

  if (current.length > 1) morceaux.push(current);
  return morceaux;
}

// Rayon des coudes. Une polyligne orthogonale brute donne un rendu anguleux ;
// quelques pixels d'arrondi suffisent à adoucir la planche entière.
export const RAYON_ANGLE = 6;

// Chemin SVG suivant une polyligne orthogonale, coudes arrondis.
//
// On normalise les directions plutôt que d'utiliser Math.sign : ça reste juste
// si ELK émet un segment très légèrement oblique, là où le signe seul
// produirait un point de contrôle aberrant. Deux cas sont écartés
// explicitement -- trois points alignés (pas de coude à arrondir, et le point
// de contrôle tomberait sur le sommet) et les segments de longueur nulle.
export function cheminArrondi(points: Point[], radius = RAYON_ANGLE): string {
  if (points.length === 0) return "";
  if (points.length < 3) return "M " + points.map((p) => `${p.x},${p.y}`).join(" L ");

  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1];
    const coude = points[i];
    const suivant = points[i + 1];
    const before = Math.hypot(coude.x - previous.x, coude.y - previous.y);
    const after = Math.hypot(suivant.x - coude.x, suivant.y - coude.y);
    const aligned = Math.abs((coude.x - previous.x) * (suivant.y - coude.y) - (coude.y - previous.y) * (suivant.x - coude.x)) < 0.01;

    if (aligned || before < 0.01 || after < 0.01) {
      d += ` L ${coude.x},${coude.y}`;
      continue;
    }
    const ra = Math.min(radius, before / 2);
    const rb = Math.min(radius, after / 2);
    const input = { x: coude.x + ((previous.x - coude.x) / before) * ra, y: coude.y + ((previous.y - coude.y) / before) * ra };
    const output = { x: coude.x + ((suivant.x - coude.x) / after) * rb, y: coude.y + ((suivant.y - coude.y) / after) * rb };
    d += ` L ${input.x},${input.y} Q ${coude.x},${coude.y} ${output.x},${output.y}`;
  }
  const dernier = points[points.length - 1];
  return d + ` L ${dernier.x},${dernier.y}`;
}

export type Rect = { x0: number; y0: number; x1: number; y1: number };

export function pointDansRect(p: Point, r: Rect): boolean {
  return p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1;
}

export function orientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = orientation(c, d, a);
  const d2 = orientation(c, d, b);
  const d3 = orientation(a, b, c);
  const d4 = orientation(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  if (pointDansRect(a, r) || pointDansRect(b, r)) return true;
  const coins: [Point, Point][] = [
    [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }],
    [{ x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }],
    [{ x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }],
    [{ x: r.x0, y: r.y1 }, { x: r.x0, y: r.y0 }],
  ];
  return coins.some(([c, d]) => segmentsCross(a, b, c, d));
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
export function reculerPourLaPointe(points: Point[], longueur: number, pulled: boolean): Point[] {
  if (!pulled) return pointsAvantPointe(points, longueur);
  return pointsAvantPointe([...points].reverse(), longueur).reverse();
}

export function pointsAvantPointe(points: Point[], longueur: number): Point[] {
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