import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { modelToLikeC4 } from "./likec4-dsl";
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

describe("modeleEnLikeC4", () => {
  it("declares the kinds it uses before using them", () => {
    const dsl = modelToLikeC4(model(), null);
    expect(dsl).toMatch(/specification \{[\s\S]*element group[\s\S]*element system[\s\S]*\}/);
    expect(dsl.indexOf("specification {")).toBeLessThan(dsl.indexOf("model {"));
  });

  // LikeC4 says belonging through nesting: that is what gives the group its
  // boundary on the board.
  it("nests the actors inside their group", () => {
    const dsl = modelToLikeC4(model(), null);
    expect(dsl).toMatch(/socle = group "Socle" \{\s+a = system "A" \{/);
  });

  it("carries the description and the actor type on the element", () => {
    const dsl = modelToLikeC4(model(), null);
    expect(dsl).toContain('description "d"');
    expect(dsl).toContain('technology "Application"');
  });

  // The group's perimeter becomes a tag: that is what tells the estate one owns
  // apart from the one one puts up with.
  it("tags what sits outside the platform", () => {
    const dsl = modelToLikeC4(model(), null);
    expect(dsl).toMatch(/b = system "B" \{\s+#external/);
  });

  // A relationship named from the root designates both ends by their full path,
  // failing which LikeC4 does not find them.
  it("names both ends by their full path", () => {
    const dsl = modelToLikeC4(model(), null);
    expect(dsl).toContain('socle.a -[http]-> partenaire.b "F"');
    expect(dsl).toContain('technology "HTTP"');
  });

  it("follows the flow type the other way round when it says so", () => {
    const m = model({
      flowTypes: [
        base.flowType({ type: "HTTP", direction: "provider-to-consumer", rawDirection: "provider → consumer" }),
      ],
    });
    expect(modelToLikeC4(m, null)).toContain('socle.a -[http]-> partenaire.b "F"');
  });

  // LikeC4 has a description field on the relationship, distinct from the label:
  // what the exchange carries is written where the tool shows it, rather than as
  // metadata.
  it("carries the interface description on the relationship", () => {
    const m = model({ interfaces: [iface({ description: "What the exchange carries" })] });
    expect(modelToLikeC4(m, null)).toMatch(/-> partenaire\.b "F" \{[^}]*description "What the exchange carries"/s);
  });

  // The two comment columns do not say the same thing: the interface's is about
  // the contract, the consumption's about the use a consumer makes of it.
  //
  it("carries both comment columns on the relationship", () => {
    const m = model({
      interfaces: [iface({ comments: "Scope under review" })],
      consumptions: [consumption({ comments: "Migrating next quarter" })],
    });
    const dsl = modelToLikeC4(m, null);
    expect(dsl).toContain('interfaceComments "Scope under review"');
    expect(dsl).toContain('consumptionComments "Migrating next quarter"');
  });

  it("flags an interface still to be confirmed, and only that one", () => {
    const m = model({ interfaces: [iface({ toConfirm: true })] });
    expect(modelToLikeC4(m, null)).toContain('toConfirm "Yes"');
    expect(modelToLikeC4(model(), null)).not.toContain("toConfirm");
  });

  // An actor consuming the interface it publishes itself: LikeC4 refuses the
  // whole file on a relationship from an element to itself -- "Invalid
  // parent-child relationship". The aggregated views already hide it (§4.3).
  it("leaves out an actor consuming the interface it exposes itself", () => {
    const m = model({ actors: [actor({ name: "A" })], consumptions: [consumption({ consumerName: "A" })] });
    const dsl = modelToLikeC4(m, null);
    expect(dsl).not.toContain("socle.a -> socle.a");
  });

  // An actor with no group still exists: the report already asks for it, and it
  // is not the export's place to make it vanish.
  it("keeps an actor that belongs to no group, at the root", () => {
    const m = model({ actors: [actor({ name: "Seul", group: "" })], interfaces: [], consumptions: [] });
    expect(modelToLikeC4(m, null)).toContain('seul = system "Seul"');
  });

  it("exports the platform as it stands at the milestone on show", () => {
    const milestones = [
      { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
      { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
    ];
    const m = model({
      milestones,
      actors: [
        actor({ name: "A", introducedAt: "v1" }),
        actor({ name: "B", group: "Partenaire", introducedAt: "v1", retiredAt: "v2" }),
      ],
      interfaces: [iface({ introducedAt: "v1" })],
      consumptions: [consumption({ introducedAt: "v1" })],
    });
    expect(modelToLikeC4(m, 1)).toContain('b = system "B"');
    expect(modelToLikeC4(m, 2)).not.toContain('b = system "B"');
  });

  it("declares a view that shows everything", () => {
    const dsl = modelToLikeC4(model(), null);
    expect(dsl).toContain("views {");
    expect(dsl).toContain("include *");
  });

  // One view per diagram, as in the tool: an actor's view is about that actor,
  // hence the "of".
  it("declares a view for each actor, scoped to it", () => {
    const dsl = modelToLikeC4(model(), null);
    expect(dsl).toContain("view actor_a of socle.a {");
    expect(dsl).toContain("view actor_b of partenaire.b {");
  });

  // The technology reads on the lines: with no tag on the relationship, the view
  // has nothing to filter on. The tag must be declared first.
  it("tags each relationship with its technology, and gives it a view", () => {
    const dsl = modelToLikeC4(model(), null);
    expect(dsl).toContain("tag http");
    expect(dsl).toMatch(/-> partenaire\.b "F" \{\s+#http/);
    expect(dsl).toContain("view tech_http {");
    expect(dsl).toContain("include * where tag is #http");
  });

  it("declares a view holding the platform alone", () => {
    const dsl = modelToLikeC4(model(), null);
    expect(dsl).toContain("view platform_only {");
    expect(dsl).toContain("include * where tag is #platform");
  });
});

// --- §2.13: three kinds for N actor types, no legend, and our arrowhead
// convention reduced to a tag -- although LikeC4 is the ONLY target that can
// draw it.
describe("modelToLikeC4 — the notation survives the export", () => {
  const estate = (direction: "consumer-to-provider" | "provider-to-consumer") =>
    model({ flowTypes: [base.flowType({ type: "HTTP", direction: direction })] });

  it("sets an open head on a pulled technology", () => {
    expect(modelToLikeC4(estate("consumer-to-provider"), null)).toMatch(/relationship http \{[\s\S]*?head vee/);
  });

  it("sets a solid head on a pushed technology", () => {
    expect(modelToLikeC4(estate("provider-to-consumer"), null)).toMatch(/relationship http \{[\s\S]*?head normal/);
  });

  // LikeC4's default stroke style is `dashed`: without `line solid`, ALL our
  // lines come out dashed and "Transform" can no longer be told apart.
  it("writes line solid explicitly", () => {
    expect(modelToLikeC4(estate("provider-to-consumer"), null)).toContain("line solid");
  });

  it("gives the relationship the colour the technology has in the tool", () => {
    const m = model({ flowTypes: [base.flowType({ type: "HTTP", colour: "#1f5fae" })] });
    expect(modelToLikeC4(m, null)).toMatch(/relationship http \{[\s\S]*?color #1f5fae/);
  });

  // The groups ARE ALREADY elements of the exported model: only the views were
  // missing. Quoted without its `.*` a group is a box, with its `.*` it is opened
  // -- which is exactly our two aggregated views.
  it("produces the group-to-group view and the platform-detail view", () => {
    const dsl = modelToLikeC4(model(), null);
    expect(dsl).toContain("view group_to_group {");
    expect(dsl).toContain("view platform_detail {");
    expect(dsl).toMatch(/view platform_detail \{[\s\S]*?socle\.\*/);
  });
});

describe("modelToLikeC4 — the functional reading", () => {
  it("announces the reading at the head of the file", () => {
    expect(modelToLikeC4(model(), null, "functional")).toContain("functional reading");
  });

  it("does not announce it in the architecture reading", () => {
    expect(modelToLikeC4(model(), null)).not.toContain("functional reading");
  });
});
