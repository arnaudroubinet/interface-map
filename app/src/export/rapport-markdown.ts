import type { IntegrityReport } from "../integrity/checks";
import { sectionsDuRapport } from "../render/integrity-report";

// Le rapport hors de l'outil. Ce qu'on veut en emporter, ce n'est pas la mise
// en page : c'est la liste des lignes à corriger, dans un format qui se colle
// dans un ticket ou un mail et reste lisible tel quel. Chaque item porte déjà
// son adresse (feuille, ligne) : le classeur se corrige sans rouvrir l'outil.

function compte(n: number, singulier: string, pluriel: string): string | null {
  if (n === 0) return null;
  return `${n} ${n > 1 ? pluriel : singulier}`;
}

// Ce qui vient du classeur est du TEXTE, jamais de la structure. Une cellule
// Excel contenant un retour à la ligne -- Alt+Entrée, geste courant -- forgeait
// sinon une famille d'anomalies entière que les contrôles n'ont jamais
// produite ; et un acteur nommé « [Sullust](http://…) » devenait un lien
// cliquable, « **Chandrila** » perdait ses étoiles, donc son nom ne se
// retrouvait plus dans le classeur.
//
// L'échappement par contre-oblique rend le caractère tel quel : le nom reste
// lisible et cherchable une fois le Markdown rendu.
function texteInline(valeur: string): string {
  // Le souligné n'y est pas : à l'intérieur d'un mot il ne met rien en italique
  // (CommonMark), et l'échapper défigurerait tous les noms d'onglet FX_A_HTTP
  // que ce rapport cite en permanence.
  return valeur.replace(/\s+/g, " ").trim().replace(/([\\`*[\]<>])/g, "\\$1");
}

// Le bilan compte les puces RÉELLEMENT imprimées, section par section. Calculé
// à côté, sur les compteurs du rapport, il annonçait « 2 pending decisions »
// au-dessus de dix-neuf puces -- les blocs informatifs n'y entraient pas -- et
// se réduisait à un point solitaire quand aucun compteur n'était renseigné.
const LIBELLE_GRAVITE: Record<string, [string, string]> = {
  erreur: ["anomaly", "anomalies"],
  action: ["pending decision", "pending decisions"],
  avertissement: ["warning", "warnings"],
  info: ["point of information", "points of information"],
};

export function rapportEnMarkdown(
  report: IntegrityReport,
  nomClasseur: string,
  palier: string | null
): string {
  const lignes: string[] = [`# Integrity report — ${nomClasseur}`, ""];

  // Les contrôles se lisent AU palier affiché : sans lui, la liste ne dit pas
  // de quel moment du classeur elle parle. Mais tous ne s'y lisent pas -- ceux
  // qui jugent le FICHIER portent sur le classeur entier -- et un lecteur qui
  // l'ignore attribue au palier une faute qui n'en dépend pas.
  if (palier) {
    lignes.push(
      `Milestone: ${palier}`,
      "",
      "Structure, references, vocabularies and consistency are checked on the whole workbook; completeness and the information blocks are read at this milestone.",
      ""
    );
  }

  // Une section vide rassure à l'écran ; collée dans un ticket, elle encombre.
  const sections = sectionsDuRapport(report).filter((s) => s.items.length > 0);

  if (sections.length === 0) {
    lignes.push("Nothing to report.", "");
    return lignes.join("\n");
  }

  const parGravité = new Map<string, number>();
  for (const s of sections) parGravité.set(s.gravité, (parGravité.get(s.gravité) ?? 0) + s.items.length);
  const bilan = Object.entries(LIBELLE_GRAVITE)
    .map(([gravité, [singulier, pluriel]]) => compte(parGravité.get(gravité) ?? 0, singulier, pluriel))
    .filter(Boolean);
  lignes.push(`${bilan.join(", ")}.`, "");

  for (const s of sections) {
    lignes.push(`## ${texteInline(s.titre)} (${s.items.length})`, "", texteInline(s.description), "");
    for (const item of s.items) lignes.push(`- ${texteInline(item)}`);
    lignes.push("");
  }

  return lignes.join("\n");
}
