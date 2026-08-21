import type { Acteur, ParsedModel, Palier, ValiditePalier } from "../parsing/model";
import { normalizeText } from "../shared/text";

// L'axe du temps de la plateforme. À ne jamais confondre avec la version d'un
// contrat d'interface ni avec le numéro de schéma du classeur.

// L'intervalle de vie d'une ligne, en rangs. Les bornes vides deviennent les
// infinis : « depuis toujours » et « toujours là ». C'est ce qui laisse un
// classeur qui ne déclare aucun palier se comporter exactement comme avant.
export interface Intervalle {
  debut: number;
  fin: number;
}

export const TOUJOURS: Intervalle = { debut: -Infinity, fin: Infinity };

export function rangDuPalier(model: ParsedModel, nom: string): number | undefined {
  const cherché = normalizeText(nom);
  if (!cherché) return undefined;
  return model.paliers.find((p) => normalizeText(p.nom) === cherché)?.rang;
}

// Un palier cité mais inconnu est traité comme absent plutôt que résolu au
// hasard : un contrôle le réclame, et la borne reste ouverte de ce côté.
//
// Rien n'est hérité d'un objet à l'autre : une borne d'arrivée absente est un
// manque de saisie, signalé comme tel (§7.4). On ne devine pas à la place de
// celui qui tient le fichier.
export function intervalleDeVie(model: ParsedModel, validite: ValiditePalier): Intervalle {
  const debut = rangDuPalier(model, validite.palierIntroduction);
  const fin = rangDuPalier(model, validite.palierRetrait);
  return { debut: debut ?? -Infinity, fin: fin ?? Infinity };
}

// Le palier affiché par défaut : le livré de rang le plus haut. Sans aucun
// livré, le palier de rang le plus haut tout court -- mieux vaut montrer un
// état connu que rien du tout, et un contrôle signale l'absence.
export function palierCourant(model: ParsedModel): Palier | undefined {
  const livrés = model.paliers.filter((p) => normalizeText(p.statut) === normalizeText("Delivered"));
  const candidats = livrés.length > 0 ? livrés : model.paliers;
  return candidats.reduce<Palier | undefined>(
    (meilleur, p) => (!meilleur || p.rang > meilleur.rang ? p : meilleur),
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
export function estVivant(intervalle: Intervalle, rang: number): boolean {
  return intervalle.debut <= rang && rang < intervalle.fin;
}

// Les acteurs que le palier retient. Les deux exports C4 en portaient chacun
// leur copie : deux lignes, une seule règle, et c'est la règle des paliers --
// elle appartient donc ici, avec estVivant et intervalleDeVie.
export function acteursVivants(model: ParsedModel, rang: number | null): Acteur[] {
  if (rang === null || model.paliers.length === 0) return model.acteurs;
  return model.acteurs.filter((a) => estVivant(intervalleDeVie(model, a), rang));
}

// Deux intervalles se rencontrent s'il existe un rang où les deux lignes sont
// vivantes ensemble. Le retrait restant exclu, la borne haute ne compte pas :
// [v1, v2[ et [v2, ...[ ne se rencontrent jamais -- c'est exactement ce que
// décrit une migration datée, et ce n'est donc pas une incohérence.
export function seRencontrent(a: Intervalle, b: Intervalle): boolean {
  return Math.max(a.debut, b.debut) < Math.min(a.fin, b.fin);
}
