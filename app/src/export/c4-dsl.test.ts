import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { modelToStructurizr } from "./c4-dsl";
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
    referentialActors: [],
    referentialTechnologies: [],
    ...o,
  };
}

describe("modeleEnStructurizr", () => {
  it("wraps the model and its views in a workspace named after the workbook", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('workspace "carto"');
    expect(dsl).toContain("model {");
    expect(dsl).toContain("views {");
  });

  it("declares each actor as a software system, tagged with its type", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('a = softwareSystem "A" "d"');
    expect(dsl).toContain('tags "Application"');
  });

  // The group is the only boundary the workbook declares: losing it would make
  // the board illegible, every actor flat.
  it("puts the actors inside the group they belong to", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toMatch(/group "Socle" \{[^}]*a = softwareSystem/s);
  });

  // The relationship goes from provider to consumer, exactly as on the diagrams:
  // an export reversing it would tell something other than what the user has in
  // front of them. The test's intent has not changed; what changed is that the
  // rule is now the same on both sides.
  it("draws the relationship the way the diagrams do", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('a -> b "F" "HTTP"');
  });

  // The direction the flow type declares no longer turns the relationship round:
  // it says only who takes the initiative, and that is written as a tag.
  it("keeps the same direction whichever way the flow type reads", () => {
    const m = model({
      flowTypes: [
        base.flowType({ type: "HTTP", direction: "provider-to-consumer", rawDirection: "provider → consumer" }),
      ],
    });
    const dsl = modelToStructurizr(m, null, "carto.xlsx");
    expect(dsl).toContain('a -> b "F" "HTTP"');
    expect(dsl).not.toContain('"Pulled"');
  });

  // What the exchange carries is precisely what a C4 relationship describes. The
  // relationship's label already carries the flow's identity -- name and version,
  // as on the diagrams -- and Structurizr has no other text slot on a link: the
  // description is filed as a property rather than lost.
  it("carries the interface description on the relationship", () => {
    const m = model({ interfaces: [iface({ description: "What the exchange carries" })] });
    expect(modelToStructurizr(m, null, "carto.xlsx")).toContain('"Description" "What the exchange carries"');
  });

  // The two comment columns -- the interface's and the consumption's -- say
  // different things: one is about the contract, the other about the use a
  // consumer makes of it. Merging them into a single property would lose which
  // came from whom.
  it("carries both comment columns on the relationship", () => {
    const m = model({
      interfaces: [iface({ comments: "Scope under review" })],
      consumptions: [consumption({ comments: "Migrating next quarter" })],
    });
    const dsl = modelToStructurizr(m, null, "carto.xlsx");
    expect(dsl).toContain('"Interface comments" "Scope under review"');
    expect(dsl).toContain('"Consumption comments" "Migrating next quarter"');
  });

  // A flow to be confirmed is a flow one is not sure about: the export says so,
  // otherwise the produced file asserts more than the workbook. A confirmed
  // interface has nothing to say about it, so it does not carry the property.
  it("flags an interface still to be confirmed, and only that one", () => {
    const m = model({ interfaces: [iface({ toConfirm: true })] });
    expect(modelToStructurizr(m, null, "carto.xlsx")).toContain('"To confirm" "Yes"');
    expect(modelToStructurizr(model(), null, "carto.xlsx")).not.toContain('"To confirm"');
  });

  // An actor consuming the interface it publishes itself: the relationship would
  // go from an element to itself, which says nothing in a C4 model and which the
  // aggregated views already hide (§4.3). Structurizr accepts it, but LikeC4
  // refuses the whole file -- "Invalid parent-child relationship" -- and both
  // exports must describe the same model.
  it("leaves out an actor consuming the interface it exposes itself", () => {
    const m = model({ actors: [actor({ name: "A" })], consumptions: [consumption({ consumerName: "A" })] });
    const dsl = modelToStructurizr(m, null, "carto.xlsx");
    expect(dsl).not.toContain("a -> a");
  });

  it("names the interface version on the relationship, like everywhere else", () => {
    const m = model({ interfaces: [iface({ version: "1.0" })], consumptions: [consumption({ version: "1.0" })] });
    expect(modelToStructurizr(m, null, "carto.xlsx")).toContain('"F 1.0"');
  });

  // An actor retired at the displayed milestone is no longer there: the export
  // says the platform's state at that milestone, not the workbook's history.
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
    expect(modelToStructurizr(m, 1, "carto.xlsx")).toContain('b = softwareSystem "B"');
    expect(modelToStructurizr(m, 2, "carto.xlsx")).not.toContain('b = softwareSystem "B"');
  });

  // Structurizr cannot escape a quote: letting one through would break the whole
  // file rather than the offending line alone.
  it("keeps a quoted name from breaking the file", () => {
    const m = model({ actors: [actor({ name: 'Le "gros" système' })], interfaces: [], consumptions: [] });
    const dsl = modelToStructurizr(m, null, "carto.xlsx");
    expect(dsl).toContain("Le 'gros' système");
  });

  it("declares a landscape view that shows everything", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain("systemLandscape");
    expect(dsl).toContain("include *");
    expect(dsl).toContain("autolayout lr");
  });

  // One view per diagram: what the tool can draw, the C4 tool must be able to
  // find again without asking the workbook for it.
  it("declares a context view for each actor", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('systemContext a "actor-a"');
    expect(dsl).toContain('systemContext b "actor-b"');
  });

  // The by-technology view reads on the lines, not on the boxes: every link
  // therefore carries its technology as a tag, failing which there is no way to
  // find it again.
  it("tags each relationship with its technology, and gives it a view", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('tags "HTTP"');
    expect(dsl).toContain('systemLandscape "tech-http"');
    expect(dsl).toContain('include "relationship.tag==HTTP"');
  });

  it("declares a view holding the platform alone", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx");
    expect(dsl).toContain('include "element.tag==Platform"');
  });

  // A technology declared but used by nobody has no diagram in the tool: it has
  // none here either.
  it("leaves out a technology no interface uses", () => {
    const m = model({
      flowTypes: [
        ...model().flowTypes,
        base.flowType({ type: "Kafka", direction: "provider-to-consumer", rawDirection: "provider \u2192 consumer" }),
      ],
    });
    expect(modelToStructurizr(m, null, "carto.xlsx")).not.toContain("tech-kafka");
  });
});

// --- The diagrams' rule holds for the C4 model: the relationship goes from
// provider to consumer, like the data. It used to follow the CALL's direction,
// so that an HTTP flow came out the wrong way round from our images -- the same
// estate told two stories depending on where it was read.
//
// The initiative is not lost: a C4 relationship has only one direction, so it
// goes into a tag.
describe("modelToStructurizr — the relationship's direction", () => {
  const estate = (direction: "provider-to-consumer" | "consumer-to-provider") =>
    model({
      actors: [actor({ name: "Fournisseur" }), actor({ name: "Appelant" })],
      flowTypes: [base.flowType({ direction, rawDirection: "" })],
      interfaces: [iface({ providerName: "Fournisseur" })],
      consumptions: [consumption({ consumerName: "Appelant" })],
    });

  // The identifiers are made by identifiers(): they are resolved from the
  // declaration lines rather than their shape being assumed.
  const identifiantDe = (dsl: string, name: string) =>
    dsl.split("\n").find((l) => l.includes(`"${name}"`) && l.includes(" = "))!.trim().split(" = ")[0];
  const relation = (dsl: string) => dsl.split("\n").find((l) => l.includes(" -> "))!.trim();

  it("goes from provider to consumer, even when the consumer calls", () => {
    for (const direction of ["provider-to-consumer", "consumer-to-provider"] as const) {
      const dsl = modelToStructurizr(estate(direction), null, "c.xlsx");
      const [de, vers] = relation(dsl).split(" -> ");
      expect(de).toBe(identifiantDe(dsl, "Fournisseur"));
      expect(vers.split(" ")[0]).toBe(identifiantDe(dsl, "Appelant"));
    }
  });

  it("tags the relationship the consumer initiates", () => {
    expect(modelToStructurizr(estate("consumer-to-provider"), null, "c.xlsx")).toContain('"Pulled"');
    expect(modelToStructurizr(estate("provider-to-consumer"), null, "c.xlsx")).not.toContain('"Pulled"');
  });
});

// --- QA: the perimeter was compared by strict equality here, and up to
// normalisation in the diagrams. A group entered as "platform" was therefore a
// platform on screen and was no longer one in the C4 file: the dedicated view
// vanished without a word.
describe("modelToStructurizr — a perimeter spelled differently", () => {
  const estate = (perimeter: string) =>
    model({ groups: [{ name: "Socle", perimeter, sheet: "Groups", row: 0 }] });

  it("recognises the platform whatever the case", () => {
    for (const v of ["Platform", "platform", "PLATFORM"]) {
      expect(modelToStructurizr(estate(v), null, "c.xlsx")).toContain('"platform-only"');
    }
  });

  // Declaring the view is not enough: it filters on "element.tag==Platform", and
  // the tag copied the workbook's spelling. The view therefore existed, and
  // sortait vide.
  it("tags the actors in the spelling the view filters on", () => {
    for (const v of ["platform", "PLATFORM"]) {
      const dsl = modelToStructurizr(estate(v), null, "c.xlsx");
      expect(dsl).toContain('"Platform"');
      expect(dsl).not.toContain(`"${v}"`);
    }
  });

  it("does not build the view when no group is a platform", () => {
    expect(modelToStructurizr(estate("External"), null, "c.xlsx")).not.toContain('"platform-only"');
  });
});

// --- §2.12: 21 views with no title. Opened in Structurizr, the file presented
// a list of technical keys -- "tech-rest-esb" -- that nobody can read.
//
describe("modelToStructurizr — the views carry a title", () => {
  it("writes `title` INSIDE the view's block, not as a second argument", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx", "v2");
    expect(dsl).toMatch(/systemLandscape "landscape" \{\s*\n\s*title "System landscape — milestone v2"/);
  });

  it("titles each technology view with the technology's name", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).toContain('title "HTTP flows"');
  });

  // With no milestone displayed, no mention: "milestone null" would be worse than
  // rien.
  it("mentions the milestone only when there is one", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).not.toContain("milestone");
  });
});

describe("modelToStructurizr — the notation makes it into the file", () => {
  it("styles the platform, and not only the external side", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).toMatch(/element "Platform" \{\s*\n\s*background/);
  });

  // With no style, the "Pulled" tag changed nothing in the target tool: our
  // arrowhead convention was invisible there.
  // The default ground is PULLED (HTTP, "consumer → provider").
  it("gives the Pulled tag a style when a flow is pulled", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).toMatch(/relationship "Pulled" \{\s*\n\s*style dashed/);
  });

  it("does not style Pulled when no flow is", () => {
    const pushed = model({ flowTypes: [base.flowType({ type: "HTTP", direction: "provider-to-consumer" })] });
    expect(modelToStructurizr(pushed, null, "carto.xlsx")).not.toContain('relationship "Pulled"');
  });

  it("gives a shape to the actor types it recognises, and leaves the others as boxes", () => {
    const estate = model({
      actorTypes: [
        { type: "Queue", icon: "", nature: "", sheet: "ActorTypes", row: 0 },
        { type: "Chose", icon: "", nature: "", sheet: "ActorTypes", row: 0 },
      ],
    });
    const dsl = modelToStructurizr(estate, null, "carto.xlsx");
    expect(dsl).toMatch(/element "Queue" \{\s*\n\s*shape Pipe/);
    expect(dsl).not.toContain('element "Chose"');
  });

  it("declares the hierarchical identifiers at the head of the model", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).toContain("!identifiers hierarchical");
  });
});

// --- Both DSLs were closed in the functional reading, on the grounds that a
// functional diagram is not a C4 architecture. Yet a system rendering a service
// to another is a systemLandscape's central use case. What is forbidden is a
// file that tells something other than the screen.
describe("modelToStructurizr — the functional reading", () => {
  it("announces the reading in the workspace's name and description", () => {
    const dsl = modelToStructurizr(model(), null, "carto.xlsx", null, "functional");
    expect(dsl).toContain("(functional reading)");
    expect(dsl).toContain("chains folded, media removed");
  });

  it("does not announce it in the architecture reading", () => {
    expect(modelToStructurizr(model(), null, "carto.xlsx")).not.toContain("functional reading");
  });
});
