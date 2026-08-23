import { describe, it, expect, vi } from "vitest";
import { openMigration } from "./upgrade-dialog";
import { writeTemplate, type WorkbookData } from "../export/template-export";
import { readReferentialUrls } from "../export/datamashup";
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


// The repair rebuilds every sheet, and the referential URLs are in none of
// them: they live in the binary Power Query stream. Handing back a workbook
// whose queries have quietly gone is exactly what the specification forbids of
// the migration.
describe("openMigration — the referential queries survive the repair", () => {
  const REFERENTIALS = { actors: "https://ref/actors.csv", technologies: "https://ref/technologies.csv" };

  it("puts the dropped workbook's URLs back into the repaired one", async () => {
    vi.mocked(downloadWorkbook).mockClear();
    document.body.innerHTML = "";
    openMigration();
    const zone = document.querySelector(".migration-target") as HTMLElement;

    const buffer = writeTemplate({ ...emptyData, referentials: REFERENTIALS });
    drop(zone, { name: "ok.xlsx", arrayBuffer: async () => buffer } as unknown as File);

    await vi.waitFor(() => {
      if (!zone.querySelector(".export-button")) throw new Error("not repaired yet");
    });

    expect(downloadWorkbook).toHaveBeenCalledTimes(1);
    expect(await readReferentialUrls(vi.mocked(downloadWorkbook).mock.calls[0][0])).toEqual(REFERENTIALS);
  });
});
