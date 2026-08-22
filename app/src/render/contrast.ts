// La formule de luminance relative de WCAG 2. Deux raisons de la porter ici
// plutôt que de faire confiance à l'œil : les fonds de boîte de l'outil
// échouaient à 2,90:1 alors qu'ils « avaient l'air » contrastés, et cette même
// formule EST celle du niveau de gris Rec. 709 -- corriger le contraste rend
// donc le schéma lisible à l'impression en noir et blanc et pour un daltonien,
// du même geste.
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

// Assombrit par pas de 2 % jusqu'à atteindre la cible. On ne change JAMAIS la
// teinte : une couleur déclarée au référentiel appartient à celui qui tient le
// classeur, on ne fait que la rendre lisible.
export function darkenTo(hex: string, target: number, sur = "#ffffff"): string {
  let [r, v, b] = composantes(hex);
  for (let i = 0; i < 200; i += 1) {
    const current = `#${[r, v, b].map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
    if (contrastRatio(current, sur) >= target) return current;
    [r, v, b] = [r * 0.98, v * 0.98, b * 0.98];
  }
  return "#000000";
}
