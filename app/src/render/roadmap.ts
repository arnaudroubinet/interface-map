import type { Frise } from "../aggregation/roadmap";
import { ENCRE, PAPIER, styleDuNoeud } from "./node-styles";
import { construireCartouche, HAUTEUR_CARTOUCHE, type ContexteSchema } from "./title-block";

const SVG_NS = "http://www.w3.org/2000/svg";
const POLICE = 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

// Une grille, pas un graphe : un axe, une ligne par sujet. Passer par le moteur
// de placement coûterait cher et donnerait un moins bon résultat -- il n'a rien
// à placer ici, tout est déterminé par le rang du palier.
const MARGE = 24;
const LARGEUR_LIBELLE = 300;
const LARGEUR_PALIER = 150;
const HAUTEUR_LIGNE = 26;
const HAUTEUR_ENTETE = 44;
const GRIS_SECONDAIRE = "#39424f";

function el<K extends keyof SVGElementTagNameMap>(tag: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, tag);
}

function text(x: number, y: number, content: string, size: number, colour: string, gras = false): SVGTextElement {
  const t = el("text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  t.setAttribute("font-size", String(size));
  if (gras) t.setAttribute("font-weight", "600");
  t.setAttribute("fill", colour);
  t.textContent = content;
  return t;
}

export function buildFriseSvg(timeline: Frise, shownMilestone: string | null, contexte: ContexteSchema | null): SVGSVGElement {
  const svg = el("svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("font-family", POLICE);
  svg.setAttribute("class", "fx-roadmap");

  const ranks = timeline.milestones.map((p) => p.rank);
  const rangMin = ranks.length ? Math.min(...ranks) : 0;
  // Une colonne de plus à droite : c'est là que se dessine « toujours là ».
  const columns = ranks.length ? Math.max(...ranks) - rangMin + 2 : 1;
  const x = (rank: number) => MARGE + LARGEUR_LIBELLE + (rank - rangMin) * LARGEUR_PALIER;

  const hautDesLignes = MARGE + (contexte ? HAUTEUR_CARTOUCHE : 0) + HAUTEUR_ENTETE;
  const width = MARGE * 2 + LARGEUR_LIBELLE + columns * LARGEUR_PALIER;
  const height = hautDesLignes + timeline.segments.length * HAUTEUR_LIGNE + MARGE;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));

  const fill = el("rect");
  fill.setAttribute("width", String(width));
  fill.setAttribute("height", String(height));
  fill.setAttribute("fill", PAPIER);
  svg.appendChild(fill);

  if (contexte) svg.appendChild(construireCartouche(contexte, MARGE, MARGE));

  // L'axe : une graduation par palier, avec son nom et sa date. Le palier
  // affiché porte une verticale pleine -- c'est le « vous êtes ici ».
  for (const milestone of timeline.milestones) {
    const px = x(milestone.rank);
    const line = el("line");
    line.setAttribute("x1", String(px));
    line.setAttribute("y1", String(hautDesLignes - 22));
    line.setAttribute("x2", String(px));
    line.setAttribute("y2", String(height - MARGE));
    line.setAttribute("stroke", milestone.name === shownMilestone ? "#0E7DAD" : "#dde1e7");
    line.setAttribute("stroke-width", milestone.name === shownMilestone ? "2" : "1");
    svg.appendChild(line);

    svg.appendChild(text(px + 6, hautDesLignes - 26, milestone.name, 12, ENCRE, true));
    const subtitle = [milestone.label?.trim(), milestone.date?.trim()].filter(Boolean).join(" · ");
    if (subtitle) svg.appendChild(text(px + 6, hautDesLignes - 11, subtitle, 11, GRIS_SECONDAIRE));
  }

  const style = styleDuNoeud({ kind: "actor", external: false });
  timeline.segments.forEach((s, i) => {
    const y = hautDesLignes + i * HAUTEUR_LIGNE;
    svg.appendChild(text(MARGE, y + 14, s.label, 12, ENCRE));

    const gauche = x(s.start);
    const droite = x(s.end);
    const barre = el("rect");
    barre.setAttribute("x", String(gauche));
    barre.setAttribute("y", String(y + 4));
    barre.setAttribute("width", String(Math.max(6, droite - gauche)));
    barre.setAttribute("height", "14");
    barre.setAttribute("rx", "4");
    barre.setAttribute("fill", style.fill);
    svg.appendChild(barre);

    // Ouvert à droite : une pointe, pas un bord franc. Un bord franc dirait
    // que la ligne s'arrête là, alors qu'elle n'a simplement pas de fin connue.
    if (s.ouvertADroite) {
      const head = el("path");
      head.setAttribute("d", `M${droite} ${y + 4} L${droite + 10} ${y + 11} L${droite} ${y + 18} Z`);
      head.setAttribute("fill", style.fill);
      head.setAttribute("class", "fx-roadmap-open");
      svg.appendChild(head);
    }
  });

  return svg;
}
