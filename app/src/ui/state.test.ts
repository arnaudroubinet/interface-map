import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import {
  initialState,
  withFichierCharge,
  withVue,
  withOptions,
  withSelectionActeur,
  withActeurMasqueMatrice,
  withGranulariteMatrice,
  withMode,
  withPalierAffiche,
  vueAuChargement,
} from "./state";
import { VERSION_MODELE } from "../parsing/build-model";
import type { ParsedModel } from "../parsing/model";
import type { IntegrityReport } from "../integrity/checks";

const model: ParsedModel = base.modele();
const report: IntegrityReport = { familles: [], blocsInformatifs: [], totalAnomalies: 0, totalActions: 0, totalAvertissements: 0 };

describe("initialState", () => {
  it("starts with no file loaded and no options set", () => {
    const state = initialState();
    expect(state.fichier).toBeNull();
    expect(state.vue).toBe("groupe-a-groupe");
    expect(state.options).toEqual({ compteurs: true, libelléArête: "technology", echellePng: 2, graisseParCriticite: false });
  });
});

describe("withFichierCharge", () => {
  it("replaces the whole state at once and opens on the default view when the file is clean", () => {
    const loaded = withFichierCharge(initialState(), {
      nom: "classeur.xlsx", model, report, dateModification: null,
    });
    expect(loaded.fichier?.nom).toBe("classeur.xlsx");
    expect(loaded.vue).toBe("groupe-a-groupe");
  });

  it("opens on the integrity view when the file breaks the rules, rather than on a diagram", () => {
    const enDefaut: IntegrityReport = {
      familles: [{ id: "coherence", titre: "Cohérence", description: "", anomalies: [{ message: "…" }] }],
      blocsInformatifs: [],
      totalAnomalies: 1,
      totalActions: 0,
      totalAvertissements: 0,
    };
    const loaded = withFichierCharge(initialState(), {
      nom: "classeur.xlsx", model, report: enDefaut, dateModification: null,
    });
    expect(loaded.vue).toBe("controles");
  });
});

describe("withVue / withOptions / withSelectionActeur", () => {
  it("updates only the targeted slice of state", () => {
    const state = withSelectionActeur(withOptions(withVue(initialState(), "par-acteur"), { compteurs: false }), "Tatooine");
    expect(state.vue).toBe("par-acteur");
    expect(state.options.compteurs).toBe(false);
    expect(state.selectionActeur).toBe("Tatooine");
  });
});

describe("withGranulariteMatrice", () => {
  it("starts on acteur-to-acteur", () => {
    expect(initialState().filtresMatrice.granularite).toBe("acteur");
  });

  it("clears the masked rows, whose names no longer mean anything", () => {
    const masqué = withActeurMasqueMatrice(initialState(), "Tatooine", true);
    const replié = withGranulariteMatrice(masqué, "groupe");
    expect(replié.filtresMatrice.granularite).toBe("groupe");
    expect(replié.filtresMatrice.acteursMasques).toEqual([]);
  });
});

describe("withFichierCharge — classeur d'une version antérieure", () => {
  const ancien = { ...model, versionModele: 0 };

  it("ouvre sur l'écran de mise à niveau plutôt que sur une vue", () => {
    const loaded = withFichierCharge(initialState(), {
      nom: "vieux.xlsx", model: ancien, report, dateModification: null,
    });
    expect(loaded.vue).toBe("mise-a-niveau");
  });

  // Les anomalies d'un classeur qu'on ne sait pas lire entièrement ne sont pas
  // fiables : la mise à niveau passe avant, sans quoi on ferait corriger des
  // défauts qui n'en sont peut-être pas.
  it("passe avant l'écran des contrôles, même en présence d'anomalies", () => {
    const enDefaut: IntegrityReport = {
      familles: [{ id: "coherence", titre: "Cohérence", description: "", anomalies: [{ message: "…" }] }],
      blocsInformatifs: [], totalAnomalies: 1, totalActions: 0, totalAvertissements: 0,
    };
    const loaded = withFichierCharge(initialState(), {
      nom: "vieux.xlsx", model: ancien, report: enDefaut, dateModification: null,
    });
    expect(loaded.vue).toBe("mise-a-niveau");
  });

  it("laisse un classeur à jour ouvrir normalement", () => {
    const loaded = withFichierCharge(initialState(), {
      nom: "a-jour.xlsx", model, report, dateModification: null,
    });
    expect(loaded.vue).toBe("groupe-a-groupe");
  });
});

describe("withFichierCharge — palier d'ouverture", () => {
  const avecPaliers = {
    ...model,
    paliers: [
      { nom: "v1", rang: 1, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
      { nom: "v2", rang: 2, libelle: "", statut: "Delivered", date: "", description: "", feuille: "Milestones", ligne: 0 },
      { nom: "v3", rang: 3, libelle: "", statut: "Planned", date: "", description: "", feuille: "Milestones", ligne: 0 },
    ],
  };

  it("ouvre sur le dernier palier livré, en comparant au précédent", () => {
    const loaded = withFichierCharge(initialState(), {
      nom: "c.xlsm", model: avecPaliers, report, dateModification: null,
    });
    expect(loaded.palierAffiche).toBe("v2");
    expect(loaded.palierCompare).toBe("v1");
  });

  it("laisse les deux à null quand le classeur ne déclare aucun palier", () => {
    const loaded = withFichierCharge(initialState(), {
      nom: "c.xlsm", model, report, dateModification: null,
    });
    expect(loaded.palierAffiche).toBeNull();
    expect(loaded.palierCompare).toBeNull();
  });
});

describe("mode de lecture", () => {
  it("ouvre en architecture", () => {
    expect(initialState().mode).toBe("architecture");
  });

  it("retient le mode choisi", () => {
    expect(withMode(initialState(), "fonctionnel").mode).toBe("fonctionnel");
  });

  // « Par technologie » n'a pas d'objet sans technologie : y rester
  // afficherait une vue vide sans rien expliquer. Le repli n'est plus le
  // groupe à groupe, qui n'a pas davantage d'objet en fonctionnel.
  it("quitte la vue par technologie en passant en fonctionnel", () => {
    const s = withVue(initialState(), "par-technologie");
    expect(withMode(s, "fonctionnel").vue).toBe("plateforme-detaillee");
  });

  it("laisse la vue en place quand elle garde un sens", () => {
    const s = withVue(initialState(), "matrice");
    expect(withMode(s, "fonctionnel").vue).toBe("matrice");
  });

  const acteur = (nom: string, typeActeur: string) => base.acteur({ nom, typeActeur });
  const modelMixte: ParsedModel = {
    ...model,
    acteurs: [acteur("Tatooine", "Application"), acteur("Bus", "Middleware")],
    typesActeur: [
      { type: "Application", icone: "", nature: "Business", feuille: "ActorTypes", ligne: 0 },
      { type: "Middleware", icone: "", nature: "Technical", feuille: "ActorTypes", ligne: 0 },
    ],
  };

  // Passer en fonctionnel sans corriger la sélection montre une seule boîte
  // et aucun message : la boîte disparue du sélecteur reste pourtant visée.
  it("efface la sélection d'acteur en passant en fonctionnel si elle visait un acteur technique", () => {
    const chargé = withFichierCharge(initialState(), { nom: "c.xlsx", model: modelMixte, report, dateModification: null });
    const s = withSelectionActeur(chargé, "Bus");
    expect(withMode(s, "fonctionnel").selectionActeur).toBeNull();
  });

  it("garde la sélection quand elle visait déjà un acteur métier", () => {
    const chargé = withFichierCharge(initialState(), { nom: "c.xlsx", model: modelMixte, report, dateModification: null });
    const s = withSelectionActeur(chargé, "Tatooine");
    expect(withMode(s, "fonctionnel").selectionActeur).toBe("Tatooine");
  });
});

// --- QA : changer de palier ne revalidait pas la sélection d'acteur. Le mode
// le faisait déjà (§5.2) ; le palier, non. Un acteur retiré restait donc
// sélectionné alors qu'il ne figure plus dans la lecture, et le schéma
// n'affichait qu'une boîte fantôme, sans un mot pour l'expliquer.
describe("withPalierAffiche — la sélection suit ce que le palier montre", () => {
  const acteur = (nom: string, palierRetrait = "") => base.acteur({ nom, palierRetrait });
  const avecFrise: ParsedModel = {
    ...model,
    paliers: [base.palier({ nom: "v1", rang: 1 }), base.palier({ nom: "v2", rang: 2 })],
    acteurs: [acteur("Tatooine", "v2"), acteur("Chandrila")],
  };
  const chargé = () =>
    withSelectionActeur(
      withFichierCharge(initialState(), { nom: "c.xlsx", model: avecFrise, report, dateModification: null }),
      "Tatooine"
    );

  it("lâche un acteur que le nouveau palier ne montre plus", () => {
    expect(withPalierAffiche(chargé(), "v2").selectionActeur).toBeNull();
  });

  it("garde un acteur que le nouveau palier montre encore", () => {
    expect(withPalierAffiche(chargé(), "v1").selectionActeur).toBe("Tatooine");
  });

  it("garde la sélection quand on retire le filtre de palier", () => {
    expect(withPalierAffiche(chargé(), null).selectionActeur).toBe("Tatooine");
  });
});

// --- QA : un classeur d'un schéma PLUS RÉCENT que l'outil s'ouvrait
// normalement -- la condition ne regardait que le retard. L'outil en dessinait
// une image amputée de tout ce qu'il ne sait pas encore lire, sans le dire.
describe("vueAuChargement — les deux sens du désaccord de schéma", () => {
  const à = (versionModele: number) => ({
    nom: "c.xlsx", model: { ...model, versionModele }, report, dateModification: null,
  });

  it("bloque sur un classeur en retard", () => {
    expect(vueAuChargement(à(VERSION_MODELE - 1))).toBe("mise-a-niveau");
  });

  it("bloque aussi sur un classeur en avance", () => {
    expect(vueAuChargement(à(VERSION_MODELE + 1))).toBe("mise-a-niveau");
  });

  it("laisse passer un classeur à la bonne version", () => {
    expect(vueAuChargement(à(VERSION_MODELE))).not.toBe("mise-a-niveau");
  });
});

// --- QA : le groupe à groupe n'a pas de sens en fonctionnel -- on n'y présente
// que la vue d'architecture. Le rail ne retirait pourtant que « par
// technologie », et la vue restait offerte.
describe("withMode — les vues qui n'ont pas de sens en fonctionnel", () => {
  const chargé = () => withFichierCharge(initialState(), { nom: "c.xlsx", model, report, dateModification: null });

  // « Groupe à groupe » a été ROUVERT en fonctionnel : « quelle direction
  // alimente quelle direction » est précisément la question d'un comité de
  // direction, et c'est la seule vue qui y réponde.
  it("garde le groupe à groupe en passant en fonctionnel", () => {
    const état = withMode(withVue(chargé(), "groupe-a-groupe"), "fonctionnel");
    expect(état.vue).toBe("groupe-a-groupe");
  });

  it("quitte aussi la vue par technologie", () => {
    expect(withMode(withVue(chargé(), "par-technologie"), "fonctionnel").vue).not.toBe("par-technologie");
  });

  it("ne touche à rien en architecture", () => {
    expect(withMode(withVue(chargé(), "groupe-a-groupe"), "architecture").vue).toBe("groupe-a-groupe");
  });
});
