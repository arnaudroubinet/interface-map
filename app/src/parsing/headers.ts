import { normalizeText } from "../shared/text";

// Le classeur parle anglais. Les noms français du format d'origine restent
// RECONNUS, et seulement reconnus : c'est ce qui permet de lire un classeur
// d'avant le versionnement pour le convertir. Aucun classeur produit ne les
// porte plus, et rien d'autre que la mise à niveau n'en dépend.
export const NOMS_ORIGINE: Record<string, string | string[]> = {
  // Feuilles. Plusieurs écritures ont circulé pour la même chose : les
  // classeurs tenus à la main préfixaient « Ref » leurs référentiels, et
  // nommaient « Flux » le catalogue des interfaces -- à ne pas confondre avec
  // l'onglet « Flux » du format d'origine, qui décrit un LIEN entre deux
  // composants. Les deux se distinguent sans ambiguïté : ce dernier n'a pas
  // d'onglet d'acteurs reconnaissable, donc le parseur échoue et l'aiguillage
  // de reparation.ts l'envoie au bon convertisseur.
  Actors: ["Acteurs", "RefActeur", "RefActeurs"],
  Groups: "Groupes",
  ActorTypes: ["TypesActeur", "RefTypesActeur"],
  FlowTypes: ["TypesFlux", "RefTypesFlux"],
  Interfaces: "Flux",
  // Colonnes
  Name: "Nom",
  Group: "Groupe",
  "Actor type": "Type d'acteur",
  Owner: ["Responsable", "Usine responsable"],
  Comments: "Commentaires",
  Perimeter: "Périmètre",
  Icon: "Icône",
  Preview: "Aperçu",
  "Flow type": "Type de flux",
  Direction: "Sens de représentation",
  "Flow name": "Nom du flux",
  Provider: "Acteur exposant",
  "Contract link": "Lien contrat",
  "Contract reference": "Référence contrat",
  "To confirm": "À confirmer",
  Consumer: "Acteur consommateur",
  "Criticality for this consumer": "Criticité pour ce consommateur",
  Decision: "Décision",
};
// Toutes les écritures acceptées pour un nom : la courante, en anglais, puis
// celles qui ont circulé avant le versionnement -- il y en a parfois plusieurs
// pour la même chose. Les feuilles et colonnes nées avec le versionnement ne
// figurent pas ici : aucun classeur ne les a jamais portées en français.
function spellings(attendu: string): string[] {
  const origin = NOMS_ORIGINE[attendu];
  if (!origin) return [attendu];
  return [attendu, ...(Array.isArray(origin) ? origin : [origin])];
}

export function findHeader(actualHeaders: string[], expected: string): string | undefined {
  const cibles = spellings(expected).map(normalizeText);
  return actualHeaders.find((h) => cibles.includes(normalizeText(h)));
}

export function matchesSheetName(actualName: string, expected: string): boolean {
  const name = normalizeText(actualName);
  return spellings(expected).some((e) => normalizeText(e) === name);
}

export function hasPrefix(actualName: string, prefix: string): boolean {
  return normalizeText(actualName).startsWith(normalizeText(prefix));
}
