import { describe, it, expect } from "vitest";
import { parseWorkbook } from "../src/parsing/workbook";
import { buildModel } from "../src/parsing/build-model";
import { runIntegrityChecks } from "../src/integrity/checks";
import { buildGroupToGroupView, buildPlatformDetailView } from "../src/aggregation/views";
import { reading, chainesCoupees } from "../src/aggregation/reading";
import { isTechnicalActor } from "../src/aggregation/nature";
import { actorIsPlatform } from "../src/aggregation/core";
import { writeTemplate } from "../src/export/template-export";
import { SAMPLE_DATA } from "../src/export/sample-data";

// The sample workbook, written by the tool then reread by it: this is the only
// test that runs the whole chain end to end. It used to be about a real
// workbook kept in the repository; that one left along with the company's data,
// and the embedded sample replaces it. The field's untidiness is lost -- accents,
// hand-named sheets, spare columns -- and nothing here makes up for it.
//
describe("the full chain on the sample workbook", () => {
  it("parses end to end without throwing and yields plausible counts", async () => {
    const workbook = parseWorkbook(writeTemplate(SAMPLE_DATA));
    const built = buildModel(workbook);

    expect(built.ok).toBe(true);
    if (!built.ok) return;

    expect(built.model.actors.length).toBeGreaterThan(0);
    expect(built.model.interfaces.length).toBeGreaterThan(0);
    expect(built.model.consumptions.length).toBeGreaterThan(0);
    // FX_Modèle must not be picked up as a real consumption tab.
    expect(built.model.fxSheetNames).not.toContain("FX_Modèle");

    const report = runIntegrityChecks(built.model);
    expect(report.families).toHaveLength(5);
    // 10, not 11: the sample workbook's five groups (Core, Sales network,
    // Health partners, Institutional, Support) are all clearly distinct, so
    // the near-duplicate-groups block has nothing to report and is left out.
    expect(report.infoBlocks).toHaveLength(10);
    // The identifiers, not merely the count: a block disappearing at the same time
    // as another arrives would leave the count intact.
    expect(new Set(report.infoBlocks.map((b) => b.id)).size).toBe(report.infoBlocks.length);
    // The sample is built to trigger no anomaly (see sample-data.ts's comment): a
    // column shift in the sample, the template or the model turns this line red at
    // once.
    expect(report.totalAnomalies).toBe(0);

    const view = buildGroupToGroupView(
      built.model,
      reading(built.model, null, "architecture"),
      { counters: true }
    );
    expect(view.nodes.length).toBeGreaterThan(0);
    expect(view.edges.length).toBeGreaterThan(0);
  });
});

// --- QA: the shipped sample carried neither nature nor relay, so both modes
// returned exactly the same drawing. It could therefore neither show the
// business reading to a newcomer, nor protect the walk from a regression -- and
// nothing said so, everything was green.
describe("the sample workbook exercises the business reading", () => {
  const template = () => {
    const built = buildModel(parseWorkbook(writeTemplate(SAMPLE_DATA)));
    if (!built.ok) throw new Error("exemple illisible");
    return built.model;
  };

  it("declares at least one technical actor and makes it disappear in the functional reading", () => {
    const m = template();
    const archi = reading(m, null, "architecture").actors.length;
    const business = reading(m, null, "functional").actors.length;
    expect(business).toBeLessThan(archi);
  });

  it("joins a chain up: two business actors only the functional mode links", () => {
    const m = template();
    const paires = (mode: "architecture" | "functional") =>
      new Set(reading(m, null, mode).flows.map((f) => `${f.provider} → ${f.consumer}`));
    const archi = paires("architecture");
    const nouvelles = [...paires("functional")].filter((p) => !archi.has(p));
    expect(nouvelles.length).toBeGreaterThan(0);
  });

  it("breaks no chain", () => {
    expect(chainesCoupees(template(), null)).toHaveLength(0);
  });
});

// --- A chain with THREE successive relays, one of them off-platform.
// Single-hop cases prove little: the walk-up recurses, and it is over several
// hops that it can stop too early, get lost, or cross the platform boundary
// without saying so.
describe("the sample workbook carries a three-relay chain", () => {
  const template = () => {
    const built = buildModel(parseWorkbook(writeTemplate(SAMPLE_DATA)));
    if (!built.ok) throw new Error("exemple illisible");
    return built.model;
  };

  it("declares the three technical relays, two on the platform and one outside", () => {
    const m = template();
    const legacyRelays = ["Kafka", "Dagobah", "ESB"].map((name) => m.actors.find((a) => a.name === name)!);
    expect(legacyRelays.every((a) => isTechnicalActor(m, a.name))).toBe(true);
    expect(legacyRelays.filter((a) => actorIsPlatform(m, a)).map((a) => a.name)).toEqual(["Kafka", "Dagobah"]);
  });

  it("draws the four segments in the architecture reading", () => {
    const segments = reading(template(), null, "architecture")
      .flows.filter((f) => f.interfaceName === "Policy notice" || f.interfaceName.startsWith("notice."))
      .map((f) => `${f.provider}→${f.consumer}`);
    expect(segments).toEqual(["Chandrila→Kafka", "Kafka→Dagobah", "Dagobah→ESB", "ESB→Bracca"]);
  });

  // The same relay serves two chains that are not alike: one leaves the perimeter
  // through two more relays, the other stops at the first and stays internal.
  // Nothing in the bus's interface row tells them apart -- it is the consumption
  // row that says so, one per input.
  it("makes the same relay serve two chains without conflating them", () => {
    const m = template();
    const business = reading(m, null, "functional").flows;
    const target = (name: string) =>
      business.filter((f) => f.provider === "Chandrila" && f.consumer === name).map((f) => f.interfaceName);

    // outwards, through three relays
    expect(target("Bracca")).toContain("Policy notice");
    expect(actorIsPlatform(m, m.actors.find((a) => a.name === "Bracca")!)).toBe(false);

    // and towards the platform, through Kafka alone
    expect(target("Takodana")).toEqual(["Policy events"]);
    expect(actorIsPlatform(m, m.actors.find((a) => a.name === "Takodana")!)).toBe(true);
  });

  it("joins them into a single business link, the three relays removed", () => {
    const m = template();
    const business = reading(m, null, "functional");
    expect(business.actors.map((a) => a.name)).not.toContain("Dagobah");
    expect(
      business.flows.filter((f) => f.provider === "Chandrila" && f.consumer === "Bracca" && f.interfaceName === "Policy notice")
    ).toHaveLength(1);
  });
});

// --- The line follows the DATA, from provider to consumer, whatever the
// technology. The chain therefore reads as a pipe even when a hop is pulled:
// the third segment is over HTTP, and its head -- set at its start -- says it
// is the bus that queries the gateway.
describe("the three-relay chain reads in a single direction", () => {
  it("chains the four segments end to end", () => {
    const built = buildModel(parseWorkbook(writeTemplate(SAMPLE_DATA)));
    if (!built.ok) throw new Error("exemple illisible");
    const m = built.model;
    const view = buildPlatformDetailView(m, reading(m, null, "architecture"), { counters: true });

    // "Support" is the group carrying the ESB: off-platform, it is drawn folded
    // onto its group.
    const chaining: [string, string][] = [
      ["Chandrila", "Kafka"],
      ["Kafka", "Dagobah"],
      ["Dagobah", "Support"],
      ["Support", "Sales network"],
    ];
    for (const [de, vers] of chaining) {
      expect(view.edges.some((e) => e.from === de && e.to === vers)).toBe(true);
    }
  });
});
