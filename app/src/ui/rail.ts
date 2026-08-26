import { el, clear } from "../shared/dom";
import { actorFilterOptions, technologyFilterOptions, matrixFilterOptions } from "../aggregation/views";
import type { MatrixGrain } from "../aggregation/views";
import type { Mode, EdgeLabelMode } from "../aggregation/core";
import type { MatrixOrder } from "../aggregation/seriation";
import { availableChains } from "../aggregation/chain";
import type { Neighbourhood } from "../aggregation/impact";
import type { RoadmapSubject } from "../aggregation/roadmap";
import { rankOfMilestone } from "../aggregation/milestones";
import { normalizeText } from "../shared/text";
import type { Actor } from "../parsing/model";

// The reading order goes from the shortest to the most complete.
const EDGE_LABELS: [EdgeLabelMode, string][] = [
  ["technology", "technology"],
  ["exchanges", "what flows"],
  ["both", "both"],
];
import type { Reading } from "../aggregation/reading";
import type { AppState, View, LoadedFile } from "./state";
import { VIEWS_MOOT_IN_FUNCTIONAL, VIEW_LABEL } from "./state";

// The rail's order, and nothing else: the labels come from VIEW_LABEL, which
// is the only table. "upgrade" is not in it -- one does not navigate there,
// one is sent there.
const VIEW_ORDER: View[] = [
  "group-to-group",
  "platform-detail",
  "platform-only",
  "by-actor",
  "by-technology",
  "chain",
  "roadmap",
  "matrix",
  "changes",
  "checks",
  "help",
];

export const VIEWS: { id: View; label: string }[] = VIEW_ORDER.map((id) => ({ id, label: VIEW_LABEL[id] }));

// The matrix's three reading scales, with the title of the checkbox block that
// goes with them: what gets unticked is the rows actually drawn.
const MATRIX_GRAINS: { id: MatrixGrain; label: string; filterTitle: string }[] = [
  { id: "actor", label: "Actor to actor", filterTitle: "Actors" },
  { id: "group", label: "Group to group", filterTitle: "Groups" },
  { id: "platform", label: "Platform to group", filterTitle: "Actors and groups" },
];

// The four orders offered, from the most neutral to the most interpretative.
const MATRIX_ORDERS: { id: MatrixOrder; label: string }[] = [
  { id: "alphabetical", label: "Order: alphabetical" },
  { id: "group", label: "Order: by group" },
  { id: "degree", label: "Order: by degree" },
  { id: "blocks", label: "Order: blocks" },
];

// How far the by-actor board carries the eye.
const NEIGHBOURHOODS: { id: Neighbourhood; label: string }[] = [
  { id: "direct", label: "Neighbours: direct" },
  { id: "upstream", label: "Neighbours: what it depends on" },
  { id: "downstream", label: "Neighbours: what depends on it" },
];

export interface RailCallbacks {
  onMode: (mode: Mode) => void;
  onView: (view: View) => void;
  onActorSelection: (name: string) => void;
  onTechnologySelection: (type: string) => void;
  onChainSelection: (chain: string) => void;
  onNeighbourhood: (value: Neighbourhood) => void;
  onRoadmapSubject: (value: RoadmapSubject) => void;
  onWeightByCriticality: (value: boolean) => void;
  onDisplayedMilestone: (milestone: string) => void;
  onComparedMilestone: (milestone: string) => void;
  onComparedFile: (file: File | null) => void;
  onCounterOption: (value: boolean) => void;
  onEdgeLabel: (value: EdgeLabelMode) => void;
  onMatrixOrder: (value: MatrixOrder) => void;
  onPngScale: (value: 1 | 2 | 4) => void;
  onTechnologyHidden: (tech: string, hidden: boolean) => void;
  onActorHidden: (actor: string, hidden: boolean) => void;
  onHideExternals: (value: boolean) => void;
  onActorHiddenForTechnology: (actor: string, hidden: boolean) => void;
  onHideExternalsInMatrix: (value: boolean) => void;
  onActorHiddenInMatrix: (actor: string, hidden: boolean) => void;
  onMatrixGrain: (grain: MatrixGrain) => void;
  onDownloadTemplate: () => void;
  onDownloadSample: () => void;
  onMigrationLegacy: () => void;
}

// A milestone is picked from a list, never typed: its label and its status are
// shown alongside, so one knows whether one is looking at what is delivered or
// what is planned.
function milestoneSelect(
  title: string,
  milestones: readonly { name: string; label: string; status: string }[],
  chosen: string | null,
  onChange: (milestone: string) => void
): HTMLElement {
  const block = el("label", { class: "rail-milestone" });
  block.appendChild(el("span", { class: "rail-milestone-title" }, [title]));
  const select = el("select", { class: "rail-select" });
  for (const p of milestones) {
    const suffix = p.label.trim() ? ` — ${p.label.trim()}` : "";
    const option = el("option", { value: p.name }, [`${p.name}${suffix} (${p.status || "?"})`]);
    if (p.name === chosen) option.selected = true;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onChange(select.value));
  block.appendChild(select);
  return block;
}

// The mode is chosen before the view, because it decides which ones make
// sense. Always offered, even on a workbook with no nature filled in: the
// functional mode already merges the media there, and that is what makes it
// discoverable -- hidden, nobody would know the column had to be filled.
function renderMode(root: HTMLElement, state: AppState, onMode: (mode: Mode) => void): void {
  const block = el("label", { class: "rail-milestone" });
  block.appendChild(el("span", { class: "rail-milestone-title" }, ["Reading"]));
  const select = el("select", { class: "rail-select" });
  // Both readings are correct and did not borrow the vocabulary their readers
  // already have: these are the ArchiMate viewpoints "Application Cooperation"
  // and "Application Usage".
  for (const [value, label] of [
    ["architecture", "Architecture — application interfaces (how it travels)"],
    ["functional", "Functional — application services (who feeds whom)"],
  ] as const) {
    const option = el("option", { value: value }, [label]);
    option.selected = state.mode === value;
    select.appendChild(option);
  }
  select.addEventListener("change", () => onMode(select.value as Mode));
  block.appendChild(select);
  root.appendChild(block);
}

// The "hide externals" switch, identical from one view to the next.
function externalsToggle(checked: boolean, onChange: (value: boolean) => void): HTMLElement {
  const label = el("label", { class: "rail-toggle" });
  const input = el("input", { type: "checkbox" });
  input.checked = checked;
  input.addEventListener("change", () => onChange(input.checked));
  label.appendChild(input);
  label.appendChild(document.createTextNode(" hide external"));
  return label;
}

// A collapsible group of checkboxes. Ticked = visible, unticked = hidden: what
// is described is what one sees, not what one removes.
function filterBlock(
  title: string,
  values: string[],
  hidden: readonly string[],
  onChange: (value: string, hidden: boolean) => void
): HTMLElement | null {
  if (values.length === 0) return null;
  const block = el("details", { class: "rail-filter", open: "" });
  const visibles = values.length - values.filter((v) => hidden.includes(v)).length;
  block.appendChild(el("summary", {}, [`${title} (${visibles}/${values.length})`]));
  for (const value of values) {
    const row = el("label", {});
    const case_ = el("input", { type: "checkbox" });
    case_.checked = !hidden.includes(value);
    case_.addEventListener("change", () => onChange(value, !case_.checked));
    row.appendChild(case_);
    row.appendChild(document.createTextNode(` ${value}`));
    block.appendChild(row);
  }
  return block;
}

// The workbook the Changes view measures against. It lives beside the milestone
// selector because that is the other thing the view compares against -- and it
// takes its place: when two files are compared, both sides are read whole, and
// a "Compared to" milestone deciding nothing would be worse than none at all.
function compareWithBlock(chosen: LoadedFile | null, onChoose: (file: File | null) => void): HTMLElement {
  const block = el("label", { class: "rail-milestone rail-compare" });
  block.appendChild(el("span", { class: "rail-milestone-title" }, ["Compare with a workbook"]));

  if (chosen) {
    const row = el("div", { class: "rail-compare-chosen" });
    row.appendChild(el("span", { class: "rail-compare-name" }, [chosen.name]));
    const drop = el("button", { class: "rail-compare-drop", type: "button", "aria-label": `Stop comparing with ${chosen.name}` }, ["×"]);
    drop.addEventListener("click", () => onChoose(null));
    row.appendChild(drop);
    block.appendChild(row);
    return block;
  }

  // Drag and drop drops the MAIN workbook: a second target on the same page
  // would make the two gestures indistinguishable, and the wrong one replaces
  // what is on screen.
  const field = el("input", { class: "rail-compare-file", type: "file", accept: ".xlsx,.xlsm" });
  field.addEventListener("change", () => {
    const file = field.files?.[0];
    if (file) onChoose(file);
  });
  block.appendChild(field);
  return block;
}

// A drop-down of N actors is not browsed beyond twenty, and on a real
// referential the by-actor board is the one opened most: its selector was the
// longest list in the tool, with no way to reach a name except by scrolling to
// it. The field filters as one types; the list under it is what a click
// chooses from.
//
// It holds NO state of its own. What was typed lives in the field and dies
// with the next render; the chosen actor lives where it always did, in
// state.actorSelection. A second copy of the selection would be a second truth
// to keep in step with the first.
function actorSearch(actors: readonly Actor[], selected: string | null, onPick: (name: string) => void): HTMLElement {
  const block = el("div", { class: "rail-search-block" });
  const field = el("input", {
    class: "rail-search",
    type: "search",
    placeholder: "Search an actor",
    "aria-label": "Search an actor",
  });
  const list = el("div", { class: "rail-suggestions" });
  const sorted = [...actors].sort((a, b) => a.name.localeCompare(b.name, "fr"));

  // The same normalisation as everywhere a name is matched in this project: the
  // field must not be the one place where an accent or a capital decides.
  const fill = (): void => {
    const sought = normalizeText(field.value);
    clear(list);
    for (const actor of sorted.filter((a) => normalizeText(a.name).includes(sought))) {
      const suggestion = el("button", { class: "rail-suggestion", type: "button" }, [actor.name]);
      // `aria-current` rather than a class alone: a screen reader must know
      // which of the names is the one the board is drawing.
      if (actor.name === selected) suggestion.setAttribute("aria-current", "true");
      suggestion.addEventListener("click", () => onPick(actor.name));
      list.appendChild(suggestion);
    }
  };

  field.addEventListener("input", fill);
  fill();
  block.append(field, list);
  return block;
}

// The rail's foot: something to start from. It shows even with no workbook
// loaded -- that is precisely when one looks for a template or a sample.
export function renderRailFoot(
  root: HTMLElement,
  callbacks: Pick<RailCallbacks, "onDownloadTemplate" | "onDownloadSample" | "onMigrationLegacy">
): void {
  const starts = el("div", { class: "rail-starts" });
  // These two hand back a FILE; the landing screen's "Open a sample workbook"
  // opens one on the spot. Labels that did not say which was which sent a
  // reader looking for the sample into their downloads folder -- and on a
  // phone that folder cannot be handed back to the page.
  const sample = el("button", { class: "rail-button" }, ["Download the sample"]);
  sample.title = "A complete fictional repository, to see the tool at work";
  sample.addEventListener("click", callbacks.onDownloadSample);
  starts.appendChild(sample);
  const template = el("button", { class: "rail-button" }, ["Download a blank template"]);
  template.title = "An empty workbook, ready to fill in";
  template.addEventListener("click", callbacks.onDownloadTemplate);
  starts.appendChild(template);
  const migration = el("button", { class: "rail-button" }, ["Repair or upgrade a workbook"]);
  migration.title = "Bring any workbook up to the current format and create the sheets it is missing";
  migration.addEventListener("click", callbacks.onMigrationLegacy);
  starts.appendChild(migration);
  root.appendChild(starts);
  root.appendChild(el("p", { class: "rail-copyright" }, ["© Arnaud Roubinet 2026"]));
}

export function renderRail(
  root: HTMLElement,
  state: AppState,
  // The SAME reading as the views, not the whole model: the rail used to offer
  // actors the displayed milestone had retired, and selected one on its own for
  // want of anything better -- the user then got a phantom box with not a word
  // of explanation.
  reading: Reading,
  currentTechnologies: string[],
  callbacks: RailCallbacks
): void {
  const flows = reading.flows;
  clear(root);
  if (!state.file) {
    renderRailFoot(root, callbacks);
    return;
  }

  // On the upgrade screen the views stay visible but inert: making them
  // clickable only to see them refuse would be worse than greying them out.
  const blocked = state.view === "upgrade";

  renderMode(root, state, callbacks.onMode);

  const nav = el("nav", { class: "rail-views" });
  const views = state.mode === "functional" ? VIEWS.filter((v) => !VIEWS_MOOT_IN_FUNCTIONAL.includes(v.id)) : VIEWS;
  for (const v of views) {
    const button = el("button", { class: "rail-view-item" }, [v.label]);
    if (blocked) button.disabled = true;
    if (v.id === state.view) button.setAttribute("aria-current", "true");
    // Three counters, three natures: anomalies invalidate the diagrams (red),
    // actions await a decision (blue), warnings report an incomplete entry
    // (yellow). Only red diverts the user from their view.
    //
    // On the upgrade screen the report concerns a badly-read workbook
    // (§ viewOnLoad): its counts mean nothing, and showing them would suggest a
    // diagnosis one does not have.
    if (v.id === "checks" && !blocked) {
      const { totalAnomalies, totalActions, totalWarnings } = state.file.report;
      if (totalAnomalies > 0) {
        button.appendChild(
          el("span", { class: "count-anomalies", title: "Blocking anomalies" }, [String(totalAnomalies)])
        );
      }
      if (totalActions > 0) {
        button.appendChild(
          el("span", { class: "count-actions", title: "Pending decisions" }, [String(totalActions)])
        );
      }
      if (totalWarnings > 0) {
        button.appendChild(
          el("span", { class: "count-warnings", title: "Points to confirm" }, [String(totalWarnings)])
        );
      }
    }
    button.addEventListener("click", () => callbacks.onView(v.id));
    nav.appendChild(button);
  }
  root.appendChild(nav);

  // The milestone selector comes before everything else: it applies to the whole
  // tool, not to the current view. Absent when the workbook declares no
  // milestone -- offering an empty axis would teach nothing.
  const milestones = state.file.model.milestones;
  if (!blocked && (milestones.length > 0 || state.view === "changes")) {
    const block = el("div", { class: "rail-milestones" });
    if (milestones.length > 0) {
      block.appendChild(milestoneSelect("Milestone", milestones, state.shownMilestone, callbacks.onDisplayedMilestone));
      if (state.view === "changes" && state.comparedFile === null) {
        block.appendChild(milestoneSelect("Compared to", milestones, state.comparedMilestone, callbacks.onComparedMilestone));
      }
    }
    // Comparing two files needs no milestone axis at all: a workbook that
    // declares none can still be measured against another, and that is often
    // exactly the workbook one wants to compare.
    if (state.view === "changes") {
      block.appendChild(compareWithBlock(state.comparedFile, callbacks.onComparedFile));
    }
    root.appendChild(block);
  }

  if (state.view === "by-actor") {
    // The selector offers only what the current reading keeps: the technical
    // actors disappear in the functional reading (§5.2), the retired ones
    // disappear at the milestone where they are.
    root.appendChild(actorSearch(reading.actors, state.actorSelection, callbacks.onActorSelection));

    // How far to carry the eye. "What depends on it" answers the question asked
    // on the day a migration has to be arbitrated: if this actor falls, who is
    // affected?
    const neighbourhood = el("select", { class: "rail-select rail-neighbourhood" });
    for (const v of NEIGHBOURHOODS) {
      const option = el("option", { value: v.id }, [v.label]);
      if (v.id === state.actorFilters.neighbourhood) option.selected = true;
      neighbourhood.appendChild(option);
    }
    neighbourhood.addEventListener("change", () => callbacks.onNeighbourhood(neighbourhood.value as Neighbourhood));
    root.appendChild(neighbourhood);
  }

  if (state.view === "by-technology") {
    const select = el("select", { class: "rail-select" });
    for (const type of [...state.file.model.flowTypes].sort((a, b) => a.type.localeCompare(b.type, "fr"))) {
      const option = el("option", { value: type.type }, [type.type]);
      if (type.type === state.technologySelection) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onTechnologySelection(select.value));
    root.appendChild(select);
  }

  // The by-actor view's filters: the actor being looked at cannot be unticked,
  // failing which the view would lose its subject.
  if (state.view === "by-actor" && state.actorSelection) {
    const available = actorFilterOptions(flows, state.actorSelection);
    const techs = filterBlock("Technologies", available.technologies, state.actorFilters.hiddenTechnologies, callbacks.onTechnologyHidden);
    if (techs) root.appendChild(techs);
    const actors = filterBlock("Related actors", available.actors, state.actorFilters.hiddenActors, callbacks.onActorHidden);
    if (actors) root.appendChild(actors);
  }

  if (state.view === "by-technology" && state.technologySelection) {
    root.appendChild(externalsToggle(state.technologyFilters.hideExternals, callbacks.onHideExternals));

    const available = technologyFilterOptions(state.file.model, flows, state.technologySelection, {
      hideExternals: state.technologyFilters.hideExternals,
    });
    const actors = filterBlock("Actors", available, state.technologyFilters.hiddenActors, callbacks.onActorHiddenForTechnology);
    if (actors) root.appendChild(actors);
  }

  if (state.view === "chain") {
    // The chain selector. A chain only makes sense in the functional reading:
    // that is where the plumbing is crossed, and the view shows precisely what
    // that crossing erases.
    const chains = availableChains(state.file.model, rankOfMilestone(state.file.model, state.shownMilestone ?? "") ?? null);
    const select = el("select", { class: "rail-select rail-chain" });
    for (const c of chains) {
      const option = el("option", { value: c.id }, [c.label]);
      if (c.id === state.chainSelection) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onChainSelection(select.value));
    root.appendChild(select);
    if (chains.length === 0) {
      root.appendChild(el("p", { class: "rail-empty" }, ["No chain in this workbook: no flow crosses a technical actor."]));
    }
  }

  if (state.view === "roadmap") {
    const select = el("select", { class: "rail-select rail-roadmap" });
    for (const [value, label] of [["interfaces", "Interfaces"], ["actors", "Actors"]] as const) {
      const option = el("option", { value: value }, [label]);
      if (value === state.roadmapSubject) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onRoadmapSubject(select.value as RoadmapSubject));
    root.appendChild(select);
  }

  if (state.view === "matrix") {
    const grain = state.matrixFilters.grain;
    const select = el("select", { class: "rail-select" });
    for (const g of MATRIX_GRAINS) {
      const option = el("option", { value: g.id }, [g.label]);
      if (g.id === grain) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => callbacks.onMatrixGrain(select.value as MatrixGrain));
    root.appendChild(select);

    // The order: this is the matrix's strongest reading lever, and it was
    // unused. Alphabetical stays the default -- a seriation must never impose
    // itself in silence.
    const order = el("select", { class: "rail-select rail-matrix-order" });
    for (const o of MATRIX_ORDERS) {
      const option = el("option", { value: o.id }, [o.label]);
      if (o.id === state.matrixFilters.order) option.selected = true;
      order.appendChild(option);
    }
    order.addEventListener("change", () => callbacks.onMatrixOrder(order.value as MatrixOrder));
    root.appendChild(order);

    root.appendChild(externalsToggle(state.matrixFilters.hideExternals, callbacks.onHideExternalsInMatrix));
    const available = matrixFilterOptions(state.file.model, flows, {
      grain,
      hideExternals: state.matrixFilters.hideExternals,
    });
    const title = MATRIX_GRAINS.find((g) => g.id === grain)!.filterTitle;
    const actors = filterBlock(title, available, state.matrixFilters.hiddenActors, callbacks.onActorHiddenInMatrix);
    if (actors) root.appendChild(actors);
  }

  if (state.view !== "checks" && !blocked) {
    const options = el("fieldset", { class: "rail-options" });

    const countersLabel = el("label", {});
    const countersInput = el("input", { type: "checkbox" });
    countersInput.checked = state.options.counters;
    countersInput.addEventListener("change", () => callbacks.onCounterOption(countersInput.checked));
    countersLabel.appendChild(countersInput);
    countersLabel.appendChild(document.createTextNode(" counters"));
    options.appendChild(countersLabel);

    // Naming the protocol alone makes a map of PIPES; naming the exchange makes
    // it a map of what TRAVELS. Both are worth the same depending on the
    // question asked of the diagram, hence the choice rather than an imposed
    const labelField = el("label", { class: "rail-option-label" }, ["Label "]);
    const labelSelect = el("select", { class: "rail-select" });
    for (const [value, text] of EDGE_LABELS) {
      const option = el("option", { value: value }, [text]);
      if (value === state.options.edgeLabelMode) option.selected = true;
      labelSelect.appendChild(option);
    }
    labelSelect.addEventListener("change", () => callbacks.onEdgeLabel(labelSelect.value as EdgeLabelMode));
    labelField.appendChild(labelSelect);
    options.appendChild(labelField);

    // default. The PNG's scale, beside what it serves: an architecture diagram
    // is thin lines, the case where high resolution still pays.
    const scaleLabel = el("label", { class: "rail-option-png" }, ["PNG "]);
    const scaleSelect = el("select", { class: "rail-select" });
    for (const factor of [1, 2, 4] as const) {
      const option = el("option", { value: String(factor) }, [`${factor}×`]);
      if (factor === state.options.pngScale) option.selected = true;
      scaleSelect.appendChild(option);
    }
    scaleSelect.addEventListener("change", () => callbacks.onPngScale(Number(scaleSelect.value) as 1 | 2 | 4));
    scaleLabel.appendChild(scaleSelect);
    options.appendChild(scaleLabel);

    // Criticality has been entered, checked and exported since day one, and was
    // never drawn. It is the workbook's most decision-bearing field.
    //
    const critLabel = el("label", { class: "rail-option-criticality" });
    const critInput = el("input", { type: "checkbox" });
    critInput.checked = state.options.weightByCriticality;
    critInput.addEventListener("change", () => callbacks.onWeightByCriticality(critInput.checked));
    critLabel.appendChild(critInput);
    critLabel.appendChild(document.createTextNode(" thickness by criticality"));
    options.appendChild(critLabel);

    root.appendChild(options);
  }

  renderRailFoot(root, callbacks);

  // The legend is no longer here: it is drawn IN the SVG, so as to travel with
  // the exported diagram. Duplicating it in the rail would only make two sources
  // to keep up to date.
}
