// The geometry of the line, without the SVG.
//
// These functions know nothing but points and rectangles: they do not touch
// the DOM, know nothing of actors or technologies, and so are verified on
// numbers. They used to live in the middle of the SVG construction, in a
// 960-line file where the two trades could no longer be told apart -- and yet
// they carry the subtlest part of the drawing: cutting a line under a label,
// reserving room for an arrowhead, rounding a corner without deforming the
// path.

export type Point = { x: number; y: number };

// --- Breaking a line around the boxes --------------------------------------
//
// The label sits INSIDE the line: the line breaks before the text and resumes
// behind it, which ties it to its arrow beyond any doubt.
//
//     ----- text ------>
//
// A chip set beside the line, however opaque, always leaves the question
// "which goes with which" when several flows run side by side.
export const BREAK_PLAY = 5;

// What a label never eats on the approach to the target: enough to set the
// arrowhead on a piece that genuinely approaches the box.
export const GAP_BEFORE_TARGET = 14;

// The portion of a segment lying inside a rectangle, as a parameter interval
// [0,1], or null if the segment misses it. The segment being orthogonal, the
// two axes are handled separately (the slab algorithm).
export function rectCrossing(a: Point, b: Point, r: Rect): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  for (const [from, arrival, min, max] of [
    [a.x, b.x, r.x0, r.x1],
    [a.y, b.y, r.y0, r.y1],
  ] as [number, number, number, number][]) {
    const d = arrival - from;
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

// Cuts a line into visible pieces, removing what falls inside a rectangle,
// plus a little play on either side.
export function breakTheLine(points: Point[], obstacles: Rect[]): Point[][] {
  const pieces: Point[][] = [];
  let current: Point[] = [points[0]];

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 1e-9) continue;
    const play = BREAK_PLAY / length;

    // Cuts on this segment, ordered, merged when they touch.
    //
    // On the LAST segment the cut never runs to the very end: the arrowhead
    // sits on the last visible piece, and without that remainder the piece
    // became the one BEFORE the label -- the arrow stopped at its label
    // instead of the box it aimed at.
    const ceiling =
      i === points.length - 2 ? 1 - Math.min(0.5, GAP_BEFORE_TARGET / length) : 1;
    const cuts: [number, number][] = [];
    for (const r of obstacles) {
      const t = rectCrossing(a, b, r);
      if (!t) continue;
      const start = Math.max(0, t[0] - play);
      const end = Math.min(ceiling, t[1] + play);
      if (end > start) cuts.push([start, end]);
    }
    cuts.sort((x, y) => x[0] - y[0]);
    const merged: [number, number][] = [];
    for (const c of cuts) {
      const last = merged[merged.length - 1];
      if (last && c[0] <= last[1]) last[1] = Math.max(last[1], c[1]);
      else merged.push([...c]);
    }

    for (const [start, end] of merged) {
      if (start > 0) current.push(surSegment(a, b, start));
      if (current.length > 1) pieces.push(current);
      current = end < 1 ? [surSegment(a, b, end)] : [];
    }
    if (current.length === 0) current = [b];
    else current.push(b);
  }

  if (current.length > 1) pieces.push(current);
  return pieces;
}

// Corner radius. A raw orthogonal polyline renders angular; a few pixels of
// rounding are enough to soften the whole board.
export const CORNER_RADIUS = 6;

// An SVG path following an orthogonal polyline, with rounded corners.
//
// Directions are normalised rather than using Math.sign: this stays correct if
// ELK emits a very slightly oblique segment, where the sign alone would
// produce an aberrant control point. Two cases are ruled out explicitly --
// three collinear points (no corner to round, and the control point would
// land on the vertex) and zero-length segments.
export function roundedPath(points: Point[], radius = CORNER_RADIUS): string {
  if (points.length === 0) return "";
  if (points.length < 3) return "M " + points.map((p) => `${p.x},${p.y}`).join(" L ");

  let d = `M ${points[0].x},${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1];
    const corner = points[i];
    const next = points[i + 1];
    const before = Math.hypot(corner.x - previous.x, corner.y - previous.y);
    const after = Math.hypot(next.x - corner.x, next.y - corner.y);
    const aligned = Math.abs((corner.x - previous.x) * (next.y - corner.y) - (corner.y - previous.y) * (next.x - corner.x)) < 0.01;

    if (aligned || before < 0.01 || after < 0.01) {
      d += ` L ${corner.x},${corner.y}`;
      continue;
    }
    const ra = Math.min(radius, before / 2);
    const rb = Math.min(radius, after / 2);
    const input = { x: corner.x + ((previous.x - corner.x) / before) * ra, y: corner.y + ((previous.y - corner.y) / before) * ra };
    const output = { x: corner.x + ((next.x - corner.x) / after) * rb, y: corner.y + ((next.y - corner.y) / after) * rb };
    d += ` L ${input.x},${input.y} Q ${corner.x},${corner.y} ${output.x},${output.y}`;
  }
  const last = points[points.length - 1];
  return d + ` L ${last.x},${last.y}`;
}

export type Rect = { x0: number; y0: number; x1: number; y1: number };

export function pointInRect(p: Point, r: Rect): boolean {
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
  if (pointInRect(a, r) || pointInRect(b, r)) return true;
  const corners: [Point, Point][] = [
    [{ x: r.x0, y: r.y0 }, { x: r.x1, y: r.y0 }],
    [{ x: r.x1, y: r.y0 }, { x: r.x1, y: r.y1 }],
    [{ x: r.x1, y: r.y1 }, { x: r.x0, y: r.y1 }],
    [{ x: r.x0, y: r.y1 }, { x: r.x0, y: r.y0 }],
  ];
  return corners.some(([c, d]) => segmentsCross(a, b, c, d));
}

// The marker-end anchors at the path's final point and is drawn over it, but
// a line wider than the (concave) back of the softened arrowhead visually
// overruns on the sides: so the LINE itself is shortened back to the
// arrowhead's base, and it is the marker (anchored via refX="0", hence set by
// its base) that alone covers the last HEAD_SIZE units to the true point of
// contact. The last segment is straight by construction (cf.
// segmentsCubiques), so this setback along its direction is exact.
//
// A pulled line's arrowhead is at its START: that is therefore where room must
// be reserved for it, failing which it would be drawn over the starting box
// instead of approaching it.
export function setBackForTheHead(points: Point[], length: number, pulled: boolean): Point[] {
  if (!pulled) return pointsBeforeHead(points, length);
  return pointsBeforeHead([...points].reverse(), length).reverse();
}

export function pointsBeforeHead(points: Point[], length: number): Point[] {
  const n = points.length;
  const penultimate = points[n - 2];
  const last = points[n - 1];
  const dx = last.x - penultimate.x;
  const dy = last.y - penultimate.y;
  const dist = Math.hypot(dx, dy);
  if (dist === 0) return points;
  const setback = Math.min(length, dist * 0.95);
  const t = (dist - setback) / dist;
  const point = { x: penultimate.x + dx * t, y: penultimate.y + dy * t };
  return [...points.slice(0, n - 1), point];
}