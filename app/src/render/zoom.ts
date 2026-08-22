// A diagram's visible frame, that is, its viewBox. Zooming and panning happen
// here, in pure arithmetic: no library to embed in a single-file deliverable,
// and the geometry is testable without a browser.
export interface Frame {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Without bounds, two wheel turns are enough to leave the drawing behind.
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 8;

export function frameOfSvg(svg: SVGSVGElement): Frame {
  const [x, y, width, height] = (svg.getAttribute("viewBox") ?? "0 0 100 100").split(/\s+/).map(Number);
  return { x, y, width, height };
}

export function appliquer(svg: SVGSVGElement, frame: Frame): void {
  svg.setAttribute("viewBox", `${frame.x} ${frame.y} ${frame.width} ${frame.height}`);
}

// The point under the cursor does not move: that is what separates a usable
// zoom from one that loses its reader.
export function zoomBy(frame: Frame, factor: number, anchor: { x: number; y: number }, initial: Frame): Frame {
  const currentScale = initial.width / frame.width;
  const scale = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, currentScale * factor));
  const headcount = scale / currentScale;
  const width = frame.width / headcount;
  const height = frame.height / headcount;
  return {
    x: anchor.x - (anchor.x - frame.x) / headcount,
    y: anchor.y - (anchor.y - frame.y) / headcount,
    width,
    height,
  };
}

export function panBy(frame: Frame, dx: number, dy: number): Frame {
  return { ...frame, x: frame.x + dx, y: frame.y + dy };
}

// The DOM wiring: wheel to zoom, drag to pan. Returns what the banner needs to
// drive it, and detaches on its own with the SVG it equips.
export function brancherZoom(svg: SVGSVGElement): { ajuster: () => void; zoomBy: (factor: number) => void } {
  const initial = frameOfSvg(svg);
  let frame = { ...initial };

  const apply = (c: Frame) => {
    frame = c;
    appliquer(svg, frame);
  };

  // The DRAWING point under the cursor: that is what must stay still, not the
  // screen pixel.
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
    zoomBy: (factor) => apply(zoomBy(frame, factor, { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }, initial)),
  };
}
