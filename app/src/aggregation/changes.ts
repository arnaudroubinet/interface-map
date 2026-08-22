import type { ParsedModel } from "../parsing/model";
import { interfaceLabel, type GraphEdge, type Mode } from "./core";
import { flowsForReading, reading as readingOfMode } from "./reading";
import { buildPlatformDetailView, type ViewResult } from "./views";
import { lifespanOf, isLiveAt } from "./milestones";

// The change between two milestones, entirely COMPUTED: none of this is
// entered anywhere, so nothing can contradict anything. It is the difference
// between two snapshots the workbook already knows how to produce.
export interface Changes {
  actors: Difference;
  interfaces: Difference;
  consumptions: Difference;
}

export interface Difference {
  ajoutes: string[];
  retires: string[];
}

function difference(before: Set<string>, after: Set<string>): Difference {
  const byName = (a: string, b: string) => a.localeCompare(b, "fr");
  return {
    ajoutes: [...after].filter((x) => !before.has(x)).sort(byName),
    retires: [...before].filter((x) => !after.has(x)).sort(byName),
  };
}

function liveActors(model: ParsedModel, rank: number): Set<string> {
  return new Set(
    model.actors.filter((a) => isLiveAt(lifespanOf(model, a), rank)).map((a) => a.name.trim())
  );
}

function liveInterfaces(model: ParsedModel, rank: number): Set<string> {
  return new Set(
    model.interfaces
      .filter((i) => isLiveAt(lifespanOf(model, i), rank))
      .map((i) => interfaceLabel(i.flowName, i.version))
  );
}

// A consumption is named by the pair it creates: that is what one reads on the
// diagram, and what speaks in a meeting.
function liveConsumptions(model: ParsedModel, rank: number, mode: Mode): Set<string> {
  return new Set(
    flowsForReading(model, rank, mode).map(
      (f) => `${f.consumer} → ${interfaceLabel(f.interfaceName, f.version)}`
    )
  );
}

export function computeChanges(model: ParsedModel, rankBefore: number, rankAfter: number, mode: Mode): Changes {
  return {
    actors: difference(liveActors(model, rankBefore), liveActors(model, rankAfter)),
    interfaces: difference(liveInterfaces(model, rankBefore), liveInterfaces(model, rankAfter)),
    consumptions: difference(liveConsumptions(model, rankBefore, mode), liveConsumptions(model, rankAfter, mode)),
  };
}

// The change diagram: the landscape of the arrival milestone, plus what has
// just left it. A line present on both sides is drawn normally; the others
// carry their mark, and the rendering tells them apart.
//
// Built on "platform detail", with no grain selector: one wants to know WHICH
// component gained or lost a flow, not merely which group, while keeping the
// outside folded. One more selector on a comparison view would make it heavier
// to read than it is worth.
export function buildEcartsView(model: ParsedModel, rankBefore: number, rankAfter: number, mode: Mode): ViewResult {
  const options = { counters: true };
  const before = buildPlatformDetailView(model, readingOfMode(model, rankBefore, mode), options);
  const after = buildPlatformDetailView(model, readingOfMode(model, rankAfter, mode), options);

  // A link carries the DELTA of its volume, not the volume: what changed is
  // the subject. Without this, a link going from six flows to four stayed an
  // ordinary line, and the one case the diagram existed to make visible was
  // not.
  const key = (e: GraphEdge) => JSON.stringify([e.from, e.to, e.technology]);
  const byKey = (r: ViewResult) => new Map(r.edges.map((e) => [key(e), e]));
  const beforeByKey = byKey(before);
  const afterByKey = byKey(after);

  const edges: GraphEdge[] = [];
  for (const k of new Set([...afterByKey.keys(), ...beforeByKey.keys()])) {
    const a = beforeByKey.get(k);
    const b = afterByKey.get(k);
    const delta = (b?.count ?? 0) - (a?.count ?? 0);
    // The link is drawn as it stands at arrival when it survives there,
    // otherwise as it was: either way a line is needed to colour.
    const base = b ?? a!;
    // An unchanged link has no place here: the diagram shows ONLY the change.
    // Mixing the scenery in with the few lines that carry information would drown them.
    if (delta === 0) continue;
    edges.push({
      ...base,
      change: delta > 0 ? "added" : "removed",
      // The sign and the number alone: the technology shows itself on the
      // sub-label, since the label does not name it (subLabel).
      label: `${delta > 0 ? "+" : "−"}${Math.abs(delta)}`,
    });
  }

  // Only the nodes the remaining lines touch, taken from both sides -- a
  // removed link needs boxes that may no longer exist afterwards.
  const known = [...after.nodes, ...before.nodes].filter(
    (n, i, all) => all.findIndex((other) => other.id === n.id) === i
  );
  const required = new Set(edges.flatMap((e) => [e.from, e.to]));
  const kept = known.filter((n) => required.has(n.id));

  // The platform boundary is a PARENT node: no line touches it, so pruning
  // would carry it off and leave its children pointing at a container that no
  // longer exists. It is restored when it still holds enough to frame, and the
  // parent link is cut otherwise -- the same rule as elsewhere: under two
  // components, a frame adds nothing.
  const dedans = kept.filter((n) => n.parent !== undefined);
  if (dedans.length < 2) {
    return { nodes: kept.map((n) => ({ ...n, parent: undefined })), edges };
  }
  const boundary = known.find((n) => n.kind === "boundary");
  return { nodes: boundary ? [boundary, ...kept] : kept, edges };
}
