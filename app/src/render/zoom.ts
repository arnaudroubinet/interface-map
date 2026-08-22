// Le cadre visible d'un schéma, c'est-à-dire son viewBox. Zoomer et déplacer se
// font ici, en arithmétique pure : aucune bibliothèque à embarquer dans un
// livrable mono-fichier, et la géométrie se teste sans navigateur.
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Sans bornes, deux coups de molette suffisent à sortir du dessin.
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;

export function frameOfSvg(svg: SVGSVGElement): Frame {
  const [x, y, width, height] = (svg.getAttribute("viewBox") ?? "0 0 100 100").split(/\s+/).map(Number);
  return { x, y, width, height };
}

export function appliquer(svg: SVGSVGElement, frame: Frame): void {
  svg.setAttribute("viewBox", `${frame.x} ${frame.y} ${frame.width} ${frame.height}`);
}

// Le point sous le curseur ne bouge pas : c'est ce qui distingue un zoom
// utilisable d'un zoom qui perd son lecteur.
export function zoomBy(frame: Frame, facteur: number, anchor: { x: number; y: number }, initial: Frame): Frame {
  const currentScale = initial.width / frame.width;
  const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, currentScale * facteur));
  const effectif = scale / currentScale;
  const width = frame.width / effectif;
  const height = frame.height / effectif;
  return {
    x: anchor.x - (anchor.x - frame.x) / effectif,
    y: anchor.y - (anchor.y - frame.y) / effectif,
    width,
    height,
  };
}

export function panBy(frame: Frame, dx: number, dy: number): Frame {
  return { ...frame, x: frame.x + dx, y: frame.y + dy };
}

// Le branchement DOM : molette pour zoomer, glisser pour déplacer. Rend de quoi
// piloter depuis le banner, et se détache tout seul avec le SVG qu'il équipe.
export function brancherZoom(svg: SVGSVGElement): { ajuster: () => void; zoomBy: (facteur: number) => void } {
  const initial = frameOfSvg(svg);
  let frame = { ...initial };

  const apply = (c: Frame) => {
    frame = c;
    appliquer(svg, frame);
  };

  // Le point du DESSIN sous le curseur : c'est lui qui doit rester immobile,
  // pas le pixel d'écran.
  const drawingPoint = (e: { clientX: number; clientY: number }) => {
    const box = svg.getBoundingClientRect();
    return {
      x: frame.x + ((e.clientX - box.left) / box.width) * frame.width,
      y: frame.y + ((e.clientY - box.top) / box.height) * frame.height,
    };
  };

  svg.addEventListener("wheel", (e) => {
    e.preventDefault();
    apply(zoomBy(frame, e.deltaY < 0 ? 1.15 : 1 / 1.15, drawingPoint(e), initial));
  });

  let start: { x: number; y: number; frame: Frame } | null = null;
  svg.addEventListener("pointerdown", (e) => {
    start = { x: e.clientX, y: e.clientY, frame };
    svg.setPointerCapture(e.pointerId);
    svg.style.cursor = "grabbing";
  });
  svg.addEventListener("pointermove", (e) => {
    if (!start) return;
    const box = svg.getBoundingClientRect();
    apply(
      panBy(
        start.frame,
        -((e.clientX - start.x) / box.width) * start.frame.width,
        -((e.clientY - start.y) / box.height) * start.frame.height
      )
    );
  });
  const release = () => {
    start = null;
    svg.style.cursor = "";
  };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);

  return {
    ajuster: () => apply({ ...initial }),
    zoomBy: (facteur) => apply(zoomBy(frame, facteur, { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }, initial)),
  };
}
