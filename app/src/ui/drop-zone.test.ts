import { describe, it, expect, vi } from "vitest";
import { buildDropTarget } from "./drop-zone";

function buildTarget(overrides: Partial<Parameters<typeof buildDropTarget>[0]> = {}): HTMLElement {
  return buildDropTarget({ onFile: () => {}, onOpenSample: () => {}, onHelp: () => {}, ...overrides });
}

function buttonByLabel(root: HTMLElement, label: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim() === label);
  if (!button) throw new Error(`button "${label}" not found`);
  return button as HTMLButtonElement;
}

// A phone has no drag and drop: without a picker, the landing screen offers a
// gesture the reader cannot make, and the tool is simply unusable there.
describe("buildDropTarget — picking a workbook", () => {
  it("hands the picked file to onFile", () => {
    let handed: File | undefined;
    const target = buildTarget({ onFile: (f) => (handed = f) });
    const field = target.querySelector("input[type=file]") as HTMLInputElement;
    const file = new File([""], "june.xlsx");
    Object.defineProperty(field, "files", { value: [file] });
    field.dispatchEvent(new Event("change", { bubbles: true }));
    expect(handed).toBe(file);
  });

  it("accepts the two workbook extensions the tool reads", () => {
    const field = buildTarget().querySelector("input[type=file]") as HTMLInputElement;
    expect(field.accept).toContain(".xlsx");
    expect(field.accept).toContain(".xlsm");
  });

  // The raw input renders as an unlabelled control the reader has no reason to
  // recognise: the button is what carries the offer, the input stays hidden.
  it("opens the picker from a labelled button", () => {
    const target = buildTarget();
    const field = target.querySelector("input[type=file]") as HTMLInputElement;
    const opened = vi.fn();
    field.click = opened;
    buttonByLabel(target, "Choose a workbook").click();
    expect(opened).toHaveBeenCalled();
  });
});

describe("buildDropTarget — the sample button", () => {
  it("asks for the sample to be opened", () => {
    const opened = vi.fn();
    buttonByLabel(buildTarget({ onOpenSample: opened }), "Open a sample workbook").click();
    expect(opened).toHaveBeenCalled();
  });
});
