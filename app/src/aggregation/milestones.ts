import type { Actor, ParsedModel, Milestone, ValiditePalier } from "../parsing/model";
import { normalizeText } from "../shared/text";

// L'axe du temps de la plateforme. À ne jamais confondre avec la version d'un
// contrat d'interface ni avec le numéro de schéma du classeur.

// L'intervalle de vie d'une ligne, en rangs. Les bornes vides deviennent les
// infinis : « depuis toujours » et « toujours là ». C'est ce qui laisse un
// classeur qui ne déclare aucun palier se comporter exactement comme avant.
export interface Intervalle {
  start: number;
  end: number;
}

export const TOUJOURS: Intervalle = { start: -Infinity, end: Infinity };

export function rankOfMilestone(model: ParsedModel, name: string): number | undefined {
  const cherché = normalizeText(name);
  if (!cherché) return undefined;
  return model.milestones.find((p) => normalizeText(p.name) === cherché)?.rank;
}

// Un palier cité mais inconnu est traité comme absent plutôt que résolu au
// hasard : un contrôle le réclame, et la borne reste ouverte de ce côté.
//
// Rien n'est hérité d'un objet à l'autre : une borne d'arrivée absente est un
// manque de saisie, signalé comme tel (§7.4). On ne devine pas à la place de
// celui qui tient le fichier.
export function lifespanOf(model: ParsedModel, validite: ValiditePalier): Intervalle {
  const start = rankOfMilestone(model, validite.introducedAt);
  const end = rankOfMilestone(model, validite.retiredAt);
  return { start: start ?? -Infinity, end: end ?? Infinity };
}

// Le palier affiché par défaut : le livré de rang le plus haut. Sans aucun
// livré, le palier de rang le plus haut tout court -- mieux vaut montrer un
// état connu que rien du tout, et un contrôle signale l'absence.
export function currentMilestone(model: ParsedModel): Milestone | undefined {
  const livrés = model.milestones.filter((p) => normalizeText(p.statut) === normalizeText("Delivered"));
  const candidats = livrés.length > 0 ? livrés : model.milestones;
  return candidats.reduce<Milestone | undefined>(
    (meilleur, p) => (!meilleur || p.rank > meilleur.rank ? p : meilleur),
    undefined
  );
}

// Une ligne est vivante à un rang si son intervalle le contient. Le retrait
// est exclu : une ligne retirée AU palier P n'y est déjà plus, c'est le sens
// courant de « retiré en v3 ».
//
// Le palier porte la date, pas la ligne : « v3 » est un jalon, sa date se lit
// dans l'onglet Paliers. Une ligne n'a donc jamais de date, seulement un
// palier d'arrivée et un palier de retrait.
export function isLiveAt(interval: Intervalle, rank: number): boolean {
  return interval.start <= rank && rank < interval.end;
}

// Les acteurs que le palier retient. Les deux exports C4 en portaient chacun
// leur copie : deux lignes, une seule règle, et c'est la règle des paliers --
// elle appartient donc ici, avec estVivant et intervalleDeVie.
export function liveActors(model: ParsedModel, rank: number | null): Actor[] {
  if (rank === null || model.milestones.length === 0) return model.actors;
  return model.actors.filter((a) => isLiveAt(lifespanOf(model, a), rank));
}

// Deux intervalles se rencontrent s'il existe un rang où les deux lignes sont
// vivantes ensemble. Le retrait restant exclu, la borne haute ne compte pas :
// [v1, v2[ et [v2, ...[ ne se rencontrent jamais -- c'est exactement ce que
// décrit une migration datée, et ce n'est donc pas une incohérence.
export function seRencontrent(a: Intervalle, b: Intervalle): boolean {
  return Math.max(a.start, b.start) < Math.min(a.end, b.end);
}
