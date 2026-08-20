import type { ParsedModel, Palier, ValiditePalier } from "../parsing/model";
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

// Le palier affiché par défaut : le dernier livré. Sans aucun livré, le premier
// déclaré -- mieux vaut montrer le premier état connu que rien du tout, et un
// contrôle signale l'absence.
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

// L'intervalle de l'enfant doit tenir dans celui du parent : une interface ne
// peut pas vivre avant ou après son acteur exposant, une consommation pas
// avant ou après son interface. Vu de l'autre bout c'est le même contrôle que
// « acteur retiré qui porte encore des flux », d'où une seule implémentation.
export function deborde(enfant: Intervalle, parent: Intervalle): boolean {
  return enfant.debut < parent.debut || enfant.fin > parent.fin;
}
