import { normalizeText } from "../shared/text";

// The workbook speaks English. The original format's French names are still
// RECOGNISED, and only recognised: that is what allows a workbook from before
// versioning to be read in order to convert it. No produced workbook carries
// them any more, and nothing but the upgrade depends on them.
export const ORIGIN_NAMES: Record<string, string | string[]> = {
  // Sheets. Several spellings circulated for the same thing: hand-kept
  // workbooks prefixed their referentials with "Ref", and named the interface
  // catalogue "Flux" -- not to be confused with the original format's "Flux"
  // sheet, which describes a LINK between two components. The two are told
  // apart without ambiguity: the latter has no recognisable actors sheet, so
  // the parser fails and repair.ts's routing sends it to the right converter.
  //
  Actors: ["Acteurs", "RefActeur", "RefActeurs"],
  Groups: "Groupes",
  ActorTypes: ["TypesActeur", "RefTypesActeur"],
  FlowTypes: ["TypesFlux", "RefTypesFlux"],
  Interfaces: "Flux",
  // Columns
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
// Every spelling accepted for a name: the current one, in English, then those
// that circulated before versioning -- sometimes several for the same thing.
// Sheets and columns born with versioning do not appear here: no workbook ever
// carried them in French.
function spellings(expected: string): string[] {
  const origin = ORIGIN_NAMES[expected];
  if (!origin) return [expected];
  return [expected, ...(Array.isArray(origin) ? origin : [origin])];
}

export function findHeader(actualHeaders: string[], expected: string): string | undefined {
  const targets = spellings(expected).map(normalizeText);
  return actualHeaders.find((h) => targets.includes(normalizeText(h)));
}

export function matchesSheetName(actualName: string, expected: string): boolean {
  const name = normalizeText(actualName);
  return spellings(expected).some((e) => normalizeText(e) === name);
}

export function hasPrefix(actualName: string, prefix: string): boolean {
  return normalizeText(actualName).startsWith(normalizeText(prefix));
}
