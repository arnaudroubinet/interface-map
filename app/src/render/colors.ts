import { normalizeText } from "../shared/text";
import { darkenTo, contrastRatio } from "./contrast";

// A categorical palette, fixed order. All eight hues pass 4.5:1 on white: they
// serve as INK as much as stroke, and the old palette failed on both counts --
// #eda100 at 2.17:1, #1baf7a at 2.82:1, five hues out of eight below 3:1 as a
// plain stroke. Measured ratios, in order: 6.35 · 5.27 · 5.01 · 5.65 · 5.68 ·
// 4.95 · 8.56 · 6.31.
//
// The colour stays a reminder: the technology's name is written everywhere it
// appears, so beyond eight it wraps around rather than inventing an
// unvalidated hue.
export const PALETTE = ["#1f5fae", "#b8481f", "#0e7f56", "#8a5f00", "#a8446a", "#008300", "#4a3aa7", "#b32d2c"];

export function colourForTechnologies(technologies: string[]): Map<string, string> {
  const distinct = [...new Set(technologies.map((t) => t.trim()))].sort((a, b) => a.localeCompare(b, "fr"));
  const map = new Map<string, string>();
  distinct.forEach((tech, i) => map.set(tech, PALETTE[i % PALETTE.length]));
  return map;
}

// The external referential carries each technology's colour. A declared colour
// is therefore honoured as it is: that is what anchors it to the technology
// rather than to its alphabetical rank, which shifted every hue as soon as a
// technology was added ahead of the others.
//
// The palette now serves only the technologies that declare none, and it
// avoids the hues already taken: failing which two lines would end up the same
// colour while free hues remained.
export const HEXA = /^#?([0-9a-f]{6})$/i;

// The referential is authoritative on the HUE, not on the lightness: a
// declared yellow stays yellow, but dark enough for the line to be seen.
// Without that guard the workbook could make a flow invisible with nothing to
// say so -- and the integrity report now announces it.
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
  // The external referential's colours. They are the ordinary source; the
  // workbook's own Colour column stays available above them, because forcing a
  // hue locally is legitimate and the referential is not always right.
  referentialTechnologies?: readonly { type: string; colour: string }[];
}): Map<string, string> {
  // A technology MUST be declared in the referential. Used without appearing in
  // it, it is not drawn anyway -- its representation direction is unknown, and
  // the reference check says so -- but it still took a hue, and therefore
  // shifted those of the technologies actually drawn. On a real workbook, three
  // drawn technologies shared the 1st, 3rd and 4th hues because two unknown ones
  // had slipped in between them.
  const declaredTypes = new Map(model.flowTypes.map((t) => [normalizeText(t.type), t]));
  const used = new Set(model.interfaces.map((i) => i.flowType.trim()).filter(Boolean));
  const drawn = [...used]
    .filter((t) => declaredTypes.has(normalizeText(t)))
    .sort((a, b) => a.localeCompare(b, "fr"));

  // Keyed like everything else that compares two names -- case- and
  // accent-insensitively. On the raw spelling, "HTTP" in the workbook and
  // "http" in the referential were two different keys: the integrity report
  // said the referential KNOWS this technology while the colour was silently
  // lost. Two technologies differing only in case therefore share one key, and
  // the last declared wins, exactly as two identical spellings already did.
  const declaredColour = new Map<string, string>();
  for (const t of model.referentialTechnologies ?? []) {
    const colour = declaredColourOf(t.colour);
    if (colour) declaredColour.set(normalizeText(t.type), colour);
  }
  // Second, so that a colour typed into the workbook overwrites the
  // referential's.
  for (const t of model.flowTypes) {
    const colour = declaredColourOf(t.colour);
    if (colour) declaredColour.set(normalizeText(t.type), colour);
  }

  const colours = new Map<string, string>();
  const taken = new Set<string>();
  for (const tech of drawn) {
    const colour = declaredColour.get(normalizeText(tech));
    if (!colour) continue;
    colours.set(tech, colour);
    taken.add(colour);
  }

  // The free hues first, in the palette's order; once exhausted it wraps around
  // the whole palette rather than inventing an unvalidated hue -- the
  // technology's name stays written everywhere its colour appears, and the
  // colour is only a reminder.
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
