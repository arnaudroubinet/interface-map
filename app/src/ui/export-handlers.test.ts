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

const téléchargements: { nom: string; contenu: string }[] = [];
vi.mock("../export/telechargement", () => ({
  téléchargerTexte: (contenu: string, nom: string) => void téléchargements.push({ nom, contenu }),
  téléchargerBlob: () => {},
}));
vi.mock("../export/svg-export", () => ({
  downloadSvg: (_svg: unknown, nom: string) => void téléchargements.push({ nom, contenu: "<svg>" }),
}));
vi.mock("../export/xlsx-export", () => ({
  downloadMatrixXlsx: (_m: unknown, nom: string) => void téléchargements.push({ nom, contenu: "xlsx" }),
}));
const pngRendu = { ok: true as boolean };
vi.mock("../export/png-export", () => ({
  exportPng: async () => (pngRendu.ok ? { ok: true, blob: new Blob() } : { ok: false, error: "No PNG here." }),
  downloadPngBlob: (_b: unknown, nom: string) => void téléchargements.push({ nom, contenu: "png" }),
}));

const rapport: IntegrityReport = {
  familles: [], blocsInformatifs: [], totalAnomalies: 0, totalActions: 0, totalAvertissements: 0,
};

const modele = base.modele({
  acteurs: [base.acteur({ nom: "Tatooine" })],
  groupes: [base.groupe()],
  typesActeur: [base.typeActeur()],
  typesFlux: [base.typeFlux()],
  interfaces: [base.iface({ acteurExposant: "Tatooine" })],
  consommations: [base.conso()],
  fxSheetNames: ["FX_A_HTTP"],
});

function contexte(state: AppState, svg: SVGSVGElement | null = document.createElementNS("http://www.w3.org/2000/svg", "svg")) {
  let courant = state;
  const ctx: ContexteExport = {
    etat: () => courant,
    setState: (s) => void (courant = s),
    svgCourant: () => svg,
    matriceCourante: () => base.matrice({ colonnes: ["B"], lignes: [] }),
  };
  return { ctx, handlers: handlersExport(ctx), état: () => courant };
}

const chargé = () =>
  withFichierCharge(initialState(), { nom: "carto.xlsx", model: modele, report: rapport, dateModification: null });

beforeEach(() => {
  téléchargements.length = 0;
  pngRendu.ok = true;
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
    const { handlers } = contexte(withVue(chargé(), "plateforme-detaillee"), null);
    handlers.onExportSvg();
    expect(téléchargements).toHaveLength(0);
  });

  // Le nom porte la vue, le palier et la sélection : sans elle, deux lectures
  // différentes se téléchargeraient sous le même nom.
  it("met la sélection dans le nom de la vue par acteur", () => {
    const s = withSelectionActeur(withVue(chargé(), "par-acteur"), "Tatooine");
    contexte(s).handlers.onExportSvg();
    expect(téléchargements[0].nom).toContain("tatooine");
    expect(téléchargements[0].nom).toMatch(/\.svg$/);
  });

  // Le rapport juge le CLASSEUR, pas une lecture du classeur : son contenu ne
  // bouge pas d'un mode à l'autre, son nom ne doit donc pas bouger non plus.
  it("ne met pas le mode dans le nom du rapport Markdown", () => {
    const s = withMode(withVue(chargé(), "controles"), "fonctionnel");
    contexte(s).handlers.onExportMarkdown();
    expect(téléchargements[0].nom).not.toContain("functional");
    expect(téléchargements[0].contenu).toContain("Integrity report");
  });

  it("met le mode dans le nom d'un schéma, lui", () => {
    const s = withMode(withVue(chargé(), "plateforme-detaillee"), "fonctionnel");
    contexte(s).handlers.onExportSvg();
    expect(téléchargements[0].nom).toContain("functional");
  });

  // Un navigateur qui refuse la conversion doit le DIRE : sans message, le
  // bouton semblerait ne rien faire. Et c'est le message de l'export qui
  // s'affiche : il distingue deux échecs, le bandeau n'en invente pas un
  // troisième.
  it("prévient dans le bandeau quand le PNG échoue, et ne télécharge rien", async () => {
    pngRendu.ok = false;
    const { handlers, état } = contexte(withVue(chargé(), "plateforme-detaillee"));
    await handlers.onExportPng();
    expect(téléchargements).toHaveLength(0);
    expect(état().messageBandeau).toBe("No PNG here.");
  });

  it("télécharge le PNG quand la conversion passe", async () => {
    const { handlers } = contexte(withVue(chargé(), "plateforme-detaillee"));
    await handlers.onExportPng();
    expect(téléchargements[0].nom).toMatch(/\.png$/);
  });

  it("exporte la matrice affichée, sous le nom de la vue matrice", () => {
    contexte(withVue(chargé(), "matrice")).handlers.onExportXlsx();
    expect(téléchargements[0].nom).toMatch(/matrix.*\.xlsx$/);
  });

  // Les deux DSL décrivent le MODÈLE : ni nom de vue, ni sélection, ni mode.
  it("nomme les deux DSL d'après le modèle, pas d'après la vue", () => {
    const s = withMode(withVue(chargé(), "par-acteur"), "fonctionnel");
    const { handlers } = contexte(s);
    handlers.onExportStructurizr();
    handlers.onExportLikeC4();
    expect(téléchargements.map((t) => t.nom)).toEqual(["carto-model.dsl", "carto-model.c4"]);
    expect(téléchargements[0].contenu).toContain("workspace");
    expect(téléchargements[1].contenu).toContain("specification");
  });

  it("emporte toutes les planches dans le draw.io, quelle que soit la vue ouverte", async () => {
    await contexte(withVue(chargé(), "controles")).handlers.onExportDrawio();
    expect(téléchargements[0].nom).toMatch(/boards.*\.drawio$/);
    expect(téléchargements[0].contenu).toContain("<mxfile");
  });
});
