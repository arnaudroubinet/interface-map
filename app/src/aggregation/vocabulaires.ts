import { NATURE_METIER, NATURE_TECHNIQUE } from "./nature";

// Vocabulaires fermés du domaine. Les mêmes valeurs alimentent les listes
// déroulantes du classeur (export/template-export.ts) et les contrôles
// d'intégrité qui les valident (integrity/checks.ts) : ni l'un ni l'autre
// n'en est le propriétaire, donc elles vivent ici plutôt que d'être
// déclarées deux fois et de pouvoir diverger.

export const VOCABULAIRE_DIRECTION = ["provider → consumer", "consumer → provider"];

// « Remove » est un jugement comme les autres -- cette consommation n'a plus
// lieu d'être -- et non une date de départ : celle-là se déclare par un
// palier de retrait, et les deux peuvent coexister.
export const VOCABULAIRE_DECISION = ["Keep", "Investigate", "Transform", "Remove"];

export const VOCABULAIRE_CRITICITE = ["1 - Critical", "2 - Important", "3 - Standard"];

export const VOCABULAIRE_NATURE = [NATURE_METIER, NATURE_TECHNIQUE];

// Le périmètre décide de tout le dessin : ce qui entre dans la frontière, ce
// qui reste dehors. Il vivait en dur à trois endroits -- la liste déroulante du
// classeur, les deux prédicats des schémas, les exports C4 -- et les deux
// derniers ne comparaient pas de la même façon.
export const PERIMETRE_PLATEFORME = "Platform";
export const PERIMETRE_EXTERNE = "External";
export const VOCABULAIRE_PERIMETRE = [PERIMETRE_PLATEFORME, PERIMETRE_EXTERNE];
