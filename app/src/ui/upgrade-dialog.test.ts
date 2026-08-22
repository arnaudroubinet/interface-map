import { describe, it, expect, vi } from "vitest";
import { openMigration } from "./upgrade-dialog";
import { writeTemplate, type WorkbookData } from "../export/template-export";

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
      if (!zone.querySelector(".error-message")) throw new Error("pas encore de message d'erreur");
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
      if (!zone.querySelector(".export-button")) throw new Error("pas encore de bouton de relance");
    });

    const button = zone.querySelector(".export-button");
    expect(button?.textContent?.trim()).toBe("Convert another file");
  });
});
