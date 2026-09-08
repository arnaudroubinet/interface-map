import type { ParsedModel, Actor } from "../parsing/model";
import { type FlowInstance, type Mode } from "../aggregation/core";
import { liveActors } from "../aggregation/milestones";
import { flowsForReading } from "../aggregation/reading";
import { normalizeText } from "../shared/text";

// What the two C4 exports share, written once. They used to carry the same
// five functions as two copies, comments included: the contract "what
// disappears from one disappears from the other" rested on nobody editing one
// without the other. Here it holds by construction.

// A string literal in either DSL: one line, no double quote. Neither grammar
// escapes a quote inside a string, and neither survives a line break in one --
// a cell typed with Alt+Enter broke the whole file, not merely its own line.
export const text = (v: string) => v.replace(/\s+/g, " ").trim().replace(/"/g, "'");

// The initiative, as the technology declares it. A C4 relationship has one
// direction -- provider to consumer, like the data and like our diagrams -- so
// the initiative goes into a tag, where it stays readable and filterable.
export const PULLED_TAG = "Pulled";
export const isPulled = (f: FlowInstance) => f.direction === "consumer-to-provider";

// An actor consuming the interface it publishes itself would give a
// relationship from an element to itself: it says nothing in a C4 model, and
// the aggregated views already hide it. Structurizr accepts it, LikeC4 refuses
// the whole file -- "Invalid parent-child relationship" -- and both exports
// return the same model.
export function exportableFlows(model: ParsedModel, rank: number | null, mode: Mode): FlowInstance[] {
  return flowsForReading(model, rank, mode).filter((f) => f.provider.trim() !== f.consumer.trim());
}

// The actors alive at the milestone, one per name. Two Actors rows of the same
// name -- a duplicate the report flags -- produced two declarations under ONE
// identifier, and both tools refused the file. The first row speaks for the
// name; the report says the rest.
export function exportableActors(model: ParsedModel, rank: number | null): Actor[] {
  const seen = new Set<string>();
  return liveActors(model, rank).filter((a) => {
    const name = a.name.trim();
    if (name === "" || seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

// The workbook names its actor types freely; only the one with a shape of its
// own is recognised, in the two languages a workbook may carry.
export function isAPerson(a: Actor): boolean {
  return ["person", "humain"].includes(normalizeText(a.actorType));
}

// The contract link as a URL both tools accept, or nothing. The column is free
// text: a UNC path with a space, or "see SharePoint", broke the file or failed
// the tool's URL validation. Only a web address goes out, quoted.
export function contractUrl(link: string): string | null {
  const trimmed = link.trim();
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return null;
  return `"${trimmed.replace(/"/g, "%22")}"`;
}
