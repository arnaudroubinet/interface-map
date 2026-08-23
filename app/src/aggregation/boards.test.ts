import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { allBoards } from "./boards";
import type { ParsedModel, Actor, InterfaceCatalogue, Consumption } from "../parsing/model";
import { SCHEMA_VERSION } from "../parsing/build-model";

// A filled-in estate: these files check what the exports CARRY, so the fields
// they read must be filled in.
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
      base.flowType({ type: "HTTP" }),
      base.flowType({ type: "Kafka", direction: "provider-to-consumer", rawDirection: "provider → consumer" }),
    ],
    interfaces: [iface({})],
    consumptions: [consumption({})],
    fxSheetNames: ["FX_A_HTTP"],
    missingOptionalColumns: [],
    schemaVersion: SCHEMA_VERSION,
    savedAt: null,
    referentialActors: [],
    referentialTechnologies: [],
    ...o,
  };
}

const titles = (m: ParsedModel, rank: number | null = null) =>
  allBoards(m, rank, "architecture").map((p) => p.title);

// Bus relays a flow from Tatooine to Naboo: Tatooine publishes F1, Bus relays
// via F2 (relay: F1), Naboo consumes F2. In the functional reading the chain
// resolves to a direct Tatooine → Naboo flow, and Bus disappears.
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

describe("allBoards", () => {
  it("opens with the three views that need no selection", () => {
    expect(titles(model()).slice(0, 3)).toEqual(["Group to group", "Platform detail", "Platform only"]);
  });

  // The views with a selector produce as many as there are choices in the
  // selector: that is all "every diagram" means.
  it("unfolds the selector views, one board per choice", () => {
    const all = titles(model());
    expect(all).toContain("HTTP (technology)");
    expect(all).toContain("A (actor)");
    expect(all).toContain("B (actor)");
  });

  // A technology nobody uses has no diagram: it would be an empty board, and
  // the report already reports it as an unused type.
  it("leaves out a technology no interface uses", () => {
    expect(titles(model())).not.toContain("Kafka (technology)");
  });

  // Nor has an actor no flow touches: its board would show nothing but its own
  // box.
  it("leaves out an actor no flow reaches", () => {
    const m = model({ actors: [actor({ name: "A" }), actor({ name: "B" }), actor({ name: "Seul" })] });
    expect(titles(m)).not.toContain("Seul (actor)");
  });

  // An actor may bear a flow type's name: two "HTTP" tabs in the draw.io file,
  // and the reader no longer knows which is the technology and which the actor.
  //
  it("tells the flow type board from the actor board of the same name", () => {
    const m = model({
      actors: [actor({ name: "HTTP" }), actor({ name: "B", group: "Partenaire" })],
      interfaces: [iface({ providerName: "HTTP" })],
    });
    expect(titles(m)).toContain("HTTP (technology)");
    expect(titles(m)).toContain("HTTP (actor)");
    // The board names the actor it details: that is what the links target, and
    // the title can no longer be taken apart to find it again.
    const boards = allBoards(m, null, "architecture");
    expect(boards.find((p) => p.title === "HTTP (actor)")!.actor).toBe("HTTP");
    expect(boards.find((p) => p.title === "HTTP (technology)")!.actor).toBeUndefined();
  });

  it("carries the nodes and edges of each board", () => {
    const board = allBoards(model(), null, "architecture").find((p) => p.title === "Group to group")!;
    expect(board.nodes.length).toBeGreaterThan(0);
    expect(board.edges.length).toBeGreaterThan(0);
  });

  // The displayed milestone applies to every board: an export cannot mix two
  // states of the platform.
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

describe("boards by mode", () => {
  it("includes no by-technology board in the functional reading", () => {
    const titles = allBoards(modelWithTechnical(), null, "functional").map((p) => p.title);
    expect(titles).not.toContain("HTTP (technology)");
  });

  it("includes no board for a technical actor", () => {
    const titles = allBoards(modelWithTechnical(), null, "functional").map((p) => p.title);
    expect(titles).not.toContain("Bus (actor)");
  });

  it("keeps the three fixed views", () => {
    const titles = allBoards(modelWithTechnical(), null, "functional").map((p) => p.title);
    expect(titles.slice(0, 3)).toEqual(["Group to group", "Platform detail", "Platform only"]);
  });

  // §5.2: a business actor left isolated -- whose exchanges all went through
  // broken chains -- stays displayed, alone. The draw.io file promises every
  // board; a missing tab would break that promise.
  it("carries its own board for a business actor left isolated", () => {
    const m = modelWithTechnical();
    m.actors.push(actor({ name: "Isolé", group: "Socle" }));
    const titles = allBoards(m, null, "functional").map((p) => p.title);
    expect(titles).toContain("Isolé (actor)");
  });

  // Retired at the displayed milestone, the isolated actor has no board left:
  // it is no longer on the map, not even alone.
  it("has no board for an isolated business actor retired at the displayed milestone", () => {
    const milestones = [
      { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
      { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
    ];
    const m = modelWithTechnical();
    m.milestones = milestones;
    m.actors.push(actor({ name: "Isolé", group: "Socle", introducedAt: "v1", retiredAt: "v2" }));
    const titlesAt = (rank: number) => allBoards(m, rank, "functional").map((p) => p.title);
    expect(titlesAt(1)).toContain("Isolé (actor)");
    expect(titlesAt(2)).not.toContain("Isolé (actor)");
  });
});
