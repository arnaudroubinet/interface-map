import type { ParsedModel } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";
import type { MatrixGrain } from "../aggregation/views";
import type { MatrixOrder } from "../aggregation/seriation";
import type { Neighbourhood } from "../aggregation/impact";
import type { RoadmapSubject } from "../aggregation/roadmap";
import type { Mode, EdgeLabelMode } from "../aggregation/core";
import { SCHEMA_VERSION } from "../parsing/build-model";
import { currentMilestone, rankOfMilestone } from "../aggregation/milestones";
import { actorsForReading } from "../aggregation/reading";

export type View =
  | "group-to-group"
  | "platform-detail"
  | "platform-only"
  | "by-actor"
  | "by-technology"
  | "chain"
  | "roadmap"
  | "matrix"
  | "changes"
  | "checks"
  // Not a workbook view either: the page that explains the tool, consultable
  // with or without a workbook loaded.
  | "help"
  // Not a workbook view: the screen that blocks until the file is in the format
  // the tool can read.
  | "upgrade";

// A view's name, in one place only. The rail showed it on its buttons and the
// exports put it in their file names, each from its own table: two lists of
// the same ten labels, which could contradict each other with nothing to say
// so -- a "Changes" button and a "carto-ecarts" file.
//
// `Record<View, string>` forces the table to be completed as soon as a view is
// added: it is the type that holds exhaustiveness, not vigilance.
export const VIEW_LABEL: Record<View, string> = {
  "group-to-group": "Group to group",
  "platform-detail": "Platform detail",
  "platform-only": "Platform only",
  "by-actor": "By actor",
  "by-technology": "By technology",
  chain: "Chain",
  roadmap: "Roadmap",
  matrix: "Matrix",
  changes: "Changes",
  checks: "Integrity checks",
  help: "How it works",
  // Not in the rail: one does not navigate there, one is sent there. But the
  // export needs it, a stale workbook being exportable before its upgrade.
  "upgrade": "Upgrade",
};

export interface LoadedFile {
  name: string;
  model: ParsedModel;
  report: IntegrityReport;
  dateModification: Date | null;
}

export interface AppOptions {
  counters: boolean;
  // What a line's label NAMES: the pipe, what travels through it, or both. The
  // default stays the pipe -- that is the historical behaviour, and it fits
  // within a box's width.
  edgeLabelMode: EdgeLabelMode;
  // An architecture diagram is thin lines with small type: this is the case
  // where 600 dpi still pays. The right reflex is still SVG, which is vector and
  // has no resolution.
  pngScale: 1 | 2 | 4;
  // The line weight follows the consumption's criticality. Off by default:
  // elsewhere the weight serves to say NOTHING, and the two uses do not mix.
  //
  weightByCriticality: boolean;
}

// What the user unticked in the by-actor view. Reset as soon as the actor
// changes: hiding only makes sense relative to the one being looked at, and
// dragging it from one actor to the next would hide flows for no visible
// reason.
export interface ActorViewFilters {
  hiddenTechnologies: string[];
  hiddenActors: string[];
  // How far the board reaches: the immediate neighbours, upstream, or downstream
  // -- "if this actor falls, who is affected?".
  neighbourhood: Neighbourhood;
}

// The same for the by-technology view: hiding everything off-platform in one
// go, and/or unticking actor by actor.
export interface TechnologyViewFilters {
  masquerExternes: boolean;
  hiddenActors: string[];
}

// The matrix is filtered like the by-technology view, plus the reading scale:
// actor by actor, folded onto groups, or platform detail.
export interface MatrixViewFilters extends TechnologyViewFilters {
  grain: MatrixGrain;
  // The order of rows and columns. Alphabetical by default: a seriation must
  // never be the silent default -- the reference survey warns that RCM readily
  // produces a diagonal band that teaches nothing, and one must be able to get
  // back with one click.
  order: MatrixOrder;
}

export interface AppState {
  file: LoadedFile | null;
  view: View;
  mode: Mode;
  // The milestone being looked at, by name. This is not a display option but an
  // application setting: it runs through the views, the filters, the exports and
  // the report. `null` when the workbook declares no milestone.
  shownMilestone: string | null;
  // The two milestones the Changes view compares. The second is the one being
  // looked at; the first is the reference the change is measured from.
  comparedMilestone: string | null;
  // The workbook the Changes view measures against, when the comparison is
  // between two FILES rather than two milestones of one -- "what changed since
  // January's version of the referential". `null` is the ordinary case.
  //
  // It takes precedence over comparedMilestone when it is set: two workbooks
  // have no reason to share a milestone name, so both sides are then read
  // whole, and the report says so.
  comparedFile: LoadedFile | null;
  options: AppOptions;
  actorFilters: ActorViewFilters;
  technologyFilters: TechnologyViewFilters;
  matrixFilters: MatrixViewFilters;
  actorSelection: string | null;
  technologySelection: string | null;
  // The chain being followed, by its label. A chain exists only in the
  // functional reading, where the plumbing is precisely what is crossed.
  chainSelection: string | null;
  // What the roadmap puts on its rows: the actors or the interfaces.
  roadmapSubject: RoadmapSubject;
  messageBandeau: string | null;
}

export function initialState(): AppState {
  return {
    file: null,
    view: "group-to-group",
    mode: "architecture",
    shownMilestone: null,
    comparedMilestone: null,
    comparedFile: null,
    options: { counters: true, edgeLabelMode: "technology", pngScale: 2, weightByCriticality: false },
    actorFilters: { hiddenTechnologies: [], hiddenActors: [], neighbourhood: "direct" },
    technologyFilters: { masquerExternes: false, hiddenActors: [] },
    matrixFilters: { masquerExternes: false, hiddenActors: [], grain: "actor", order: "alphabetical" },
    actorSelection: null,
    technologySelection: null,
    chainSelection: null,
    roadmapSubject: "interfaces",
    messageBandeau: null,
  };
}

// A workbook that breaks the rules produces misleading diagrams: better to put
// the user in front of the anomalies than in front of a drawing that looks
// right. So a diagram view only opens if the file is sound.
//
// And even before that: a workbook whose schema does not match the tool's is
// not merely incomplete, it is misunderstood -- its anomalies are therefore
// not reliable, and the mismatch screen comes first.
//
// The mismatch reads BOTH ways. Behind, columns are missing; ahead, the tool
// ignores the ones it does not know yet and would draw a truncated image
// without saying so -- the case of the day a new version circulates while an
// old page stays open.
export function viewOnLoad(file: LoadedFile): View {
  if (file.model.schemaVersion !== SCHEMA_VERSION) return "upgrade";
  return file.report.totalAnomalies > 0 ? "checks" : "group-to-group";
}

export function withLoadedFile(state: AppState, file: LoadedFile): AppState {
  // It opens on the last delivered milestone, and compares by default with the
  // previous one: that is the change just crossed, the one people talk about.
  const current = currentMilestone(file.model);
  const previous = [...file.model.milestones]
    .filter((p) => current !== undefined && p.rank < current.rank)
    .sort((a, b) => b.rank - a.rank)[0];

  return {
    ...state,
    file,
    view: viewOnLoad(file),
    mode: "architecture",
    shownMilestone: current?.name ?? null,
    comparedMilestone: previous?.name ?? null,
    // A comparison was chosen against the workbook being replaced. Keeping it
    // would have the Changes view assert a comparison nobody asked for, over a
    // file that has just changed under it.
    comparedFile: null,
    actorFilters: { hiddenTechnologies: [], hiddenActors: [], neighbourhood: "direct" },
    technologyFilters: { masquerExternes: false, hiddenActors: [] },
    matrixFilters: { masquerExternes: false, hiddenActors: [], grain: "actor", order: "alphabetical" },
    actorSelection: null,
    technologySelection: null,
    chainSelection: null,
    roadmapSubject: "interfaces",
    messageBandeau: null,
  };
}

// The by-actor selector only offers the actors of the current reading: the
// technical ones drop out in the functional reading (§5.2), the retired ones
// drop out at the milestone where they are. A selection targeting an actor
// that has left the list designates nothing any more -- the diagram shows a
// phantom box, with not a word to say why. Mode and milestone share the same
// rule: separating them fixes only half of it.
function selectionRetenue(state: AppState, mode: Mode, milestone: string | null): string | null {
  if (!state.file || !state.actorSelection) return state.actorSelection;
  const model = state.file.model;
  const rank = milestone === null ? null : rankOfMilestone(model, milestone) ?? null;
  const offered = new Set(actorsForReading(model, rank, mode).map((a) => a.name));
  return offered.has(state.actorSelection) ? state.actorSelection : null;
}

export function withDisplayedMilestone(state: AppState, milestone: string | null): AppState {
  return { ...state, shownMilestone: milestone, actorSelection: selectionRetenue(state, state.mode, milestone) };
}

export function withComparedMilestone(state: AppState, milestone: string | null): AppState {
  return { ...state, comparedMilestone: milestone };
}

// The workbook the Changes view measures against. `null` puts the view back on
// the milestone axis of the file that is loaded.
export function withComparedFile(state: AppState, file: LoadedFile | null): AppState {
  return { ...state, comparedFile: file };
}

export function withView(state: AppState, view: View): AppState {
  return { ...state, view };
}

// Only one view is moot in the functional reading: "By technology", because
// the technology is precisely what is removed there. Leaving the user in it
// would show them a view with no content and explain nothing.
//
// "Group to group" was there too, on the grounds that aggregating groups over
// a folded chain would no longer say who feeds whom. The reason does not hold:
// "which division feeds which division" is precisely a board's question, and
// this is the only view that answers it. The folded chain links two BUSINESS
// actors, each of which has its group.
export const VIEWS_MOOT_IN_FUNCTIONAL: View[] = ["by-technology"];

export function withMode(state: AppState, mode: Mode): AppState {
  const view =
    mode === "functional" && VIEWS_MOOT_IN_FUNCTIONAL.includes(state.view)
      ? "platform-detail"
      : state.view;
  return { ...state, mode, view, actorSelection: selectionRetenue(state, mode, state.shownMilestone) };
}

export function withOptions(state: AppState, patch: Partial<AppOptions>): AppState {
  return { ...state, options: { ...state.options, ...patch } };
}

export function withActorSelection(state: AppState, actor: string | null): AppState {
  if (actor === state.actorSelection) return { ...state, actorSelection: actor };
  return { ...state, actorSelection: actor, actorFilters: { ...state.actorFilters, hiddenTechnologies: [], hiddenActors: [] } };
}

function basculer(list: string[], value: string, hidden: boolean): string[] {
  const sans = list.filter((v) => v !== value);
  return hidden ? [...sans, value] : sans;
}

export function withTechnoMasquee(state: AppState, tech: string, hidden: boolean): AppState {
  return {
    ...state,
    actorFilters: { ...state.actorFilters, hiddenTechnologies: basculer(state.actorFilters.hiddenTechnologies, tech, hidden) },
  };
}

export function withActorHidden(state: AppState, actor: string, hidden: boolean): AppState {
  return {
    ...state,
    actorFilters: { ...state.actorFilters, hiddenActors: basculer(state.actorFilters.hiddenActors, actor, hidden) },
  };
}

// The neighbourhood does not touch the hidings: widening the view neither
// reveals nor hides anyone beyond what the radius brings.
export function withSujetFrise(state: AppState, subject: RoadmapSubject): AppState {
  return { ...state, roadmapSubject: subject };
}

export function withVoisinage(state: AppState, neighbourhood: Neighbourhood): AppState {
  return { ...state, actorFilters: { ...state.actorFilters, neighbourhood } };
}

export function withChainSelection(state: AppState, chain: string | null): AppState {
  return { ...state, chainSelection: chain };
}

export function withTechnologySelection(state: AppState, technology: string | null): AppState {
  if (technology === state.technologySelection) return { ...state, technologySelection: technology };
  return {
    ...state,
    technologySelection: technology,
    technologyFilters: { ...state.technologyFilters, hiddenActors: [] },
  };
}

export function withMasquerExternes(state: AppState, masquer: boolean): AppState {
  return { ...state, technologyFilters: { ...state.technologyFilters, masquerExternes: masquer } };
}

export function withMasquerExternesMatrice(state: AppState, masquer: boolean): AppState {
  return { ...state, matrixFilters: { ...state.matrixFilters, masquerExternes: masquer } };
}

// Changing scale changes the nature of the rows: keeping the old names would
// hide rows with no checkbox left to bring them back.
export function withMatrixGrain(state: AppState, grain: MatrixGrain): AppState {
  if (grain === state.matrixFilters.grain) return state;
  return { ...state, matrixFilters: { ...state.matrixFilters, grain, hiddenActors: [] } };
}

// The order does not touch the filters: changing order neither hides nor
// reveals anyone, unlike a change of grain.
export function withMatrixOrder(state: AppState, order: MatrixOrder): AppState {
  return { ...state, matrixFilters: { ...state.matrixFilters, order } };
}

export function withActorHiddenInMatrix(state: AppState, actor: string, hidden: boolean): AppState {
  return {
    ...state,
    matrixFilters: {
      ...state.matrixFilters,
      hiddenActors: basculer(state.matrixFilters.hiddenActors, actor, hidden),
    },
  };
}

export function withActorHiddenForTechnology(state: AppState, actor: string, hidden: boolean): AppState {
  return {
    ...state,
    technologyFilters: {
      ...state.technologyFilters,
      hiddenActors: basculer(state.technologyFilters.hiddenActors, actor, hidden),
    },
  };
}

export function withMessageBandeau(state: AppState, message: string | null): AppState {
  return { ...state, messageBandeau: message };
}
