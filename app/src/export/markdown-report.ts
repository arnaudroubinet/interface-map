import type { IntegrityReport } from "../integrity/checks";
import { reportSections } from "../render/integrity-report";

// The report outside the tool. What one wants to take away is not the layout:
// it is the list of rows to fix, in a format that pastes into a ticket or an
// email and stays readable as it is. Each item already carries its address
// (sheet, row): the workbook is fixed without reopening the tool.

function count(n: number, singular: string, singularOrPlural: string): string | null {
  if (n === 0) return null;
  return `${n} ${n > 1 ? singularOrPlural : singular}`;
}

// What comes from the workbook is TEXT, never structure. An Excel cell holding
// a line break -- Alt+Enter, a common gesture -- otherwise forged a whole
// anomaly family the checks never produced; and an actor named
// "[Sullust](http://…)" became a clickable link, "**Chandrila**" lost its
// stars, so its name could no longer be found in the workbook.
//
//
// Backslash escaping renders the character as it is: the name stays readable
// and searchable once the Markdown is rendered.
function inlineText(value: string): string {
  // The underscore is not in it: inside a word it italicises nothing
  // (CommonMark), and escaping it would disfigure every FX_A_HTTP sheet name
  // this report quotes constantly.
  return value.replace(/\s+/g, " ").trim().replace(/([\\`*[\]<>])/g, "\\$1");
}

// The summary counts the bullets ACTUALLY printed, section by section.
// Computed alongside, from the report's counters, it announced "2 pending
// decisions" above nineteen bullets -- the informational blocks did not go
// into it -- and shrank to a lone full stop when no counter was filled.
const SEVERITY_LABEL: Record<string, [string, string]> = {
  error: ["anomaly", "anomalies"],
  action: ["pending decision", "pending decisions"],
  warning: ["warning", "warnings"],
  info: ["point of information", "points of information"],
};

export function reportToMarkdown(
  report: IntegrityReport,
  workbookName: string,
  milestone: string | null
): string {
  const rows: string[] = [`# Integrity report — ${workbookName}`, ""];

  // The checks read AT the displayed milestone: without it, the list does not
  // say which moment of the workbook it speaks of. But not all read there --
  // those judging the FILE apply to the whole workbook -- and a reader unaware
  // of that attributes to the milestone a fault that does not depend on it.
  if (milestone) {
    rows.push(
      `Milestone: ${milestone}`,
      "",
      "Structure, references, vocabularies and consistency are checked on the whole workbook; completeness and the information blocks are read at this milestone.",
      ""
    );
  }

  // An empty section is reassuring on screen; pasted into a ticket, it clutters.
  const sections = reportSections(report).filter((s) => s.items.length > 0);

  if (sections.length === 0) {
    rows.push("Nothing to report.", "");
    return rows.join("\n");
  }

  const bySeverity = new Map<string, number>();
  for (const s of sections) bySeverity.set(s.severity, (bySeverity.get(s.severity) ?? 0) + s.items.length);
  const summary = Object.entries(SEVERITY_LABEL)
    .map(([severity, [singular, singularOrPlural]]) => count(bySeverity.get(severity) ?? 0, singular, singularOrPlural))
    .filter(Boolean);
  rows.push(`${summary.join(", ")}.`, "");

  for (const s of sections) {
    rows.push(`## ${inlineText(s.title)} (${s.items.length})`, "", inlineText(s.description), "");
    for (const item of s.items) rows.push(`- ${inlineText(item)}`);
    rows.push("");
  }

  return rows.join("\n");
}
