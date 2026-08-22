import type { Actor, ParsedModel, Milestone, Validity } from "../parsing/model";
import { normalizeText } from "../shared/text";

// The platform's time axis. Never to be confused with an interface contract's
// version, nor with the workbook's schema number.

// A row's lifespan, in ranks. Empty bounds become the infinities: "always been
// there" and "still there". That is what lets a workbook declaring no
// milestone behave exactly as it did before.
export interface Interval {
  start: number;
  end: number;
}

export const ALWAYS: Interval = { start: -Infinity, end: Infinity };

export function rankOfMilestone(model: ParsedModel, name: string): number | undefined {
  const sought = normalizeText(name);
  if (!sought) return undefined;
  return model.milestones.find((m) => normalizeText(m.name) === sought)?.rank;
}

// A milestone that is quoted but unknown is treated as absent rather than
// resolved at random: a check asks for it, and the bound stays open on that
// side.
//
// Nothing is inherited from one object to another: a missing arrival bound is
// an unfilled cell, reported as such (§7.4). We do not guess on behalf of
// whoever keeps the file.
export function lifespanOf(model: ParsedModel, validity: Validity): Interval {
  const start = rankOfMilestone(model, validity.introducedAt);
  const end = rankOfMilestone(model, validity.retiredAt);
  return { start: start ?? -Infinity, end: end ?? Infinity };
}

// The milestone shown by default: the delivered one of highest rank. With none
// delivered, simply the highest rank -- better to show a known state than
// nothing at all, and a check reports the absence.
export function currentMilestone(model: ParsedModel): Milestone | undefined {
  const delivered = model.milestones.filter((m) => normalizeText(m.status) === normalizeText("Delivered"));
  const candidates = delivered.length > 0 ? delivered : model.milestones;
  return candidates.reduce<Milestone | undefined>(
    (best, m) => (!best || m.rank > best.rank ? m : best),
    undefined
  );
}

// A row is live at a rank if its interval contains it. Retirement is EXCLUSIVE:
// a row retired AT milestone P is already gone at P, which is what "retired in
// v3" ordinarily means.
//
// The milestone carries the date, not the row: "v3" is a marker, and its date
// is read on the Milestones sheet. A row therefore never has a date, only an
// arrival milestone and a retirement milestone.
export function isLiveAt(interval: Interval, rank: number): boolean {
  return interval.start <= rank && rank < interval.end;
}

// The actors the milestone keeps. Both C4 exports each carried their own copy:
// two lines, one rule, and it is the milestone rule -- so it belongs here,
// next to isLiveAt and lifespanOf.
export function liveActors(model: ParsedModel, rank: number | null): Actor[] {
  if (rank === null || model.milestones.length === 0) return model.actors;
  return model.actors.filter((a) => isLiveAt(lifespanOf(model, a), rank));
}

// Two intervals meet if there is a rank where both rows are live together.
// Retirement being exclusive, the upper bound does not count: [v1, v2[ and
// [v2, ...[ never meet -- which is exactly what a dated migration describes,
// and therefore not an inconsistency.
export function intervalsMeet(a: Interval, b: Interval): boolean {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}
