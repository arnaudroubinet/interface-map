// Le cadre visible d'un schéma, c'est-à-dire son viewBox. Zoomer et déplacer se
// font ici, en arithmétique pure : aucune bibliothèque à embarquer dans un
// livrable mono-fichier, et la géométrie se teste sans navigateur.
export interface Cadre {
  x: number;
  y: number;
  largeur: number;
  hauteur: number;
}

// Sans bornes, deux coups de molette suffisent à sortir du dessin.
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;

export function cadreDuSvg(svg: SVGSVGElement): Cadre {
  const [x, y, largeur, hauteur] = (svg.getAttribute("viewBox") ?? "0 0 100 100").split(/\s+/).map(Number);
  return { x, y, largeur, hauteur };
}

export function appliquer(svg: SVGSVGElement, cadre: Cadre): void {
  svg.setAttribute("viewBox", `${cadre.x} ${cadre.y} ${cadre.largeur} ${cadre.hauteur}`);
}

// Le point sous le curseur ne bouge pas : c'est ce qui distingue un zoom
// utilisable d'un zoom qui perd son lecteur.
export function zoomer(cadre: Cadre, facteur: number, ancre: { x: number; y: number }, initial: Cadre): Cadre {
  const échelleCourante = initial.largeur / cadre.largeur;
  const échelle = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, échelleCourante * facteur));
  const effectif = échelle / échelleCourante;
  const largeur = cadre.largeur / effectif;
  const hauteur = cadre.hauteur / effectif;
  return {
    x: ancre.x - (ancre.x - cadre.x) / effectif,
    y: ancre.y - (ancre.y - cadre.y) / effectif,
    largeur,
    hauteur,
  };
}

export function deplacer(cadre: Cadre, dx: number, dy: number): Cadre {
  return { ...cadre, x: cadre.x + dx, y: cadre.y + dy };
}

// Le branchement DOM : molette pour zoomer, glisser pour déplacer. Rend de quoi
// piloter depuis le bandeau, et se détache tout seul avec le SVG qu'il équipe.
export function brancherZoom(svg: SVGSVGElement): { ajuster: () => void; zoomer: (facteur: number) => void } {
  const initial = cadreDuSvg(svg);
  let cadre = { ...initial };

  const poser = (c: Cadre) => {
    cadre = c;
    appliquer(svg, cadre);
  };

  // Le point du DESSIN sous le curseur : c'est lui qui doit rester immobile,
  // pas le pixel d'écran.
  const pointDuDessin = (e: { clientX: number; clientY: number }) => {
    const boîte = svg.getBoundingClientRect();
    return {
      x: cadre.x + ((e.clientX - boîte.left) / boîte.width) * cadre.largeur,
      y: cadre.y + ((e.clientY - boîte.top) / boîte.height) * cadre.hauteur,
    };
  };

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    poser(zoomer(cadre, e.deltaY < 0 ? 1.15 : 1 / 1.15, pointDuDessin(e), initial));
  });

  let départ: { x: number; y: number; cadre: Cadre } | null = null;
  svg.addEventListener("pointerdown", (e) => {
    départ = { x: e.clientX, y: e.clientY, cadre };
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = "grabbing";
  });
  svg.addEventListener("pointermove", (e) => {
    if (!départ) return;
    const boîte = svg.getBoundingClientRect();
    poser(
      deplacer(
        départ.cadre,
        -((e.clientX - départ.x) / boîte.width) * départ.cadre.largeur,
        -((e.clientY - départ.y) / boîte.height) * départ.cadre.hauteur
      )
    );
  });
  const relâcher = () => {
    départ = null;
    svg.style.cursor = "";
  };
  svg.addEventListener("pointerup", relâcher);
  svg.addEventListener("pointercancel", relâcher);

  return {
    ajuster: () => poser({ ...initial }),
    zoomer: (facteur) => poser(zoomer(cadre, facteur, { x: cadre.x + cadre.largeur / 2, y: cadre.y + cadre.hauteur / 2 }, initial)),
  };
}
