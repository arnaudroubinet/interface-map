import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { buildFlowInstances, groupFlows, identityNodeKey } from "./core";
import { allBoards } from "./boards";
import { computeLayout } from "../layout/graph-layout";
import { buildDrawio } from "../export/drawio-export";
import {
  buildGroupToGroupView,
  buildPlatformDetailView,
  buildPlatformOnlyView,
  buildByTechnologyView,
  buildByActorView,
  buildMatrixView,
  matrixFilterOptions,
  actorFilterOptions,
} from "./views";
import { flowsForReading, reading as readingOfMode } from "./reading";
import type { Mode } from "./core";
import { SCHEMA_VERSION } from "../parsing/build-model";
import type { ParsedModel, Actor, InterfaceCatalogue, Consumption } from "../parsing/model";

// The shared factories; this file adds nothing to them but its two groups and
// a consumption already decided.
function actor(o: Partial<Actor> = {}): Actor {
  return base.actor({ group: "G1", ...o });
}
const iface = base.iface;
function consumption(o: Partial<Consumption> = {}): Consumption {
  return base.consumption({ legacyStatus: "Actif", decision: "Keep", ...o });
}

const baseModel: ParsedModel = base.template({
  actors: [actor({ name: "A", group: "G1" }), actor({ name: "B", group: "G2" })],
  groups: [base.group({ name: "G1" }), base.group({ name: "G2", perimeter: "External" })],
  actorTypes: [base.actorType()],
  flowTypes: [base.flowType()],
  interfaces: [iface()],
  consumptions: [consumption()],
  fxSheetNames: ["FX_A_HTTP"],
});


// Two actors in the Platform group: that is what makes the difference between
// the matrix's three grains visible.
const modelTwoPerGroup: ParsedModel = {
  ...baseModel,
  actors: [actor({ name: "A", group: "G1" }), actor({ name: "A2", group: "G1" }), actor({ name: "B", group: "G2" })],
  interfaces: [iface({}), iface({ flowName: "F2", providerName: "A2", expectedSheet: "FX_A2_HTTP" })],
  consumptions: [consumption({}), consumption({ flowName: "F2", sheet: "FX_A2_HTTP" })],
  fxSheetNames: ["FX_A_HTTP", "FX_A2_HTTP"],
};

// Flows resolved once per test, as at the real entry point (app.ts): this file
// must not reinvent its own way of going from model to flows.
function flows(model: ParsedModel, mode: Mode = "architecture"): ReturnType<typeof flowsForReading> {
  return flowsForReading(model, null, mode);
}

// The Reading (flows + actors) the views that can draw an isolated actor now
// receive. `rank` defaults to `null`: most of the tests here are not about the
// milestone axis.
function read(model: ParsedModel, mode: Mode = "architecture", rank: number | null = null): ReturnType<typeof readingOfMode> {
  return readingOfMode(model, rank, mode);
}

describe("buildGroupToGroupView", () => {
  it("keys nodes by groupe", () => {
    const view = buildGroupToGroupView(baseModel, read(baseModel), { counters: true });
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["G1", "G2"]);
    expect(view.edges).toHaveLength(1);
  });
});

describe("buildPlatformDetailView", () => {
  it("gives a plateforme actor its own node, keeps external actors grouped", () => {
    const view = buildPlatformDetailView(baseModel, read(baseModel), { counters: true });
    expect(view.nodes.find((n) => n.id === "A")?.kind).toBe("platform");
    expect(view.nodes.find((n) => n.id === "G2")).toBeDefined();
  });

  // The title promised tolerance to case and accents, but the model built here
  // wrote "Platform" identically: the test still passed with groupIsPlatform's
  // normalisation removed. So the perimeter is written differently, and so is
  // the group's name -- it resolves through the same route.
  it("recognizes the platform perimeter regardless of case or accents", () => {
    const model: ParsedModel = {
      ...baseModel,
      groups: [
        { name: "g1", perimeter: "PLATFÔRM", sheet: "Groups", row: 0 },
        { name: "G2", perimeter: "External", sheet: "Groups", row: 0 },
      ],
    };
    const view = buildPlatformDetailView(model, read(model), { counters: true });
    expect(view.nodes.find((n) => n.id === "A")?.kind).toBe("platform");
  });
});

describe("buildByTechnologyView", () => {
  it("keeps only flows of the selected technology, keyed by actor", () => {
    const view = buildByTechnologyView(baseModel, flows(baseModel), "HTTP", { counters: true });
    expect(view.nodes.map((n) => n.id).sort()).toEqual(["A", "B"]);
  });

  it("returns no edges for an unused technology", () => {
    const view = buildByTechnologyView(baseModel, flows(baseModel), "Kafka", { counters: true });
    expect(view.edges).toHaveLength(0);
  });
});

describe("buildByActorView", () => {
  it("includes the selected actor and its one-hop neighbours, without dedup", () => {
    const view = buildByActorView(baseModel, flows(baseModel), "A", {});
    expect(view.nodes.find((n) => n.id === "A")?.kind).toBe("focus-actor");
    expect(view.nodes.find((n) => n.id === "B")?.kind).toBe("actor");
    expect(view.edges[0].label).toBe("F");
  });

  it("keeps self-loops visible", () => {
    const model = { ...baseModel, consumptions: [consumption({ consumerName: "A" })] };
    const view = buildByActorView(model, flows(model), "A", {});
    expect(view.edges).toHaveLength(1);
  });
});

describe("buildMatrixView", () => {
  // The matrix says "who feeds whom", like the diagrams and like the functional
  // mode: the row is the PROVIDER, whatever the technology. It used to carry the
  // call's direction, so that an HTTP flow appeared there the wrong way round
  // from a Kafka flow between the same two actors.
  it("keeps a row only for what provides and a column only for what consumes", () => {
    const matrix = buildMatrixView(baseModel, read(baseModel), { mode: "architecture" });
    expect(matrix.rows.map((l) => l.actor)).toEqual(["A"]);
    expect(matrix.columns).toEqual(["B"]);
    expect(matrix.rows[0].cells.get("B")).toEqual([{ technology: "HTTP", count: 1, attenuated: false, names: ["F"] }]);
  });

  it("judges each axis on its own: what both emits and receives keeps a row and a column", () => {
    const model: ParsedModel = {
      ...modelTwoPerGroup,
      // A publishes F (hence receives from B) and consumes F2 (hence sends to B).
      interfaces: [iface({}), iface({ flowName: "F2", providerName: "B", expectedSheet: "FX_A2_HTTP" })],
      consumptions: [consumption({}), consumption({ flowName: "F2", sheet: "FX_A2_HTTP", consumerName: "A" })],
    };
    const matrix = buildMatrixView(model, read(model), { mode: "architecture" });
    expect(matrix.rows.map((l) => l.actor)).toEqual(["A", "B"]);
    expect(matrix.columns).toEqual(["A", "B"]);
  });

  it("keeps self-loop cells (unlike graphical views)", () => {
    const model = { ...baseModel, consumptions: [consumption({ consumerName: "A" })] };
    const matrix = buildMatrixView(model, read(model), { mode: "architecture" });
    const rowA = matrix.rows.find((l) => l.actor === "A")!;
    expect(rowA.cells.get("A")).toBeDefined();
  });

  it("collapses actors onto their group when the grain is 'group'", () => {
    const matrix = buildMatrixView(modelTwoPerGroup, read(modelTwoPerGroup), { mode: "architecture", grain: "group" });
    expect(matrix.rows.map((l) => l.actor)).toEqual(["G1"]);
    expect(matrix.columns).toEqual(["G2"]);
    const rowG1 = matrix.rows.find((l) => l.actor === "G1")!;
    expect(rowG1.cells.get("G2")).toEqual([{ technology: "HTTP", count: 2, attenuated: false, names: ["F", "F2"] }]);
  });

  it("details platform actors and collapses the rest when the grain is 'platform'", () => {
    const matrix = buildMatrixView(modelTwoPerGroup, read(modelTwoPerGroup), { mode: "architecture", grain: "platform" });
    expect(matrix.rows.map((l) => l.actor)).toEqual(["A", "A2"]);
    expect(matrix.columns).toEqual(["G2"]);
    expect(matrix.rows.find((l) => l.actor === "A")!.cells.get("G2")).toHaveLength(1);
    expect(matrix.rows.find((l) => l.actor === "A2")!.cells.get("G2")).toHaveLength(1);
  });

  it("puts an intra-group flow on the diagonal when the grain is 'group'", () => {
    const model: ParsedModel = {
      ...modelTwoPerGroup,
      consumptions: [consumption({ flowName: "F", consumerName: "A2" })],
    };
    const matrix = buildMatrixView(model, read(model), { mode: "architecture", grain: "group" });
    const rowG1 = matrix.rows.find((l) => l.actor === "G1")!;
    expect(rowG1.cells.get("G1")).toBeDefined();
  });

  it("hides an external group wholesale when the grain is 'group'", () => {
    const matrix = buildMatrixView(modelTwoPerGroup, read(modelTwoPerGroup), {
      mode: "architecture",
      grain: "group",
      masquerExternes: true,
    });
    expect(matrix.columns).toEqual([]);
    expect(matrix.rows).toEqual([]);
  });

  it("masks a whole group by its own name when the grain is 'group'", () => {
    const matrix = buildMatrixView(modelTwoPerGroup, read(modelTwoPerGroup), {
      mode: "architecture",
      grain: "group",
      hiddenActors: ["G1"],
    });
    expect(matrix.columns).toEqual([]);
    expect(matrix.rows).toEqual([]);
  });
});

describe("optionsFiltreMatrice", () => {
  it("lists actors when the grain is 'actor'", () => {
    expect(matrixFilterOptions(modelTwoPerGroup, flows(modelTwoPerGroup), { grain: "actor" })).toEqual(["A", "A2", "B"]);
  });

  it("lists groups when the grain is 'group'", () => {
    expect(matrixFilterOptions(modelTwoPerGroup, flows(modelTwoPerGroup), { grain: "group" })).toEqual(["G1", "G2"]);
  });

  it("drops externe groupes when the switch is on", () => {
    expect(
      matrixFilterOptions(modelTwoPerGroup, flows(modelTwoPerGroup), { grain: "group", masquerExternes: true })
    ).toEqual(["G1"]);
  });
});

describe("buildByActorView — the version in the label", () => {
  const modelVersionne: ParsedModel = {
    ...baseModel,
    interfaces: [iface({ version: "1.0" })],
    consumptions: [consumption({ version: "1.0" })],
  };

  it("names the published contract with its version", () => {
    const view = buildByActorView(modelVersionne, flows(modelVersionne), "A", {});
    expect(view.edges[0].label).toBe("F 1.0");
  });

  // A workbook that does not version must not start showing a spare space after
  // every name.
  it("sticks to the name when the version is empty", () => {
    const view = buildByActorView(baseModel, flows(baseModel), "A", {});
    expect(view.edges[0].label).toBe("F");
  });

  // Matching tolerates case and spaces, but the label shows the CATALOGUE's
  // spelling: it is the published contract that is named, not the way a consumer
  // copied it out.
  it("shows the catalogue's spelling, not the one entered on the consumption side", () => {
    const model: ParsedModel = {
      ...baseModel,
      interfaces: [iface({ version: "V2 " })],
      consumptions: [consumption({ version: "v2" })],
    };
    const view = buildByActorView(model, flows(model), "A", {});
    expect(view.edges[0].label).toBe("F V2");
  });
});

describe("mode fonctionnel", () => {
  // Tatooine publishes Transactions; Bus (Middleware, Technical) relays it as
  // trx.norm towards Naboo: the functional chain links Tatooine to Naboo, with
  // Bus removed.
  function estate(): ParsedModel {
    return {
      actors: [
        actor({ name: "Tatooine", actorType: "Application", group: "Socle" }),
        actor({ name: "Bus", actorType: "Middleware", group: "Socle" }),
        actor({ name: "Naboo", actorType: "Application", group: "Finance" }),
      ],
      groups: [
        { name: "Socle", perimeter: "Platform", sheet: "Groups", row: 0 },
        { name: "Finance", perimeter: "External", sheet: "Groups", row: 0 },
      ],
      groupsSheetMissing: false,
      actorTypes: [
        { type: "Application", icon: "", nature: "Business", sheet: "ActorTypes", row: 0 },
        { type: "Middleware", icon: "", nature: "Technical", sheet: "ActorTypes", row: 0 },
      ],
      milestones: [],
      flowTypes: [
        base.flowType({ type: "HTTP" }),
      ],
      interfaces: [
        iface({ flowName: "Transactions", providerName: "Tatooine", expectedSheet: "FX_Tatooine_HTTP" }),
        iface({ flowName: "trx.norm", providerName: "Bus", expectedSheet: "FX_Bus_HTTP" }),
      ],
      consumptions: [
        consumption({ flowName: "Transactions", consumerName: "Bus", sheet: "FX_Tatooine_HTTP", republishedAs: "trx.norm" }),
        consumption({ flowName: "trx.norm", consumerName: "Naboo", sheet: "FX_Bus_HTTP" }),
      ],
      fxSheetNames: ["FX_Tatooine_HTTP", "FX_Bus_HTTP"],
      missingOptionalColumns: [],
      schemaVersion: SCHEMA_VERSION,
      savedAt: null,
    };
  }

  const options = (mode: Mode) => ({ counters: true, mode });

  it("leaves the architecture mode unchanged", () => {
    const m = estate();
    const view = buildPlatformDetailView(m, read(m, "architecture"), options("architecture"));
    expect(view.nodes.map((n) => n.id)).toContain("Bus");
  });

  it("retire l'acteur technique en mode fonctionnel", () => {
    const m = estate();
    const view = buildPlatformDetailView(m, read(m, "functional"), options("functional"));
    expect(view.nodes.map((n) => n.id)).not.toContain("Bus");
  });

  it("links the source to the consumer in functional mode", () => {
    const m = estate();
    const view = buildPlatformDetailView(m, read(m, "functional"), options("functional"));
    expect(view.edges).toHaveLength(1);
    expect([view.edges[0].from, view.edges[0].to]).toEqual(["Tatooine", "Finance"]);
  });

  // With no technology, two exchanges between the same applications merge into a
  // single line, whatever medium carried them.
  it("merges the lines without telling the technologies apart", () => {
    const m = estate();
    m.interfaces.push(iface({ flowName: "Autre", providerName: "Tatooine", flowType: "Kafka", expectedSheet: "FX_Tatooine_Kafka" }));
    m.consumptions.push(consumption({ flowName: "Autre", consumerName: "Naboo", sheet: "FX_Tatooine_Kafka" }));
    m.flowTypes.push(base.flowType({ type: "Kafka", direction: "provider-to-consumer", rawDirection: "provider → consumer" }));
    m.fxSheetNames.push("FX_Tatooine_Kafka");
    const view = buildPlatformDetailView(m, read(m, "functional"), options("functional"));
    expect(view.edges).toHaveLength(1);
    expect(view.edges[0].count).toBe(2);
  });

  // The matrix is the only view where the cell still shows the technology: in
  // the functional reading it must empty like everywhere else, and the rendering
  // (matrix-table.ts) only makes sense if that field really arrives empty.
  it("empties the technology from the matrix's cells in functional mode", () => {
    const m = estate();
    // Tatooine supplies, the Bus consumes: so the row is the provider's, even over
    // HTTP where it is the Bus that makes the call.
    const architecture = buildMatrixView(m, read(m, "architecture"), { mode: "architecture" });
    const tatooineArchiRow = architecture.rows.find((l) => l.actor === "Tatooine")!;
    expect(tatooineArchiRow.cells.get("Bus")).toEqual([{ technology: "HTTP", count: 1, attenuated: false, names: ["Transactions"] }]);

    const fonctionnel = buildMatrixView(m, read(m, "functional"), { mode: "functional" });
    expect(fonctionnel.rows.map((l) => l.actor)).not.toContain("Bus");
    const tatooineRow = fonctionnel.rows.find((l) => l.actor === "Tatooine")!;
    expect(tatooineRow.cells.get("Naboo")).toEqual([{ technology: "", count: 1, attenuated: false, names: ["Transactions"] }]);
  });

  // An empty technology is not one: offering it as a filter produces an
  // unlabelled checkbox that empties the whole diagram in one click without
  // expliquer.
  it("offers no technology to filter in functional mode", () => {
    const m = estate();
    const options = actorFilterOptions(flows(m, "functional"), "Tatooine");
    expect(options.technologies).toEqual([]);
  });

  // §5.2: a business actor left isolated -- whose exchanges all went through
  // broken chains -- stays displayed, alone. Making it vanish would remove
  // information without saying so.
  describe("an isolated business actor", () => {
    it("stays displayed, through its group, at group to group", () => {
      const m = estate();
      m.actors.push(actor({ name: "Isolé", actorType: "Application", group: "Ops" }));
      m.groups.push({ name: "Ops", perimeter: "External", sheet: "Groups", row: 0 });
      const view = buildGroupToGroupView(m, read(m, "functional"), options("functional"));
      expect(view.nodes.map((n) => n.id)).toContain("Ops");
    });

    it("keeps its own node at platform detail when it is a platform component", () => {
      const m = estate();
      m.actors.push(actor({ name: "Isolé", actorType: "Application", group: "Socle" }));
      const view = buildPlatformDetailView(m, read(m, "functional"), options("functional"));
      const node = view.nodes.find((n) => n.id === "Isolé");
      expect(node?.kind).toBe("platform");
    });

    it("stays displayed at platform only when it is a platform component", () => {
      const m = estate();
      m.actors.push(actor({ name: "Isolé", actorType: "Application", group: "Socle" }));
      const view = buildPlatformOnlyView(m, read(m, "functional"), options("functional"));
      expect(view.nodes.map((n) => n.id)).toContain("Isolé");
    });

    it("keeps an empty row in the matrix", () => {
      const m = estate();
      m.actors.push(actor({ name: "Isolé", actorType: "Application", group: "Ops" }));
      m.groups.push({ name: "Ops", perimeter: "External", sheet: "Groups", row: 0 });
      const matrix = buildMatrixView(m, read(m, "functional"), { mode: "functional" });
      const row = matrix.rows.find((l) => l.actor === "Isolé");
      expect(row).toBeDefined();
      expect(row?.cells.size).toBe(0);
    });

    // An isolated actor retired at the displayed milestone is no longer an
    // isolated business actor: it is no longer on the map AT ALL. §5.2 keeps its
    // box as long as it lives, not beyond.
    describe("retired at a milestone", () => {
      const milestones = [
        { name: "v1", rank: 1, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
        { name: "v2", rank: 2, label: "", status: "Delivered", date: "", description: "", sheet: "Milestones", row: 0 },
      ];
      function withIsolatedRetired(): ParsedModel {
        const m = estate();
        m.milestones = milestones;
        m.actors.push(
          actor({ name: "Isolé", actorType: "Application", group: "Socle", introducedAt: "v1", retiredAt: "v2" })
        );
        return m;
      }

      it("keeps its box at the milestone where it is still alive", () => {
        const m = withIsolatedRetired();
        const view = buildPlatformDetailView(m, read(m, "functional", 1), options("functional"));
        expect(view.nodes.map((n) => n.id)).toContain("Isolé");
      });

      it("loses its box at platform detail at the milestone where it is retired", () => {
        const m = withIsolatedRetired();
        const view = buildPlatformDetailView(m, read(m, "functional", 2), options("functional"));
        expect(view.nodes.map((n) => n.id)).not.toContain("Isolé");
      });

      it("loses its box at platform only at the milestone where it is retired", () => {
        const m = withIsolatedRetired();
        const view = buildPlatformOnlyView(m, read(m, "functional", 2), options("functional"));
        expect(view.nodes.map((n) => n.id)).not.toContain("Isolé");
      });

      it("loses its matrix row at the milestone where it is retired", () => {
        const m = withIsolatedRetired();
        const matrix = buildMatrixView(m, read(m, "functional", 2), { mode: "functional" });
        expect(matrix.rows.map((l) => l.actor)).not.toContain("Isolé");
      });
    });
  });
});

// --- The platform frame carried "Plateforme" in French inside an entirely
// English interface, a leftover from before the translation. No test looked at
// it, hence its survival.
describe("the platform boundary", () => {
  // The frame exists only from two platform components upwards: below that it
  // would add nothing.
  it("carries its name in the interface's language", () => {
    const m: ParsedModel = {
      ...baseModel,
      actors: [actor({ name: "A", group: "G1" }), actor({ name: "C", group: "G1" }), actor({ name: "B", group: "G2" })],
    };
    const view = buildPlatformDetailView(m, read(m), { counters: true });
    expect(view.nodes.find((n) => n.kind === "boundary")?.label).toBe("Platform");
  });
});

// --- QA: the line follows the DATA, from provider to consumer, and the head
// says who calls. buildByActorView builds its edges without going through
// groupFlows: it had kept the old convention and reversed the line on a pulled
// flow. Those boards go into the draw.io file -- so one file told two different
// architectures depending on which tab was open.
// ---------------------------------------------------------------------------
// 1. The line's direction, in the "By actor" view and in the draw.io tabs it
//    produces.
// ---------------------------------------------------------------------------

const pulledEstate = () =>
  base.template({
    actors: [base.actor({ name: "Fournisseur" }), base.actor({ name: "Consommateur" })],
    groups: [base.group({ name: "G" })],
    actorTypes: [base.actorType()],
    // HTTP is pulled: "consumer → provider".
    flowTypes: [base.flowType({ type: "HTTP", direction: "consumer-to-provider" })],
    interfaces: [base.iface({ flowName: "F", providerName: "Fournisseur" })],
    consumptions: [base.consumption({ flowName: "F", consumerName: "Consommateur" })],
  });

describe("the line goes from provider to consumer, everywhere", () => {
  it("the aggregated views and the matrix follow the data", () => {
    const m = pulledEstate();
    const g = groupFlows(buildFlowInstances(m), identityNodeKey, true)[0];
    expect([g.from, g.to, g.pulled]).toEqual(["Fournisseur", "Consommateur", true]);
    const mat = buildMatrixView(m, readingOfMode(m, null, "architecture"), { mode: "architecture" });
    expect(mat.rows.map((l) => l.actor)).toEqual(["Fournisseur"]);
  });

  it("the \"By actor\" view too, although it builds its edges itself", () => {
    const m = pulledEstate();
    const edge = buildByActorView(m, buildFlowInstances(m), "Fournisseur", {}).edges[0];
    expect([edge.from, edge.to, edge.pulled]).toEqual(["Fournisseur", "Consommateur", true]);
  });

  it("every board of one draw.io file tells the same architecture", async () => {
    const m = pulledEstate();
    const placed = [];
    for (const p of allBoards(m, null, "architecture")) {
      placed.push({ title: p.title, actor: p.actor, layout: await computeLayout(p.nodes, p.edges) });
    }
    const xml = buildDrawio(placed, () => "#000");
    const direction = xml
      .split("<diagram ")
      .slice(1)
      .map((page) => {
        const title = /name="([^"]+)"/.exec(page)![1];
        const edge = /<mxCell id="[^"]*_e0"[^>]*source="([^"]*)" target="([^"]*)"/.exec(page);
        return edge ? `${title} : ${edge[1].replace(/^p\d+_/, "")} → ${edge[2].replace(/^p\d+_/, "")}` : null;
      })
      .filter((x): x is string => x !== null);
    expect(direction.every((s) => s.includes("Fournisseur → Consommateur"))).toBe(true);
  });
});

// --- QA: the criticality was lost between the aggregation and the rendering.
// The "weight by criticality" setting was therefore ticked and had no effect --
// a setting that does nothing is worse than an absent one.
describe("the views carry the criticality all the way to the line", () => {
  const estate = () =>
    base.template({
      groups: [{ name: "Socle", perimeter: "Platform", sheet: "Groups", row: 0 }],
      actorTypes: [base.actorType()],
      flowTypes: [base.flowType()],
      fxSheetNames: ["FX_A_HTTP"],
      actors: [base.actor({ name: "A", group: "Socle" }), base.actor({ name: "B", group: "Socle" })],
      interfaces: [base.iface({ flowName: "F", providerName: "A", expectedSheet: "FX_A_HTTP" })],
      consumptions: [
        base.consumption({ flowName: "F", consumerName: "B", sheet: "FX_A_HTTP", criticality: "1 - Critical" }),
      ],
    });

  it("carries it through the aggregated views", () => {
    const m = estate();
    const view = buildPlatformDetailView(m, readingOfMode(m, null, "architecture"), { counters: true });
    expect(view.edges[0].criticality).toBe("1 - Critical");
  });

  // This view builds its edges itself, without going through the aggregation:
  // that is exactly where a new field gets lost.
  it("carries it in the by-actor view too, which builds its edges separately", () => {
    const m = estate();
    const view = buildByActorView(m, readingOfMode(m, null, "architecture").flows, "A", {});
    expect(view.edges[0].criticality).toBe("1 - Critical");
  });
});
