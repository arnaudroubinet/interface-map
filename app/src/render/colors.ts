import { normalizeText } from "../shared/text";

// Palette catégorielle validée (huit teintes, ordre fixe) — voir la skill
// dataviz du projet. La couleur est un rappel visuel : le nom de la
// technologie est toujours écrit sur le trait, donc au-delà de 8
// technologies distinctes on boucle sur la palette plutôt que d'inventer
// des teintes non validées.
const PALETTE = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];

export function colorForTechnologies(technologies: string[]): Map<string, string> {
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
const HEXA = /^#?([0-9a-f]{6})$/i;

function couleurDeclaree(brut: string): string | undefined {
  const m = HEXA.exec(brut.trim());
  return m ? `#${m[1].toLowerCase()}` : undefined;
}

export function couleursDuModele(model: {
  interfaces: readonly { typeDeFlux: string }[];
  typesFlux: readonly { type: string; couleur: string }[];
}): Map<string, string> {
  // Une technologie DOIT être déclarée au référentiel. Employée sans y figurer,
  // elle n'est de toute façon pas dessinée -- son sens de représentation est
  // inconnu, le contrôle de référence le dit -- mais elle prenait quand même
  // une teinte, et décalait donc celles des technologies réellement dessinées.
  // Sur un classeur réel, trois technologies dessinées se partageaient les 1re,
  // 3e et 4e teintes parce que deux inconnues s'étaient glissées entre elles.
  const déclarées = new Map(model.typesFlux.map((t) => [normalizeText(t.type), t]));
  const employées = new Set(model.interfaces.map((i) => i.typeDeFlux.trim()).filter(Boolean));
  const dessinées = [...employées]
    .filter((t) => déclarées.has(normalizeText(t)))
    .sort((a, b) => a.localeCompare(b, "fr"));

  const déclarée = new Map<string, string>();
  for (const t of model.typesFlux) {
    const couleur = couleurDeclaree(t.couleur);
    if (couleur) déclarée.set(t.type.trim(), couleur);
  }

  const couleurs = new Map<string, string>();
  const prises = new Set<string>();
  for (const techno of dessinées) {
    const couleur = déclarée.get(techno);
    if (!couleur) continue;
    couleurs.set(techno, couleur);
    prises.add(couleur);
  }

  // Les teintes libres d'abord, dans l'ordre de la palette ; une fois épuisées
  // on reboucle sur la palette entière plutôt que d'inventer une teinte non
  // validée -- le nom de la technologie reste écrit partout où sa couleur
  // apparaît, la couleur n'est qu'un rappel.
  const libres = PALETTE.filter((c) => !prises.has(c));
  const réserve = libres.length > 0 ? libres : PALETTE;
  let i = 0;
  for (const techno of dessinées) {
    if (couleurs.has(techno)) continue;
    couleurs.set(techno, réserve[i % réserve.length]);
    i += 1;
  }
  return couleurs;
}
