// WCAG 2's relative luminance formula. Two reasons to carry it here rather
// than trust the eye: the tool's box fills failed at 2.90:1 while "looking"
// contrasted, and that very same formula IS the Rec. 709 grey level -- fixing
// the contrast therefore makes the diagram legible in black-and-white print
// and for a colour-blind reader, in one and the same move.
//
function canal(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function composantes(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function relativeLuminance(hex: string): number {
  const [r, v, b] = composantes(hex);
  return 0.2126 * canal(r) + 0.7152 * canal(v) + 0.0722 * canal(b);
}

export function contrastRatio(a: string, b: string): number {
  const [top, bottom] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (top + 0.05) / (bottom + 0.05);
}

// Darkens in 2% steps until the target is met. The HUE is NEVER changed: a
// colour declared in the referential belongs to whoever keeps the workbook;
// all this does is make it legible.
export function darkenTo(hex: string, target: number, sur = "#ffffff"): string {
  let [r, v, b] = composantes(hex);
  for (let i = 0; i < 200; i += 1) {
    const current = `#${[r, v, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
    if (contrastRatio(current, sur) >= target) return current;
    [r, v, b] = [r * 0.98, v * 0.98, b * 0.98];
  }
  return "#000000";
}
