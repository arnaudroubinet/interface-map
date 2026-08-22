import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { chainesDisponibles, buildChainView } from "./chaine";
import type { ParsedModel } from "../parsing/model";

// Boreal publie sur Kafka, l'ESB relaie, un consommateur métier reçoit. Trois
// maillons, deux technologies, et trois NOMS différents : c'est exactement ce
// que la lecture fonctionnelle efface et que la vue Chaîne est venue montrer.
function parcTroisMaillons(overrides: Partial<ParsedModel> = {}): ParsedModel {
  return base.modele({
    groupes: [base.groupe({ nom: "G" })],
    typesActeur: [base.typeActeur({ nature: "Business" }), base.typeActeur({ type: "Infra", nature: "Technical" })],
    typesFlux: [base.typeFlux({ type: "Kafka" }), base.typeFlux({ type: "HTTP" })],
    acteurs: [
      base.acteur({ nom: "Boreal" }),
      base.acteur({ nom: "Kafka", typeActeur: "Infra" }),
      base.acteur({ nom: "ESB", typeActeur: "Infra" }),
      base.acteur({ nom: "Onderon" }),
    ],
    fxSheetNames: ["FX_Boreal_Kafka", "FX_Kafka_Kafka", "FX_ESB_HTTP"],
    interfaces: [
      base.iface({ nomDuFlux: "Policy events", acteurExposant: "Boreal", typeDeFlux: "Kafka", feuilleAttendue: "FX_Boreal_Kafka" }),
      base.iface({ nomDuFlux: "Policy stream", acteurExposant: "Kafka", typeDeFlux: "Kafka", feuilleAttendue: "FX_Kafka_Kafka" }),
      base.iface({ nomDuFlux: "Policy feed", acteurExposant: "ESB", typeDeFlux: "HTTP", feuilleAttendue: "FX_ESB_HTTP" }),
    ],
    consommations: [
      base.conso({ nomDuFlux: "Policy events", acteurConsommateur: "Kafka", feuille: "FX_Boreal_Kafka", republiePar: "Policy stream" }),
      base.conso({ nomDuFlux: "Policy stream", acteurConsommateur: "ESB", feuille: "FX_Kafka_Kafka", republiePar: "Policy feed" }),
      base.conso({ nomDuFlux: "Policy feed", acteurConsommateur: "Onderon", feuille: "FX_ESB_HTTP" }),
    ],
    ...overrides,
  });
}

describe("chainesDisponibles", () => {
  it("rend un maillon par segment, dans l'ordre du parcours", () => {
    const [chaîne] = chainesDisponibles(parcTroisMaillons(), null);
    expect(chaîne.maillons.map((m) => [m.exposant, m.consommateur])).toEqual([
      ["Boreal", "Kafka"],
      ["Kafka", "ESB"],
      ["ESB", "Onderon"],
    ]);
  });

  // Le nom sous lequel l'échange circule CHANGE en route : c'est ce qu'on vient
  // voir, et ce que le lien fonctionnel rabattu ne dit pas.
  it("porte sur chaque maillon le nom et la technologie de CE segment", () => {
    const [chaîne] = chainesDisponibles(parcTroisMaillons(), null);
    expect(chaîne.maillons.map((m) => m.interfaceNom)).toEqual(["Policy events", "Policy stream", "Policy feed"]);
    expect(chaîne.maillons.map((m) => m.technologie)).toEqual(["Kafka", "Kafka", "HTTP"]);
  });

  it("se nomme par ses deux bouts et l'échange reçu", () => {
    expect(chainesDisponibles(parcTroisMaillons(), null)[0].libellé).toBe("Boreal → Onderon : Policy feed");
  });

  // Un lien direct est une chaîne d'UN maillon : pas un cas particulier.
  it("rend un seul maillon pour un lien direct", () => {
    const direct = base.modele({
      groupes: [base.groupe({ nom: "G" })],
      typesActeur: [base.typeActeur()],
      typesFlux: [base.typeFlux()],
      fxSheetNames: ["FX_A_HTTP"],
      acteurs: [base.acteur({ nom: "A" }), base.acteur({ nom: "B" })],
      interfaces: [base.iface({ nomDuFlux: "F", acteurExposant: "A", feuilleAttendue: "FX_A_HTTP" })],
      consommations: [base.conso({ nomDuFlux: "F", acteurConsommateur: "B", feuille: "FX_A_HTTP" })],
    });
    expect(chainesDisponibles(direct, null)[0].maillons).toHaveLength(1);
  });

  // L'atténuation se marque À L'ENDROIT où elle a lieu, pas globalement : c'est
  // toute la valeur de la vue face au lien rabattu, qui ne dit que « quelque
  // part sur le trajet ».
  it("marque le maillon qui transforme, et lui seul", () => {
    const parc = parcTroisMaillons();
    parc.consommations[1].decision = "Transform";
    const [chaîne] = chainesDisponibles(parc, null);
    expect(chaîne.maillons.map((m) => m.atténué)).toEqual([false, true, false]);
  });

  // Une chaîne coupée ne produit aucun lien fonctionnel : elle n'a donc pas de
  // trajet à proposer, et le rapport d'intégrité la signale par ailleurs.
  it("ne propose rien quand la chaîne est coupée", () => {
    const parc = parcTroisMaillons();
    parc.consommations[0].republiePar = "";
    expect(chainesDisponibles(parc, null)).toEqual([]);
  });
});

describe("buildChainView", () => {
  it("dessine un nœud par acteur traversé et un trait par maillon", () => {
    const vue = buildChainView(parcTroisMaillons(), chainesDisponibles(parcTroisMaillons(), null)[0]);
    expect(vue.nodes.map((n) => n.id)).toEqual(["Boreal", "Kafka", "ESB", "Onderon"]);
    expect(vue.edges).toHaveLength(3);
  });

  // Les deux bouts sont ce qu'on est venu voir ; ce qu'il y a entre eux est la
  // plomberie qu'on traverse.
  it("met en avant les deux bouts et marque la plomberie du milieu", () => {
    const vue = buildChainView(parcTroisMaillons(), chainesDisponibles(parcTroisMaillons(), null)[0]);
    expect(vue.nodes.map((n) => n.kind)).toEqual(["acteur-selectionne", "acteur", "acteur", "acteur-selectionne"]);
    expect(vue.nodes.map((n) => n.technique)).toEqual([undefined, true, true, undefined]);
  });

  it("écrit sur chaque trait le nom porté à cet endroit", () => {
    const vue = buildChainView(parcTroisMaillons(), chainesDisponibles(parcTroisMaillons(), null)[0]);
    expect(vue.edges.map((e) => e.label)).toEqual(["Policy events", "Policy stream", "Policy feed"]);
  });
});
