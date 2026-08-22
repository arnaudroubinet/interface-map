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
  // La planche d'un acteur est ce que visent les liens du fichier draw.io.
  // Son titre porte désormais une mention et ne se laisse plus lire comme un
  // nom d'acteur : c'est ce champ, et lui seul, qui dit lequel elle détaille.
  actor?: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

// Toutes les planches que l'outil sait dessiner, à un palier donné. Trois vues
// se lisent telles quelles ; les deux autres ont un sélecteur, et valent donc
// autant de planches qu'il y a de choix dedans.
//
// Un choix sans flux est écarté : sa planche ne montrerait qu'une boîte seule
// ou rien du tout, et le rapport d'intégrité signale déjà l'acteur sans flux
// comme le type de flux inutilisé.
export function toutesLesPlanches(model: ParsedModel, rank: number | null, mode: Mode): Planche[] {
  const reading = lectureDuMode(model, rank, mode);
  const options = { counters: true };
  const boards: Planche[] = [
    { title: "Group to group", ...buildGroupToGroupView(model, reading, options) },
    { title: "Platform detail", ...buildPlatformDetailView(model, reading, options) },
    { title: "Platform only", ...buildPlatformOnlyView(model, reading, options) },
  ];

  const byName = (a: string, b: string) => a.localeCompare(b, "fr");

  // Pas de planche par technologie en fonctionnel : il n'y a plus de
  // technologie. Et pas de planche pour un acteur qui n'est pas sur la carte.
  const technologies = mode === "functional" ? [] : [...new Set(reading.flows.map((f) => f.flowType.trim()))].sort(byName);
  // Rien n'empêche un acteur de porter le nom d'un type de flux : deux onglets
  // « HTTP » côte à côte dans draw.io, indiscernables. La mention se lit dans
  // les mots de l'application elle-même (« By technology », « By actor »), et
  // se met en suffixe pour que le nom reste en tête d'onglet -- c'est lui qu'on
  // cherche du regard, et la barre d'onglets tronque par la fin.
  for (const techno of technologies) {
    boards.push({ title: `${techno} (technology)`, ...buildByTechnologyView(model, reading.flows, techno, options) });
  }

  const touched = new Set(reading.flows.flatMap((f) => [f.provider.trim(), f.consumer.trim()]));
  // Un acteur métier devenu isolé en fonctionnel (§5.2) n'est sur aucun flux,
  // mais le fichier draw.io promet TOUTES les planches : sa boîte seule reste
  // une planche, l'omettre romprait cette promesse sans le dire. `lecture.acteurs`
  // porte déjà le rang -- un acteur retiré n'y est plus, donc pas de planche.
  const isolated = mode === "functional" ? reading.actors.map((a) => a.name.trim()).filter((n) => !touched.has(n)) : [];
  const actors = [...touched, ...isolated].sort(byName);
  for (const actor of actors) {
    boards.push({ title: `${actor} (actor)`, actor, ...buildByActorView(model, reading.flows, actor, {}) });
  }

  return boards;
}
