import { describe, it, expect } from "vitest";
import { EXPORTS } from "./banner";
import { initialState, withLoadedFile, withView, withMode } from "./state";
import type { AppState } from "./state";
import * as base from "../testing/fixtures";
import type { IntegrityReport } from "../integrity/checks";

// Les règles de désactivation des boutons sont de la LOGIQUE, pas de la
// plomberie : elles décident si un export est offert, et elles se trompaient
// discrètement quand elles vivaient éparpillées dans quatre-vingts lignes de
// boutons. Devenues une table, elles se vérifient sans monter le DOM.

const report: IntegrityReport = {
  families: [],
  infoBlocks: [],
  totalAnomalies: 0,
  totalActions: 0,
  totalWarnings: 0,
};

const loaded = (): AppState =>
  withLoadedFile(initialState(), { name: "c.xlsx", model: base.template(), report: report, dateModification: null });

const active = (label: string, state: AppState, drawing = true) =>
  EXPORTS.find((e) => e.label === label)!.active(state, drawing);

describe("EXPORTS — quand un format est offert", () => {
  it("n'offre rien tant qu'aucun classeur n'est chargé", () => {
    for (const format of EXPORTS) {
      expect(format.active(initialState(), true)).toBe(false);
    }
  });

  it("offre les images sur un schéma, et seulement là", () => {
    const s = withView(loaded(), "platform-detail");
    expect(active("SVG", s)).toBe(true);
    expect(active("PNG", s)).toBe(true);
    expect(active("SVG", withView(s, "matrix"))).toBe(false);
    expect(active("SVG", withView(s, "checks"))).toBe(false);
  });

  // Un schéma pas encore rendu n'est pas exportable : le bouton attendrait un
  // dessin qui n'existe pas.
  it("n'offre pas une image tant que le dessin n'est pas prêt", () => {
    expect(active("SVG", withView(loaded(), "platform-detail"), false)).toBe(false);
  });

  it("réserve Excel à la matrix et Markdown au rapport", () => {
    expect(active("Excel", withView(loaded(), "matrix"))).toBe(true);
    expect(active("Excel", withView(loaded(), "checks"))).toBe(false);
    expect(active("Markdown", withView(loaded(), "checks"))).toBe(true);
    expect(active("Markdown", withView(loaded(), "matrix"))).toBe(false);
  });

  // Les trois qui emportent tout le classeur ne dépendent pas de la vue --
  // mais les deux DSL C4 décrivent une architecture, pas une lecture métier.
  // Les deux DSL sont ROUVERTS en fonctionnel : un système qui rend un service
  // à un autre est le cas d'usage central d'un systemLandscape. Le fichier dit
  // désormais quelle lecture il porte, ce qui était la vraie exigence.
  it("offre les trois formats de modèle dans les deux lectures", () => {
    const fonctionnel = withMode(withView(loaded(), "matrix"), "functional");
    expect(active("draw.io", fonctionnel)).toBe(true);
    expect(active("Structurizr", fonctionnel)).toBe(true);
    expect(active("LikeC4", fonctionnel)).toBe(true);
  });

  it("n'offre aucun des trois sur l'écran de mise à niveau", () => {
    const blocked = withView(loaded(), "upgrade");
    for (const label of ["draw.io", "Structurizr", "LikeC4"]) {
      expect(active(label, blocked)).toBe(false);
    }
  });
});
