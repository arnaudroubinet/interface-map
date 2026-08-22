import type { ParsedModel, Milestone, Validity } from "../parsing/model";
import { interfaceLabel } from "./core";
import { lifespanOf } from "./milestones";

// The milestone axis was a drop-down, so the time was never visible. The
// roadmap shows it at once -- one row per subject, a bar from its arrival to
// its retirement. It is an obsolescence chart, and everything it needs is
// already in the workbook.
export type RoadmapSubject = "actors" | "interfaces";

export interface RoadmapBar {
  label: string;
  // The group or the provider, depending on the subject: enough to arrange the
  // rows by something other than alphabetical order.
  grouping: string;
  // In milestone RANKS, not dates: it is the rank that orders the axis.
  start: number;
  end: number;
  // A row with no retirement milestone runs to the end. That has to be DRAWN
  // as such -- stopping it at the last known milestone would say it dies there.
  openRight: boolean;
  openLeft: boolean;
}

export interface Roadmap {
  milestones: Milestone[];
  segments: RoadmapBar[];
}

function segment(
  label: string,
  grouping: string,
  validity: Validity,
  model: ParsedModel,
  bounds: { min: number; max: number }
): RoadmapBar {
  const interval = lifespanOf(model, validity);
  return {
    label,
    grouping,
    start: Number.isFinite(interval.start) ? interval.start : bounds.min,
    end: Number.isFinite(interval.end) ? interval.end : bounds.max + 1,
    openRight: !Number.isFinite(interval.end),
    openLeft: !Number.isFinite(interval.start),
  };
}

export function buildRoadmap(model: ParsedModel, what: RoadmapSubject): Roadmap {
  const milestones = [...model.milestones].sort((a, b) => a.rank - b.rank);
  if (milestones.length === 0) return { milestones, segments: [] };
  const bounds = { min: milestones[0].rank, max: milestones[milestones.length - 1].rank };

  const segments =
    what === "actors"
      ? model.actors.map((a) => segment(a.name.trim(), a.group.trim(), a, model, bounds))
      : model.interfaces.map((i) =>
          segment(interfaceLabel(i.flowName, i.version), i.providerName.trim(), i, model, bounds)
        );

  // Arranged by grouping then by arrival: rows from the same provider read
  // together, and a dated migration -- two versions following one another --
  // reads as a staircase rather than as steps to be hunted for.
  return {
    milestones,
    segments: segments.sort(
      (a, b) =>
        a.grouping.localeCompare(b.grouping, "fr") ||
        a.start - b.start ||
        a.label.localeCompare(b.label, "fr")
    ),
  };
}
