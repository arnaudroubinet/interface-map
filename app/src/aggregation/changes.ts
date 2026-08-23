import type { ParsedModel, Validity } from "../parsing/model";
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

// One side of a comparison. The model used to be implicit -- a single one,
// looked at through two ranks -- so the only question this module could answer
// was "what changed between v1 and v2 of this file". Making it a parameter
// answers the other one, asked at least as often: "what changed since January's
// version of the referential".
export interface Snapshot {
  model: ParsedModel;
  // `null` reads the file WHOLE, with no milestone filter. That is what one
  // wants when comparing two workbooks: their milestone names have no reason to
  // match, and picking one on either side would state an equivalence nobody
  // entered.
  rank: number | null;
}

function isLive(model: ParsedModel, row: Validity, rank: number | null): boolean {
  return rank === null || isLiveAt(lifespanOf(model, row), rank);
}

function difference(before: Set<string>, after: Set<string>): Difference {
  const byName = (a: string, b: string) => a.localeCompare(b, "fr");
  return {
    ajoutes: [...after].filter((x) => !before.has(x)).sort(byName),
    retires: [...before].filter((x) => !after.has(x)).sort(byName),
  };
}

function liveActors({ model, rank }: Snapshot): Set<string> {
  return new Set(
    model.actors.filter((a) => isLive(model, a, rank)).map((a) => a.name.trim())
  );
}

function liveInterfaces({ model, rank }: Snapshot): Set<string> {
  return new Set(
    model.interfaces
      .filter((i) => isLive(model, i, rank))
      .map((i) => interfaceLabel(i.flowName, i.version))
  );
}

// A consumption is named by the pair it creates: that is what one reads on the
// diagram, and what speaks in a meeting.
function liveConsumptions({ model, rank }: Snapshot, mode: Mode): Set<string> {
  return new Set(
    flowsForReading(model, rank, mode).map(
      (f) => `${f.consumer} → ${interfaceLabel(f.interfaceName, f.version)}`
    )
  );
}

export function computeChanges(before: Snapshot, after: Snapshot, mode: Mode): Changes {
  return {
    actors: difference(liveActors(before), liveActors(after)),
    interfaces: difference(liveInterfaces(before), liveInterfaces(after)),
    consumptions: difference(liveConsumptions(before, mode), liveConsumptions(after, mode)),
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
export function buildChangesView(a: Snapshot, b: Snapshot, mode: Mode): ViewResult {
  const options = { counters: true };
  // Each side is read through ITS OWN model: on two workbooks the perimeter,
  // the groups and the actor types are the compared file's, not the current
  // one's. The node ids are names, and names are what the two files share.
  const side = (s: Snapshot) =>
    buildPlatformDetailView(s.model, readingOfMode(s.model, s.rank, mode), options);
  const before = side(a);
  const after = side(b);

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
  const inside = kept.filter((n) => n.parent !== undefined);
  if (inside.length < 2) {
    return { nodes: kept.map((n) => ({ ...n, parent: undefined })), edges };
  }
  const boundary = known.find((n) => n.kind === "boundary");
  return { nodes: boundary ? [boundary, ...kept] : kept, edges };
}
