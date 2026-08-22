import type { ParsedModel, Palier, ValiditePalier } from "../parsing/model";
import { libelleInterface } from "./core";
import { intervalleDeVie } from "./paliers";

// L'axe des paliers était une liste déroulante : on ne voyait jamais le temps.
// La frise le montre d'un coup -- une ligne par sujet, un segment de son
// arrivée à son retrait. C'est un diagramme d'obsolescence, et tout ce qu'il
// faut est déjà dans le classeur.
export type SujetDeFrise = "acteurs" | "interfaces";

export interface SegmentFrise {
  libellé: string;
  // Le groupe ou le fournisseur, selon le sujet : de quoi ranger les lignes
  // autrement que par ordre alphabétique.
  rattachement: string;
  // En RANGS de palier, pas en dates : c'est le rang qui ordonne l'axe.
  debut: number;
  fin: number;
  // Une ligne sans palier de retrait court jusqu'au bout. Il faut le DESSINER
  // comme tel -- l'arrêter au dernier palier connu dirait qu'elle y meurt.
  ouvertADroite: boolean;
  ouvertAGauche: boolean;
}

export interface Frise {
  paliers: Palier[];
  segments: SegmentFrise[];
}

function segment(
  libellé: string,
  rattachement: string,
  validite: ValiditePalier,
  model: ParsedModel,
  bornes: { min: number; max: number }
): SegmentFrise {
  const intervalle = intervalleDeVie(model, validite);
  return {
    libellé,
    rattachement,
    debut: Number.isFinite(intervalle.debut) ? intervalle.debut : bornes.min,
    fin: Number.isFinite(intervalle.fin) ? intervalle.fin : bornes.max + 1,
    ouvertADroite: !Number.isFinite(intervalle.fin),
    ouvertAGauche: !Number.isFinite(intervalle.debut),
  };
}

export function construireFrise(model: ParsedModel, quoi: SujetDeFrise): Frise {
  const paliers = [...model.paliers].sort((a, b) => a.rang - b.rang);
  if (paliers.length === 0) return { paliers, segments: [] };
  const bornes = { min: paliers[0].rang, max: paliers[paliers.length - 1].rang };

  const segments =
    quoi === "acteurs"
      ? model.acteurs.map((a) => segment(a.nom.trim(), a.groupe.trim(), a, model, bornes))
      : model.interfaces.map((i) =>
          segment(libelleInterface(i.nomDuFlux, i.version), i.acteurExposant.trim(), i, model, bornes)
        );

  // Rangé par rattachement puis par arrivée : les lignes d'un même fournisseur
  // se lisent ensemble, et une migration datée -- deux versions qui se
  // succèdent -- se lit comme un escalier plutôt qu'en cherchant ses marches.
  return {
    paliers,
    segments: segments.sort(
      (a, b) =>
        a.rattachement.localeCompare(b.rattachement, "fr") ||
        a.debut - b.debut ||
        a.libellé.localeCompare(b.libellé, "fr")
    ),
  };
}
