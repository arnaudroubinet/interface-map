import { describe, it, expect, vi, beforeEach } from "vitest";
import { handlersExport, type ContexteExport } from "./export-handlers";
import { initialState, withFichierCharge, withVue, withMode, withSelectionActeur, type AppState } from "./state";
import type { IntegrityReport } from "../integrity/checks";
import * as base from "../testing/fixtures";

// Les sept exports, éprouvés un par un. C'est ce que leur sortie de la
// fermeture de mountApp rend possible : avant, il fallait monter le DOM entier
// pour en toucher un seul, et aucun n'avait de test.
//
// On intercepte les fonctions de téléchargement : ce qu'on vérifie ici, ce
// n'est pas qu'un fichier descend -- le navigateur s'en charge -- mais CE QU'ON
// LUI DONNE : le bon contenu, sous le bon nom.

const téléchargements: { name: string; content: string }[] = [];
vi.mock("../export/download", () => ({
  téléchargerTexte: (content: string, name: string) => void téléchargements.push({ name, content }),
  téléchargerBlob: () => {},
}));
vi.mock("../export/svg-export", () => ({
  downloadSvg: (_svg: unknown, name: string) => void téléchargements.push({ name, content: "<svg>" }),
}));
vi.mock("../export/xlsx-export", () => ({
  downloadMatrixXlsx: (_m: unknown, name: string) => void téléchargements.push({ name, content: "xlsx" }),
}));
const pngRendu = { ok: true as boolean, scale: 0 };
vi.mock("../export/png-export", () => ({
  exportPng: async (_svg: unknown, _fond: unknown, scale: number) => {
    pngRendu.scale = scale;
    return pngRendu.ok ? { ok: true, blob: new Blob() } : { ok: false, error: "No PNG here." };
  },
  downloadPngBlob: (_b: unknown, name: string) => void téléchargements.push({ name, content: "png" }),
}));

const report: IntegrityReport = {
  families: [], infoBlocks: [], totalAnomalies: 0, totalActions: 0, totalAvertissements: 0,
};

const template = base.template({
  actors: [base.actor({ name: "Tatooine" })],
  groups: [base.group()],
  typesActeur: [base.typeActeur()],
  flowTypes: [base.typeFlux()],
  interfaces: [base.iface({ providerName: "Tatooine" })],
  consumptions: [base.conso()],
  fxSheetNames: ["FX_A_HTTP"],
});

function contexte(state: AppState, svg: SVGSVGElement | null = document.createElementNS("http://www.w3.org/2000/svg", "svg")) {
  let courant = state;
  const ctx: ContexteExport = {
    etat: () => courant,
    setState: (s) => void (courant = s),
    svgCourant: () => svg,
    matriceCourante: () => base.matrix({ columns: ["B"], rows: [] }),
  };
  return { ctx, handlers: handlersExport(ctx), état: () => courant };
}

const chargé = () =>
  withFichierCharge(initialState(), { name: "carto.xlsx", model: template, report: report, dateModification: null });

beforeEach(() => {
  téléchargements.length = 0;
  pngRendu.ok = true;
  pngRendu.scale = 0;
});

describe("handlersExport", () => {
  it("ne fait rien tant qu'aucun classeur n'est chargé", async () => {
    const { handlers } = contexte(initialState());
    handlers.onExportSvg();
    await handlers.onExportPng();
    handlers.onExportMarkdown();
    handlers.onExportStructurizr();
    expect(téléchargements).toHaveLength(0);
  });

  it("ne fait rien quand aucun schéma n'est à l'écran", () => {
    const { handlers } = contexte(withVue(chargé(), "platform-detail"), null);
    handlers.onExportSvg();
    expect(téléchargements).toHaveLength(0);
  });

  // Le nom porte la vue, le palier et la sélection : sans elle, deux lectures
  // différentes se téléchargeraient sous le même nom.
  it("met la sélection dans le nom de la vue par acteur", () => {
    const s = withSelectionActeur(withVue(chargé(), "by-actor"), "Tatooine");
    contexte(s).handlers.onExportSvg();
    expect(téléchargements[0].name).toContain("tatooine");
    expect(téléchargements[0].name).toMatch(/\.svg$/);
  });

  // Le rapport juge le CLASSEUR, pas une lecture du classeur : son contenu ne
  // bouge pas d'un mode à l'autre, son nom ne doit donc pas bouger non plus.
  it("ne met pas le mode dans le nom du rapport Markdown", () => {
    const s = withMode(withVue(chargé(), "checks"), "functional");
    contexte(s).handlers.onExportMarkdown();
    expect(téléchargements[0].name).not.toContain("functional");
    expect(téléchargements[0].content).toContain("Integrity report");
  });

  it("met le mode dans le nom d'un schéma, lui", () => {
    const s = withMode(withVue(chargé(), "platform-detail"), "functional");
    contexte(s).handlers.onExportSvg();
    expect(téléchargements[0].name).toContain("functional");
  });

  // Un navigateur qui refuse la conversion doit le DIRE : sans message, le
  // bouton semblerait ne rien faire. Et c'est le message de l'export qui
  // s'affiche : il distingue deux échecs, le banner n'en invente pas un
  // troisième.
  it("prévient dans le banner quand le PNG échoue, et ne télécharge rien", async () => {
    pngRendu.ok = false;
    const { handlers, état } = contexte(withVue(chargé(), "platform-detail"));
    await handlers.onExportPng();
    expect(téléchargements).toHaveLength(0);
    expect(état().messageBandeau).toBe("No PNG here.");
  });

  it("télécharge le PNG quand la conversion passe", async () => {
    const { handlers } = contexte(withVue(chargé(), "platform-detail"));
    await handlers.onExportPng();
    expect(téléchargements[0].name).toMatch(/\.png$/);
  });

  it("exporte la matrix affichée, sous le nom de la vue matrix", () => {
    contexte(withVue(chargé(), "matrix")).handlers.onExportXlsx();
    expect(téléchargements[0].name).toMatch(/matrix.*\.xlsx$/);
  });

  // Les deux DSL décrivent le MODÈLE : ni nom de vue, ni sélection, ni mode.
  it("nomme les deux DSL d'après le modèle, pas d'après la vue", () => {
    const s = withMode(withVue(chargé(), "by-actor"), "functional");
    const { handlers } = contexte(s);
    handlers.onExportStructurizr();
    handlers.onExportLikeC4();
    expect(téléchargements.map((t) => t.name)).toEqual(["carto-model.dsl", "carto-model.c4"]);
    expect(téléchargements[0].content).toContain("workspace");
    expect(téléchargements[1].content).toContain("specification");
  });

  it("emporte toutes les planches dans le draw.io, quelle que soit la vue ouverte", async () => {
    await contexte(withVue(chargé(), "checks")).handlers.onExportDrawio();
    expect(téléchargements[0].name).toMatch(/boards.*\.drawio$/);
    expect(téléchargements[0].content).toContain("<mxfile");
  });
});

// --- §2.8 : le facteur d'échelle du PNG était codé en dur à 2. Un schéma
// d'architecture est du trait fin avec de petits caractères : c'est le cas où
// une haute résolution paie encore.
const dernierScalePng = () => pngRendu.scale;

describe("onExportPng — l'échelle est choisie", () => {
  it("garde 2 comme échelle par défaut", async () => {
    const { handlers } = contexte(chargé());
    await handlers.onExportPng();
    expect(dernierScalePng()).toBe(2);
  });

  it("exporte à l'échelle retenue", async () => {
    const s = chargé();
    const { handlers } = contexte({ ...s, options: { ...s.options, echellePng: 4 } });
    await handlers.onExportPng();
    expect(dernierScalePng()).toBe(4);
  });
});
