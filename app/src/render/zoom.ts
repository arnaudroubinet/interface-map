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

export function applyZoom(svg: SVGSVGElement, frame: Frame): void {
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

// The DOM wiring: wheel to zoom, drag to pan, two fingers to pinch. Returns
// what the banner needs to drive it, and detaches on its own with the SVG it
// equips.
//
// Everything below speaks Pointer Events, so a finger and a mouse go through
// the same code; only the pinch needs to know there are two of them.
export function wireZoom(svg: SVGSVGElement): { ajuster: () => void; zoomBy: (factor: number) => void } {
  const initial = frameOfSvg(svg);
  let frame = { ...initial };

  // Without this the browser answers the finger itself -- scrolls the page,
  // pinches the viewport -- and cancels our pointer events mid-gesture. On
  // phones the board is a window (see the mobile stylesheet), so trapping the
  // gestures inside it is precisely the point.
  svg.style.touchAction = "none";

  const apply = (c: Frame) => {
    frame = c;
    applyZoom(svg, frame);
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

  // The fingers (or the mouse) currently down, by pointer id.
  const pointers = new Map<number, { x: number; y: number }>();
  let start: { x: number; y: number; frame: Frame } | null = null;
  // The pinch measures itself against its own start: the spread between the
  // fingers at that instant, the frame at that instant, and the drawing point
  // under the fingers' midpoint -- the point that must not move.
  let pinch: { spread: number; frame: Frame; anchor: { x: number; y: number } } | null = null;

  const spreadOf = () => {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  const midpointOf = () => {
    const [a, b] = [...pointers.values()];
    return { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
  };

  svg.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    // Capture keeps the gesture even when a finger slides off the SVG. It can
    // refuse -- a pointer already lifted, a synthetic event -- and a refused
    // capture must not cost the gesture itself.
    try {
      svg.setPointerCapture(e.pointerId);
    } catch {
      /* the gesture works uncaptured */
    }
    if (pointers.size === 2) {
      start = null;
      pinch = { spread: spreadOf(), frame, anchor: drawingPoint(midpointOf()) };
    } else if (pointers.size === 1) {
      start = { x: e.clientX, y: e.clientY, frame };
      svg.style.cursor = "grabbing";
    }
  });
  svg.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const factor = spreadOf() / pinch.spread;
      // Anchored zoom FROM the pinch's start frame: the factor is cumulative,
      // and replaying it from the start avoids drifting one rounding at a time.
      apply(zoomBy(pinch.frame, factor, pinch.anchor, initial));
      return;
    }
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
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) {
      start = null;
      svg.style.cursor = "";
    } else if (pointers.size === 1) {
      // The finger that stays becomes a pan, from where things are NOW: a
      // pinch ending finger by finger must not make the board jump.
      const [rest] = [...pointers.values()];
      start = { x: rest.x, y: rest.y, frame };
    }
  };
  svg.addEventListener("pointerup", release);
  svg.addEventListener("pointercancel", release);

  return {
    ajuster: () => apply({ ...initial }),
    zoomBy: (factor) => apply(zoomBy(frame, factor, { x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 }, initial)),
  };
}
