import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { renderRail, type RailCallbacks } from "./rail";
import { initialState, withFichierCharge, withMode, withVue, withSelectionActeur, type AppState } from "./state";
import { runIntegrityChecks } from "../integrity/checks";
import { VERSION_MODELE } from "../parsing/build-model";
import { acteursDuMode, lecture } from "../aggregation/fonctionnel";
import type { ParsedModel, Acteur, InterfaceCatalogue, Consommation } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";

// Le flux, résolu comme au point d'entrée réel (app.ts) : un test qui
// passerait un tableau vide masquerait une dépendance réelle du rail au
// contenu des flux (§ filtre Technologies).
function flux(state: AppState): ReturnType<typeof lecture> {
  return state.fichier ? lecture(state.fichier.model, null, state.mode) : { flux: [], acteurs: [] };
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
  interfaces: [iface({}), iface({ nomDuFlux: "F2", acteurExposant: "Bus", feuilleAttendue: "FX_Bus_HTTP" })],
  consommations: [
    // C'est la CONSOMMATION qui dit sous quelle interface elle ressort (v4) :
    // le terrain portait encore la colonne « Relays » de la v3, que plus rien
    // ne lit -- la chaîne fonctionnelle n'existait donc pas, et le test du
    // filtre passait faute de flux plutôt que faute de technologie.
    conso({ republiePar: "F2" }),
    conso({ nomDuFlux: "F2", acteurConsommateur: "Naboo", feuille: "FX_Bus_HTTP" }),
  ],
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
  onLibelléArête: noop,
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
    // Le terrain porte bien un lien fonctionnel : sans cette ligne, le test
    // passerait aussi sur un parc vide, où il n'y a rien à filtrer.
    expect(flux(state).flux).toHaveLength(1);
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

// --- QA : le sélecteur listait les acteurs du CLASSEUR, pas ceux de la lecture
// courante. Il proposait donc un acteur que le palier affiché a retiré, et en
// sélectionnait un tout seul faute de mieux : une boîte fantôme, sans un mot
// d'explication.
// ---------------------------------------------------------------------------
// 2. Le sélecteur « By actor » propose des acteurs que le palier a retirés.
// ---------------------------------------------------------------------------

describe("le sélecteur « By actor » suit le palier affiché", () => {
  const parc = base.modele({
    acteurs: [
      base.acteur({ nom: "Aaa", palierIntroduction: "v1", palierRetrait: "v2" }),
      base.acteur({ nom: "Bbb", palierIntroduction: "v1" }),
    ],
    groupes: [base.groupe({ nom: "G" })],
    typesActeur: [base.typeActeur()],
    typesFlux: [base.typeFlux()],
    paliers: [base.palier({ nom: "v1", rang: 1 }), base.palier({ nom: "v2", rang: 2 })],
    interfaces: [base.iface({ nomDuFlux: "F", acteurExposant: "Bbb", feuilleAttendue: "FX_Bbb_HTTP" })],
    consommations: [base.conso({ nomDuFlux: "F", acteurConsommateur: "Aaa", feuille: "FX_Bbb_HTTP" })],
  });

  it("n'offre pas un acteur absent de la lecture courante", () => {
    const state: AppState = withVue(
      withFichierCharge(initialState(), {
        nom: "c.xlsx",
        model: parc,
        report: runIntegrityChecks(parc),
        dateModification: null,
      }),
      "par-acteur"
    );
    expect(state.palierAffiche).toBe("v2");
    expect(acteursDuMode(parc, 2, "architecture").map((a) => a.nom)).toEqual(["Bbb"]);

    const root = document.createElement("div");
    renderRail(root, state, lecture(parc, 2, "architecture"), [], callbacks);
    const offerts = [...root.querySelectorAll("select.rail-selecteur option")].map((o) => o.getAttribute("value"));
    expect(offerts).not.toContain("Aaa");
  });
});

// --- §2.3 : l'étiquette nommait le protocole et jamais ce qui circule. Le
// choix se pose au rail, à côté du compteur -- qui décide du ×N, pas de ce
// qui est nommé.
describe("renderRail — ce que nomme l'étiquette d'un trait", () => {
  const chargé = () => withFichierCharge(initialState(), { nom: "c.xlsx", model: modelAvecFlux, report, dateModification: null });
  const rendu = (s: AppState) => {
    const root = document.createElement("div");
    renderRail(root, s, flux(s), [], callbacks);
    return root;
  };

  it("propose les trois lectures de l'étiquette", () => {
    const options = [...rendu(chargé()).querySelectorAll(".rail-option-libelle option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["technology", "exchanges", "both"]);
  });

  it("montre celle qui est retenue", () => {
    const s = { ...chargé(), options: { compteurs: true, libelléArête: "exchanges" as const } };
    const select = rendu(s).querySelector(".rail-option-libelle select") as HTMLSelectElement;
    expect(select.value).toBe("exchanges");
  });
});
