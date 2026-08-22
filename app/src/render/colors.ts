import { normalizeText } from "../shared/text";
import { darkenTo, contrastRatio } from "./contrast";

// Palette catégorielle, ordre fixe. Les huit teintes passent 4,5:1 sur blanc :
// elles servent d'ENCRE autant que de trait, et l'ancienne palette échouait des
// deux côtés -- #eda100 à 2,17:1, #1baf7a à 2,82:1, cinq teintes sur huit sous
// 3:1 comme simple trait. Ratios mesurés, dans l'ordre : 6,35 · 5,27 · 5,01 ·
// 5,65 · 5,68 · 4,95 · 8,56 · 6,31.
//
// La couleur reste un rappel : le nom de la technologie est écrit partout où
// elle apparaît, donc au-delà de huit on reboucle plutôt que d'inventer une
// teinte non validée.
export const PALETTE = ["#1f5fae", "#b8481f", "#0e7f56", "#8a5f00", "#a8446a", "#008300", "#4a3aa7", "#b32d2c"];

export function colourForTechnologies(technologies: string[]): Map<string, string> {
  const distinct = [...new Set(technologies.map((t) => t.trim()))].sort((a, b) => a.localeCompare(b, "fr"));
  const map = new Map<string, string>();
  distinct.forEach((tech, i) => map.set(tech, PALETTE[i % PALETTE.length]));
  return map;
}

// Le référentiel externe porte la couleur de chaque technologie. Une couleur
// déclarée est donc respectée telle quelle : c'est ce qui l'ancre à la
// technologie plutôt qu'à son rang alphabétique, lequel décalait toutes les
// teintes dès qu'on ajoutait une technologie avant les autres.
//
// La palette ne sert plus qu'aux technologies qui n'en déclarent aucune, et
// elle évite les teintes déjà prises : sans quoi deux traits se retrouveraient
// de la même couleur alors qu'il restait des teintes libres.
export const HEXA = /^#?([0-9a-f]{6})$/i;

// Le référentiel fait foi sur la TEINTE, pas sur la clarté : un jaune déclaré
// reste jaune, mais assez foncé pour qu'on voie le trait. Sans ce garde-fou, le
// classeur pouvait rendre un flux invisible sans que rien ne le dise -- et le
// rapport d'intégrité l'annonce désormais.
export const LINE_THRESHOLD = 3;

function declaredColourOf(raw: string): string | undefined {
  const m = HEXA.exec(raw.trim());
  if (!m) return undefined;
  const colour = `#${m[1].toLowerCase()}`;
  return contrastRatio(colour, "#ffffff") >= LINE_THRESHOLD ? colour : darkenTo(colour, LINE_THRESHOLD);
}

export function coloursOfModel(model: {
  interfaces: readonly { flowType: string }[];
  flowTypes: readonly { type: string; colour: string }[];
}): Map<string, string> {
  // Une technologie DOIT être déclarée au référentiel. Employée sans y figurer,
  // elle n'est de toute façon pas dessinée -- son sens de représentation est
  // inconnu, le contrôle de référence le dit -- mais elle prenait quand même
  // une teinte, et décalait donc celles des technologies réellement dessinées.
  // Sur un classeur réel, trois technologies dessinées se partageaient les 1re,
  // 3e et 4e teintes parce que deux inconnues s'étaient glissées entre elles.
  const declaredTypes = new Map(model.flowTypes.map((t) => [normalizeText(t.type), t]));
  const used = new Set(model.interfaces.map((i) => i.flowType.trim()).filter(Boolean));
  const drawn = [...used]
    .filter((t) => declaredTypes.has(normalizeText(t)))
    .sort((a, b) => a.localeCompare(b, "fr"));

  const declaredColour = new Map<string, string>();
  for (const t of model.flowTypes) {
    const colour = declaredColourOf(t.colour);
    if (colour) declaredColour.set(t.type.trim(), colour);
  }

  const colours = new Map<string, string>();
  const taken = new Set<string>();
  for (const tech of drawn) {
    const colour = declaredColour.get(tech);
    if (!colour) continue;
    colours.set(tech, colour);
    taken.add(colour);
  }

  // Les teintes libres d'abord, dans l'ordre de la palette ; une fois épuisées
  // on reboucle sur la palette entière plutôt que d'inventer une teinte non
  // validée -- le nom de la technologie reste écrit partout où sa couleur
  // apparaît, la couleur n'est qu'un rappel.
  const free = PALETTE.filter((c) => !taken.has(c));
  const spare = free.length > 0 ? free : PALETTE;
  let i = 0;
  for (const tech of drawn) {
    if (colours.has(tech)) continue;
    colours.set(tech, spare[i % spare.length]);
    i += 1;
  }
  return colours;
}
