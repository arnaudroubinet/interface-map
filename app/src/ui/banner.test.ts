import { describe, it, expect } from "vitest";
import { EXPORTS } from "./banner";
import { initialState, withFichierCharge, withVue, withMode } from "./state";
import type { AppState } from "./state";
import * as base from "../testing/fixtures";
import type { IntegrityReport } from "../integrity/checks";

// Les règles de désactivation des boutons sont de la LOGIQUE, pas de la
// plomberie : elles décident si un export est offert, et elles se trompaient
// discrètement quand elles vivaient éparpillées dans quatre-vingts lignes de
// boutons. Devenues une table, elles se vérifient sans monter le DOM.

const rapport: IntegrityReport = {
  familles: [],
  blocsInformatifs: [],
  totalAnomalies: 0,
  totalActions: 0,
  totalAvertissements: 0,
};

const chargé = (): AppState =>
  withFichierCharge(initialState(), { nom: "c.xlsx", model: base.modele(), report: rapport, dateModification: null });

const actif = (libellé: string, state: AppState, dessin = true) =>
  EXPORTS.find((e) => e.libellé === libellé)!.actif(state, dessin);

describe("EXPORTS — quand un format est offert", () => {
  it("n'offre rien tant qu'aucun classeur n'est chargé", () => {
    for (const format of EXPORTS) {
      expect(format.actif(initialState(), true)).toBe(false);
    }
  });

  it("offre les images sur un schéma, et seulement là", () => {
    const s = withVue(chargé(), "plateforme-detaillee");
    expect(actif("SVG", s)).toBe(true);
    expect(actif("PNG", s)).toBe(true);
    expect(actif("SVG", withVue(s, "matrice"))).toBe(false);
    expect(actif("SVG", withVue(s, "controles"))).toBe(false);
  });

  // Un schéma pas encore rendu n'est pas exportable : le bouton attendrait un
  // dessin qui n'existe pas.
  it("n'offre pas une image tant que le dessin n'est pas prêt", () => {
    expect(actif("SVG", withVue(chargé(), "plateforme-detaillee"), false)).toBe(false);
  });

  it("réserve Excel à la matrice et Markdown au rapport", () => {
    expect(actif("Excel", withVue(chargé(), "matrice"))).toBe(true);
    expect(actif("Excel", withVue(chargé(), "controles"))).toBe(false);
    expect(actif("Markdown", withVue(chargé(), "controles"))).toBe(true);
    expect(actif("Markdown", withVue(chargé(), "matrice"))).toBe(false);
  });

  // Les trois qui emportent tout le classeur ne dépendent pas de la vue --
  // mais les deux DSL C4 décrivent une architecture, pas une lecture métier.
  it("retire les deux DSL C4 en lecture fonctionnelle, jamais draw.io", () => {
    const fonctionnel = withMode(withVue(chargé(), "matrice"), "fonctionnel");
    expect(actif("draw.io", fonctionnel)).toBe(true);
    expect(actif("Structurizr", fonctionnel)).toBe(false);
    expect(actif("LikeC4", fonctionnel)).toBe(false);
  });

  it("n'offre aucun des trois sur l'écran de mise à niveau", () => {
    const bloqué = withVue(chargé(), "mise-a-niveau");
    for (const libellé of ["draw.io", "Structurizr", "LikeC4"]) {
      expect(actif(libellé, bloqué)).toBe(false);
    }
  });
});
