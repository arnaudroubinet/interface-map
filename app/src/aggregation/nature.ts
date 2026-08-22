import type { ParsedModel, Actor } from "../parsing/model";
import { normalizeText } from "../shared/text";

export const NATURE_METIER = "Business";
export const NATURE_TECHNIQUE = "Technical";

// Un acteur est technique quand SON TYPE le déclare. Le type tranche pour tous
// ses acteurs, comme le périmètre du groupe tranche pour tous ses membres :
// six lignes à tenir plutôt que cinquante, donc six occasions de se contredire
// plutôt que cinquante.
//
// Tout le reste est métier : nature vide, type inconnu, type absent. Le défaut
// penche du côté qui MONTRE -- masquer sur une colonne non remplie cacherait
// de la donnée sans que personne l'ait demandé.
export function isTechnicalActor(model: ParsedModel, nomActeur: string): boolean {
  // Le nom d'acteur se compare au .trim() près, PAS via normalizeText : c'est
  // un identifiant que le classeur fait toujours saisir par liste déroulante
  // (§3.3), donc deux graphies qui ne diffèrent que par la casse ou les
  // accents désignent deux acteurs distincts, pas une faute de frappe -- à la
  // différence du type et de la nature, qui viennent d'un vocabulaire fermé
  // où une variante EST une faute de frappe. Convention reprise partout dans
  // aggregation/ (core.ts, views.ts, changes.ts, planches.ts...).
  const actor = model.actors.find((a) => a.name.trim() === nomActeur.trim());
  if (!actor) return false;
  const type = model.typesActeur.find((t) => normalizeText(t.type) === normalizeText(actor.typeActeur));
  return type !== undefined && normalizeText(type.nature) === normalizeText(NATURE_TECHNIQUE);
}

export function businessActors(model: ParsedModel): Actor[] {
  return model.actors.filter((a) => !isTechnicalActor(model, a.name));
}
