import type { ParsedModel } from "../parsing/model";
import { type GraphNode, type GraphEdge, type Mode } from "./core";
import { reading as lectureDuMode } from "./reading";
import {
  buildGroupToGroupView,
  buildPlatformDetailView,
  buildPlatformOnlyView,
  buildByTechnologyView,
  buildByActorView,
} from "./views";

export interface Planche {
  title: string;
  // An actor's board is what the draw.io file's links point at. Its title now
  // carries a qualifier and can no longer be read as an actor name: this field,
  // and this field alone, says which actor it details.
  actor?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Every board the tool can draw, at a given milestone. Three views read as
// they are; the other two have a selector, and are therefore worth as many
// boards as there are choices in it.
//
// A choice with no flow is dropped: its board would show a lone box or nothing
// at all, and the integrity report already reports both the actor with no flow
// and the unused flow type.
export function toutesLesPlanches(model: ParsedModel, rank: number | null, mode: Mode): Planche[] {
  const reading = lectureDuMode(model, rank, mode);
  const options = { counters: true };
  const boards: Planche[] = [
    { title: "Group to group", ...buildGroupToGroupView(model, reading, options) },
    { title: "Platform detail", ...buildPlatformDetailView(model, reading, options) },
    { title: "Platform only", ...buildPlatformOnlyView(model, reading, options) },
  ];

  const byName = (a: string, b: string) => a.localeCompare(b, "fr");

  // No board per technology in the functional reading: there is no technology
  // left. And no board for an actor that is not on the map.
  const technologies = mode === "functional" ? [] : [...new Set(reading.flows.map((f) => f.flowType.trim()))].sort(byName);
  // Nothing stops an actor from bearing a flow type's name: two "HTTP" tabs
  // side by side in draw.io, indistinguishable. The qualifier is written in
  // the application's own words ("By technology", "By actor"), and is put as a
  // suffix so the name stays at the head of the tab -- that is what the eye
  // looks for, and the tab bar truncates from the end.
  for (const techno of technologies) {
    boards.push({ title: `${techno} (technology)`, ...buildByTechnologyView(model, reading.flows, techno, options) });
  }

  const touched = new Set(reading.flows.flatMap((f) => [f.provider.trim(), f.consumer.trim()]));
  // A business actor left isolated in the functional reading (§5.2) is on no
  // flow, but the draw.io file promises EVERY board: its lone box is still a
  // board, and omitting it would break that promise silently. `reading.actors`
  // already carries the rank -- a retired actor is gone from it, hence no board.
  const isolated = mode === "functional" ? reading.actors.map((a) => a.name.trim()).filter((n) => !touched.has(n)) : [];
  const actors = [...touched, ...isolated].sort(byName);
  for (const actor of actors) {
    boards.push({ title: `${actor} (actor)`, actor, ...buildByActorView(model, reading.flows, actor, {}) });
  }

  return boards;
}
