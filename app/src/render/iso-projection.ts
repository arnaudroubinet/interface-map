// The isometric projection, extracted from fossflow's own bundle: a tile of
// 100 projects to 141.5 × 81.9. One module because two callers need the SAME
// numbers -- the painter to draw (iso-view.ts) and the translation to judge
// distances while placing (export/fossflow-json.ts): a placement optimised in
// another metric than the drawing's would optimise the wrong picture.

export const HALF_TILE_W = 70.75;
export const HALF_TILE_H = 40.95;

export function tileToScreen(tile: { x: number; y: number }): { x: number; y: number } {
  return {
    x: HALF_TILE_W * (tile.x - tile.y),
    y: -HALF_TILE_H * (tile.x + tile.y),
  };
}

// The distance the EYE sees between two tiles, in screen pixels: the diamond
// squashes vertically, so two tiles a same grid-distance apart are nearer on
// screen along one diagonal than the other.
export function screenDistance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  const pa = tileToScreen(a);
  const pb = tileToScreen(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}

// One step along a grid axis, in screen pixels: the length of the tile's
// diagonal half-edges combined.
export const TILE_STEP_PX = Math.hypot(HALF_TILE_W, HALF_TILE_H);

// Where a line stops before the drawing it joins, in screen pixels measured
// ALONG its last segment. From above it runs into the icon's body and stops
// at its silhouette; from below it passes behind the name (haloed) and stops
// at the icon's foot. Shared by the painter, which trims the drawn line, and
// by the crossing count, which must not count what the trim hides.
export const END_GAP_FROM_ABOVE = 70;
export const END_GAP_FROM_BELOW = 26;

// "From above": the last segment travels DOWN the screen into the drawing.
// In tile space a step down the screen lowers tx + ty.
export function endGapPx(tipTile: { x: number; y: number }, beforeTile: { x: number; y: number }): number {
  return tipTile.x + tipTile.y < beforeTile.x + beforeTile.y ? END_GAP_FROM_ABOVE : END_GAP_FROM_BELOW;
}
