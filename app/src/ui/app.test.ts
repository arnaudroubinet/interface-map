import { describe, it, expect, vi } from "vitest";
import { mountApp } from "./app";
import { écrireModele, type DonneesClasseur } from "../export/template-export";

vi.mock("../export/download", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../export/download")>();
  return { ...actual, téléchargerTexte: vi.fn() };
});

import { téléchargerTexte } from "../export/download";

const donnees: DonneesClasseur = {
  flowTypes: [["HTTP", "consumer → provider", ""]],
  typesActeur: [],
  milestones: [],
  groups: [["Core", "Platform"]],
  actors: [
    ["Tatooine", "Core", "Application", "", "", "", "", ""],
    ["Mygeeto", "Core", "Application", "", "", "", "", ""],
  ],
  interfaces: [["Authent", "", "Tatooine", "HTTP", "", "", "", "", "No", "", ""]],
  fx: [{ name: "FX_Tatooine_HTTP", rows: [["Authent", "", "Mygeeto", "", "", "Keep", "", "", "", ""]] }],
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

function boutonParLibellé(root: HTMLElement, label: string): HTMLButtonElement {
  const bouton = [...root.querySelectorAll("button")].find((b) => (b.textContent ?? "").trim().startsWith(label));
  if (!bouton) throw new Error(`bouton "${label}" introuvable`);
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
      if (!root.querySelector(".rail-view-item")) throw new Error("classeur pas encore chargé");
    });

    boutonParLibellé(root, "Integrity checks").click();
    boutonParLibellé(root, "Markdown").click();

    const modeSelect = [...root.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "functional")
    ) as HTMLSelectElement;
    modeSelect.value = "functional";
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
  flowTypes: [["HTTP", "consumer → provider", ""]],
  typesActeur: [
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
      if (!root.querySelector(".rail-view-item")) throw new Error("classeur pas encore chargé");
    });

    const modeSelect = [...root.querySelectorAll("select")].find((s) =>
      [...s.options].some((o) => o.value === "functional")
    ) as HTMLSelectElement;
    modeSelect.value = "functional";
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
    expect(root.querySelector(".no-flow")).toBeNull();
  });
});

// L'unique anomalie du classeur porte sur une interface retirée à V2 : au
// palier courant (le dernier livré), elle est déjà filtrée, le rapport
// affiché est donc sain. La vue d'atterrissage doit refléter CE rapport, pas
// celui — non filtré — qui a servi à choisir la vue avant le calage sur le
// palier courant.
const donneesAvecAnomalieRetiree: DonneesClasseur = {
  flowTypes: [["HTTP", "consumer → provider", ""]],
  typesActeur: [["Application", "box", "Business"]],
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
      if (!root.querySelector(".rail-view-item")) throw new Error("classeur pas encore chargé");
    });

    const actif = root.querySelector('.rail-view-item[aria-current="true"]');
    expect(actif?.textContent?.trim()).toBe("Group to group");
  });
});

// Un seul palier déclaré n'est pas « aucun palier » : comparer réclame deux
// bornes, la seconde manque, mais le classeur n'est pas silencieux sur son
// axe du temps -- le dire autrement le contredirait.
const donneesAvecUnSeulPalier: DonneesClasseur = {
  flowTypes: [["HTTP", "consumer → provider", ""]],
  typesActeur: [],
  milestones: [["V1", "1", "", "Delivered", "", ""]],
  groups: [["Core", "Platform"]],
  actors: [["Tatooine", "Core", "Application", "", "", "", "", ""]],
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
      if (!root.querySelector(".rail-view-item")) throw new Error("classeur pas encore chargé");
    });

    boutonParLibellé(root, "Changes").click();

    const message = root.querySelector(".no-flow");
    expect(message?.textContent).toBe("This workbook declares only one milestone; comparing needs two.");
  });
});


// --- QA : la mémoire du placement est indexée sur ce qui décide du DESSIN.
// La sélection de chaîne y manquait, et changer de chaîne ne changeait donc
// rien à l'écran : deux vues différentes partageaient le même schéma.
describe("vue Chaîne — changer de chaîne redessine", () => {
  // Deux chaînes DISJOINTES : aucun acteur commun. C'est ce qui rend le défaut
  // détectable -- avec une plomberie partagée, le dessin resterait plausible
  // même en réutilisant le placement de l'autre chaîne.
  const deuxChaines: DonneesClasseur = {
    flowTypes: [["Kafka", "provider → consumer", ""]],
    typesActeur: [["Application", "app-window", "Business"], ["Infra", "app-window", "Technical"]],
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

  it("dessine la chaîne retenue, et pas la précédente", async () => {
    const root = document.createElement("div");
    mountApp(root);
    const buffer = écrireModele(deuxChaines);
    const file = { name: "test.xlsx", arrayBuffer: async () => buffer } as unknown as File;
    const event = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: { files: [file] } });
    root.dispatchEvent(event);
    await vi.waitFor(() => expect(root.querySelector(".rail-view-item")).not.toBeNull());

    boutonParLibellé(root, "Chain").click();
    const select = await vi.waitFor(() => {
      const s = root.querySelector(".rail-chain") as HTMLSelectElement | null;
      if (!s || s.options.length < 2) throw new Error("sélecteur pas prêt");
      return s;
    });
    const labels = [...select.options].map((o) => o.textContent);
    expect(labels).toHaveLength(2);

    // Les BOÎTES, pas seulement les étiquettes : celles-ci viennent de la vue
    // courante et changeraient même sur un placement périmé. Les boîtes, elles,
    // viennent du placement -- c'est là que le défaut se voit.
    const boxes = async () =>
      vi.waitFor(() => {
        const svg = root.querySelector(".render-area svg");
        if (!svg) throw new Error("pas de schéma");
        const b = [...svg.querySelectorAll(".fx-nodes > g")].map((g) => g.querySelector("text")?.textContent);
        if (b.length === 0) throw new Error("pas de boîte");
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
