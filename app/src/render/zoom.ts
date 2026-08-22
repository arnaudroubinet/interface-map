// Le cadre visible d'un schéma, c'est-à-dire son viewBox. Zoomer et déplacer se
// font ici, en arithmétique pure : aucune bibliothèque à embarquer dans un
// livrable mono-fichier, et la géométrie se teste sans navigateur.
export interface Cadre {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Sans bornes, deux coups de molette suffisent à sortir du dessin.
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;

export function cadreDuSvg(svg: SVGSVGElement): Cadre {
  const [x, y, width, height] = (svg.getAttribute("viewBox") ?? "0 0 100 100").split(/\s+/).map(Number);
  return { x, y, width, height };
}

export function appliquer(svg: SVGSVGElement, frame: Cadre): void {
  svg.setAttribute("viewBox", `${frame.x} ${frame.y} ${frame.width} ${frame.height}`);
}

// Le point sous le curseur ne bouge pas : c'est ce qui distingue un zoom
// utilisable d'un zoom qui perd son lecteur.
export function zoomer(frame: Cadre, facteur: number, ancre: { x: number; y: number }, initial: Cadre): Cadre {
  const échelleCourante = initial.width / frame.width;
  const échelle = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, échelleCourante * facteur));
  const effectif = échelle / échelleCourante;
  const width = frame.width / effectif;
  const height = frame.height / effectif;
  return {
    x: ancre.x - (ancre.x - frame.x) / effectif,
    y: ancre.y - (ancre.y - frame.y) / effectif,
    width,
    height,
  };
}

export function deplacer(frame: Cadre, dx: number, dy: number): Cadre {
  return { ...frame, x: frame.x + dx, y: frame.y + dy };
}

// Le branchement DOM : molette pour zoomer, glisser pour déplacer. Rend de quoi
// piloter depuis le banner, et se détache tout seul avec le SVG qu'il équipe.
export function brancherZoom(svg: SVGSVGElement): { ajuster: () => void; zoomer: (facteur: number) => void } {
  const initial = cadreDuSvg(svg);
  let frame = { ...initial };

  const poser = (c: Cadre) => {
    frame = c;
    appliquer(svg, frame);
  };

  // Le point du DESSIN sous le curseur : c'est lui qui doit rester immobile,
  // pas le pixel d'écran.
  const pointDuDessin = (e: { clientX: number; clientY: number }) => {
    const box = svg.getBoundingClientRect();
    return {
      x: frame.x + ((e.clientX - box.left) / box.width) * frame.width,
      y: frame.y + ((e.clientY - box.top) / box.height) * frame.height,
    };
  };

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    poser(zoomer(frame, e.deltaY < 0 ? 1.15 : 1 / 1.15, pointDuDessin(e), initial));
  });

  let départ: { x: number; y: number; frame: Cadre } | null = null;
  svg.addEventListener("pointerdown", (e) => {
    départ = { x: e.clientX, y: e.clientY, frame };
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = "grabbing";
  });
  svg.addEventListener("pointermove", (e) => {
    if (!départ) return;
    const box = svg.getBoundingClientRect();
    poser(
      deplacer(
        départ.frame,
        -((e.clientX - départ.x) / box.width) * départ.frame.width,
        -((e.clientY - départ.y) / box.height) * départ.frame.height
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
    zoomer: (facteur) => poser(zoomer(frame, facteur, { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }, initial)),
  };
}
