import type { ParsedModel, Actor } from "../parsing/model";
import { normalizeText } from "../shared/text";

// What an actor IS, in the only sense the readings care about: whether the
// functional reading crosses it, stops at it, or shows it as a correspondent.
//
// Three roles, because two were not enough. "Technical" used to mean one thing
// -- crossed -- and every technical actor was expected to republish what it
// consumed. That holds for a bus or a gateway; it is false for an S3 bucket or
// a database, where the data legitimately stops. Both were being reported as
// plumbing that swallows a flow.
export const NATURE_BUSINESS = "Business";
// Crossed: the flows through it are joined end to end, and it is expected to
// say what it republishes.
export const NATURE_MIDDLEWARE = "Middleware";
// Terminal: the data stops there. Never folded, never asked to relay.
export const NATURE_STORAGE = "Storage";

// What a middleware was called before the two technical roles were told apart.
// Accepted, never written: a referential in circulation still says it, and that
// file carries no version number to tell anyone it is stale.
const LEGACY_MIDDLEWARE = "Technical";

// What is READ, as opposed to what is offered. The drop-down proposes the three
// roles (VOCABULARY_NATURE); the integrity check must not then report as
// unknown a word this module accepts, or every workbook fed by a referential in
// circulation would light up on a value nobody can fix from there.
export const ACCEPTED_NATURES = [NATURE_BUSINESS, NATURE_MIDDLEWARE, NATURE_STORAGE, LEGACY_MIDDLEWARE];

// The nature of an actor's TYPE. The type decides for all its actors, just as
// the group's perimeter decides for all its members: six lines to keep straight
// rather than fifty, hence six chances to contradict oneself rather than fifty.
//
// Everything else is business: empty nature, unknown nature, unknown type,
// missing type. The default leans towards SHOWING -- hiding on the strength of
// an unfilled column would drop data without anyone having asked.
//
// The actor name is compared on .trim() alone, NOT through normalizeText: it is
// an identifier the workbook always has entered from a drop-down (§3.3), so two
// spellings differing only in case or accents name two distinct actors rather
// than one typo -- unlike the type and the nature, which come from a closed
// vocabulary where a variant IS a typo. The same convention holds throughout
// aggregation/ (core.ts, views.ts, changes.ts, boards.ts...).
function natureOf(model: ParsedModel, actorName: string): string {
  const actor = model.actors.find((a) => a.name.trim() === actorName.trim());
  if (!actor) return NATURE_BUSINESS;
  const type = model.actorTypes.find((t) => normalizeText(t.type) === normalizeText(actor.actorType));
  if (!type) return NATURE_BUSINESS;
  const said = normalizeText(type.nature);
  if (said === normalizeText(NATURE_MIDDLEWARE) || said === normalizeText(LEGACY_MIDDLEWARE)) {
    return NATURE_MIDDLEWARE;
  }
  if (said === normalizeText(NATURE_STORAGE)) return NATURE_STORAGE;
  return NATURE_BUSINESS;
}

// Crossed by the functional reading. This is the question the reading asks --
// "do I fold this one?" -- and the one the relay checks ask.
export function isRelayActor(model: ParsedModel, actorName: string): boolean {
  return natureOf(model, actorName) === NATURE_MIDDLEWARE;
}

// The data stops here. A storage is plumbing, but a terminus: it is drawn as
// plumbing and it may publish, yet nothing is missing when it republishes
// nothing.
export function isStorageActor(model: ParsedModel, actorName: string): boolean {
  return natureOf(model, actorName) === NATURE_STORAGE;
}

// Not a business correspondent. This is the question the DRAWING asks, and the
// one behind "only plumbing relays": both hold for a storage as much as for a
// middleware.
export function isTechnicalActor(model: ParsedModel, actorName: string): boolean {
  return natureOf(model, actorName) !== NATURE_BUSINESS;
}

export function businessActors(model: ParsedModel): Actor[] {
  return model.actors.filter((a) => !isTechnicalActor(model, a.name));
}
