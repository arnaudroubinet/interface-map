import { describe, it, expect, vi } from "vitest";
import { mountApp } from "./app";
import { writeTemplate, type WorkbookData } from "../export/template-export";
import { readReferentialUrls } from "../export/datamashup";
import { SCHEMA_VERSION } from "../parsing/build-model";
import * as XLSX from "xlsx";

vi.mock("../export/download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/download")>();
  return { ...actual, downloadText: vi.fn(), downloadWorkbook: vi.fn() };
});

vi.mock("../export/datamashup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/datamashup")>();
  return { ...actual, readReferentialUrls: vi.fn(actual.readReferentialUrls) };
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

  // The compared workbook's referential URLs are stored but never read by
  // anything: reading them would mean reopening the whole package with
  // XLSX.CFB for no purpose. Pinned here so nobody "fixes" this later by
  // reading them again.
  it("never reads the compared workbook's referential URLs", async () => {
    vi.mocked(readReferentialUrls).mockClear();
    const root = document.createElement("div");
    mountApp(root);

    const referentials = { actors: "https://ref/actors.csv", technologies: "https://ref/technologies.csv" };
    const drop = (data: WorkbookData, name: string) => {
      const file = { name, arrayBuffer: async () => writeTemplate(data) } as unknown as File;
      const event = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
      root.dispatchEvent(event);
    };

    drop({ ...base([["V1", "1", "", "Delivered", "", ""]]), referentials }, "june.xlsx");
    await vi.waitFor(() => {
      if (!root.querySelector(".rail-view-item")) throw new Error("workbook not loaded yet");
    });
    expect(readReferentialUrls).toHaveBeenCalledTimes(1);

    buttonByLabel(root, "Changes").click();

    // The compared workbook has one interface fewer: something must move, or
    // the diagram is never drawn and the test would pass on an empty page.
    const january = { ...base([["V1", "1", "", "Delivered", "", ""]]), interfaces: [], fx: [], referentials };
    const field = root.querySelector("input.rail-compare-file") as HTMLInputElement;
    Object.defineProperty(field, "files", {
      value: [
        { name: "january.xlsx", arrayBuffer: async () => writeTemplate(january) } as unknown as File,
      ],
    });
    field.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      if (!root.querySelector("svg title")) throw new Error("diagram not drawn yet");
    });

    // Still one call: the main workbook's, only. The compared file's URLs --
    // present in its bytes, exactly like the main one's -- were never read.
    expect(readReferentialUrls).toHaveBeenCalledTimes(1);
  });
});


// The referential URLs are NOT in any sheet: they live in the binary Power
// Query stream. Every rebuild of the workbook -- and the upgrade is one --
// therefore has to put them back from the file that was loaded, failing which
// bringing a workbook up to the current model would silently erase its
// queries. This test is that guard: it is the upgrade button, not the
// referential block, that is clicked here.
describe("Upgrade — the referential queries survive the rewrite", () => {
  const REFERENTIALS = { actors: "https://ref/actors.csv", technologies: "https://ref/technologies.csv" };

  // A workbook of the current format, with its schema number lowered: that is
  // what a workbook produced by an older version of the tool looks like, and
  // writeTemplate can only stamp the current one.
  function staleWorkbook(): ArrayBuffer {
    const cfb = XLSX.CFB.read(new Uint8Array(writeTemplate({ ...data, referentials: REFERENTIALS })), {
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

  it("carries the loaded workbook's URLs into the upgraded file", async () => {
    vi.mocked(downloadWorkbook).mockClear();
    const root = document.createElement("div");
    mountApp(root);

    const bytes = staleWorkbook();
    expect(await readReferentialUrls(bytes)).toEqual(REFERENTIALS);

    const file = { name: "stale.xlsx", arrayBuffer: async () => bytes } as unknown as File;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    root.dispatchEvent(event);

    await vi.waitFor(() => {
      buttonByLabel(root, "Download the upgraded workbook");
    });
    buttonByLabel(root, "Download the upgraded workbook").click();

    expect(downloadWorkbook).toHaveBeenCalledTimes(1);
    const written = vi.mocked(downloadWorkbook).mock.calls[0][0];
    expect(await readReferentialUrls(written)).toEqual(REFERENTIALS);
  });
});


// Editing a URL and clicking straight into the OTHER field used to lose the
// click: `change` fires on blur, the rail was rebuilt between the mousedown and
// the mouseup, and the second field never took focus. The edit therefore
// updates the state WITHOUT a render -- and the paths that rewrite the workbook
// read the state at click time, so they must still see what was just typed.
describe("External referential — editing a URL without redrawing the rail", () => {
  async function loadedApp(): Promise<HTMLElement> {
    // Attached to the document: in jsdom a detached node cannot take focus, and
    // the focus is half of what this describe block checks.
    document.body.innerHTML = "";
    const root = document.createElement("div");
    document.body.appendChild(root);
    mountApp(root);
    dropFile(root);
    await vi.waitFor(() => {
      if (!root.querySelector("input.rail-referential-url")) throw new Error("rail not rendered yet");
    });
    return root;
  }

  const urlFields = (root: HTMLElement) =>
    [...root.querySelectorAll("input.rail-referential-url")] as HTMLInputElement[];

  function type(field: HTMLInputElement, value: string): void {
    field.focus();
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // The proxy for the browser defect: if the rail were rebuilt, both inputs
  // would be different nodes and the focused one would be detached.
  it("leaves both fields in place and keeps the focus where it was", async () => {
    const root = await loadedApp();
    const before = urlFields(root);
    type(before[0], "https://ref/actors.csv");

    const after = urlFields(root);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(document.activeElement).toBe(before[0]);
  });

  // Both fields edited in a row, exactly as the lost click would have had them:
  // no render happened in between, so the second edit must have seen the first.
  it("hands the rail's own download the two URLs just typed", async () => {
    vi.mocked(downloadWorkbook).mockClear();
    const root = await loadedApp();
    const fields = urlFields(root);
    type(fields[0], "https://ref/actors.csv");
    type(fields[1], "https://ref/technologies.csv");

    buttonByLabel(root, "Download the workbook with these URLs").click();

    expect(downloadWorkbook).toHaveBeenCalledTimes(1);
    expect(await readReferentialUrls(vi.mocked(downloadWorkbook).mock.calls[0][0])).toEqual({
      actors: "https://ref/actors.csv",
      technologies: "https://ref/technologies.csv",
    });
  });
});
