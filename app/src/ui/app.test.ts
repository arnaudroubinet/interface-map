import { describe, it, expect, vi } from "vitest";
import { mountApp } from "./app";
import { writeTemplate, type WorkbookData } from "../export/template-export";
import { writeReferential, type ReferentialData } from "../export/referential-template";
import { readReferentialWorkbook } from "../parsing/referential-workbook";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel, SCHEMA_VERSION, REF_ACTORS_SHEET } from "../parsing/build-model";
import * as XLSX from "xlsx";

vi.mock("../export/download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/download")>();
  return { ...actual, downloadText: vi.fn(), downloadWorkbook: vi.fn() };
});

import { downloadText, downloadWorkbook } from "../export/download";

const data: WorkbookData = {
  flowTypes: [["HTTP", "consumer → provider", ""]],
  actorTypes: [],
  milestones: [],
  groups: [["Core", "Platform"]],
  actors: [
    ["Tatooine", "Core", "Application", "", "", "", "", ""],
    ["Mygeeto", "Core", "Application", "", "", "", "", ""],
  ],
  interfaces: [["Authent", "", "Tatooine", "HTTP", "", "", "", "", "No", "", ""]],
  fx: [{ name: "FX_Tatooine_HTTP", rows: [["Authent", "", "Mygeeto", "", "", "Keep", "", "", "", ""]] }],
};

// jsdom's File does not implement arrayBuffer(): no real File is built, only
// what handleFile asks of it (name, arrayBuffer()).
function dropFile(root: HTMLElement): void {
  const buffer = writeTemplate(data);
  const file = { name: "test.xlsx", arrayBuffer: async () => buffer } as unknown as File;
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  root.dispatchEvent(event);
}

function buttonByLabel(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith(label));
  if (!button) throw new Error(`button "${label}" introuvable`);
  return button as HTMLButtonElement;
}

// The (Markdown) report does not depend on the mode (§5.3): both readings
// judge the SAME workbook, with the same anomalies. Two names for identical
// content would suggest two different reports.
describe("Markdown export — a file name independent of the mode", () => {
  it("produces the same name in the architecture and functional readings", async () => {
    const root = document.createElement("div");
    mountApp(root);
    dropFile(root);
    await vi.waitFor(() => {
      if (!root.querySelector(".rail-view-item")) throw new Error("workbook not loaded yet");
    });

    buttonByLabel(root, "Integrity checks").click();
    buttonByLabel(root, "Markdown").click();

    const modeSelect = [...root.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "functional")
    ) as HTMLSelectElement;
    modeSelect.value = "functional";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    buttonByLabel(root, "Integrity checks").click();
    buttonByLabel(root, "Markdown").click();

    const called = vi.mocked(downloadText);
    expect(called).toHaveBeenCalledTimes(2);
    const [, architectureName] = called.mock.calls[0];
    const [, functionalName] = called.mock.calls[1];
    expect(functionalName).toBe(architectureName);
  });
});

// Ghost publishes GhostFeed, which Bus (Middleware, Technical) consumes
// without relaying: the functional chain stops there, and Ghost has no flow
// left in the functional reading. §5.2: it must stay displayed, alone.
const dataWithIsolatedActor: WorkbookData = {
  flowTypes: [["HTTP", "consumer → provider", ""]],
  actorTypes: [
    ["Application", "", "Business"],
    ["Middleware", "", "Technical"],
  ],
  milestones: [],
  groups: [["Core", "Platform"]],
  actors: [
    ["Tatooine", "Core", "Application", "", "", "", "", ""],
    ["Bus", "Core", "Middleware", "", "", "", "", ""],
    ["Naboo", "Core", "Application", "", "", "", "", ""],
    ["Ghost", "Core", "Application", "", "", "", "", ""],
  ],
  interfaces: [
    ["Transactions", "", "Tatooine", "HTTP", "", "", "", "", "No", "", "", ""],
    ["trx.norm", "", "Bus", "HTTP", "", "", "", "", "No", "Transactions", "", ""],
    ["GhostFeed", "", "Ghost", "HTTP", "", "", "", "", "No", "", "", ""],
  ],
  fx: [
    { name: "FX_Tatooine_HTTP", rows: [["Transactions", "", "Bus", "", "", "Keep", "", "", ""]] },
    { name: "FX_Bus_HTTP", rows: [["trx.norm", "", "Naboo", "", "", "Keep", "", "", ""]] },
    { name: "FX_Ghost_HTTP", rows: [["GhostFeed", "", "Bus", "", "", "Keep", "", "", ""]] },
  ],
};

// The "by actor" view must draw the isolated actor, alone, rather than show
// the "no flow" message reserved for the absence of a selection.
describe("by-actor view — a business actor isolated in the functional reading", () => {
  it("draws the actor alone instead of the \"no flow\" message", async () => {
    const root = document.createElement("div");
    mountApp(root);
    const buffer = writeTemplate(dataWithIsolatedActor);
    const file = { name: "test.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    root.dispatchEvent(event);
    await vi.waitFor(() => {
      if (!root.querySelector(".rail-view-item")) throw new Error("workbook not loaded yet");
    });

    const modeSelect = [...root.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "functional")
    ) as HTMLSelectElement;
    modeSelect.value = "functional";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));

    buttonByLabel(root, "By actor").click();
    // The by-actor selector is a search field: the actor is chosen by clicking
    // its suggestion, not by setting a select's value.
    const suggestion = [...root.querySelectorAll(".rail-suggestion")].find((e) => e.textContent === "Ghost");
    (suggestion as HTMLButtonElement).click();

    await vi.waitFor(() => {
      if (!root.querySelector("svg")) throw new Error("diagram not drawn yet");
    });
    expect(root.querySelector(".no-flow")).toBeNull();
  });
});

// The workbook's one anomaly concerns an interface retired at V2: at the
// current milestone (the last delivered) it is already filtered out, so the
// displayed report is sound. The landing view must reflect THAT report, not
// the unfiltered one used to choose the view before settling on the
// palier courant.
const dataWithRetiredAnomaly: WorkbookData = {
  flowTypes: [["HTTP", "consumer → provider", ""]],
  actorTypes: [["Application", "box", "Business"]],
  milestones: [
    ["V1", "1", "", "Delivered", "", ""],
    ["V2", "2", "", "Delivered", "", ""],
  ],
  groups: [["Core", "Platform"]],
  actors: [
    ["Tatooine", "Core", "Application", "", "", "", "V1", ""],
    ["Mygeeto", "Core", "Application", "", "", "", "V1", ""],
  ],
  interfaces: [["RetiredIface", "", "Tatooine", "HTTP", "", "https://example", "", "", "No", "V1", "V2"]],
  fx: [{ name: "FX_Tatooine_HTTP", rows: [["RetiredIface", "", "Mygeeto", "test usage", "", "Keep", "", "", "V1", "V2"]] }],
};

describe("landing view — an anomaly on a row retired at the current milestone", () => {
  it("opens on Group to group, not on Integrity checks", async () => {
    const root = document.createElement("div");
    mountApp(root);
    const buffer = writeTemplate(dataWithRetiredAnomaly);
    const file = { name: "test.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    root.dispatchEvent(event);
    await vi.waitFor(() => {
      if (!root.querySelector(".rail-view-item")) throw new Error("workbook not loaded yet");
    });

    const active = root.querySelector('.rail-view-item[aria-current="true"]');
    expect(active?.textContent?.trim()).toBe("Group to group");
  });
});

// One milestone declared is not "no milestone": comparing asks for two bounds,
// the second is missing, but the workbook is not silent about its time axis for
// all that -- saying otherwise would contradict it.
const dataWithASingleMilestone: WorkbookData = {
  flowTypes: [["HTTP", "consumer → provider", ""]],
  actorTypes: [],
  milestones: [["V1", "1", "", "Delivered", "", ""]],
  groups: [["Core", "Platform"]],
  actors: [["Tatooine", "Core", "Application", "", "", "", "", ""]],
  interfaces: [],
  fx: [],
};

describe("Changes view — a single milestone declared", () => {
  it("does not claim the workbook declares no milestone", async () => {
    const root = document.createElement("div");
    mountApp(root);
    const buffer = writeTemplate(dataWithASingleMilestone);
    const file = { name: "test.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    root.dispatchEvent(event);
    await vi.waitFor(() => {
      if (!root.querySelector(".rail-view-item")) throw new Error("workbook not loaded yet");
    });

    buttonByLabel(root, "Changes").click();

    const message = root.querySelector(".no-flow");
    expect(message?.textContent).toBe("This workbook declares only one milestone; comparing needs two — or another workbook.");
  });
});


// --- QA: the layout memo is keyed on what decides the DRAWING. The chain
// selection was missing from it, so switching chains changed nothing on screen:
// two different views shared the same diagram.
describe("Chain view — switching chains redraws", () => {
  // Two DISJOINT chains: no actor in common. That is what makes the defect
  // detectable -- with shared plumbing the drawing would stay plausible even
  // while reusing the other chain's layout.
  const twoChains: WorkbookData = {
    flowTypes: [["Kafka", "provider → consumer", ""]],
    actorTypes: [["Application", "app-window", "Business"], ["Infra", "app-window", "Technical"]],
    milestones: [],
    groups: [["Core", "Platform"]],
    actors: [
      ["Amont1", "Core", "Application", "", "", "", "", ""],
      ["Amont2", "Core", "Application", "", "", "", "", ""],
      ["Bus1", "Core", "Infra", "", "", "", "", ""],
      ["Bus2", "Core", "Infra", "", "", "", "", ""],
      ["Aval1", "Core", "Application", "", "", "", "", ""],
      ["Aval2", "Core", "Application", "", "", "", "", ""],
    ],
    interfaces: [
      ["Un", "", "Amont1", "Kafka", "", "", "", "", "No", "", ""],
      ["Deux", "", "Amont2", "Kafka", "", "", "", "", "No", "", ""],
      ["Sortie1", "", "Bus1", "Kafka", "", "", "", "", "No", "", ""],
      ["Sortie2", "", "Bus2", "Kafka", "", "", "", "", "No", "", ""],
    ],
    fx: [
      { name: "FX_Amont1_Kafka", rows: [["Un", "", "Bus1", "", "", "Keep", "", "Sortie1", "", ""]] },
      { name: "FX_Amont2_Kafka", rows: [["Deux", "", "Bus2", "", "", "Keep", "", "Sortie2", "", ""]] },
      { name: "FX_Bus1_Kafka", rows: [["Sortie1", "", "Aval1", "", "", "Keep", "", "", "", ""]] },
      { name: "FX_Bus2_Kafka", rows: [["Sortie2", "", "Aval2", "", "", "Keep", "", "", "", ""]] },
    ],
  };

  it("draws the chain chosen, and not the previous one", async () => {
    const root = document.createElement("div");
    mountApp(root);
    const buffer = writeTemplate(twoChains);
    const file = { name: "test.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    root.dispatchEvent(event);
    await vi.waitFor(() => expect(root.querySelector(".rail-view-item")).not.toBeNull());

    buttonByLabel(root, "Chain").click();
    const select = await vi.waitFor(() => {
      const s = root.querySelector(".rail-chain") as HTMLSelectElement | null;
      if (!s || s.options.length < 2) throw new Error("selector not ready");
      return s;
    });
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toHaveLength(2);

    // The BOXES, not only the labels: the labels come from the current view and
    // would change even on a stale layout. The boxes come from the layout -- that
    // is where the defect shows.
    const boxes = async () =>
      vi.waitFor(() => {
        const svg = root.querySelector(".render-area svg");
        if (!svg) throw new Error("no diagram");
        const b = [...svg.querySelectorAll(".fx-nodes > g")].map((g) => g.querySelector("text")?.textContent);
        if (b.length === 0) throw new Error("no box");
        return b;
      });

    const premier = await boxes();
    expect(premier).toContain("Amont1");
    select.value = select.options[1].value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
    const second = await vi.waitFor(async () => {
      const b = await boxes();
      expect(b).not.toEqual(premier);
      return b;
    });
    expect(second).toContain("Amont2");
    expect(second).not.toContain("Amont1");
  });
});

// --- A6: an exported SVG travels alone, so its title block is the only thing
// that says what it shows. When two WORKBOOKS are compared, both sides are read
// whole -- announcing "milestone v2" there would be a plain falsehood, in the
// one place the reader has nothing else to check it against.
describe("Changes view — comparing two workbooks", () => {
  const base = (milestones: string[][]): WorkbookData => ({
    flowTypes: [["HTTP", "consumer → provider", ""]],
    actorTypes: [],
    milestones,
    groups: [["Core", "Platform"], ["Out", "External"]],
    actors: [
      ["Tatooine", "Core", "Application", "", "", "", "V1", ""],
      ["Naboo", "Out", "Application", "", "", "", "V1", ""],
    ],
    interfaces: [["F", "1.0", "Tatooine", "HTTP", "", "", "", "", "No", "", "V1", ""]],
    fx: [{ name: "FX_Tatooine_HTTP", rows: [["F", "1.0", "Naboo", "", "", "Keep", "", "V1", ""]] }],
  });

  it("names both workbooks and claims no milestone", async () => {
    const root = document.createElement("div");
    mountApp(root);

    const drop = (data: WorkbookData, name: string) => {
      const file = { name, arrayBuffer: async () => writeTemplate(data) } as unknown as File;
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
      root.dispatchEvent(event);
    };

    drop(base([["V1", "1", "", "Delivered", "", ""], ["V2", "2", "", "Delivered", "", ""]]), "june.xlsx");
    await vi.waitFor(() => {
      if (!root.querySelector(".rail-view-item")) throw new Error("workbook not loaded yet");
    });

    buttonByLabel(root, "Changes").click();

    // The second workbook has one interface fewer: something must move, or the
    // diagram is never drawn and the test would pass on an empty page.
    const january = { ...base([["V1", "1", "", "Delivered", "", ""]]), interfaces: [], fx: [] };
    const field = root.querySelector("input.rail-compare-file") as HTMLInputElement;
    Object.defineProperty(field, "files", {
      value: [{ name: "january.xlsx", arrayBuffer: async () => writeTemplate(january) } as unknown as File],
    });
    field.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      if (!root.querySelector("svg title")) throw new Error("diagram not drawn yet");
    });

    const title = root.querySelector("svg title")?.textContent ?? "";
    expect(title).toContain("january.xlsx");
    expect(title).toContain("june.xlsx");
    expect(title).not.toContain("milestone");
  });
});


// The hidden copy of the referential is rebuilt with the rest of the workbook
// at every rewrite -- and the upgrade is one. Bringing a workbook up to the
// current model must not hand back one whose lists have gone: this test is
// that guard, and it is the upgrade button that is clicked here.
describe("Upgrade — the referential copy survives the rewrite", () => {
  const HELD = { [REF_ACTORS_SHEET]: [["Tatooine", "Core", "Application", "Leia", "The capital"]] };

  // A workbook of the current format, with its schema number lowered: that is
  // what a workbook produced by an older version of the tool looks like, and
  // writeTemplate can only stamp the current one.
  function staleWorkbook(): ArrayBuffer {
    const cfb = XLSX.CFB.read(new Uint8Array(writeTemplate({ ...data, referentialRows: HELD })), {
      type: "array",
    });
    const version = (cfb as { FullPaths: string[] }).FullPaths.find((path) => {
      if (!/worksheets\/sheet\d+\.xml$/.test(path)) return false;
      const part = XLSX.CFB.find(cfb, path);
      return part !== null && new TextDecoder().decode(new Uint8Array(part.content as never)).includes(">Model version<");
    });
    if (!version) throw new Error("no sheet carries the model version");
    const xml = new TextDecoder()
      .decode(new Uint8Array(XLSX.CFB.find(cfb, version)!.content as never))
      .replace(`<c r="A2"><v>${SCHEMA_VERSION}</v></c>`, `<c r="A2"><v>${SCHEMA_VERSION - 1}</v></c>`);
    XLSX.CFB.utils.cfb_add(cfb, version, [...new TextEncoder().encode(xml)]);
    return XLSX.CFB.write(cfb, { fileType: "zip", type: "array" }) as unknown as ArrayBuffer;
  }

  it("carries the loaded workbook's copy into the upgraded file", async () => {
    vi.mocked(downloadWorkbook).mockClear();
    const root = document.createElement("div");
    mountApp(root);

    const file = { name: "stale.xlsx", arrayBuffer: async () => staleWorkbook() } as unknown as File;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    root.dispatchEvent(event);

    await vi.waitFor(() => {
      buttonByLabel(root, "Download the upgraded workbook");
    });
    buttonByLabel(root, "Download the upgraded workbook").click();

    expect(downloadWorkbook).toHaveBeenCalledTimes(1);
    const written = vi.mocked(downloadWorkbook).mock.calls[0][0];
    const reread = buildModel(parseWorkbook(written));
    if (!reread.ok) throw new Error("unreadable workbook");
    expect(reread.model.schemaVersion).toBe(SCHEMA_VERSION);
    expect(reread.model.referentialActors.map((a) => a.name)).toEqual(["Tatooine"]);
  });
});


// The referential is a file dropped beside the cartography, and the tool tells
// the two apart by their shape. What it says of the copy the cartography holds
// is said in the banner; when that copy had drifted, the workbook is rebuilt
// with the referential's rows, shown, and offered back -- never downloaded on
// the reader's behalf.
describe("the referential dropped beside the cartography", () => {
  const published: ReferentialData = {
    actors: [
      ["Tatooine", "Core", "Application", "Leia", ""],
      ["Mygeeto", "Core", "Application", "", ""],
    ],
    groups: [["Core", ""]],
    actorTypes: [],
    flowTypes: [["HTTP", "consumer → provider", "", ""]],
  };
  const referentialFile = () => ({ name: "ref.xlsx", arrayBuffer: async () => writeReferential(published) }) as unknown as File;
  const cartographyFile = (workbook: WorkbookData, name = "carto.xlsx") =>
    ({ name, arrayBuffer: async () => writeTemplate(workbook) }) as unknown as File;

  function drop(root: HTMLElement, ...files: File[]): void {
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files } });
    root.dispatchEvent(event);
  }

  const banner = (root: HTMLElement) => root.querySelector(".banner")?.textContent ?? "";
  const loaded = (root: HTMLElement) =>
    vi.waitFor(() => {
      if (!root.querySelector(".rail-view-item")) throw new Error("workbook not loaded yet");
    });
  const downloadButton = (root: HTMLElement) =>
    [...root.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === "Download the updated workbook");

  // What the referential publishes, as the cartography would hold it: the
  // shape the copy is compared in.
  const publishedRows = () => readReferentialWorkbook(parseWorkbook(writeReferential(published)))!;

  it("says the copy is up to date, and offers nothing to download", async () => {
    const root = document.createElement("div");
    mountApp(root);
    drop(root, cartographyFile({ ...data, referentialRows: publishedRows() }), referentialFile());
    await loaded(root);
    await vi.waitFor(() => {
      if (!banner(root).includes("up to date")) throw new Error("no verdict yet");
    });
    expect(banner(root)).toContain("Referential ref.xlsx");
    expect(downloadButton(root)).toBeUndefined();
  });

  it("rebuilds a drifted copy, shows the rebuilt workbook and offers it back", async () => {
    vi.mocked(downloadWorkbook).mockClear();
    const root = document.createElement("div");
    mountApp(root);
    // Whichever order: the referential first, here.
    drop(root, referentialFile(), cartographyFile({ ...data, referentialRows: { [REF_ACTORS_SHEET]: [["Tatooine", "Core", "Application", "", ""]] } }));
    await loaded(root);
    const button = await vi.waitFor(() => {
      const b = downloadButton(root);
      if (!b) throw new Error("no download offered yet");
      return b;
    });
    expect(banner(root)).toContain("had drifted");
    // Nothing downloaded until asked.
    expect(downloadWorkbook).not.toHaveBeenCalled();

    button.click();
    expect(downloadWorkbook).toHaveBeenCalledTimes(1);
    const [bytes, filename] = vi.mocked(downloadWorkbook).mock.calls[0];
    expect(filename).toBe("carto.xlsx");
    const reread = buildModel(parseWorkbook(bytes));
    if (!reread.ok) throw new Error("unreadable workbook");
    expect(reread.model.referentialActors.map((a) => a.name)).toEqual(["Tatooine", "Mygeeto"]);
    expect(reread.model.schemaVersion).toBe(SCHEMA_VERSION);
  });

  // The button must survive a click on a view: the reader looks at the rebuilt
  // workbook, then downloads it. Cleared on the first navigation, the offer
  // would be gone before it was taken.
  it("keeps the offer while the reader navigates", async () => {
    const root = document.createElement("div");
    mountApp(root);
    drop(root, cartographyFile({ ...data, referentialRows: { [REF_ACTORS_SHEET]: [] } }), referentialFile());
    await loaded(root);
    await vi.waitFor(() => {
      if (!downloadButton(root)) throw new Error("no download offered yet");
    });
    buttonByLabel(root, "Matrix").click();
    expect(downloadButton(root)).toBeDefined();
  });

  it("applies a referential dropped afterwards to the workbook on screen", async () => {
    const root = document.createElement("div");
    mountApp(root);
    drop(root, cartographyFile({ ...data, referentialRows: { [REF_ACTORS_SHEET]: [["Tatooine", "Core", "Application", "", ""]] } }));
    await loaded(root);
    expect(downloadButton(root)).toBeUndefined();

    drop(root, referentialFile());
    await vi.waitFor(() => {
      if (!downloadButton(root)) throw new Error("no download offered yet");
    });
    expect(banner(root)).toContain("Referential ref.xlsx");
  });

  // The writer falls back on the workbook's own actors when the copy's Actors
  // sheet is empty. Compared against the referential's empty sheet, that copy
  // drifted at every drop: the same blank referential rebuilt the workbook
  // forever. Compared as WRITTEN, the second drop finds nothing to do.
  it("finds a workbook up to date once rebuilt from a referential publishing an empty sheet", async () => {
    const blank: ReferentialData = { ...published, actors: [] };
    const blankFile = () => ({ name: "blank.xlsx", arrayBuffer: async () => writeReferential(blank) }) as unknown as File;
    const root = document.createElement("div");
    mountApp(root);
    // A copy that names a group the referential does not: the first drop drifts.
    drop(root, cartographyFile({ ...data, referentialRows: { RefGroups: [["Old", ""]] } }), blankFile());
    await loaded(root);
    const button = await vi.waitFor(() => {
      const b = downloadButton(root);
      if (!b) throw new Error("no download offered yet");
      return b;
    });
    // The rebuilt workbook, dropped back with the same blank referential.
    vi.mocked(downloadWorkbook).mockClear();
    button.click();
    const [bytes] = vi.mocked(downloadWorkbook).mock.calls[0];
    drop(root, { name: "carto.xlsx", arrayBuffer: async () => bytes } as unknown as File, blankFile());
    await vi.waitFor(() => {
      if (!banner(root).includes("up to date")) throw new Error("no verdict yet");
    });
    expect(downloadButton(root)).toBeUndefined();
  });

  it("refuses a referential dropped with nothing to apply it to, and says what it is", async () => {
    const root = document.createElement("div");
    mountApp(root);
    drop(root, referentialFile());
    await vi.waitFor(() => {
      if (!root.querySelector(".banner-error")) throw new Error("no message yet");
    });
    expect(root.querySelector(".banner-error")?.textContent).toContain("ref.xlsx is a referential");
    expect(root.querySelector(".rail-view-item")).toBeNull();
  });

  it("refuses two cartographies dropped at once", async () => {
    const root = document.createElement("div");
    mountApp(root);
    drop(root, cartographyFile(data, "a.xlsx"), cartographyFile(data, "b.xlsx"));
    await vi.waitFor(() => {
      if (!root.querySelector(".banner-error")) throw new Error("no message yet");
    });
    expect(root.querySelector(".banner-error")?.textContent).toContain("Several cartographies");
    expect(root.querySelector(".rail-view-item")).toBeNull();
  });
});


// A layout still in flight when the reader moves to a view that draws no
// diagram -- the matrix, the report -- must find its generation stale. It did
// not: the counter only moved on the diagram branches, and the late SVG landed
// under the matrix, with the image exports switched back on.
describe("mountApp — a late layout never lands under another view", () => {
  it("draws no diagram under the matrix opened while a layout was running", async () => {
    const root = document.createElement("div");
    mountApp(root);
    dropFile(root);
    await vi.waitFor(() => {
      if (!root.querySelector(".rail-view-item")) throw new Error("workbook not loaded yet");
    });
    // A diagram view starts its layout; the matrix is asked for in the same
    // tick, before that layout can land.
    buttonByLabel(root, "Platform detail").click();
    buttonByLabel(root, "Matrix").click();
    await vi.waitFor(() => {
      if (!root.querySelector(".render-area table")) throw new Error("matrix not drawn yet");
    });
    // Long enough for the abandoned layout to resolve.
    await new Promise((r) => setTimeout(r, 1500));
    expect(root.querySelector(".render-area svg")).toBeNull();
    expect(root.querySelector(".render-area table")).not.toBeNull();
  });
});

describe("mountApp — opening the sample workbook", () => {
  it("loads the sample instead of downloading it", async () => {
    vi.mocked(downloadWorkbook).mockClear();
    const root = document.createElement("div");
    mountApp(root);

    buttonByLabel(root, "Open a sample workbook").click();

    await vi.waitFor(() => {
      if (!root.querySelector(".rail-view-item")) throw new Error("sample not loaded yet");
    });
    expect(downloadWorkbook).not.toHaveBeenCalled();
  });
});

// The picker is the only way in on a phone: what it hands over must reach the
// same reading as a drop, message of refusal included.
describe("mountApp — the workbook picker", () => {
  it("loads the workbook chosen in the file field", async () => {
    const root = document.createElement("div");
    mountApp(root);
    const field = root.querySelector(".drop-target input[type=file]") as HTMLInputElement;
    const buffer = writeTemplate(data);
    const file = { name: "test.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    Object.defineProperty(field, "files", { value: [file] });
    field.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      if (!root.querySelector(".rail-view-item")) throw new Error("workbook not loaded yet");
    });
  });
});

describe("the rail drawer — a phone's rail opens, serves, and closes", () => {
  it("toggles on its button, and closes when a view is picked or the veil is touched", () => {
    const root = document.createElement("div");
    mountApp(root);

    const toggle = root.querySelector<HTMLButtonElement>(".rail-toggle")!;
    const layout = root.querySelector(".layout")!;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    toggle.click();
    expect(layout.classList.contains("rail-open")).toBe(true);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    // Picking a view is leaving the menu: the drawer closes by itself.
    const view = root.querySelector<HTMLButtonElement>(".rail-view-item");
    if (view) view.click();
    else (layout as HTMLElement).click();
    expect(layout.classList.contains("rail-open")).toBe(false);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    // Touching the board behind the open drawer closes it too.
    toggle.click();
    (layout as HTMLElement).click();
    expect(layout.classList.contains("rail-open")).toBe(false);
  });
});
