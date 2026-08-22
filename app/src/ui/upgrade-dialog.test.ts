import { describe, it, expect, vi } from "vitest";
import { openMigration } from "./upgrade-dialog";
import { writeTemplate, type WorkbookData } from "../export/template-export";

vi.mock("../export/download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/download")>();
  return { ...actual, downloadWorkbook: vi.fn() };
});

const donneesVides: WorkbookData = { flowTypes: [], actorTypes: [], milestones: [], groups: [], actors: [], interfaces: [], fx: [] };

function drop(zone: HTMLElement, file: File): void {
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  zone.dispatchEvent(event);
}

// Un classeur tronqué ne se laisse pas lire du tout : la cause réelle est
// « fichier illisible », pas « feuille Flux absente », que le classeur ait ou
// non jamais eu de feuille Flux. Le même fichier déposé sur la cible
// principale (app.ts) produit "Workbook unreadable or corrupted." — c'est ce
// message, et pas un autre, que la fenêtre de migration doit reprendre.
describe("ouvrirMigration — classeur corrompu", () => {
  it("annonce, en anglais, que le classeur est illisible plutôt qu'une feuille Flux absente", async () => {
    document.body.innerHTML = "";
    openMigration();
    const zone = document.querySelector(".migration-target") as HTMLElement;

    const complet = writeTemplate(donneesVides);
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

// Le bouton qui relance une conversion doit être lisible par l'utilisateur
// anglophone au même titre que le reste de l'écran de succès.
describe("ouvrirMigration — bouton de relance", () => {
  it("porte un libellé en anglais", async () => {
    document.body.innerHTML = "";
    openMigration();
    const zone = document.querySelector(".migration-target") as HTMLElement;

    const buffer = writeTemplate(donneesVides);
    const file = { name: "ok.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    drop(zone, file);

    await vi.waitFor(() => {
      if (!zone.querySelector(".export-button")) throw new Error("pas encore de bouton de relance");
    });

    const bouton = zone.querySelector(".export-button");
    expect(bouton?.textContent?.trim()).toBe("Convert another file");
  });
});
