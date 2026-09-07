import { describe, it, expect, vi } from "vitest";
import { openMigration } from "./upgrade-dialog";
import { writeTemplate, type WorkbookData } from "../export/template-export";
import { writeReferential, type ReferentialData } from "../export/referential-template";
import { REFERENTIAL_SHEETS } from "../parsing/referential-shape";
import { REF_ACTORS_SHEET } from "../parsing/build-model";
import { parseWorkbook } from "../parsing/workbook";
import { buildModel } from "../parsing/build-model";
import { SAMPLE_DATA } from "../export/sample-data";
import * as XLSX from "xlsx";
import { downloadWorkbook } from "../export/download";

vi.mock("../export/download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/download")>();
  return { ...actual, downloadWorkbook: vi.fn() };
});

const emptyData: WorkbookData = { flowTypes: [], actorTypes: [], milestones: [], groups: [], actors: [], interfaces: [], fx: [] };

function drop(zone: HTMLElement, ...files: File[]): void {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files } });
  zone.dispatchEvent(event);
}

const asFile = (name: string, bytes: ArrayBuffer): File =>
  ({ name, arrayBuffer: async () => bytes } as unknown as File);

// A truncated workbook cannot be read at all: the real cause is "unreadable
// file", not "missing Flux sheet", whether or not the workbook ever had a Flux
// sheet. The same file dropped on the main target (app.ts) produces "Workbook
// unreadable or corrupted." — that message, and no other, is the one the
// migration dialog must take up.
describe("ouvrirMigration — classeur corrompu", () => {
  it("announces, in English, that the workbook is unreadable rather than a missing Flux sheet", async () => {
    document.body.innerHTML = "";
    openMigration();
    const zone = document.querySelector(".migration-target") as HTMLElement;

    const complet = writeTemplate(emptyData);
    const truncated = complet.slice(0, Math.floor(complet.byteLength / 3));
    const file = { name: "corrompu.xlsx", arrayBuffer: async () => truncated } as unknown as File;
    drop(zone, file);

    await vi.waitFor(() => {
      if (!zone.querySelector(".error-message")) throw new Error("no error message yet");
    });

    const message = zone.querySelector(".error-message");
    expect(message?.textContent).toBe("Workbook unreadable or corrupted.");
  });
});

// The Escape listener sits on the document. Closing by the cross or the veil
// left it there, one more per opening, each removing an overlay long gone.
describe("openMigration — closing", () => {
  const listeners = () => {
    const added = vi.spyOn(document, "addEventListener");
    const removed = vi.spyOn(document, "removeEventListener");
    return { added, removed };
  };

  it("removes its Escape listener when closed by the cross", () => {
    document.body.innerHTML = "";
    const { added, removed } = listeners();
    openMigration();
    (document.querySelector(".close-button") as HTMLButtonElement).click();
    expect(document.querySelector(".migration-overlay")).toBeNull();
    const keydownAdded = added.mock.calls.filter(([type]) => type === "keydown").length;
    const keydownRemoved = removed.mock.calls.filter(([type]) => type === "keydown").length;
    expect(keydownRemoved).toBe(keydownAdded);
    vi.restoreAllMocks();
  });

  it("removes it when closed by the veil, and when closed by Escape", () => {
    document.body.innerHTML = "";
    const { added, removed } = listeners();
    openMigration();
    (document.querySelector(".migration-overlay") as HTMLElement).click();
    openMigration();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".migration-overlay")).toBeNull();
    const keydownAdded = added.mock.calls.filter(([type]) => type === "keydown").length;
    const keydownRemoved = removed.mock.calls.filter(([type]) => type === "keydown").length;
    expect(keydownAdded).toBeGreaterThanOrEqual(2);
    // At least: earlier tests in this file wiped their dialog with the body
    // and left its listener behind; the first Escape makes each of those
    // remove itself too, which is the same fix at work.
    expect(keydownRemoved).toBeGreaterThanOrEqual(keydownAdded);
    vi.restoreAllMocks();
  });
});

// The button that starts another conversion must be readable to an
// English-speaking user just like the rest of the success screen.
describe("openMigration — the try-again button", () => {
  it("carries an English label", async () => {
    document.body.innerHTML = "";
    openMigration();
    const zone = document.querySelector(".migration-target") as HTMLElement;

    const buffer = writeTemplate(emptyData);
    const file = { name: "ok.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    drop(zone, file);

    await vi.waitFor(() => {
      if (!zone.querySelector(".export-button")) throw new Error("no retry button yet");
    });

    const button = zone.querySelector(".export-button");
    expect(button?.textContent?.trim()).toBe("Convert another file");
  });
});


// The repair rebuilds every sheet, the hidden copy of the referential included.
// Dropped beside the workbook, the referential is what that copy is rebuilt
// from; dropped without one, the workbook keeps the copy it had -- handing back
// a workbook whose lists have quietly gone is exactly what this screen must
// never do.
describe("openMigration — the referential copy of the repaired workbook", () => {
  const referential: ReferentialData = {
    actors: [["Tatooine", "Core", "Application", "Leia", "The capital"]],
    groups: [["Core", "The platform"]],
    actorTypes: [["Application", "app-window", "Business", ""]],
    flowTypes: [["HTTP", "consumer → provider", "", "#1f5fae"]],
  };

  function repair(...files: File[]): HTMLElement {
    vi.mocked(downloadWorkbook).mockClear();
    document.body.innerHTML = "";
    openMigration();
    const zone = document.querySelector(".migration-target") as HTMLElement;
    drop(zone, ...files);
    return zone;
  }

  const producedActors = (): string[] => {
    const result = buildModel(parseWorkbook(vi.mocked(downloadWorkbook).mock.calls[0][0]));
    if (!result.ok) throw new Error("unreadable workbook");
    return result.model.referentialActors.map((a) => a.name);
  };

  const settled = (zone: HTMLElement) =>
    vi.waitFor(() => {
      if (!zone.querySelector(".export-button")) throw new Error("not repaired yet");
    });

  it("rebuilds the copy from the referential dropped alongside, whichever came first", async () => {
    const zone = repair(asFile("ref.xlsx", writeReferential(referential)), asFile("ok.xlsx", writeTemplate(emptyData)));
    await settled(zone);
    expect(downloadWorkbook).toHaveBeenCalledTimes(1);
    expect(producedActors()).toEqual(["Tatooine"]);
    expect(zone.textContent).toContain("refreshed from ref.xlsx");
  });

  it("keeps the copy the workbook carried when no referential is dropped, and says so", async () => {
    const held = { [REF_ACTORS_SHEET]: [["Naboo", "Core", "Application", "", ""]] };
    const zone = repair(asFile("ok.xlsx", writeTemplate({ ...emptyData, referentialRows: held })));
    await settled(zone);
    expect(producedActors()).toEqual(["Naboo"]);
    expect(zone.textContent).toContain("kept as the workbook carried it");
  });

  // A referential alone is not a workbook to repair: the reader is told what
  // the file is, not that it is unreadable.
  it("refuses a referential dropped alone, and says why", async () => {
    const zone = repair(asFile("ref.xlsx", writeReferential(referential)));
    await vi.waitFor(() => {
      if (!zone.querySelector(".error-message")) throw new Error("no message yet");
    });
    expect(zone.querySelector(".error-message")?.textContent).toContain("ref.xlsx is a referential");
    expect(downloadWorkbook).not.toHaveBeenCalled();
  });

  it("refuses two workbooks dropped at once", async () => {
    const zone = repair(asFile("a.xlsx", writeTemplate(emptyData)), asFile("b.xlsx", writeTemplate(emptyData)));
    await vi.waitFor(() => {
      if (!zone.querySelector(".error-message")) throw new Error("no message yet");
    });
    expect(zone.querySelector(".error-message")?.textContent).toContain("Several workbooks");
    expect(downloadWorkbook).not.toHaveBeenCalled();
  });
});

// The screen asks for a referential the reader may not have yet. Handing over
// the file to fill in, at the very place the question is asked, is the
// difference between a dead end and a first referential.
describe("openMigration — getting a referential to publish", () => {
  const written = () => vi.mocked(downloadWorkbook).mock.calls[0][0];

  const tablesOf = (bytes: ArrayBuffer): string[] => {
    const cfb = XLSX.CFB.read(new Uint8Array(bytes), { type: "array" });
    return (cfb as { FullPaths: string[] }).FullPaths.filter((p) => /\/xl\/tables\/table\d+\.xml$/.test(p))
      .map((p) => {
        const found = XLSX.CFB.find(cfb, p);
        const xml = new TextDecoder().decode(new Uint8Array(found!.content as never));
        return /displayName="([^"]+)"/.exec(xml)?.[1] ?? "";
      });
  };

  const click = (label: string): void => {
    vi.mocked(downloadWorkbook).mockClear();
    document.body.innerHTML = "";
    openMigration();
    const button = [...document.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
    if (!button) throw new Error(`button "${label}" not found`);
    (button as HTMLButtonElement).click();
  };

  it("hands over a blank referential carrying the tables the shape announces", () => {
    click("Blank referential");
    expect(downloadWorkbook).toHaveBeenCalledTimes(1);
    const tables = tablesOf(written());
    for (const r of REFERENTIAL_SHEETS) expect(tables).toContain(r.table);
  });

  // Filled, because an empty referential shows nothing of what a referential
  // does -- and filled with the sample cartography's own names, so the two can
  // be pointed at each other.
  it("hands over a sample referential publishing the sample cartography's actors", () => {
    click("Sample referential");
    const wb = XLSX.read(new Uint8Array(written()), { type: "array" });
    const names = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Actors, { header: 1 }).slice(1).map((r) => r[0]);
    expect(names).toEqual(SAMPLE_DATA.actors.map((a) => a[0]));
  });
});

