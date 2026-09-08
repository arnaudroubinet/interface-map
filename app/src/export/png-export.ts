import { serializeSvg } from "./svg-export";
import { downloadBlob } from "./download";

// The scale actually used is reported: below the one asked for when the
// canvas would not hold the picture.
export type PngResult = { ok: true; blob: Blob; scale: number } | { ok: false; error: string };

// What a browser canvas can hold. Chrome and Firefox stop at 16 384 pixels a
// side and about 268 million pixels of area; WebKit lower still on a phone.
// Beyond that, toBlob returns null at best -- and at worst drawImage succeeds
// on a truncated canvas and a WHITE picture is handed over without a word.
export const MAX_CANVAS_SIDE = 16_384;
export const MAX_CANVAS_AREA = 268_000_000;

// The largest scale, up to the one asked for, that keeps the canvas within
// those limits. The picture comes out smaller rather than blank.
export function fitScale(width: number, height: number, scale: number): number {
  const bySide = Math.min(MAX_CANVAS_SIDE / width, MAX_CANVAS_SIDE / height);
  const byArea = Math.sqrt(MAX_CANVAS_AREA / (width * height));
  return Math.max(0.1, Math.min(scale, bySide, byArea));
}

export async function exportPng(svg: SVGSVGElement, backgroundColor: string, scale: number): Promise<PngResult> {
  try {
    const width = Number(svg.getAttribute("width")) || svg.viewBox.baseVal.width;
    const height = Number(svg.getAttribute("height")) || svg.viewBox.baseVal.height;
    if (!width || !height) {
      return { ok: false, error: "The diagram has no usable size." };
    }

    const source = serializeSvg(svg, backgroundColor);
    const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Failed to load the SVG into an image."));
        img.src = url;
      });

      const used = fitScale(width, height, scale);
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(width * used);
      canvas.height = Math.floor(height * used);
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return { ok: false, error: "This browser gives no 2D canvas — use the SVG export instead." };
      }

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) {
        return { ok: false, error: "This browser refuses to convert to PNG — use the SVG export instead." };
      }

      return { ok: true, blob, scale: used };
    } finally {
      // Revoked only after the draw (drawImage) and the encoding (toBlob):
      // revoking it between the image loading and its use in the canvas is
      // the pattern most associated with intermittently blank canvases under
      // WebKit (§2.4 also requires Safari). Always reached, including on the
      // failure path (onerror).
      URL.revokeObjectURL(url);
    }
  } catch {
    return { ok: false, error: "This browser refuses to convert to PNG — use the SVG export instead." };
  }
}

export function downloadPngBlob(blob: Blob, filename: string): void {
  downloadBlob(blob, filename);
}
