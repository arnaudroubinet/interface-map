import { describe, it, expect, vi } from "vitest";
import { ouvrirMigration } from "./migration-dialogue";
import { écrireModele, type DonneesClasseur } from "../export/template-export";

vi.mock("../export/telechargement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/telechargement")>();
  return { ...actual, téléchargerClasseur: vi.fn() };
});

const donneesVides: DonneesClasseur = { typesFlux: [], typesActeur: [], paliers: [], groupes: [], acteurs: [], interfaces: [], fx: [] };

function déposer(zone: HTMLElement, file: File): void {
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
    ouvrirMigration();
    const zone = document.querySelector(".cible-migration") as HTMLElement;

    const complet = écrireModele(donneesVides);
    const tronqué = complet.slice(0, Math.floor(complet.byteLength / 3));
    const file = { name: "corrompu.xlsx", arrayBuffer: async () => tronqué } as unknown as File;
    déposer(zone, file);

    await vi.waitFor(() => {
      if (!zone.querySelector(".message-erreur")) throw new Error("pas encore de message d'erreur");
    });

    const message = zone.querySelector(".message-erreur");
    expect(message?.textContent).toBe("Workbook unreadable or corrupted.");
  });
});

// Le bouton qui relance une conversion doit être lisible par l'utilisateur
// anglophone au même titre que le reste de l'écran de succès.
describe("ouvrirMigration — bouton de relance", () => {
  it("porte un libellé en anglais", async () => {
    document.body.innerHTML = "";
    ouvrirMigration();
    const zone = document.querySelector(".cible-migration") as HTMLElement;

    const buffer = écrireModele(donneesVides);
    const file = { name: "ok.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    déposer(zone, file);

    await vi.waitFor(() => {
      if (!zone.querySelector(".bouton-export")) throw new Error("pas encore de bouton de relance");
    });

    const bouton = zone.querySelector(".bouton-export");
    expect(bouton?.textContent?.trim()).toBe("Convert another file");
  });
});
