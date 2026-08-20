import { téléchargerBlob } from "./telechargement";

export function serializeSvg(svg: SVGSVGElement, backgroundColor: string): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  const background = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  const viewBox = clone.getAttribute("viewBox");
  const [x, y, width, height] = viewBox
    ? viewBox.split(/\s+/)
    : ["0", "0", clone.getAttribute("width") ?? "0", clone.getAttribute("height") ?? "0"];
  background.setAttribute("x", x);
  background.setAttribute("y", y);
  background.setAttribute("width", width);
  background.setAttribute("height", height);
  background.setAttribute("fill", backgroundColor);
  clone.insertBefore(background, clone.firstChild);

  return new XMLSerializer().serializeToString(clone);
}

export function downloadSvg(svg: SVGSVGElement, filename: string, backgroundColor: string): void {
  const source = serializeSvg(svg, backgroundColor);
  téléchargerBlob(new Blob([source], { type: "image/svg+xml" }), filename);
}
