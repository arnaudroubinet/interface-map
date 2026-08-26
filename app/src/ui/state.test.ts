import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import {
  initialState,
  withLoadedFile,
  withView,
  withOptions,
  withActorSelection,
  withActorHiddenInMatrix,
  withMatrixGrain,
  withMode,
  withDisplayedMilestone,
  withComparedFile,
  viewOnLoad,
} from "./state";
import { SCHEMA_VERSION } from "../parsing/build-model";
import type { ParsedModel } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";

const model: ParsedModel = base.template();
const report: IntegrityReport = { families: [], infoBlocks: [], totalAnomalies: 0, totalActions: 0, totalWarnings: 0 };

describe("initialState", () => {
  it("starts with no file loaded and no options set", () => {
    const state = initialState();
    expect(state.file).toBeNull();
    expect(state.view).toBe("group-to-group");
    expect(state.options).toEqual({ counters: true, edgeLabelMode: "technology", pngScale: 2, weightByCriticality: false });
  });
});

describe("withLoadedFile", () => {
  it("replaces the whole state at once and opens on the default view when the file is clean", () => {
    const loaded = withLoadedFile(initialState(), {
      name: "classeur.xlsx", model, report, modifiedAt: null, referential: "",
    });
    expect(loaded.file?.name).toBe("classeur.xlsx");
    expect(loaded.view).toBe("group-to-group");
  });

  it("opens on the integrity view when the file breaks the rules, rather than on a diagram", () => {
    const atFault: IntegrityReport = {
      families: [{ id: "coherence", title: "Cohérence", description: "", anomalies: [{ message: "…" }] }],
      infoBlocks: [],
      totalAnomalies: 1,
      totalActions: 0,
      totalWarnings: 0,
    };
    const loaded = withLoadedFile(initialState(), {
      name: "classeur.xlsx", model, report: atFault, modifiedAt: null, referential: "",
    });
    expect(loaded.view).toBe("checks");
  });
});

describe("withView / withOptions / withActorSelection", () => {
  it("updates only the targeted slice of state", () => {
    const state = withActorSelection(withOptions(withView(initialState(), "by-actor"), { counters: false }), "Tatooine");
    expect(state.view).toBe("by-actor");
    expect(state.options.counters).toBe(false);
    expect(state.actorSelection).toBe("Tatooine");
  });
});

describe("withMatrixGrain", () => {
  it("starts on acteur-to-acteur", () => {
    expect(initialState().matrixFilters.grain).toBe("actor");
  });

  it("clears the masked rows, whose names no longer mean anything", () => {
    const hidden = withActorHiddenInMatrix(initialState(), "Tatooine", true);
    const folded = withMatrixGrain(hidden, "group");
    expect(folded.matrixFilters.grain).toBe("group");
    expect(folded.matrixFilters.hiddenActors).toEqual([]);
  });
});

describe("withLoadedFile — a workbook of an earlier version", () => {
  const old = { ...model, schemaVersion: 0 };

  it("opens on the upgrade screen rather than on a view", () => {
    const loaded = withLoadedFile(initialState(), {
      name: "vieux.xlsx", model: old, report, modifiedAt: null, referential: "",
    });
    expect(loaded.view).toBe("upgrade");
  });

  // The anomalies of a workbook that cannot be read in full are not reliable:
  // the upgrade comes first, failing which people would be made to fix defects
  // that may not be defects at all.
  it("comes before the checks screen, even when anomalies are present", () => {
    const atFault: IntegrityReport = {
      families: [{ id: "coherence", title: "Cohérence", description: "", anomalies: [{ message: "…" }] }],
      infoBlocks: [], totalAnomalies: 1, totalActions: 0, totalWarnings: 0,
    };
    const loaded = withLoadedFile(initialState(), {
      name: "vieux.xlsx", model: old, report: atFault, modifiedAt: null, referential: "",
    });
    expect(loaded.view).toBe("upgrade");
  });

  it("lets an up-to-date workbook open normally", () => {
    const loaded = withLoadedFile(initialState(), {
      name: "a-jour.xlsx", model, report, modifiedAt: null, referential: "",
    });
    expect(loaded.view).toBe("group-to-group");
  });
});

describe("withFichierCharge — palier d'ouverture", () => {
  const withMilestones = {
    ...model,
    milestones: [
      { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
      { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
      { name: "v3", rank: 3, label: "", status: "Planned", date: "", description: "", sheet: "Milestones", row: 0 },
    ],
  };

  it("opens on the last delivered milestone, comparing with the previous one", () => {
    const loaded = withLoadedFile(initialState(), {
      name: "c.xlsm", model: withMilestones, report, modifiedAt: null, referential: "",
    });
    expect(loaded.shownMilestone).toBe("v2");
    expect(loaded.comparedMilestone).toBe("v1");
  });

  it("leaves both null when the workbook declares no milestone", () => {
    const loaded = withLoadedFile(initialState(), {
      name: "c.xlsm", model, report, modifiedAt: null, referential: "",
    });
    expect(loaded.shownMilestone).toBeNull();
    expect(loaded.comparedMilestone).toBeNull();
  });
});

describe("reading mode", () => {
  it("ouvre en architecture", () => {
    expect(initialState().mode).toBe("architecture");
  });

  it("keeps the mode chosen", () => {
    expect(withMode(initialState(), "functional").mode).toBe("functional");
  });

  // "By technology" is moot with no technology: staying there would show an
  // empty view and explain nothing. The fallback is no longer group to group,
  // which is no less moot in the functional reading.
  it("leaves the by-technology view when switching to the functional reading", () => {
    const s = withView(initialState(), "by-technology");
    expect(withMode(s, "functional").view).toBe("platform-detail");
  });

  it("leaves the view in place when it still makes sense", () => {
    const s = withView(initialState(), "matrix");
    expect(withMode(s, "functional").view).toBe("matrix");
  });

  const actor = (name: string, actorType: string) => base.actor({ name, actorType });
  const modelMixte: ParsedModel = {
    ...model,
    actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware")],
    actorTypes: [
      { type: "Application", icon: "", nature: "Business", sheet: "ActorTypes", row: 0 },
      { type: "Middleware", icon: "", nature: "Technical", sheet: "ActorTypes", row: 0 },
    ],
  };

  // Switching to the functional reading without fixing the selection shows a
  // single box and no message: the box gone from the selector is still targeted.
  it("clears the actor selection when switching to the functional reading if it targeted a technical actor", () => {
    const loaded = withLoadedFile(initialState(), { name: "c.xlsx", model: modelMixte, report, modifiedAt: null, referential: "" });
    const s = withActorSelection(loaded, "Bus");
    expect(withMode(s, "functional").actorSelection).toBeNull();
  });

  it("keeps the selection when it already targeted a business actor", () => {
    const loaded = withLoadedFile(initialState(), { name: "c.xlsx", model: modelMixte, report, modifiedAt: null, referential: "" });
    const s = withActorSelection(loaded, "Tatooine");
    expect(withMode(s, "functional").actorSelection).toBe("Tatooine");
  });
});

// --- QA: changing milestone did not revalidate the actor selection. The mode
// already did (§5.2); the milestone did not. A retired actor therefore stayed
// selected although it is no longer in the reading, and the diagram showed
// nothing but a phantom box, with not a word to explain it.
describe("withDisplayedMilestone — the selection follows what the milestone shows", () => {
  const actor = (name: string, retiredAt = "") => base.actor({ name, retiredAt });
  const withRoadmap: ParsedModel = {
    ...model,
    milestones: [base.milestone({ name: "v1", rank: 1 }), base.milestone({ name: "v2", rank: 2 })],
    actors: [actor("Tatooine", "v2"), actor("Chandrila")],
  };
  const loaded = () =>
    withActorSelection(
      withLoadedFile(initialState(), { name: "c.xlsx", model: withRoadmap, report, modifiedAt: null, referential: "" }),
      "Tatooine"
    );

  it("drops an actor the new milestone no longer shows", () => {
    expect(withDisplayedMilestone(loaded(), "v2").actorSelection).toBeNull();
  });

  it("keeps an actor the new milestone still shows", () => {
    expect(withDisplayedMilestone(loaded(), "v1").actorSelection).toBe("Tatooine");
  });

  it("keeps the selection when the milestone filter is removed", () => {
    expect(withDisplayedMilestone(loaded(), null).actorSelection).toBe("Tatooine");
  });
});

// --- QA: a workbook of a schema NEWER than the tool opened normally -- the
// condition only looked at being behind. The tool drew an image of it
// truncated of everything it cannot yet read, without saying so.
describe("viewOnLoad — both directions of the schema mismatch", () => {
  const at = (schemaVersion: number) => ({
    name: "c.xlsx", model: { ...model, schemaVersion }, report, modifiedAt: null, referential: "",
  });

  it("blocks on a workbook that is behind", () => {
    expect(viewOnLoad(at(SCHEMA_VERSION - 1))).toBe("upgrade");
  });

  it("blocks on a workbook that is ahead too", () => {
    expect(viewOnLoad(at(SCHEMA_VERSION + 1))).toBe("upgrade");
  });

  it("lets a workbook of the right version through", () => {
    expect(viewOnLoad(at(SCHEMA_VERSION))).not.toBe("upgrade");
  });
});

// --- QA: group to group makes no sense in the functional reading -- only the
// architecture view is presented there. Yet the rail removed only "by
// technology", and the view stayed on offer.
describe("withMode — the views that are moot in the functional reading", () => {
  const loaded = () => withLoadedFile(initialState(), { name: "c.xlsx", model, report, modifiedAt: null, referential: "" });

  // "Group to group" was REOPENED in the functional reading: "which division
  // feeds which division" is precisely a board's question, and it is the only
  // view that answers it.
  it("keeps group to group when switching to the functional reading", () => {
    const state = withMode(withView(loaded(), "group-to-group"), "functional");
    expect(state.view).toBe("group-to-group");
  });

  it("leaves the by-technology view as well", () => {
    expect(withMode(withView(loaded(), "by-technology"), "functional").view).not.toBe("by-technology");
  });

  it("touches nothing in the architecture reading", () => {
    expect(withMode(withView(loaded(), "group-to-group"), "architecture").view).toBe("group-to-group");
  });
});

// --- A6: the Changes view can measure against another WORKBOOK, not only
// against another milestone of the one loaded.
describe("withComparedFile — comparing two workbooks", () => {
  const loaded = (name: string) => ({
    name,
    model: base.template(),
    report: { families: [], infoBlocks: [], totalAnomalies: 0, totalActions: 0, totalWarnings: 0 },
    modifiedAt: null, referential: "",
  });

  it("holds no compared workbook until one is chosen", () => {
    expect(initialState().comparedFile).toBeNull();
  });

  it("keeps the workbook chosen to measure against", () => {
    const state = withComparedFile(withLoadedFile(initialState(), loaded("june.xlsx")), loaded("january.xlsx"));
    expect(state.comparedFile?.name).toBe("january.xlsx");
  });

  it("puts the view back on the milestone axis when the comparison is dropped", () => {
    const chosen = withComparedFile(withLoadedFile(initialState(), loaded("june.xlsx")), loaded("january.xlsx"));
    expect(withComparedFile(chosen, null).comparedFile).toBeNull();
  });

  // The comparison was chosen against the workbook being replaced. Keeping it
  // would have the view assert a comparison nobody asked for, over a file that
  // has just changed under it -- and re-picking is one click.
  it("drops the comparison when another workbook is loaded", () => {
    const chosen = withComparedFile(withLoadedFile(initialState(), loaded("june.xlsx")), loaded("january.xlsx"));
    expect(withLoadedFile(chosen, loaded("march.xlsx")).comparedFile).toBeNull();
  });
});

// The URLs travel with the FILE, not with the tool: they are edited on the
// loaded workbook, and nothing else about it moves.
