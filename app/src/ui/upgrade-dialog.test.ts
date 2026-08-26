import { describe, it, expect, vi } from "vitest";
import { openMigration } from "./upgrade-dialog";
import { writeTemplate, type WorkbookData } from "../export/template-export";
import { readReferentialUrl } from "../export/datamashup";
import { downloadWorkbook } from "../export/download";

vi.mock("../export/download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/download")>();
  return { ...actual, downloadWorkbook: vi.fn() };
});

const emptyData: WorkbookData = { flowTypes: [], actorTypes: [], milestones: [], groups: [], actors: [], interfaces: [], fx: [] };

function drop(zone: HTMLElement, file: File): void {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  zone.dispatchEvent(event);
}

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


// The repair rebuilds every sheet, and the referential is in none of them: it
// lives in the binary Power Query stream. Handing back a workbook whose queries
// have quietly gone is exactly what the specification forbids of the migration.
describe("openMigration — the referential of the repaired workbook", () => {
  const REFERENTIAL = "https://tenant.sharepoint.com/sites/SI/Documents/referential.xlsx";

  function repair(data: WorkbookData): HTMLElement {
    vi.mocked(downloadWorkbook).mockClear();
    document.body.innerHTML = "";
    openMigration();
    const zone = document.querySelector(".migration-target") as HTMLElement;
    const buffer = writeTemplate(data);
    drop(zone, { name: "ok.xlsx", arrayBuffer: async () => buffer } as unknown as File);
    return zone;
  }

  const produced = async (): Promise<string> =>
    readReferentialUrl(vi.mocked(downloadWorkbook).mock.calls[0][0]);

  const settled = (zone: HTMLElement) =>
    vi.waitFor(() => {
      if (!zone.querySelector(".export-button")) throw new Error("not repaired yet");
    });

  it("keeps the one the dropped workbook already points at when the field is left empty", async () => {
    const zone = repair({ ...emptyData, referential: REFERENTIAL });
    await settled(zone);
    expect(downloadWorkbook).toHaveBeenCalledTimes(1);
    expect(await produced()).toBe(REFERENTIAL);
  });

  // Changing the referential is what this screen is for: the rail no longer
  // carries the field, because a URL is not a reading option -- it is a
  // property of the file, and this screen is where a file is rewritten.
  it("writes the URL typed in the field", async () => {
    document.body.innerHTML = "";
    openMigration();
    const field = document.querySelector("input.migration-referential") as HTMLInputElement;
    expect(field).not.toBeNull();
    field.value = "https://tenant.sharepoint.com/sites/SI/Documents/other.xlsx";

    vi.mocked(downloadWorkbook).mockClear();
    const zone = document.querySelector(".migration-target") as HTMLElement;
    const buffer = writeTemplate({ ...emptyData, referential: REFERENTIAL });
    drop(zone, { name: "ok.xlsx", arrayBuffer: async () => buffer } as unknown as File);
    await settled(zone);

    expect(await produced()).toBe("https://tenant.sharepoint.com/sites/SI/Documents/other.xlsx");
  });

  // Said out loud rather than left to be guessed: the field was empty, so the
  // reader has no way to know which of the two rules applied.
  it("names the referential the produced workbook points at", async () => {
    const zone = repair({ ...emptyData, referential: REFERENTIAL });
    await settled(zone);
    expect(zone.textContent).toContain(REFERENTIAL);
  });

  it("says so when the workbook produced points at none", async () => {
    const zone = repair(emptyData);
    await settled(zone);
    expect(zone.textContent).toContain("No external referential");
  });
});
