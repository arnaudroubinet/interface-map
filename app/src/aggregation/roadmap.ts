import type { ParsedModel, Milestone, Validity } from "../parsing/model";
import { interfaceLabel } from "./core";
import { lifespanOf } from "./milestones";

// L'axe des paliers était une liste déroulante : on ne voyait jamais le temps.
// La frise le montre d'un coup -- une ligne par sujet, un segment de son
// arrivée à son retrait. C'est un diagramme d'obsolescence, et tout ce qu'il
// faut est déjà dans le classeur.
export type SujetDeFrise = "actors" | "interfaces";

export interface SegmentFrise {
  label: string;
  // Le groupe ou le fournisseur, selon le sujet : de quoi ranger les lignes
  // autrement que par ordre alphabétique.
  grouping: string;
  // En RANGS de palier, pas en dates : c'est le rang qui ordonne l'axe.
  start: number;
  end: number;
  // Une ligne sans palier de retrait court jusqu'au bout. Il faut le DESSINER
  // comme tel -- l'arrêter au dernier palier connu dirait qu'elle y meurt.
  ouvertADroite: boolean;
  ouvertAGauche: boolean;
}

export interface Frise {
  milestones: Milestone[];
  segments: SegmentFrise[];
}

function segment(
  label: string,
  grouping: string,
  validite: Validity,
  model: ParsedModel,
  bounds: { min: number; max: number }
): SegmentFrise {
  const interval = lifespanOf(model, validite);
  return {
    label,
    grouping,
    start: Number.isFinite(interval.start) ? interval.start : bounds.min,
    end: Number.isFinite(interval.end) ? interval.end : bounds.max + 1,
    ouvertADroite: !Number.isFinite(interval.end),
    ouvertAGauche: !Number.isFinite(interval.start),
  };
}

export function buildRoadmap(model: ParsedModel, what: SujetDeFrise): Frise {
  const milestones = [...model.milestones].sort((a, b) => a.rank - b.rank);
  if (milestones.length === 0) return { milestones, segments: [] };
  const bounds = { min: milestones[0].rank, max: milestones[milestones.length - 1].rank };

  const segments =
    what === "actors"
      ? model.actors.map((a) => segment(a.name.trim(), a.group.trim(), a, model, bounds))
      : model.interfaces.map((i) =>
          segment(interfaceLabel(i.flowName, i.version), i.providerName.trim(), i, model, bounds)
        );

  // Rangé par rattachement puis par arrivée : les lignes d'un même fournisseur
  // se lisent ensemble, et une migration datée -- deux versions qui se
  // succèdent -- se lit comme un escalier plutôt qu'en cherchant ses marches.
  return {
    milestones,
    segments: segments.sort(
      (a, b) =>
        a.grouping.localeCompare(b.grouping, "fr") ||
        a.start - b.start ||
        a.label.localeCompare(b.label, "fr")
    ),
  };
}
