import { serializeSvg } from "./svg-export";
import { téléchargerBlob } from "./telechargement";

export type PngResult = { ok: true; blob: Blob } | { ok: false; error: string };

export async function exportPng(svg: SVGSVGElement, backgroundColor: string, scale: number): Promise<PngResult> {
  try {
    const width = Number(svg.getAttribute("width")) || svg.viewBox.baseVal.width;
    const height = Number(svg.getAttribute("height")) || svg.viewBox.baseVal.height;
    if (!width || !height) {
      return { ok: false, error: "Dimensions du schéma indisponibles." };
    }

    const source = serializeSvg(svg, backgroundColor);
    const svgBlob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    try {
      const image = await new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Échec du chargement du SVG dans une image."));
        img.src = url;
      });

      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        return { ok: false, error: "This browser gives no 2D canvas — use the SVG export instead." };
      }

      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) {
        return { ok: false, error: "This browser refuses to convert to PNG — use the SVG export instead." };
      }

      return { ok: true, blob };
    } finally {
      // Révoquée seulement après le dessin (drawImage) et l'encodage
      // (toBlob) : la révoquer entre le chargement de l'image et son
      // utilisation dans le canvas est le schéma le plus associé aux canvas
      // vides par intermittence sous WebKit (§2.4 exige aussi Safari).
      // Toujours atteinte, y compris sur le chemin d'échec (onerror).
      URL.revokeObjectURL(url);
    }
  } catch {
    return { ok: false, error: "This browser refuses to convert to PNG — use the SVG export instead." };
  }
}

export function downloadPngBlob(blob: Blob, filename: string): void {
  téléchargerBlob(blob, filename);
}
