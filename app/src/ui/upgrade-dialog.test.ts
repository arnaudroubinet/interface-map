import { describe, it, expect, vi } from "vitest";
import { openMigration } from "./upgrade-dialog";
import { writeTemplate, type WorkbookData } from "../export/template-export";
import { readReferentialUrl } from "../export/datamashup";
import { REFERENTIAL_SHEETS } from "../export/referential-shape";
import { SAMPLE_DATA } from "../export/sample-data";
import * as XLSX from "xlsx";
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

// The field asks for the URL of a referential the reader may not have yet.
// Handing over the file to publish, at the very place the question is asked,
// is the difference between an empty field and a first referential.
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

  it("hands over a blank referential carrying the tables the query looks for", () => {
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

// What is pasted into the field is a SharePoint "Copy link" nine times out of
// ten: a viewer address, whose sign-in Excel refuses because it is not the
// file's. The field keeps the path and shows what it kept -- silently cleaning
// would leave the reader with an address on screen that is not the one written.
describe("openMigration — the address the field keeps", () => {
  const typeUrl = (value: string): HTMLInputElement => {
    document.body.innerHTML = "";
    openMigration();
    const field = document.querySelector("input.migration-referential") as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event("change", { bubbles: true }));
    return field;
  };

  it("keeps the path of a copied link and drops the rest, in the field itself", () => {
    const field = typeUrl("https://tenant.sharepoint.com/:x:/r/sites/SI/Documents/ref.xlsx?csf=1&web=1&e=AbCd");
    expect(field.value).toBe("https://tenant.sharepoint.com/sites/SI/Documents/ref.xlsx");
  });

  it("writes into the workbook the address it shows", async () => {
    vi.mocked(downloadWorkbook).mockClear();
    const field = typeUrl("https://tenant.sharepoint.com/:x:/r/sites/SI/Documents/ref.xlsx?e=AbCd");
    const zone = document.querySelector(".migration-target") as HTMLElement;
    drop(zone, { name: "ok.xlsx", arrayBuffer: async () => writeTemplate(emptyData) } as unknown as File);
    await vi.waitFor(() => {
      if (!zone.querySelector(".export-button")) throw new Error("not repaired yet");
    });
    expect(await readReferentialUrl(vi.mocked(downloadWorkbook).mock.calls[0][0])).toBe(field.value);
  });

  // Nothing in a guest link names the file: no address can be recovered from
  // it, and writing it into a query would only fail at the first refresh.
  it("says a guest sharing link cannot be used, rather than writing it", () => {
    typeUrl("https://tenant-my.sharepoint.com/:x:/g/personal/a_b/EbXk7?e=9Xy");
    const said = document.querySelector(".migration-referential-said");
    expect(said?.textContent ?? "").toContain("does not name the file");
  });

  it("says nothing about an address it could keep", () => {
    typeUrl("https://intranet/ref/referential.xlsx");
    expect(document.querySelector(".migration-referential-said")?.textContent ?? "").toBe("");
  });
});
