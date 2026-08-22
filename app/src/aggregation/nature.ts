import type { ParsedModel, Actor } from "../parsing/model";
import { normalizeText } from "../shared/text";

export const NATURE_BUSINESS = "Business";
export const NATURE_TECHNICAL = "Technical";

// An actor is technical when ITS TYPE says so. The type decides for all its
// actors, just as the group's perimeter decides for all its members: six lines
// to keep straight rather than fifty, hence six chances to contradict oneself
// rather than fifty.
//
// Everything else is business: empty nature, unknown type, missing type. The
// default leans towards SHOWING -- hiding on the strength of an unfilled
// column would drop data without anyone having asked.
export function isTechnicalActor(model: ParsedModel, actorName: string): boolean {
  // The actor name is compared on .trim() alone, NOT through normalizeText:
  // it is an identifier the workbook always has entered from a drop-down
  // (§3.3), so two spellings differing only in case or accents name two
  // distinct actors rather than one typo -- unlike the type and the nature,
  // which come from a closed vocabulary where a variant IS a typo. The same
  // convention holds throughout aggregation/ (core.ts, views.ts, changes.ts,
  // boards.ts...).
  const actor = model.actors.find((a) => a.name.trim() === actorName.trim());
  if (!actor) return false;
  const type = model.actorTypes.find((t) => normalizeText(t.type) === normalizeText(actor.actorType));
  return type !== undefined && normalizeText(type.nature) === normalizeText(NATURE_TECHNICAL);
}

export function businessActors(model: ParsedModel): Actor[] {
  return model.actors.filter((a) => !isTechnicalActor(model, a.name));
}
