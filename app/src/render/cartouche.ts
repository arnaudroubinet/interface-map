import { ENCRE } from "./styles-noeud";

// Ce qu'un schéma doit dire de lui-même. C4 en fait sa règle première : un
// diagramme collé dans un dossier, un ticket ou une présentation ne disait ni
// de quel classeur il vient, ni à quel palier il se lit, ni selon quelle
// lecture -- et ces trois informations changent tout son sens.
export interface ContexteSchema {
  titre: string;
  lecture: string;
  palier: string | null;
  source: string;
  date: string;
  composants: number;
  flux: number;
  technologies: number;
  // Ce que la planche compte, quand « composants et flux » ne veut rien dire :
  // une frise compte des lignes et des paliers, pas des boîtes et des traits.
  détail?: string;
}

const pluriel = (n: number, mot: string, pluriels = `${mot}s`) => `${n} ${n > 1 ? pluriels : mot}`;

export function libelléCartouche(c: ContexteSchema): { titre: string; sousTitre: string } {
  const palier = c.palier ? `, milestone ${c.palier}` : "";
  return {
    titre: `${c.titre} — ${c.lecture} reading${palier}`,
    sousTitre: `${c.source} · ${c.détail ?? `${pluriel(c.composants, "component")}, ${pluriel(c.flux, "flow")}`} · ${c.date}`,
  };
}

// La convention de lecture ne figure NULLE PART dans le texte du schéma : un
// lecteur d'écran ne peut pas la déduire du dessin. Elle appartient donc à la
// description, avec les comptes.
export function descriptionAccessible(c: ContexteSchema): string {
  return (
    `${c.source} · ${c.détail ?? `${pluriel(c.composants, "component")}, ${pluriel(c.flux, "flow")}, ${pluriel(c.technologies, "technology", "technologies")}`}. ` +
    "Line = data, provider to consumer. Arrowhead = who calls."
  );
}

export const HAUTEUR_CARTOUCHE = 44;

// Un gris pâle sur blanc se lit mal, même au-dessus du seuil : #5b6472 tenait
// 5,98:1 et restait inconfortable en petit corps. L'ardoise franc donne
// 10,16:1, et la hiérarchie reste portée par la taille et la graisse -- pas
// par la pâleur.
const GRIS_SOUS_TITRE = "#39424f";

export function construireCartouche(c: ContexteSchema, x: number, y: number): SVGGElement {
  const ns = "http://www.w3.org/2000/svg";
  const { titre, sousTitre } = libelléCartouche(c);
  const g = document.createElementNS(ns, "g");
  g.setAttribute("class", "fx-cartouche");
  const ligne = (texte: string, dy: number, taille: number, gras: boolean, couleur: string) => {
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y + dy));
    t.setAttribute("font-size", String(taille));
    if (gras) t.setAttribute("font-weight", "600");
    t.setAttribute("fill", couleur);
    t.textContent = texte;
    g.appendChild(t);
  };
  ligne(titre, 14, 14, true, ENCRE);
  ligne(sousTitre, 31, 11.5, false, GRIS_SOUS_TITRE);
  return g;
}
