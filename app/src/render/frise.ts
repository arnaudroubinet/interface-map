import type { Frise } from "../aggregation/frise";
import { ENCRE, PAPIER, styleDuNoeud } from "./styles-noeud";
import { construireCartouche, HAUTEUR_CARTOUCHE, type ContexteSchema } from "./cartouche";

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

function texte(x: number, y: number, contenu: string, taille: number, couleur: string, gras = false): SVGTextElement {
  const t = el("text");
  t.setAttribute("x", String(x));
  t.setAttribute("y", String(y));
  t.setAttribute("font-size", String(taille));
  if (gras) t.setAttribute("font-weight", "600");
  t.setAttribute("fill", couleur);
  t.textContent = contenu;
  return t;
}

export function buildFriseSvg(frise: Frise, palierAffiché: string | null, contexte: ContexteSchema | null): SVGSVGElement {
  const svg = el("svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("font-family", POLICE);
  svg.setAttribute("class", "fx-frise");

  const rangs = frise.paliers.map((p) => p.rang);
  const rangMin = rangs.length ? Math.min(...rangs) : 0;
  // Une colonne de plus à droite : c'est là que se dessine « toujours là ».
  const colonnes = rangs.length ? Math.max(...rangs) - rangMin + 2 : 1;
  const x = (rang: number) => MARGE + LARGEUR_LIBELLE + (rang - rangMin) * LARGEUR_PALIER;

  const hautDesLignes = MARGE + (contexte ? HAUTEUR_CARTOUCHE : 0) + HAUTEUR_ENTETE;
  const largeur = MARGE * 2 + LARGEUR_LIBELLE + colonnes * LARGEUR_PALIER;
  const hauteur = hautDesLignes + frise.segments.length * HAUTEUR_LIGNE + MARGE;
  svg.setAttribute("viewBox", `0 0 ${largeur} ${hauteur}`);
  svg.setAttribute("width", String(largeur));
  svg.setAttribute("height", String(hauteur));

  const fond = el("rect");
  fond.setAttribute("width", String(largeur));
  fond.setAttribute("height", String(hauteur));
  fond.setAttribute("fill", PAPIER);
  svg.appendChild(fond);

  if (contexte) svg.appendChild(construireCartouche(contexte, MARGE, MARGE));

  // L'axe : une graduation par palier, avec son nom et sa date. Le palier
  // affiché porte une verticale pleine -- c'est le « vous êtes ici ».
  for (const palier of frise.paliers) {
    const px = x(palier.rang);
    const trait = el("line");
    trait.setAttribute("x1", String(px));
    trait.setAttribute("y1", String(hautDesLignes - 22));
    trait.setAttribute("x2", String(px));
    trait.setAttribute("y2", String(hauteur - MARGE));
    trait.setAttribute("stroke", palier.nom === palierAffiché ? "#0E7DAD" : "#dde1e7");
    trait.setAttribute("stroke-width", palier.nom === palierAffiché ? "2" : "1");
    svg.appendChild(trait);

    svg.appendChild(texte(px + 6, hautDesLignes - 26, palier.nom, 12, ENCRE, true));
    const sousTitre = [palier.libelle?.trim(), palier.date?.trim()].filter(Boolean).join(" · ");
    if (sousTitre) svg.appendChild(texte(px + 6, hautDesLignes - 11, sousTitre, 11, GRIS_SECONDAIRE));
  }

  const style = styleDuNoeud({ kind: "acteur", externe: false });
  frise.segments.forEach((s, i) => {
    const y = hautDesLignes + i * HAUTEUR_LIGNE;
    svg.appendChild(texte(MARGE, y + 14, s.libellé, 12, ENCRE));

    const gauche = x(s.debut);
    const droite = x(s.fin);
    const barre = el("rect");
    barre.setAttribute("x", String(gauche));
    barre.setAttribute("y", String(y + 4));
    barre.setAttribute("width", String(Math.max(6, droite - gauche)));
    barre.setAttribute("height", "14");
    barre.setAttribute("rx", "4");
    barre.setAttribute("fill", style.fond);
    svg.appendChild(barre);

    // Ouvert à droite : une pointe, pas un bord franc. Un bord franc dirait
    // que la ligne s'arrête là, alors qu'elle n'a simplement pas de fin connue.
    if (s.ouvertADroite) {
      const pointe = el("path");
      pointe.setAttribute("d", `M${droite} ${y + 4} L${droite + 10} ${y + 11} L${droite} ${y + 18} Z`);
      pointe.setAttribute("fill", style.fond);
      pointe.setAttribute("class", "fx-frise-ouvert");
      svg.appendChild(pointe);
    }
  });

  return svg;
}
