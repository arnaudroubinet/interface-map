import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import {
  initialState,
  withLoadedFile,
  withVue,
  withOptions,
  withActorSelection,
  withActorHiddenInMatrix,
  withMatrixGrain,
  withMode,
  withDisplayedMilestone,
  viewOnLoad,
} from "./state";
import { SCHEMA_VERSION } from "../parsing/build-model";
import type { ParsedModel } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";

const model: ParsedModel = base.template();
const report: IntegrityReport = { families: [], infoBlocks: [], totalAnomalies: 0, totalActions: 0, totalAvertissements: 0 };

describe("initialState", () => {
  it("starts with no file loaded and no options set", () => {
    const state = initialState();
    expect(state.file).toBeNull();
    expect(state.view).toBe("group-to-group");
    expect(state.options).toEqual({ counters: true, edgeLabelMode: "technology", echellePng: 2, graisseParCriticite: false });
  });
});

describe("withFichierCharge", () => {
  it("replaces the whole state at once and opens on the default view when the file is clean", () => {
    const loaded = withLoadedFile(initialState(), {
      name: "classeur.xlsx", model, report, dateModification: null,
    });
    expect(loaded.file?.name).toBe("classeur.xlsx");
    expect(loaded.view).toBe("group-to-group");
  });

  it("opens on the integrity view when the file breaks the rules, rather than on a diagram", () => {
    const enDefaut: IntegrityReport = {
      families: [{ id: "coherence", title: "Cohérence", description: "", anomalies: [{ message: "…" }] }],
      infoBlocks: [],
      totalAnomalies: 1,
      totalActions: 0,
      totalAvertissements: 0,
    };
    const loaded = withLoadedFile(initialState(), {
      name: "classeur.xlsx", model, report: enDefaut, dateModification: null,
    });
    expect(loaded.view).toBe("checks");
  });
});

describe("withVue / withOptions / withSelectionActeur", () => {
  it("updates only the targeted slice of state", () => {
    const state = withActorSelection(withOptions(withVue(initialState(), "by-actor"), { counters: false }), "Tatooine");
    expect(state.view).toBe("by-actor");
    expect(state.options.counters).toBe(false);
    expect(state.actorSelection).toBe("Tatooine");
  });
});

describe("withGranulariteMatrice", () => {
  it("starts on acteur-to-acteur", () => {
    expect(initialState().filtresMatrice.grain).toBe("actor");
  });

  it("clears the masked rows, whose names no longer mean anything", () => {
    const hidden = withActorHiddenInMatrix(initialState(), "Tatooine", true);
    const folded = withMatrixGrain(hidden, "group");
    expect(folded.filtresMatrice.grain).toBe("group");
    expect(folded.filtresMatrice.hiddenActors).toEqual([]);
  });
});

describe("withFichierCharge — classeur d'une version antérieure", () => {
  const ancien = { ...model, schemaVersion: 0 };

  it("ouvre sur l'écran de mise à niveau plutôt que sur une vue", () => {
    const loaded = withLoadedFile(initialState(), {
      name: "vieux.xlsx", model: ancien, report, dateModification: null,
    });
    expect(loaded.view).toBe("upgrade");
  });

  // Les anomalies d'un classeur qu'on ne sait pas lire entièrement ne sont pas
  // fiables : la mise à niveau passe avant, sans quoi on ferait corriger des
  // défauts qui n'en sont peut-être pas.
  it("passe avant l'écran des contrôles, même en présence d'anomalies", () => {
    const enDefaut: IntegrityReport = {
      families: [{ id: "coherence", title: "Cohérence", description: "", anomalies: [{ message: "…" }] }],
      infoBlocks: [], totalAnomalies: 1, totalActions: 0, totalAvertissements: 0,
    };
    const loaded = withLoadedFile(initialState(), {
      name: "vieux.xlsx", model: ancien, report: enDefaut, dateModification: null,
    });
    expect(loaded.view).toBe("upgrade");
  });

  it("laisse un classeur à jour ouvrir normalement", () => {
    const loaded = withLoadedFile(initialState(), {
      name: "a-jour.xlsx", model, report, dateModification: null,
    });
    expect(loaded.view).toBe("group-to-group");
  });
});

describe("withFichierCharge — palier d'ouverture", () => {
  const withMilestones = {
    ...model,
    milestones: [
      { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
      { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
      { name: "v3", rank: 3, label: "", status: "Planned", date: "", description: "", sheet: "Milestones", row: 0 },
    ],
  };

  it("ouvre sur le dernier palier livré, en comparant au précédent", () => {
    const loaded = withLoadedFile(initialState(), {
      name: "c.xlsm", model: withMilestones, report, dateModification: null,
    });
    expect(loaded.shownMilestone).toBe("v2");
    expect(loaded.comparedMilestone).toBe("v1");
  });

  it("laisse les deux à null quand le classeur ne déclare aucun palier", () => {
    const loaded = withLoadedFile(initialState(), {
      name: "c.xlsm", model, report, dateModification: null,
    });
    expect(loaded.shownMilestone).toBeNull();
    expect(loaded.comparedMilestone).toBeNull();
  });
});

describe("mode de lecture", () => {
  it("ouvre en architecture", () => {
    expect(initialState().mode).toBe("architecture");
  });

  it("retient le mode choisi", () => {
    expect(withMode(initialState(), "functional").mode).toBe("functional");
  });

  // « Par technologie » n'a pas d'objet sans technologie : y rester
  // afficherait une vue vide sans rien expliquer. Le repli n'est plus le
  // groupe à groupe, qui n'a pas davantage d'objet en fonctionnel.
  it("quitte la vue par technologie en passant en fonctionnel", () => {
    const s = withVue(initialState(), "by-technology");
    expect(withMode(s, "functional").view).toBe("platform-detail");
  });

  it("laisse la vue en place quand elle garde un sens", () => {
    const s = withVue(initialState(), "matrix");
    expect(withMode(s, "functional").view).toBe("matrix");
  });

  const actor = (name: string, actorType: string) => base.actor({ name, actorType });
  const modelMixte: ParsedModel = {
    ...model,
    actors: [actor("Tatooine", "Application"), actor("Bus", "Middleware")],
    actorTypes: [
      { type: "Application", icon: "", nature: "Business", sheet: "ActorTypes", row: 0 },
      { type: "Middleware", icon: "", nature: "Technical", sheet: "ActorTypes", row: 0 },
    ],
  };

  // Passer en fonctionnel sans corriger la sélection montre une seule boîte
  // et aucun message : la boîte disparue du sélecteur reste pourtant visée.
  it("efface la sélection d'acteur en passant en fonctionnel si elle visait un acteur technique", () => {
    const loaded = withLoadedFile(initialState(), { name: "c.xlsx", model: modelMixte, report, dateModification: null });
    const s = withActorSelection(loaded, "Bus");
    expect(withMode(s, "functional").actorSelection).toBeNull();
  });

  it("garde la sélection quand elle visait déjà un acteur métier", () => {
    const loaded = withLoadedFile(initialState(), { name: "c.xlsx", model: modelMixte, report, dateModification: null });
    const s = withActorSelection(loaded, "Tatooine");
    expect(withMode(s, "functional").actorSelection).toBe("Tatooine");
  });
});

// --- QA : changer de palier ne revalidait pas la sélection d'acteur. Le mode
// le faisait déjà (§5.2) ; le palier, non. Un acteur retiré restait donc
// sélectionné alors qu'il ne figure plus dans la lecture, et le schéma
// n'affichait qu'une boîte fantôme, sans un mot pour l'expliquer.
describe("withPalierAffiche — la sélection suit ce que le palier montre", () => {
  const actor = (name: string, retiredAt = "") => base.actor({ name, retiredAt });
  const avecFrise: ParsedModel = {
    ...model,
    milestones: [base.milestone({ name: "v1", rank: 1 }), base.milestone({ name: "v2", rank: 2 })],
    actors: [actor("Tatooine", "v2"), actor("Chandrila")],
  };
  const loaded = () =>
    withActorSelection(
      withLoadedFile(initialState(), { name: "c.xlsx", model: avecFrise, report, dateModification: null }),
      "Tatooine"
    );

  it("lâche un acteur que le nouveau palier ne montre plus", () => {
    expect(withDisplayedMilestone(loaded(), "v2").actorSelection).toBeNull();
  });

  it("garde un acteur que le nouveau palier montre encore", () => {
    expect(withDisplayedMilestone(loaded(), "v1").actorSelection).toBe("Tatooine");
  });

  it("garde la sélection quand on retire le filtre de palier", () => {
    expect(withDisplayedMilestone(loaded(), null).actorSelection).toBe("Tatooine");
  });
});

// --- QA : un classeur d'un schéma PLUS RÉCENT que l'outil s'ouvrait
// normalement -- la condition ne regardait que le retard. L'outil en dessinait
// une image amputée de tout ce qu'il ne sait pas encore lire, sans le dire.
describe("vueAuChargement — les deux sens du désaccord de schéma", () => {
  const at = (schemaVersion: number) => ({
    name: "c.xlsx", model: { ...model, schemaVersion }, report, dateModification: null,
  });

  it("bloque sur un classeur en retard", () => {
    expect(viewOnLoad(at(SCHEMA_VERSION - 1))).toBe("upgrade");
  });

  it("bloque aussi sur un classeur en avance", () => {
    expect(viewOnLoad(at(SCHEMA_VERSION + 1))).toBe("upgrade");
  });

  it("laisse passer un classeur à la bonne version", () => {
    expect(viewOnLoad(at(SCHEMA_VERSION))).not.toBe("upgrade");
  });
});

// --- QA : le groupe à groupe n'a pas de sens en fonctionnel -- on n'y présente
// que la vue d'architecture. Le rail ne retirait pourtant que « par
// technologie », et la vue restait offerte.
describe("withMode — les vues qui n'ont pas de sens en fonctionnel", () => {
  const loaded = () => withLoadedFile(initialState(), { name: "c.xlsx", model, report, dateModification: null });

  // « Groupe à groupe » a été ROUVERT en fonctionnel : « quelle direction
  // alimente quelle direction » est précisément la question d'un comité de
  // direction, et c'est la seule vue qui y réponde.
  it("garde le groupe à groupe en passant en fonctionnel", () => {
    const state = withMode(withVue(loaded(), "group-to-group"), "functional");
    expect(state.view).toBe("group-to-group");
  });

  it("quitte aussi la vue par technologie", () => {
    expect(withMode(withVue(loaded(), "by-technology"), "functional").view).not.toBe("by-technology");
  });

  it("ne touche à rien en architecture", () => {
    expect(withMode(withVue(loaded(), "group-to-group"), "architecture").view).toBe("group-to-group");
  });
});
