import { describe, it, expect, vi } from "vitest";
import { mountApp } from "./app";
import { écrireModele, type DonneesClasseur } from "../export/template-export";

vi.mock("../export/telechargement", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/telechargement")>();
  return { ...actual, téléchargerTexte: vi.fn() };
});

import { téléchargerTexte } from "../export/telechargement";

const donnees: DonneesClasseur = {
  typesFlux: [["HTTP", "consumer → provider", ""]],
  typesActeur: [],
  paliers: [],
  groupes: [["Core", "Platform"]],
  acteurs: [
    ["Tatooine", "Core", "Application", "", "", "", "", ""],
    ["Mygeeto", "Core", "Application", "", "", "", "", ""],
  ],
  interfaces: [["Authent", "", "Tatooine", "HTTP", "", "", "", "", "No", "", ""]],
  fx: [{ nom: "FX_Tatooine_HTTP", lignes: [["Authent", "", "Mygeeto", "", "", "Keep", "", "", "", ""]] }],
};

// jsdom's File n'implémente pas arrayBuffer() : on ne construit pas un vrai
// File, juste ce que handleFile lui demande (name, arrayBuffer()).
function dropFile(root: HTMLElement): void {
  const buffer = écrireModele(donnees);
  const file = { name: "test.xlsx", arrayBuffer: async () => buffer } as unknown as File;
  const event = new Event("drop", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
  root.dispatchEvent(event);
}

function boutonParLibellé(root: HTMLElement, libellé: string): HTMLButtonElement {
  const bouton = [...root.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith(libellé));
  if (!bouton) throw new Error(`bouton "${libellé}" introuvable`);
  return bouton as HTMLButtonElement;
}

// Le rapport (Markdown) ne dépend pas du mode (§5.3) : les deux lectures
// jugent le MÊME classeur, avec les mêmes anomalies. Deux noms pour un
// contenu identique ferait croire à deux rapports différents.
describe("export Markdown — nom de fichier indépendant du mode", () => {
  it("produit le même nom en architecture et en fonctionnel", async () => {
    const root = document.createElement("div");
    mountApp(root);
    dropFile(root);
    await vi.waitFor(() => {
      if (!root.querySelector(".rail-vue-item")) throw new Error("classeur pas encore chargé");
    });

    boutonParLibellé(root, "Integrity checks").click();
    boutonParLibellé(root, "Markdown").click();

    const modeSelect = [...root.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "fonctionnel")
    ) as HTMLSelectElement;
    modeSelect.value = "fonctionnel";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    boutonParLibellé(root, "Integrity checks").click();
    boutonParLibellé(root, "Markdown").click();

    const appelé = vi.mocked(téléchargerTexte);
    expect(appelé).toHaveBeenCalledTimes(2);
    const [, nomArchitecture] = appelé.mock.calls[0];
    const [, nomFonctionnel] = appelé.mock.calls[1];
    expect(nomFonctionnel).toBe(nomArchitecture);
  });
});

// Ghost expose GhostFeed, que Bus (Middleware, Technical) consomme sans le
// relayer : la chaîne fonctionnelle s'arrête là, Ghost n'a plus aucun flux en
// fonctionnel. §5.2 : il doit rester affiché, seul.
const donneesAvecActeurIsole: DonneesClasseur = {
  typesFlux: [["HTTP", "consumer → provider", ""]],
  typesActeur: [
    ["Application", "", "Business"],
    ["Middleware", "", "Technical"],
  ],
  paliers: [],
  groupes: [["Core", "Platform"]],
  acteurs: [
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
    { nom: "FX_Tatooine_HTTP", lignes: [["Transactions", "", "Bus", "", "", "Keep", "", "", ""]] },
    { nom: "FX_Bus_HTTP", lignes: [["trx.norm", "", "Naboo", "", "", "Keep", "", "", ""]] },
    { nom: "FX_Ghost_HTTP", lignes: [["GhostFeed", "", "Bus", "", "", "Keep", "", "", ""]] },
  ],
};

// La vue « par acteur » doit dessiner l'acteur isolé, seul, plutôt que
// d'afficher le message « aucun flux » réservé à l'absence de sélection.
describe("vue par acteur — acteur métier isolé en fonctionnel", () => {
  it("dessine l'acteur seul au lieu du message « aucun flux »", async () => {
    const root = document.createElement("div");
    mountApp(root);
    const buffer = écrireModele(donneesAvecActeurIsole);
    const file = { name: "test.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    root.dispatchEvent(event);
    await vi.waitFor(() => {
      if (!root.querySelector(".rail-vue-item")) throw new Error("classeur pas encore chargé");
    });

    const modeSelect = [...root.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "fonctionnel")
    ) as HTMLSelectElement;
    modeSelect.value = "fonctionnel";
    modeSelect.dispatchEvent(new Event("change", { bubbles: true }));

    boutonParLibellé(root, "By actor").click();
    const acteurSelect = [...root.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "Ghost")
    ) as HTMLSelectElement;
    acteurSelect.value = "Ghost";
    acteurSelect.dispatchEvent(new Event("change", { bubbles: true }));

    await vi.waitFor(() => {
      if (!root.querySelector("svg")) throw new Error("schéma pas encore dessiné");
    });
    expect(root.querySelector(".aucun-flux")).toBeNull();
  });
});

// L'unique anomalie du classeur porte sur une interface retirée à V2 : au
// palier courant (le dernier livré), elle est déjà filtrée, le rapport
// affiché est donc sain. La vue d'atterrissage doit refléter CE rapport, pas
// celui — non filtré — qui a servi à choisir la vue avant le calage sur le
// palier courant.
const donneesAvecAnomalieRetiree: DonneesClasseur = {
  typesFlux: [["HTTP", "consumer → provider", ""]],
  typesActeur: [["Application", "box", "Business"]],
  paliers: [
    ["V1", "1", "", "Delivered", "", ""],
    ["V2", "2", "", "Delivered", "", ""],
  ],
  groupes: [["Core", "Platform"]],
  acteurs: [
    ["Tatooine", "Core", "Application", "", "", "", "V1", ""],
    ["Mygeeto", "Core", "Application", "", "", "", "V1", ""],
  ],
  interfaces: [["RetiredIface", "", "Tatooine", "HTTP", "", "https://example", "", "", "No", "V1", "V2"]],
  fx: [{ nom: "FX_Tatooine_HTTP", lignes: [["RetiredIface", "", "Mygeeto", "test usage", "", "Keep", "", "", "V1", "V2"]] }],
};

describe("vue d'atterrissage — anomalie sur une ligne retirée au palier courant", () => {
  it("ouvre sur Group to group, pas sur Integrity checks", async () => {
    const root = document.createElement("div");
    mountApp(root);
    const buffer = écrireModele(donneesAvecAnomalieRetiree);
    const file = { name: "test.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    root.dispatchEvent(event);
    await vi.waitFor(() => {
      if (!root.querySelector(".rail-vue-item")) throw new Error("classeur pas encore chargé");
    });

    const actif = root.querySelector('.rail-vue-item[aria-current="true"]');
    expect(actif?.textContent?.trim()).toBe("Group to group");
  });
});

// Un seul palier déclaré n'est pas « aucun palier » : comparer réclame deux
// bornes, la seconde manque, mais le classeur n'est pas silencieux sur son
// axe du temps -- le dire autrement le contredirait.
const donneesAvecUnSeulPalier: DonneesClasseur = {
  typesFlux: [["HTTP", "consumer → provider", ""]],
  typesActeur: [],
  paliers: [["V1", "1", "", "Delivered", "", ""]],
  groupes: [["Core", "Platform"]],
  acteurs: [["Tatooine", "Core", "Application", "", "", "", "", ""]],
  interfaces: [],
  fx: [],
};

describe("vue Écarts — un seul palier déclaré", () => {
  it("ne prétend pas que le classeur ne déclare aucun palier", async () => {
    const root = document.createElement("div");
    mountApp(root);
    const buffer = écrireModele(donneesAvecUnSeulPalier);
    const file = { name: "test.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    root.dispatchEvent(event);
    await vi.waitFor(() => {
      if (!root.querySelector(".rail-vue-item")) throw new Error("classeur pas encore chargé");
    });

    boutonParLibellé(root, "Changes").click();

    const message = root.querySelector(".aucun-flux");
    expect(message?.textContent).toBe("This workbook declares only one milestone; comparing needs two.");
  });
});
