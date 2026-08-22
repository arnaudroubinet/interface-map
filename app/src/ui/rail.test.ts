import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { renderRail, type RailCallbacks } from "./rail";
import { initialState, withLoadedFile, withMode, withView, withActorSelection, withComparedFile, type AppState } from "./state";
import { runIntegrityChecks } from "../integrity/checks";
import { SCHEMA_VERSION } from "../parsing/build-model";
import { actorsForReading, reading } from "../aggregation/reading";
import type { ParsedModel, Actor, InterfaceCatalogue, Consumption } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";

// The flows, resolved as at the real entry point (app.ts): a test passing an
// empty array would hide a real dependency of the rail on the flows' content
// (§ Technologies filter).
function flows(state: AppState): ReturnType<typeof reading> {
  return state.file ? reading(state.file.model, null, state.mode) : { flows: [], actors: [] };
}

function actor(name: string, actorType: string): Actor {
  return base.actor({ name, actorType });
}

function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return base.iface({ providerName: "Tatooine", expectedSheet: "FX_Tatooine_HTTP", ...o });
}

function consumption(o: Partial<Consumption> = {}): Consumption {
  return base.consumption({ consumerName: "Bus", legacyStatus: "Actif", decision: "Keep", sheet: "FX_Tatooine_HTTP", ...o });
}

// Tatooine publishes F towards Bus (Middleware, Technical), which relays it as
// F2 towards Naboo: in the functional reading the chain links Tatooine
// directly to Naboo, with no technology -- that is the ground the
// "Technologies" filter must reflect.
const modelWithFlows: ParsedModel = {
  actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware"), actor("Naboo", "Application")],
  groups: [{ name: "G", perimeter: "Platform", sheet: "Groups", row: 0 }],
  groupsSheetMissing: false,
  actorTypes: [
    { type: "Application", icon: "", nature: "Business", sheet: "ActorTypes", row: 0 },
    { type: "Middleware", icon: "", nature: "Technical", sheet: "ActorTypes", row: 0 },
  ],
  flowTypes: [base.flowType({ type: "HTTP" })],
  milestones: [],
  interfaces: [iface({}), iface({ flowName: "F2", providerName: "Bus", expectedSheet: "FX_Bus_HTTP" })],
  consumptions: [
    // It is the CONSUMPTION that says under which interface it comes back out
    // (v4): the ground still carried v3's "Relays" column, which nothing reads
    // any more -- the functional chain therefore did not exist, and the filter's
    // test passed for want of flows rather than for want of technology.
    consumption({ republishedAs: "F2" }),
    consumption({ flowName: "F2", consumerName: "Naboo", sheet: "FX_Bus_HTTP" }),
  ],
  fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
  missingOptionalColumns: [],
  schemaVersion: SCHEMA_VERSION,
  savedAt: null,
};

const model: ParsedModel = {
  actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware")],
  groups: [{ name: "G", perimeter: "Platform", sheet: "Groups", row: 0 }],
  groupsSheetMissing: false,
  actorTypes: [
    { type: "Application", icon: "", nature: "Business", sheet: "ActorTypes", row: 0 },
    { type: "Middleware", icon: "", nature: "Technical", sheet: "ActorTypes", row: 0 },
  ],
  flowTypes: [],
  milestones: [],
  interfaces: [],
  consumptions: [],
  fxSheetNames: [],
  missingOptionalColumns: [],
  schemaVersion: SCHEMA_VERSION,
  savedAt: null,
};

const report: IntegrityReport = { families: [], infoBlocks: [], totalAnomalies: 0, totalActions: 0, totalWarnings: 0 };

function noop(): void {}

const callbacks: RailCallbacks = {
  onMode: noop,
  onView: noop,
  onActorSelection: noop,
  onTechnologySelection: noop,
  onChainSelection: noop,
  onNeighbourhood: noop,
  onRoadmapSubject: noop,
  onWeightByCriticality: noop,
  onDisplayedMilestone: noop,
  onComparedMilestone: noop,
  onComparedFile: noop,
  onCounterOption: noop,
  onEdgeLabel: noop,
  onMatrixOrder: noop,
  onPngScale: noop,
  onTechnologyHidden: noop,
  onActorHidden: noop,
  onMasquerExternes: noop,
  onActorHiddenForTechnology: noop,
  onHideExternalsInMatrix: noop,
  onActorHiddenInMatrix: noop,
  onMatrixGrain: noop,
  onDownloadTemplate: noop,
  onDownloadSample: noop,
  onMigrationLegacy: noop,
};

function actorOptions(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".rail-suggestion")].map((o) => o.textContent ?? "");
}

function type(root: HTMLElement, text: string): void {
  const field = root.querySelector("input.rail-search") as HTMLInputElement;
  field.value = text;
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

function byActor(): AppState {
  return withView(
    withLoadedFile(initialState(), { name: "c.xlsx", model, report, dateModification: null }),
    "by-actor"
  );
}

describe("renderRail — the \"by actor\" selector", () => {
  it("lists every actor in the architecture reading", () => {
    const state = withView(withLoadedFile(initialState(), { name: "c.xlsx", model, report, dateModification: null }), "by-actor");
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], callbacks);
    expect(actorOptions(root)).toContain("Bus");
  });

  // §5.2: the selector lists only the business actors in the functional reading.
  it("lists only the business actors in the functional reading", () => {
    const state = withView(
      withMode(withLoadedFile(initialState(), { name: "c.xlsx", model, report, dateModification: null }), "functional"),
      "by-actor"
    );
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], callbacks);
    const options = actorOptions(root);
    expect(options).toContain("Tatooine");
    expect(options).not.toContain("Bus");
  });
});

// The upgrade screen reads a misunderstood workbook (§ viewOnLoad's comment):
// its anomalies are not reliable, so the badge must not show them until the
// workbook is up to date.
describe("renderRail — the anomaly badge on the upgrade screen", () => {
  it("does not show the anomaly counter when the workbook is blocked on the upgrade", () => {
    const oldModel: ParsedModel = { ...model, schemaVersion: SCHEMA_VERSION - 1 };
    const reportWithAnomalies: IntegrityReport = {
      families: [],
      infoBlocks: [],
      totalAnomalies: 5,
      totalActions: 0,
      totalWarnings: 0,
    };
    const state = withView(
      withLoadedFile(initialState(), { name: "c.xlsx", model: oldModel, report: reportWithAnomalies, dateModification: null }),
      "upgrade"
    );
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], callbacks);
    expect(root.querySelector(".count-anomalies")).toBeNull();
  });
});

describe("renderRail — the by-actor view's \"Technologies\" filter", () => {
  // An empty technology is not one (§5.2, the legend disappears with the
  // technologies): offering it would produce an unlabelled checkbox that empties
  // the whole diagram in one click while explaining nothing.
  it("does not show the Technologies block in functional mode", () => {
    const state = withActorSelection(
      withView(withMode(withLoadedFile(initialState(), { name: "c.xlsx", model: modelWithFlows, report, dateModification: null }), "functional"), "by-actor"),
      "Tatooine"
    );
    // The ground does carry a functional link: without this line, the test would
    // pass on an empty estate too, where there is nothing to filter.
    expect(flows(state).flows).toHaveLength(1);
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], callbacks);
    const titles = [...root.querySelectorAll(".rail-filter summary")].map((s) => s.textContent ?? "");
    expect(titles.some((t) => t.startsWith("Technologies"))).toBe(false);
  });

  it("shows the Technologies block in the architecture reading", () => {
    const state = withActorSelection(
      withView(withLoadedFile(initialState(), { name: "c.xlsx", model: modelWithFlows, report, dateModification: null }), "by-actor"),
      "Tatooine"
    );
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], callbacks);
    const titles = [...root.querySelectorAll(".rail-filter summary")].map((s) => s.textContent ?? "");
    expect(titles.some((t) => t.startsWith("Technologies"))).toBe(true);
  });
});

// --- QA: the selector listed the WORKBOOK's actors, not the current reading's.
// So it offered an actor the displayed milestone had retired, and selected one
// on its own for want of anything better: a phantom box, with not a word
// d'explication.
// ---------------------------------------------------------------------------
// 2. The "By actor" selector offers actors the milestone has retired.
// ---------------------------------------------------------------------------

describe("the \"By actor\" selector follows the displayed milestone", () => {
  const estate = base.template({
    actors: [
      base.actor({ name: "Aaa", introducedAt: "v1", retiredAt: "v2" }),
      base.actor({ name: "Bbb", introducedAt: "v1" }),
    ],
    groups: [base.group({ name: "G" })],
    actorTypes: [base.actorType()],
    flowTypes: [base.flowType()],
    milestones: [base.milestone({ name: "v1", rank: 1 }), base.milestone({ name: "v2", rank: 2 })],
    interfaces: [base.iface({ flowName: "F", providerName: "Bbb", expectedSheet: "FX_Bbb_HTTP" })],
    consumptions: [base.consumption({ flowName: "F", consumerName: "Aaa", sheet: "FX_Bbb_HTTP" })],
  });

  it("does not offer an actor absent from the current reading", () => {
    const state: AppState = withView(
      withLoadedFile(initialState(), {
        name: "c.xlsx",
        model: estate,
        report: runIntegrityChecks(estate),
        dateModification: null,
      }),
      "by-actor"
    );
    expect(state.shownMilestone).toBe("v2");
    expect(actorsForReading(estate, 2, "architecture").map((a) => a.name)).toEqual(["Bbb"]);

    const root = document.createElement("div");
    renderRail(root, state, reading(estate, 2, "architecture"), [], callbacks);
    const offered = [...root.querySelectorAll("select.rail-select option")].map((o) => o.getAttribute("value"));
    expect(offered).not.toContain("Aaa");
  });
});

// --- §2.3: the label named the protocol and never what travels. The choice is
// made in the rail, beside the counter -- which decides the ×N, not what gets
// named.
describe("renderRail — what a line's label names", () => {
  const loaded = () => withLoadedFile(initialState(), { name: "c.xlsx", model: modelWithFlows, report, dateModification: null });
  const rendered = (s: AppState) => {
    const root = document.createElement("div");
    renderRail(root, s, flows(s), [], callbacks);
    return root;
  };

  it("offers the label's three readings", () => {
    const options = [...rendered(loaded()).querySelectorAll(".rail-option-label option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["technology", "exchanges", "both"]);
  });

  it("shows the one that is chosen", () => {
    const s = { ...loaded(), options: { counters: true, edgeLabelMode: "exchanges" as const, pngScale: 2 as const, weightByCriticality: false } };
    const select = rendered(s).querySelector(".rail-option-label select") as HTMLSelectElement;
    expect(select.value).toBe("exchanges");
  });
});

// --- A5: a drop-down of N actors is not browsed beyond twenty, and the
// by-actor board is the one opened most on a real referential. The selector
// was the longest list in the tool, with no way to reach a name except by
// scrolling to it.
describe("renderRail — the by-actor search field", () => {
  function rendered(state: AppState = byActor()): HTMLElement {
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], callbacks);
    return root;
  }

  it("offers a filtering search field rather than a drop-down", () => {
    const root = rendered();
    expect(root.querySelector("input.rail-search")).not.toBeNull();
    expect(root.querySelector(".rail-suggestions")).not.toBeNull();
  });

  it("lists every actor of the reading while nothing is typed", () => {
    expect(actorOptions(rendered())).toEqual(["Bus", "Tatooine"]);
  });

  it("keeps only the actors whose name holds what was typed", () => {
    const root = rendered();
    type(root, "tat");
    expect(actorOptions(root)).toEqual(["Tatooine"]);
  });

  // normalizeText is already written and used everywhere a name is matched:
  // the field must not be the one place where an accent or a capital decides.
  it("filters up to case and accents", () => {
    const root = rendered();
    type(root, "BÙS");
    expect(actorOptions(root)).toEqual(["Bus"]);
  });

  it("shows nothing rather than everything when no name matches", () => {
    const root = rendered();
    type(root, "zzz");
    expect(actorOptions(root)).toEqual([]);
  });

  // The selection stays in state.actorSelection -- the field holds no state of
  // its own, so there is no second truth to keep in step with the first.
  it("marks the selected actor without holding the selection itself", () => {
    const root = rendered(withActorSelection(byActor(), "Bus"));
    const marked = [...root.querySelectorAll(".rail-suggestion[aria-current='true']")].map((e) => e.textContent);
    expect(marked).toEqual(["Bus"]);
  });

  it("announces the chosen actor when a suggestion is clicked", () => {
    let chosen = "";
    const state = byActor();
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], { ...callbacks, onActorSelection: (a) => (chosen = a) });
    const suggestion = [...root.querySelectorAll(".rail-suggestion")].find((e) => e.textContent === "Bus");
    (suggestion as HTMLButtonElement).click();
    expect(chosen).toBe("Bus");
  });
});

// --- A6: the Changes view can measure against another WORKBOOK. The control
// lives beside the milestone selector, because that is the other thing the view
// compares against.
describe("renderRail — comparing with a second workbook", () => {
  function changesView(state: AppState = initialState()): HTMLElement {
    const loaded = withLoadedFile(state, { name: "june.xlsx", model, report, dateModification: null });
    const s = withView(loaded, "changes");
    const root = document.createElement("div");
    renderRail(root, s, flows(s), [], callbacks);
    return root;
  }

  it("offers a file field to pick the workbook to measure against", () => {
    const field = changesView().querySelector("input.rail-compare-file") as HTMLInputElement;
    expect(field).not.toBeNull();
    expect(field.accept).toContain(".xlsx");
  });

  it("names the chosen workbook and offers to drop it", () => {
    const loaded = withLoadedFile(initialState(), { name: "june.xlsx", model, report, dateModification: null });
    const s = withComparedFile(withView(loaded, "changes"), {
      name: "january.xlsx",
      model,
      report,
      dateModification: null,
    });
    const root = document.createElement("div");
    renderRail(root, s, flows(s), [], callbacks);
    expect(root.querySelector(".rail-compare-name")?.textContent).toBe("january.xlsx");
    expect(root.querySelector(".rail-compare-drop")).not.toBeNull();
  });

  // A milestone selector that decides nothing is worse than an absent one: when
  // two workbooks are compared, both sides are read whole and "Compared to"
  // would sit there doing nothing at all.
  it("hides the compared-milestone selector while a workbook is being compared", () => {
    const withMilestones = { name: "june.xlsx", model: { ...model, milestones: [base.milestone({ name: "v1" }), base.milestone({ name: "v2", rank: 2 })] }, report, dateModification: null };
    const loaded = withView(withLoadedFile(initialState(), withMilestones), "changes");
    const labels = (s: AppState) => {
      const root = document.createElement("div");
      renderRail(root, s, flows(s), [], callbacks);
      return [...root.querySelectorAll(".rail-milestones label")].map((l) => l.textContent ?? "");
    };
    expect(labels(loaded).join(" ")).toContain("Compared to");
    expect(labels(withComparedFile(loaded, withMilestones)).join(" ")).not.toContain("Compared to");
  });

  it("announces the file the reader picked", () => {
    let picked: File | null | undefined;
    const loaded = withView(withLoadedFile(initialState(), { name: "june.xlsx", model, report, dateModification: null }), "changes");
    const root = document.createElement("div");
    renderRail(root, loaded, flows(loaded), [], { ...callbacks, onComparedFile: (f) => (picked = f) });
    const field = root.querySelector("input.rail-compare-file") as HTMLInputElement;
    const file = new File([""], "january.xlsx");
    Object.defineProperty(field, "files", { value: [file] });
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(picked).toBe(file);
  });

  it("announces nothing chosen when the comparison is dropped", () => {
    let picked: File | null | undefined = undefined;
    const loaded = withView(withLoadedFile(initialState(), { name: "june.xlsx", model, report, dateModification: null }), "changes");
    const s = withComparedFile(loaded, { name: "january.xlsx", model, report, dateModification: null });
    const root = document.createElement("div");
    renderRail(root, s, flows(s), [], { ...callbacks, onComparedFile: (f) => (picked = f) });
    (root.querySelector(".rail-compare-drop") as HTMLButtonElement).click();
    expect(picked).toBeNull();
  });
});
