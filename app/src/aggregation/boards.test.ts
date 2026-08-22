import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { toutesLesPlanches } from "./boards";
import type { ParsedModel, Actor, InterfaceCatalogue, Consumption } from "../parsing/model";
import { SCHEMA_VERSION } from "../parsing/build-model";

// Un parc renseigné : ces fichiers vérifient ce que les exports TRANSPORTENT,
// donc les champs qu'ils lisent doivent être remplis.
function actor(o: Partial<Actor> = {}): Actor {
  return base.actor({ group: "Socle", description: "d", ...o });
}

function iface(o: Partial<InterfaceCatalogue> = {}): InterfaceCatalogue {
  return base.iface({ description: "d", ...o });
}

function consumption(o: Partial<Consumption> = {}): Consumption {
  return base.consumption({ usage: "u", criticality: "1 - Critical", legacyStatus: "Actif", decision: "Keep", ...o });
}

function model(o: Partial<ParsedModel> = {}): ParsedModel {
  return {
    actors: [actor({ name: "A" }), actor({ name: "B", group: "Partenaire" })],
    groups: [
      { name: "Socle", perimeter: "Platform", sheet: "Groups", row: 0 },
      { name: "Partenaire", perimeter: "External", sheet: "Groups", row: 0 },
    ],
    groupsSheetMissing: false,
    actorTypes: [{ type: "Application", icon: "app-window", nature: "", sheet: "ActorTypes", row: 0 }],
    milestones: [],
    flowTypes: [
      base.typeFlux({ type: "HTTP" }),
      base.typeFlux({ type: "Kafka", direction: "provider-to-consumer", rawDirection: "provider → consumer" }),
    ],
    interfaces: [iface({})],
    consumptions: [consumption({})],
    fxSheetNames: ["FX_A_HTTP"],
    missingOptionalColumns: [],
    schemaVersion: SCHEMA_VERSION,
    savedAt: null,
    ...o,
  };
}

const titles = (m: ParsedModel, rank: number | null = null) =>
  toutesLesPlanches(m, rank, "architecture").map((p) => p.title);

// Bus relaie un flux d'Tatooine vers Naboo : Tatooine expose F1, Bus relaie
// via F2 (relais: F1), Naboo consomme F2. En fonctionnel, la chaîne se
// résout en un flux direct Tatooine → Naboo, Bus disparaît.
function modelWithTechnical(): ParsedModel {
  return model({
    actors: [actor({ name: "Tatooine" }), actor({ name: "Bus", actorType: "Middleware" }), actor({ name: "Naboo" })],
    actorTypes: [
      { type: "Application", icon: "app-window", nature: "", sheet: "ActorTypes", row: 0 },
      { type: "Middleware", icon: "app-window", nature: "Technical", sheet: "ActorTypes", row: 0 },
    ],
    interfaces: [iface({ flowName: "F1", providerName: "Tatooine" }), iface({ flowName: "F2", providerName: "Bus", legacyRelays: "F1" })],
    consumptions: [consumption({ flowName: "F2", consumerName: "Naboo" })],
  });
}

describe("toutesLesPlanches", () => {
  it("opens with the three views that need no selection", () => {
    expect(titles(model()).slice(0, 3)).toEqual(["Group to group", "Platform detail", "Platform only"]);
  });

  // Les vues à sélecteur en produisent autant qu'il y a de choix dans le
  // sélecteur : c'est là tout ce que « tous les schémas » veut dire.
  it("unfolds the selector views, one board per choice", () => {
    const tous = titles(model());
    expect(tous).toContain("HTTP (technology)");
    expect(tous).toContain("A (actor)");
    expect(tous).toContain("B (actor)");
  });

  // Une technologie que personne n'emploie n'a pas de schéma : ce serait une
  // planche vide, et le rapport la signale déjà comme type inutilisé.
  it("leaves out a technology no interface uses", () => {
    expect(titles(model())).not.toContain("Kafka (technology)");
  });

  // Un acteur qu'aucun flux ne touche non plus : sa planche ne montrerait que
  // sa propre boîte.
  it("leaves out an actor no flow reaches", () => {
    const m = model({ actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "Seul" })] });
    expect(titles(m)).not.toContain("Seul (actor)");
  });

  // Un acteur peut porter le nom d'un type de flux : deux onglets « HTTP »
  // dans le fichier draw.io, et le lecteur ne sait plus lequel est la
  // technologie et lequel est l'acteur.
  it("tells the flow type board from the actor board of the same name", () => {
    const m = model({
      actors: [actor({ name: "HTTP" }), actor({ name: "B", group: "Partenaire" })],
      interfaces: [iface({ providerName: "HTTP" })],
    });
    expect(titles(m)).toContain("HTTP (technology)");
    expect(titles(m)).toContain("HTTP (actor)");
    // La planche nomme l'acteur qu'elle détaille : c'est ce que visent les
    // liens, et le titre ne se laisse plus défaire pour le retrouver.
    const boards = toutesLesPlanches(m, null, "architecture");
    expect(boards.find((p) => p.title === "HTTP (actor)")!.actor).toBe("HTTP");
    expect(boards.find((p) => p.title === "HTTP (technology)")!.actor).toBeUndefined();
  });

  it("carries the nodes and edges of each board", () => {
    const board = toutesLesPlanches(model(), null, "architecture").find((p) => p.title === "Group to group")!;
    expect(board.nodes.length).toBeGreaterThan(0);
    expect(board.edges.length).toBeGreaterThan(0);
  });

  // Le palier affiché vaut pour toutes les planches : un export ne peut pas
  // mélanger deux états de la plateforme.
  it("reads every board at the same milestone", () => {
    const milestones = [
      { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
      { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
    ];
    const m = model({
      milestones,
      interfaces: [iface({ introducedAt: "v1", retiredAt: "v2" })],
      consumptions: [consumption({ introducedAt: "v1" })],
      actors: [actor({ name: "A", introducedAt: "v1" }), actor({ name: "B", group: "Partenaire", introducedAt: "v1" })],
    });
    expect(titles(m, 1)).toContain("HTTP (technology)");
    expect(titles(m, 2)).not.toContain("HTTP (technology)");
  });
});

describe("planches selon le mode", () => {
  it("n'inclut aucune planche par technologie en fonctionnel", () => {
    const titles = toutesLesPlanches(modelWithTechnical(), null, "functional").map((p) => p.title);
    expect(titles).not.toContain("HTTP (technology)");
  });

  it("n'inclut aucune planche pour un acteur technique", () => {
    const titles = toutesLesPlanches(modelWithTechnical(), null, "functional").map((p) => p.title);
    expect(titles).not.toContain("Bus (actor)");
  });

  it("garde les trois vues fixes", () => {
    const titles = toutesLesPlanches(modelWithTechnical(), null, "functional").map((p) => p.title);
    expect(titles.slice(0, 3)).toEqual(["Group to group", "Platform detail", "Platform only"]);
  });

  // §5.2 : un acteur métier devenu isolé -- dont les échanges passaient tous
  // par des chaînes coupées -- reste affiché, seul. Le fichier draw.io promet
  // toutes les planches ; un onglet manquant romprait cette promesse.
  it("porte sa propre planche pour un acteur métier devenu isolé", () => {
    const m = modelWithTechnical();
    m.actors.push(actor({ name: "Isolé", group: "Socle" }));
    const titles = toutesLesPlanches(m, null, "functional").map((p) => p.title);
    expect(titles).toContain("Isolé (actor)");
  });

  // Retiré au palier affiché, l'acteur isolé n'a plus de planche : il n'est
  // plus sur la carte, pas même seul.
  it("n'a pas de planche pour un acteur métier isolé retiré au palier affiché", () => {
    const milestones = [
      { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
      { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
    ];
    const m = modelWithTechnical();
    m.milestones = milestones;
    m.actors.push(actor({ name: "Isolé", group: "Socle", introducedAt: "v1", retiredAt: "v2" }));
    const titlesAt = (rank: number) => toutesLesPlanches(m, rank, "functional").map((p) => p.title);
    expect(titlesAt(1)).toContain("Isolé (actor)");
    expect(titlesAt(2)).not.toContain("Isolé (actor)");
  });
});
