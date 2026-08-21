import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { renderRail, type RailCallbacks } from "./rail";
import { initialState, withFichierCharge, withMode, withVue, withSelectionActeur, type AppState } from "./state";
import { VERSION_MODELE } from "../parsing/build-model";
import { fluxDuMode } from "../aggregation/fonctionnel";
import type { ParsedModel, Acteur, InterfaceCatalogue, Consommation } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";

// Le flux, résolu comme au point d'entrée réel (app.ts) : un test qui
// passerait un tableau vide masquerait une dépendance réelle du rail au
// contenu des flux (§ filtre Technologies).
function flux(state: AppState): ReturnType<typeof fluxDuMode> {
  return state.fichier ? fluxDuMode(state.fichier.model, null, state.mode) : [];
}

function acteur(nom: string, typeActeur: string): Acteur {
  return base.acteur({ nom, typeActeur });
}

function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return base.iface({ acteurExposant: "Tatooine", feuilleAttendue: "FX_Tatooine_HTTP", ...o });
}

function conso(o: Partial<Consommation> = {}): Consommation {
  return base.conso({ acteurConsommateur: "Bus", statut: "Actif", decision: "Keep", feuille: "FX_Tatooine_HTTP", ...o });
}

// Tatooine expose F vers Bus (Middleware, Technical), qui la relaie sous F2 vers
// Naboo : en fonctionnel, la chaîne relie directement Tatooine à
// Naboo, sans technologie -- c'est ce terrain que le filtre « Technologies »
// doit refléter.
const modelAvecFlux: ParsedModel = {
  acteurs: [acteur("Tatooine", "Application"), acteur("Bus", "Middleware"), acteur("Naboo", "Application")],
  groupes: [{ nom: "G", perimetre: "Platform", feuille: "Groups", ligne: 0 }],
  groupesAbsents: false,
  typesActeur: [
    { type: "Application", icone: "", nature: "Business", feuille: "ActorTypes", ligne: 0 },
    { type: "Middleware", icone: "", nature: "Technical", feuille: "ActorTypes", ligne: 0 },
  ],
  typesFlux: [base.typeFlux({ type: "HTTP" })],
  paliers: [],
  interfaces: [iface({}), iface({ nomDuFlux: "F2", acteurExposant: "Bus", relais: "F", feuilleAttendue: "FX_Bus_HTTP" })],
  consommations: [conso({}), conso({ nomDuFlux: "F2", acteurConsommateur: "Naboo", feuille: "FX_Bus_HTTP" })],
  fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
  colonnesOptionnellesAbsentes: [],
  versionModele: VERSION_MODELE,
  fichierModifie: null,
};

const model: ParsedModel = {
  acteurs: [acteur("Tatooine", "Application"), acteur("Bus", "Middleware")],
  groupes: [{ nom: "G", perimetre: "Platform", feuille: "Groups", ligne: 0 }],
  groupesAbsents: false,
  typesActeur: [
    { type: "Application", icone: "", nature: "Business", feuille: "ActorTypes", ligne: 0 },
    { type: "Middleware", icone: "", nature: "Technical", feuille: "ActorTypes", ligne: 0 },
  ],
  typesFlux: [],
  paliers: [],
  interfaces: [],
  consommations: [],
  fxSheetNames: [],
  colonnesOptionnellesAbsentes: [],
  versionModele: VERSION_MODELE,
  fichierModifie: null,
};

const report: IntegrityReport = { familles: [], blocsInformatifs: [], totalAnomalies: 0, totalActions: 0, totalAvertissements: 0 };

function noop(): void {}

const callbacks: RailCallbacks = {
  onMode: noop,
  onVue: noop,
  onSelectionActeur: noop,
  onSelectionTechnologie: noop,
  onPalierAffiche: noop,
  onPalierCompare: noop,
  onOptionCompteurs: noop,
  onTechnoMasquee: noop,
  onActeurMasque: noop,
  onMasquerExternes: noop,
  onActeurMasqueTechnologie: noop,
  onMasquerExternesMatrice: noop,
  onActeurMasqueMatrice: noop,
  onGranulariteMatrice: noop,
  onTelechargerModele: noop,
  onTelechargerExemple: noop,
  onMigrationLegacy: noop,
};

function optionsActeur(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".rail-selecteur option")].map((o) => o.textContent ?? "");
}

describe("renderRail — sélecteur « par acteur »", () => {
  it("liste tous les acteurs en architecture", () => {
    const state = withVue(withFichierCharge(initialState(), { nom: "c.xlsx", model, report, dateModification: null }), "par-acteur");
    const root = document.createElement("div");
    renderRail(root, state, flux(state), [], callbacks);
    expect(optionsActeur(root)).toContain("Bus");
  });

  // §5.2 : le sélecteur ne liste que les acteurs métier en fonctionnel.
  it("ne liste que les acteurs métier en fonctionnel", () => {
    const state = withVue(
      withMode(withFichierCharge(initialState(), { nom: "c.xlsx", model, report, dateModification: null }), "fonctionnel"),
      "par-acteur"
    );
    const root = document.createElement("div");
    renderRail(root, state, flux(state), [], callbacks);
    const options = optionsActeur(root);
    expect(options).toContain("Tatooine");
    expect(options).not.toContain("Bus");
  });
});

// L'écran de mise à niveau lit un classeur mal compris (§ commentaire de
// vueAuChargement) : ses anomalies ne sont pas fiables, le badge ne doit donc
// pas les afficher tant que le classeur n'est pas à niveau.
describe("renderRail — badge d'anomalies sur l'écran de mise à niveau", () => {
  it("n'affiche pas le compteur d'anomalies quand le classeur est bloqué en mise à niveau", () => {
    const modelAncien: ParsedModel = { ...model, versionModele: VERSION_MODELE - 1 };
    const reportAvecAnomalies: IntegrityReport = {
      familles: [],
      blocsInformatifs: [],
      totalAnomalies: 5,
      totalActions: 0,
      totalAvertissements: 0,
    };
    const state = withVue(
      withFichierCharge(initialState(), { nom: "c.xlsx", model: modelAncien, report: reportAvecAnomalies, dateModification: null }),
      "mise-a-niveau"
    );
    const root = document.createElement("div");
    renderRail(root, state, flux(state), [], callbacks);
    expect(root.querySelector(".compteur-anomalies")).toBeNull();
  });
});

describe("renderRail — filtre « Technologies » de la vue par acteur", () => {
  // Une technologie vide n'en est pas une (§5.2, la légende disparaît avec les
  // technologies) : la proposer produirait une case à cocher sans étiquette,
  // qui vide tout le schéma en un clic sans rien expliquer.
  it("n'affiche pas le bloc Technologies en mode fonctionnel", () => {
    const state = withSelectionActeur(
      withVue(withMode(withFichierCharge(initialState(), { nom: "c.xlsx", model: modelAvecFlux, report, dateModification: null }), "fonctionnel"), "par-acteur"),
      "Tatooine"
    );
    const root = document.createElement("div");
    renderRail(root, state, flux(state), [], callbacks);
    const titres = [...root.querySelectorAll(".rail-filtre summary")].map((s) => s.textContent ?? "");
    expect(titres.some((t) => t.startsWith("Technologies"))).toBe(false);
  });

  it("affiche le bloc Technologies en architecture", () => {
    const state = withSelectionActeur(
      withVue(withFichierCharge(initialState(), { nom: "c.xlsx", model: modelAvecFlux, report, dateModification: null }), "par-acteur"),
      "Tatooine"
    );
    const root = document.createElement("div");
    renderRail(root, state, flux(state), [], callbacks);
    const titres = [...root.querySelectorAll(".rail-filtre summary")].map((s) => s.textContent ?? "");
    expect(titres.some((t) => t.startsWith("Technologies"))).toBe(true);
  });
});
