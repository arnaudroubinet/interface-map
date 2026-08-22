import { INK } from "./node-styles";

// Ce qu'un schéma doit dire de lui-même. C4 en fait sa règle première : un
// diagramme collé dans un dossier, un ticket ou une présentation ne disait ni
// de quel classeur il vient, ni à quel palier il se lit, ni selon quelle
// lecture -- et ces trois informations changent tout son sens.
export interface DiagramContext {
  title: string;
  reading: string;
  milestone: string | null;
  source: string;
  date: string;
  composants: number;
  flows: number;
  technologies: number;
  // Ce que la planche compte, quand « composants et flux » ne veut rien dire :
  // une frise compte des lignes et des paliers, pas des boîtes et des traits.
  detail?: string;
}

const pluriel = (n: number, mot: string, pluriels = `${mot}s`) => `${n} ${n > 1 ? pluriels : mot}`;

export function titleBlockText(c: DiagramContext): { title: string; subtitle: string } {
  const milestone = c.milestone ? `, milestone ${c.milestone}` : "";
  return {
    title: `${c.title} — ${c.reading} reading${milestone}`,
    subtitle: `${c.source} · ${c.detail ?? `${pluriel(c.composants, "component")}, ${pluriel(c.flows, "flow")}`} · ${c.date}`,
  };
}

// La convention de lecture ne figure NULLE PART dans le texte du schéma : un
// lecteur d'écran ne peut pas la déduire du dessin. Elle appartient donc à la
// description, avec les comptes.
export function descriptionAccessible(c: DiagramContext): string {
  return (
    `${c.source} · ${c.detail ?? `${pluriel(c.composants, "component")}, ${pluriel(c.flows, "flow")}, ${pluriel(c.technologies, "technology", "technologies")}`}. ` +
    "Line = data, provider to consumer. Arrowhead = who calls."
  );
}

export const HAUTEUR_CARTOUCHE = 44;

// Un gris pâle sur blanc se lit mal, même au-dessus du seuil : #5b6472 tenait
// 5,98:1 et restait inconfortable en petit corps. L'ardoise franc donne
// 10,16:1, et la hiérarchie reste portée par la taille et la graisse -- pas
// par la pâleur.
const GRIS_SOUS_TITRE = "#39424f";

export function buildTitleBlock(c: DiagramContext, x: number, y: number): SVGGElement {
  const ns = "http://www.w3.org/2000/svg";
  const { title, subtitle } = titleBlockText(c);
  const g = document.createElementNS(ns, "g");
  g.setAttribute("class", "fx-titleblock");
  const row = (text: string, dy: number, size: number, gras: boolean, colour: string) => {
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", String(x));
    t.setAttribute("y", String(y + dy));
    t.setAttribute("font-size", String(size));
    if (gras) t.setAttribute("font-weight", "600");
    t.setAttribute("fill", colour);
    t.textContent = text;
    g.appendChild(t);
  };
  row(title, 14, 14, true, INK);
  row(subtitle, 31, 11.5, false, GRIS_SOUS_TITRE);
  return g;
}
