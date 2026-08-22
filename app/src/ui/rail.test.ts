import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { renderRail, type RailCallbacks } from "./rail";
import { initialState, withLoadedFile, withMode, withVue, withActorSelection, type AppState } from "./state";
import { runIntegrityChecks } from "../integrity/checks";
import { SCHEMA_VERSION } from "../parsing/build-model";
import { actorsForReading, reading } from "../aggregation/reading";
import type { ParsedModel, Actor, InterfaceCatalogue, Consumption } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";

// Le flux, résolu comme au point d'entrée réel (app.ts) : un test qui
// passerait un tableau vide masquerait une dépendance réelle du rail au
// contenu des flux (§ filtre Technologies).
function flows(state: AppState): ReturnType<typeof reading> {
  return state.file ? reading(state.file.model, null, state.mode) : { flows: [], actors: [] };
}

function actor(name: string, actorType: string): Actor {
  return base.actor({ name, actorType });
}

function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return base.iface({ providerName: "Tatooine", expectedSheet: "FX_Tatooine_HTTP", ...o });
}

function consumption(o: Partial<Consumption> = {}): Consumption {
  return base.consumption({ consumerName: "Bus", legacyStatus: "Actif", decision: "Keep", sheet: "FX_Tatooine_HTTP", ...o });
}

// Tatooine expose F vers Bus (Middleware, Technical), qui la relaie sous F2 vers
// Naboo : en fonctionnel, la chaîne relie directement Tatooine à
// Naboo, sans technologie -- c'est ce terrain que le filtre « Technologies »
// doit refléter.
const modelAvecFlux: ParsedModel = {
  actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware"), actor("Naboo", "Application")],
  groups: [{ name: "G", perimeter: "Platform", sheet: "Groups", row: 0 }],
  groupsSheetMissing: false,
  actorTypes: [
    { type: "Application", icon: "", nature: "Business", sheet: "ActorTypes", row: 0 },
    { type: "Middleware", icon: "", nature: "Technical", sheet: "ActorTypes", row: 0 },
  ],
  flowTypes: [base.typeFlux({ type: "HTTP" })],
  milestones: [],
  interfaces: [iface({}), iface({ flowName: "F2", providerName: "Bus", expectedSheet: "FX_Bus_HTTP" })],
  consumptions: [
    // C'est la CONSOMMATION qui dit sous quelle interface elle ressort (v4) :
    // le terrain portait encore la colonne « Relays » de la v3, que plus rien
    // ne lit -- la chaîne fonctionnelle n'existait donc pas, et le test du
    // filtre passait faute de flux plutôt que faute de technologie.
    consumption({ republishedAs: "F2" }),
    consumption({ flowName: "F2", consumerName: "Naboo", sheet: "FX_Bus_HTTP" }),
  ],
  fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
  missingOptionalColumns: [],
  schemaVersion: SCHEMA_VERSION,
  savedAt: null,
};

const model: ParsedModel = {
  actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware")],
  groups: [{ name: "G", perimeter: "Platform", sheet: "Groups", row: 0 }],
  groupsSheetMissing: false,
  actorTypes: [
    { type: "Application", icon: "", nature: "Business", sheet: "ActorTypes", row: 0 },
    { type: "Middleware", icon: "", nature: "Technical", sheet: "ActorTypes", row: 0 },
  ],
  flowTypes: [],
  milestones: [],
  interfaces: [],
  consumptions: [],
  fxSheetNames: [],
  missingOptionalColumns: [],
  schemaVersion: SCHEMA_VERSION,
  savedAt: null,
};

const report: IntegrityReport = { families: [], infoBlocks: [], totalAnomalies: 0, totalActions: 0, totalAvertissements: 0 };

function noop(): void {}

const callbacks: RailCallbacks = {
  onMode: noop,
  onVue: noop,
  onActorSelection: noop,
  onTechnologySelection: noop,
  onChainSelection: noop,
  onVoisinage: noop,
  onRoadmapSubject: noop,
  onWeightByCriticality: noop,
  onDisplayedMilestone: noop,
  onPalierCompare: noop,
  onOptionCompteurs: noop,
  onEdgeLabel: noop,
  onOrdreMatrice: noop,
  onEchellePng: noop,
  onTechnologyHidden: noop,
  onActorHidden: noop,
  onMasquerExternes: noop,
  onActorHiddenForTechnology: noop,
  onMasquerExternesMatrice: noop,
  onActorHiddenInMatrix: noop,
  onMatrixGrain: noop,
  onTelechargerModele: noop,
  onTelechargerExemple: noop,
  onMigrationLegacy: noop,
};

function optionsActeur(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".rail-select option")].map((o) => o.textContent ?? "");
}

describe("renderRail — sélecteur « par acteur »", () => {
  it("liste tous les acteurs en architecture", () => {
    const state = withVue(withLoadedFile(initialState(), { name: "c.xlsx", model, report, dateModification: null }), "by-actor");
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], callbacks);
    expect(optionsActeur(root)).toContain("Bus");
  });

  // §5.2 : le sélecteur ne liste que les acteurs métier en fonctionnel.
  it("ne liste que les acteurs métier en fonctionnel", () => {
    const state = withVue(
      withMode(withLoadedFile(initialState(), { name: "c.xlsx", model, report, dateModification: null }), "functional"),
      "by-actor"
    );
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], callbacks);
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
    const modelAncien: ParsedModel = { ...model, schemaVersion: SCHEMA_VERSION - 1 };
    const reportAvecAnomalies: IntegrityReport = {
      families: [],
      infoBlocks: [],
      totalAnomalies: 5,
      totalActions: 0,
      totalAvertissements: 0,
    };
    const state = withVue(
      withLoadedFile(initialState(), { name: "c.xlsx", model: modelAncien, report: reportAvecAnomalies, dateModification: null }),
      "upgrade"
    );
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], callbacks);
    expect(root.querySelector(".count-anomalies")).toBeNull();
  });
});

describe("renderRail — filtre « Technologies » de la vue par acteur", () => {
  // Une technologie vide n'en est pas une (§5.2, la légende disparaît avec les
  // technologies) : la proposer produirait une case à cocher sans étiquette,
  // qui vide tout le schéma en un clic sans rien expliquer.
  it("n'affiche pas le bloc Technologies en mode fonctionnel", () => {
    const state = withActorSelection(
      withVue(withMode(withLoadedFile(initialState(), { name: "c.xlsx", model: modelAvecFlux, report, dateModification: null }), "functional"), "by-actor"),
      "Tatooine"
    );
    // Le terrain porte bien un lien fonctionnel : sans cette ligne, le test
    // passerait aussi sur un parc vide, où il n'y a rien à filtrer.
    expect(flows(state).flows).toHaveLength(1);
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], callbacks);
    const titles = [...root.querySelectorAll(".rail-filter summary")].map((s) => s.textContent ?? "");
    expect(titles.some((t) => t.startsWith("Technologies"))).toBe(false);
  });

  it("affiche le bloc Technologies en architecture", () => {
    const state = withActorSelection(
      withVue(withLoadedFile(initialState(), { name: "c.xlsx", model: modelAvecFlux, report, dateModification: null }), "by-actor"),
      "Tatooine"
    );
    const root = document.createElement("div");
    renderRail(root, state, flows(state), [], callbacks);
    const titles = [...root.querySelectorAll(".rail-filter summary")].map((s) => s.textContent ?? "");
    expect(titles.some((t) => t.startsWith("Technologies"))).toBe(true);
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
  const estate = base.template({
    actors: [
      base.actor({ name: "Aaa", introducedAt: "v1", retiredAt: "v2" }),
      base.actor({ name: "Bbb", introducedAt: "v1" }),
    ],
    groups: [base.group({ name: "G" })],
    actorTypes: [base.actorType()],
    flowTypes: [base.typeFlux()],
    milestones: [base.milestone({ name: "v1", rank: 1 }), base.milestone({ name: "v2", rank: 2 })],
    interfaces: [base.iface({ flowName: "F", providerName: "Bbb", expectedSheet: "FX_Bbb_HTTP" })],
    consumptions: [base.consumption({ flowName: "F", consumerName: "Aaa", sheet: "FX_Bbb_HTTP" })],
  });

  it("n'offre pas un acteur absent de la lecture courante", () => {
    const state: AppState = withVue(
      withLoadedFile(initialState(), {
        name: "c.xlsx",
        model: estate,
        report: runIntegrityChecks(estate),
        dateModification: null,
      }),
      "by-actor"
    );
    expect(state.shownMilestone).toBe("v2");
    expect(actorsForReading(estate, 2, "architecture").map((a) => a.name)).toEqual(["Bbb"]);

    const root = document.createElement("div");
    renderRail(root, state, reading(estate, 2, "architecture"), [], callbacks);
    const offerts = [...root.querySelectorAll("select.rail-select option")].map((o) => o.getAttribute("value"));
    expect(offerts).not.toContain("Aaa");
  });
});

// --- §2.3 : l'étiquette nommait le protocole et jamais ce qui circule. Le
// choix se pose au rail, à côté du compteur -- qui décide du ×N, pas de ce
// qui est nommé.
describe("renderRail — ce que nomme l'étiquette d'un trait", () => {
  const loaded = () => withLoadedFile(initialState(), { name: "c.xlsx", model: modelAvecFlux, report, dateModification: null });
  const rendu = (s: AppState) => {
    const root = document.createElement("div");
    renderRail(root, s, flows(s), [], callbacks);
    return root;
  };

  it("propose les trois lectures de l'étiquette", () => {
    const options = [...rendu(loaded()).querySelectorAll(".rail-option-label option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["technology", "exchanges", "both"]);
  });

  it("montre celle qui est retenue", () => {
    const s = { ...loaded(), options: { counters: true, edgeLabelMode: "exchanges" as const, echellePng: 2 as const, weightByCriticality: false } };
    const select = rendu(s).querySelector(".rail-option-label select") as HTMLSelectElement;
    expect(select.value).toBe("exchanges");
  });
});
