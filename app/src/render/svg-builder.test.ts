import { describe, it, expect } from "vitest";
import { ICONES, ICONE_PAR_DEFAUT } from "./icons";
import { buildGraphSvg } from "./svg-builder";
import { styleDuNoeud } from "./node-styles";
import { computeLayout, taillePastille } from "../layout/graph-layout";
import { ratioDeContraste } from "./contrast";
import { serializeSvg } from "../export/svg-export";
import { colourForTechnologies } from "./colors";
import type { GraphNode, GraphEdge } from "../aggregation/core";
import type { LayoutResult } from "../layout/graph-layout";

describe("buildGraphSvg", () => {
  it("draws one <g> per node and one per edge, with the technology label always present", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "Socle", kind: "group" },
      { id: "B", label: "Ryloth", kind: "group" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 3, label: "HTTP ×3", attenuated: false }];
    const layout = await computeLayout(nodes, edges);
    const colorFor = (tech: string) => colourForTechnologies(["HTTP"]).get(tech) ?? "#000";

    const svg = buildGraphSvg(layout, colorFor);

    expect(svg.tagName.toLowerCase()).toBe("svg");
    expect(svg.querySelectorAll("text").length).toBeGreaterThanOrEqual(3); // 2 node labels + 1 edge label
    expect(svg.textContent).toContain("HTTP ×3");
  });

  it("renders an attenuated edge as dashed with reduced opacity", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: true }];
    const layout = await computeLayout(nodes, edges);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const path = svg.querySelector("path[stroke-dasharray]");
    expect(path).not.toBeNull();
  });

  it("colours a node by its perimeter: solid blue inside the platform, grey outside", async () => {
    const layout = await computeLayout(
      [
        { id: "A", label: "Tatooine", kind: "platform" },
        { id: "B", label: "Bespin", kind: "actor", external: true },
      ],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }]
    );

    const svg = buildGraphSvg(layout, () => "#2a78d6");
    const boxes = [...svg.querySelectorAll(".fx-nodes rect")];

    // Les teintes viennent de styleDuNoeud, seule source : les recopier ici
    // ferait échouer ce test au premier ajustement de contraste, sans que rien
    // n'ait cessé de fonctionner.
    const bleu = boxes.find((r) => r.getAttribute("fill") === styleDuNoeud({ kind: "platform", external: false }).fill);
    const gris = boxes.find((r) => r.getAttribute("fill") === styleDuNoeud({ kind: "actor", external: true }).fill);
    expect(bleu).not.toBeUndefined();
    expect(gris).not.toBeUndefined();
    expect(bleu!.getAttribute("fill")).not.toBe(gris!.getAttribute("fill"));
    // L'externe se distingue aussi par la forme, pas seulement par la couleur.
    expect(gris!.getAttribute("stroke-dasharray")).toBe("8 5");
  });

  it("renders a node's «type» and description under its name (style C4)", async () => {
    const nodes: GraphNode[] = [{ id: "A", label: "Tatooine", kind: "platform", subtitle: "Middleware", description: "Bus d'échange principal" }];
    const layout = await computeLayout(nodes, []);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const texts = [...svg.querySelectorAll("g > text")].map((t) => t.textContent);
    expect(texts).toContain("Tatooine");
    // Le type est écrit entre crochets sous le nom, convention C4.
    expect(texts).toContain("[Middleware]");
    expect(texts).toContain("Bus d'échange principal");
  });

  it("omits the «type»/description lines when a node has none (aggregated groupe with no matching acteurs)", async () => {
    const nodes: GraphNode[] = [{ id: "A", label: "Socle", kind: "group" }];
    const layout = await computeLayout(nodes, []);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    expect(svg.querySelectorAll("g > text")).toHaveLength(1);
  });

  // L'icône n'est plus déduite du type : elle est DÉSIGNÉE par le classeur.
  it("draws the icon designated for the node, and marks an external actor in its type line and border", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "Hoth", kind: "actor", subtitle: "Partenaire", external: true, icon: "handshake" },
    ];
    const layout = await computeLayout(nodes, []);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const nodeGroups = [...svg.querySelectorAll(".fx-nodes g")];
    const iconGroup = nodeGroups.find((g) => g.children.length === 5 && [...g.children].every((c) => c.tagName === "path"));
    expect(iconGroup).not.toBeUndefined();

    const box = svg.querySelector(".fx-nodes rect")!;
    expect(box.getAttribute("stroke-dasharray")).toBe("8 5");

    const texts = [...svg.querySelectorAll("g > text")].map((t) => t.textContent);
    expect(texts).toContain("[Partenaire · External]");
  });

  it("falls back to the neutral token when the workbook designates nothing, or names an icon that does not exist", async () => {
    const attendu = ICONES[ICONE_PAR_DEFAUT].length;
    for (const icon of [undefined, "licorne-violette"]) {
      const layout = await computeLayout([{ id: "A", label: "Tatooine", kind: "actor", subtitle: "Rituel", icon }], []);
      const svg = buildGraphSvg(layout, () => "#2a78d6");
      const groups = [...svg.querySelectorAll(".fx-nodes g")];
      expect(groups.some((g) => g.children.length === attendu)).toBe(true);
    }
  });

  it("renders the selected actor in inverted colors", async () => {
    const nodes: GraphNode[] = [{ id: "A", label: "Tatooine", kind: "focus-actor" }];
    const layout = await computeLayout(nodes, []);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const text = svg.querySelector("text")!;
    expect(text.getAttribute("fill")).toBe("#ffffff");
  });

  it("fuses same-technology edges arriving at the same target into one arrowed trunk, keeping each branch's own name", async () => {
    const layout: LayoutResult = {
      nodes: [
        { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
        { id: "C", label: "C", kind: "group", x: 0, y: 100, width: 80, height: 40 },
        { id: "B", label: "B", kind: "group", x: 200, y: 50, width: 80, height: 40 },
      ],
      edges: [
        {
          from: "A",
          to: "B",
          technology: "HTTP",
          count: 2,
          label: "Flux A",
          attenuated: false,
          // Les deux branches partagent le port d'entrée de B, donc la même
          // approche finale : c'est cette condition qui autorise la fusion.
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 20 },
            { x: 100, y: 50 },
            { x: 160, y: 50 },
          ],
          labelCentre: { x: 90, y: 15 },
        },
        {
          from: "C",
          to: "B",
          technology: "HTTP",
          count: 3,
          label: "Flux C",
          attenuated: false,
          points: [
            { x: 0, y: 100 },
            { x: 100, y: 80 },
            { x: 100, y: 50 },
            { x: 160, y: 50 },
          ],
          labelCentre: { x: 90, y: 90 },
        },
      ],
      width: 300,
      height: 150,
    };

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const paths = [...svg.querySelectorAll(".fx-edges g > path")];
    // Chaque branche est coupée en deux au droit de son libellé ; le tronc,
    // qui n'en porte pas, reste d'une pièce.
    expect(paths).toHaveLength(5);
    const arrowed = paths.filter((p) => p.hasAttribute("marker-end"));
    expect(arrowed).toHaveLength(1);
    // Le tronc porte le cumul des branches, mais son épaisseur reste celle de
    // tous les autres traits : l'agrégation ne doit pas produire d'effet de gras.
    const widths = new Set(paths.map((p) => p.getAttribute("stroke-width")));
    expect(widths).toEqual(new Set(["2"]));

    const labels = [...svg.querySelectorAll(".fx-labels text")].map((t) => t.textContent);
    expect(labels).toContain("Flux A");
    expect(labels).toContain("Flux C");
    // Le tronc ne porte pas de libellé propre.
    expect(svg.querySelectorAll(".fx-labels g")).toHaveLength(2);
  });

  it("leaves a single edge into a target unfused (own arrow, own path)", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }];
    const layout = await computeLayout(nodes, edges);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const paths = [...svg.querySelectorAll(".fx-edges g > path")];
    // Un seul flux : son tracé est coupé en deux au droit de son libellé, et
    // seul le dernier morceau porte la pointe.
    expect(paths).toHaveLength(2);
    expect(paths[0].hasAttribute("marker-end")).toBe(false);
    expect(paths[1].getAttribute("marker-end")).toBe("url(#arrow-12-2a78d6)");
  });

  it("keeps a deprecated (atténué) flow separate from active flows of the same technology into the same target", async () => {
    const layout: LayoutResult = {
      nodes: [
        { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
        { id: "B", label: "B", kind: "group", x: 200, y: 50, width: 80, height: 40 },
      ],
      edges: [
        {
          from: "A",
          to: "B",
          technology: "HTTP",
          count: 1,
          label: "Flux actif",
          attenuated: false,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 25 },
            { x: 200, y: 50 },
          ],
        },
        {
          from: "A",
          to: "B",
          technology: "HTTP",
          count: 1,
          label: "Flux à transformer",
          attenuated: true,
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 25 },
            { x: 200, y: 50 },
          ],
        },
      ],
      width: 300,
      height: 100,
    };

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const paths = [...svg.querySelectorAll(".fx-edges g > path")];
    expect(paths).toHaveLength(2); // pas de fusion malgré même cible + même techno
    expect(paths.filter((p) => p.hasAttribute("marker-end"))).toHaveLength(2);
    expect(paths.filter((p) => p.hasAttribute("stroke-dasharray"))).toHaveLength(1);
  });

  it("keeps the arrowhead a fixed size in user units, independent of the stroke width", async () => {
    const layout: LayoutResult = {
      nodes: [
        { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
        { id: "C", label: "C", kind: "group", x: 0, y: 100, width: 80, height: 40 },
        { id: "B", label: "B", kind: "group", x: 300, y: 50, width: 80, height: 40 },
      ],
      edges: [
        { from: "A", to: "B", technology: "HTTP", count: 40, label: "F1", attenuated: false, points: [{ x: 40, y: 0 }, { x: 260, y: 50 }] },
        { from: "C", to: "B", technology: "HTTP", count: 40, label: "F2", attenuated: false, points: [{ x: 40, y: 100 }, { x: 260, y: 50 }] },
      ],
      width: 400,
      height: 200,
    };

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const tronc = [...svg.querySelectorAll(".fx-edges g > path")].find((p) => p.hasAttribute("marker-end"))!;
    expect(tronc).toBeTruthy();

    const marker = svg.querySelector("marker")!;
    // Par défaut un marker se mesure en multiples de stroke-width : la pointe
    // de ce tronc aurait fait ~48px de large et aurait recouvert la boîte.
    expect(marker.getAttribute("markerUnits")).toBe("userSpaceOnUse");
    expect(Number(marker.getAttribute("markerWidth"))).toBeLessThanOrEqual(14);
  });

  it("contains the smoothed curve itself in the viewBox, not merely the points it was built from", async () => {
    // Le contournement d'un obstacle crée un virage serré : la spline lissée
    // déborde alors largement de sa polyligne de contrôle (jusqu'à ~100px
    // observés sur le classeur d'exemple) et sortait du cadre blanc.
    const nodes: GraphNode[] = [
      { id: "A", label: "Source", kind: "group" },
      { id: "C", label: "Obstacle sur la route", kind: "group" },
      { id: "B", label: "Cible", kind: "group" },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "C", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
      { from: "C", to: "B", technology: "Kafka", count: 1, label: "Kafka", attenuated: false },
      { from: "B", to: "A", technology: "JMS", count: 1, label: "JMS", attenuated: false }, // repart en arrière : détour garanti
    ];
    const layout = await computeLayout(nodes, edges);

    const svg = buildGraphSvg(layout, () => "#2a78d6");
    const [vbX, vbY, vbL, vbH] = svg.getAttribute("viewBox")!.split(" ").map(Number);

    // Rejoue les cubiques du tracé pour connaître les points RÉELLEMENT
    // dessinés (le d ne contient que les points de contrôle).
    function drawnPoints(d: string): { x: number; y: number }[] {
      const nombres = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      const rendus = [nombres[0]];
      for (let i = 1; i + 2 < nombres.length; i += 3) {
        const [p0, p1, p2, p3] = [nombres[i - 1], nombres[i], nombres[i + 1], nombres[i + 2]];
        for (let s = 1; s <= 20; s++) {
          const t = s / 20;
          const u = 1 - t;
          rendus.push({
            x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
            y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
          });
        }
      }
      return rendus;
    }

    for (const path of svg.querySelectorAll(".fx-edges g > path")) {
      for (const p of drawnPoints(path.getAttribute("d")!)) {
        expect(p.x).toBeGreaterThanOrEqual(vbX);
        expect(p.x).toBeLessThanOrEqual(vbX + vbL);
        expect(p.y).toBeGreaterThanOrEqual(vbY);
        expect(p.y).toBeLessThanOrEqual(vbY + vbH);
      }
    }
  });

  it("reserves room for the arrowheads in the viewBox, not just for the path endpoints", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }];
    const layout = await computeLayout(nodes, edges);

    const svg = buildGraphSvg(layout, () => "#2a78d6");

    const [vbX, vbY, vbL, vbH] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    const taillePointe = Number(svg.querySelector("marker")!.getAttribute("markerWidth"));
    for (const p of svg.querySelectorAll(".fx-edges g > path[marker-end]")) {
      const coords = [...p.getAttribute("d")!.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
      const bout = coords[coords.length - 1];
      expect(bout.x - taillePointe).toBeGreaterThanOrEqual(vbX);
      expect(bout.x + taillePointe).toBeLessThanOrEqual(vbX + vbL);
      expect(bout.y - taillePointe).toBeGreaterThanOrEqual(vbY);
      expect(bout.y + taillePointe).toBeLessThanOrEqual(vbY + vbH);
    }
  });

  it("colors the arrowhead marker to match its edge's technology, using a soft dart shape in the same bounding box as c4hero's marker", async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "Kafka", count: 1, label: "Kafka", attenuated: false }];
    const layout = await computeLayout(nodes, edges);

    const svg = buildGraphSvg(layout, () => "#ff6600");

    const marker = svg.querySelector("marker")!;
    expect(marker.querySelector("path")!.getAttribute("fill")).toBe("#ff6600");
    // Même boîte englobante (0..10, pointe en (10,5)) que le marker "c4-arrow"
    // de c4hero (Canvas.tsx) dont on part, mais un dard adouci (côtés
    // convexes, dos concave) plutôt que ses trois arêtes droites.
    expect(marker.getAttribute("viewBox")).toBe("0 0 10 10");
    expect(marker.querySelector("path")!.getAttribute("d")).toBe("M 0,0 Q 6,1 10,5 Q 6,9 0,10 Q 2.5,5 0,0 Z");
    // La pointe est portée par le dernier morceau du tracé, celui qui aborde
    // la cible -- les morceaux précédents s'arrêtent au libellé.
    const morceaux = [...svg.querySelectorAll(".fx-edges g > path[stroke]")];
    expect(morceaux[morceaux.length - 1].getAttribute("marker-end")).toBe(`url(#${marker.id})`);
  });
});

describe("buildGraphSvg — tracé orthogonal", () => {
  const troisPoints = (points: { x: number; y: number }[]): LayoutResult => ({
    nodes: [
      { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
      { id: "B", label: "B", kind: "group", x: 400, y: 200, width: 80, height: 40 },
    ],
    edges: [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, points }],
    width: 500,
    height: 300,
  });

  it("rounds a right-angle bend with a quadratic arc instead of a sharp corner", () => {
    const layout = troisPoints([
      { x: 40, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 200 },
      { x: 360, y: 200 },
    ]);

    const d = buildGraphSvg(layout, () => "#2a78d6").querySelector(".fx-edges g > path")!.getAttribute("d")!;

    // Un arc par coude, et aucun sommet laissé vif.
    expect([...d.matchAll(/Q /g)]).toHaveLength(2);
    expect(d).not.toContain("L 200,0 L");
  });

  it("leaves a collinear triple alone rather than emitting a degenerate arc on it", () => {
    const layout = troisPoints([
      { x: 40, y: 0 },
      { x: 200, y: 0 },
      { x: 360, y: 0 },
    ]);

    const d = buildGraphSvg(layout, () => "#2a78d6").querySelector(".fx-edges g > path")!.getAttribute("d")!;

    expect(d).not.toContain("Q ");
    expect(d).not.toContain("NaN");
  });

  it("stops the stroke short of the target so the arrowhead points at the box without biting into it", () => {
    const layout = troisPoints([
      { x: 40, y: 0 },
      { x: 360, y: 0 },
    ]);

    const svg = buildGraphSvg(layout, () => "#2a78d6");
    const d = svg.querySelector(".fx-edges g > path[marker-end]")!.getAttribute("d")!;
    const coords = [...d.matchAll(/(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/g)];
    const bout = Number(coords[coords.length - 1][1]);
    const taillePointe = Number(svg.querySelector("marker")!.getAttribute("markerWidth"));

    // Le trait s'arrête avant le point fourni par le moteur : la pointe occupe
    // la distance restante, plus un jeu avant la boîte.
    expect(bout).toBeLessThan(360 - taillePointe);
  });

  it("sizes the viewBox from the actual path, arrowhead footprint included", () => {
    const layout = troisPoints([
      { x: 40, y: 0 },
      { x: 200, y: -150 },
      { x: 360, y: 200 },
    ]);

    const svg = buildGraphSvg(layout, () => "#2a78d6");
    const [vbX, vbY, vbL, vbH] = svg.getAttribute("viewBox")!.split(" ").map(Number);

    // Le coude à y = -150 sort largement des deux boîtes : le cadre doit le contenir.
    expect(vbY).toBeLessThanOrEqual(-150);
    expect(vbX + vbL).toBeGreaterThanOrEqual(360);
    expect(vbY + vbH).toBeGreaterThanOrEqual(200);
  });
});

describe("buildGraphSvg — garde-fou de la fusion", () => {
  it("leaves flows unfused when they do not share their final approach, rather than cutting a shortcut", () => {
    const layout: LayoutResult = {
      nodes: [
        { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
        { id: "C", label: "C", kind: "group", x: 0, y: 200, width: 80, height: 40 },
        { id: "B", label: "B", kind: "group", x: 300, y: 100, width: 80, height: 40 },
      ],
      edges: [
        { from: "A", to: "B", technology: "HTTP", count: 1, label: "F1", attenuated: false,
          points: [{ x: 40, y: 0 }, { x: 200, y: 0 }, { x: 260, y: 100 }] },
        // Approche finale différente : fusionner reviendrait à relier les deux
        // par une diagonale qui ignore le routage.
        { from: "C", to: "B", technology: "HTTP", count: 1, label: "F2", attenuated: false,
          points: [{ x: 40, y: 200 }, { x: 200, y: 200 }, { x: 260, y: 140 }] },
      ],
      width: 400,
      height: 300,
    };

    const paths = [...buildGraphSvg(layout, () => "#2a78d6").querySelectorAll(".fx-edges g > path[stroke]")];

    // Deux flux, deux tracés, deux pointes : aucun tronc fabriqué.
    expect(paths).toHaveLength(2);
    expect(paths.filter((p) => p.hasAttribute("marker-end"))).toHaveLength(2);
  });
});

describe("buildGraphSvg — libellés d'arêtes", () => {
  const layoutAvecLabel = (label: string, technology: string): LayoutResult => ({
    nodes: [
      { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
      { id: "B", label: "B", kind: "group", x: 400, y: 0, width: 80, height: 40 },
    ],
    edges: [{ from: "A", to: "B", technology, count: 1, label, attenuated: false,
      points: [{ x: 40, y: 0 }, { x: 360, y: 0 }], labelCentre: { x: 200, y: 0 } }],
    width: 500,
    height: 200,
  });

  it("adds the technology on a second line only when the label says something else", () => {
    // « Par acteur » : le libellé est un nom d'interface, la technologie
    // complète l'intention.
    const avecIntention = buildGraphSvg(layoutAvecLabel("Colis à valider", "Kafka"), () => "#2a78d6");
    const rows = [...avecIntention.querySelectorAll(".fx-labels g")][0];
    expect([...rows.querySelectorAll("text")].map((t) => t.textContent)).toEqual(["Colis à valider", "[Kafka]"]);

    // Vue agrégée : le libellé EST la technologie, la répéter n'apprend rien.
    const aggregated = buildGraphSvg(layoutAvecLabel("Kafka ×3", "Kafka"), () => "#2a78d6");
    const seule = [...aggregated.querySelectorAll(".fx-labels g")][0];
    expect([...seule.querySelectorAll("text")].map((t) => t.textContent)).toEqual(["Kafka ×3"]);
  });

  it("paints labels after the boxes, so no box can cover a label", () => {
    const svg = buildGraphSvg(layoutAvecLabel("Colis à valider", "Kafka"), () => "#2a78d6");
    const couches = [...svg.querySelectorAll("svg > g")].map((g) => g.getAttribute("class"));

    // Ordre de dessin : frontières, arêtes, boîtes, libellés.
    expect(couches.indexOf("fx-labels")).toBeGreaterThan(couches.indexOf("fx-nodes"));
    expect(couches.indexOf("fx-nodes")).toBeGreaterThan(couches.indexOf("fx-edges"));
  });

});

describe("buildGraphSvg — légende", () => {
  it("draws the legend inside the SVG so it survives export, not in the surrounding page", async () => {
    const layout = await computeLayout(
      [
        { id: "A", label: "Tatooine", kind: "platform" },
        { id: "B", label: "Bespin", kind: "actor", external: true },
      ],
      [
        { from: "A", to: "B", technology: "Kafka", count: 1, label: "Kafka", attenuated: false },
        { from: "B", to: "A", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
      ]
    );

    const svg = buildGraphSvg(layout, (t) => (t === "Kafka" ? "#e0a83c" : "#d03b3b"));
    const legend = svg.querySelector(".fx-legend")!;
    expect(legend).not.toBeNull();

    const inputs = [...legend.querySelectorAll("text")].map((t) => t.textContent);
    // Une entrée par technologie présente, plus le code des périmètres. La
    // notation (bout fournisseur, pointes) est testée à part, dans legende.ts.
    expect(inputs.filter((t) => t !== "provider pushes" && t !== "consumer pulls")).toEqual([
      "HTTP",
      "Kafka",
      "Platform",
      "External",
    ]);

    // Elle tient dans le cadre : sinon elle serait rognée à l'export.
    const [vbX, vbY, vbL, vbH] = svg.getAttribute("viewBox")!.split(" ").map(Number);
    const frame = legend.querySelector("rect")!;
    const x = Number(frame.getAttribute("x"));
    const y = Number(frame.getAttribute("y"));
    expect(x).toBeGreaterThanOrEqual(vbX);
    expect(y).toBeGreaterThanOrEqual(vbY);
    expect(x + Number(frame.getAttribute("width"))).toBeLessThanOrEqual(vbX + vbL + 0.001);
    expect(y + Number(frame.getAttribute("height"))).toBeLessThanOrEqual(vbY + vbH + 0.001);
  });

  it("omits the perimeter key when every node sits on the same side of the platform", async () => {
    const layout = await computeLayout(
      [
        { id: "A", label: "A", kind: "group" },
        { id: "B", label: "B", kind: "group" },
      ],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }]
    );

    const inputs = [...buildGraphSvg(layout, () => "#d03b3b").querySelectorAll(".fx-legend text")].map((t) => t.textContent);
    expect(inputs).not.toContain("Platform");
    expect(inputs).not.toContain("External");
    expect(inputs).toContain("HTTP");
  });

  // Le mode fonctionnel vide `technologie` sur toutes ses arêtes : une entrée
  // sans nom annoncerait un code couleur qu'on ne retrouve nulle part sur le
  // dessin. La légende garde en revanche la NOTATION -- le cercle du bout
  // fournisseur est dessiné là aussi, et il doit s'expliquer.
  it("drops the legend entirely when every edge carries no technology name", async () => {
    const layout = await computeLayout(
      [
        { id: "A", label: "A", kind: "group" },
        { id: "B", label: "B", kind: "group" },
      ],
      [{ from: "A", to: "B", technology: "", count: 1, label: "", attenuated: false }]
    );

    const svg = buildGraphSvg(layout, () => "#2a78d6");
    expect(svg.querySelector(".fx-legend")).toBeNull();
  });

  it("keeps the named technologies and drops only the nameless ones", async () => {
    const layout = await computeLayout(
      [
        { id: "A", label: "A", kind: "group" },
        { id: "B", label: "B", kind: "group" },
        { id: "C", label: "C", kind: "group" },
      ],
      [
        { from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
        { from: "B", to: "C", technology: "", count: 1, label: "", attenuated: false },
      ]
    );

    const inputs = [...buildGraphSvg(layout, () => "#2a78d6").querySelectorAll(".fx-legend text")].map((t) => t.textContent);
    expect(inputs).toEqual(["HTTP"]);
  });
});

describe("buildGraphSvg — le libellé s'inscrit dans le trait", () => {
  const layoutWithLabel = (labelCentre: { x: number; y: number }): LayoutResult => ({
    nodes: [
      { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
      { id: "B", label: "B", kind: "group", x: 600, y: 0, width: 80, height: 40 },
    ],
    edges: [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false,
      points: [{ x: 40, y: 0 }, { x: 560, y: 0 }], labelCentre }],
    width: 700,
    height: 200,
  });

  it("interrupts the line where the label sits, and resumes behind it", () => {
    const svg = buildGraphSvg(layoutWithLabel({ x: 300, y: 0 }), () => "#2a78d6");
    const lines = [...svg.querySelectorAll(".fx-edges g > path[stroke]")];

    // Deux morceaux : avant le texte, puis après.
    expect(lines).toHaveLength(2);
    // Seul le dernier porte la pointe, celui qui aborde la cible.
    expect(lines.filter((p) => p.hasAttribute("marker-end"))).toHaveLength(1);
    expect(lines[1].hasAttribute("marker-end")).toBe(true);

    const coord = (p: Element, dernier: boolean) => {
      const tous = [...p.getAttribute("d")!.matchAll(/(-?[\d.]+),(-?[\d.]+)/g)];
      return Number((dernier ? tous[tous.length - 1] : tous[0])[1]);
    };
    // Le blanc encadre le texte, centré en x = 300.
    expect(coord(lines[0], true)).toBeLessThan(300);
    expect(coord(lines[1], false)).toBeGreaterThan(300);
  });

  it("writes the label as text with a white halo rather than inside a pill", () => {
    const svg = buildGraphSvg(layoutWithLabel({ x: 300, y: 0 }), () => "#2a78d6");
    const label = svg.querySelector(".fx-labels g")!;

    // Plus de rectangle : c'est le blanc du trait qui dégage le texte.
    expect(label.querySelector("rect")).toBeNull();
    const text = label.querySelector("text")!;
    expect(text.textContent).toBe("HTTP");
    // Le liseré protège des AUTRES traits, et se peint sous les lettres.
    expect(text.getAttribute("stroke")).toBe("#ffffff");
    expect(text.getAttribute("paint-order")).toBe("stroke");
  });

  it("leaves the line whole when the edge carries no label", () => {
    const layout: LayoutResult = {
      nodes: [
        { id: "A", label: "A", kind: "group", x: 0, y: 0, width: 80, height: 40 },
        { id: "B", label: "B", kind: "group", x: 600, y: 0, width: 80, height: 40 },
      ],
      edges: [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "", attenuated: false,
        points: [{ x: 40, y: 0 }, { x: 560, y: 0 }] }],
      width: 700,
      height: 200,
    };
    expect([...buildGraphSvg(layout, () => "#2a78d6").querySelectorAll(".fx-edges g > path[stroke]")]).toHaveLength(1);
  });
});

describe("légende — ce qu'elle annonce est ce que le dessin utilise", () => {
  const noeuds = [
    { id: "A", label: "A", kind: "actor" as const },
    { id: "B", label: "B", kind: "actor" as const },
  ];

  // Sur un schéma d'écart, aucun trait ne porte de couleur de technologie :
  // les énumérer annoncerait un code couleur qu'on ne trouve nulle part.
  it("names the écart colours and drops the technologies when every edge is marked", async () => {
    const svg = buildGraphSvg(
      await computeLayout(noeuds, [
        { from: "A", to: "B", technology: "HTTP", count: 1, label: "+1", attenuated: false, change: "added" },
        { from: "B", to: "A", technology: "SFTP", count: 1, label: "−1", attenuated: false, change: "removed" },
      ]),
      () => "#2a78d6"
    );
    const texts = [...svg.querySelectorAll(".fx-legend text")].map((t) => t.textContent);
    expect(texts.join(" ")).toContain("flows added");
    expect(texts.join(" ")).toContain("flows removed");
    expect(texts.join(" ")).not.toContain("HTTP");
    expect(texts.join(" ")).not.toContain("SFTP");
  });

  it("keeps naming the technologies on an ordinary diagram", async () => {
    const svg = buildGraphSvg(
      await computeLayout(noeuds, [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }]),
      () => "#2a78d6"
    );
    const texts = [...svg.querySelectorAll(".fx-legend text")].map((t) => t.textContent);
    expect(texts.join(" ")).toContain("HTTP");
    expect(texts.join(" ")).not.toContain("flows added");
  });
});

// --- QA : le fichier exporté doit se suffire à lui-même. Il héritait de la
// page deux choses qu'il ne nomme jamais -- la police, et les variables CSS
// des couleurs d'écart. Ouvert seul, un schéma Écarts sortait donc SANS AUCUN
// TRAIT (stroke résolu à « none »), avec des flèches noires, une pastille de
// légende vide, et tout le texte en serif alors que les largeurs d'étiquettes
// sont calibrées pour la police de la page.
describe("buildGraphSvg — le fichier se suffit à lui-même", () => {
  const change = async (direction: "added" | "removed") => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "group" },
      { id: "B", label: "B", kind: "group" },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, change: direction },
    ];
    return buildGraphSvg(await computeLayout(nodes, edges), () => "#2a78d6");
  };

  it("nomme sa police sur la racine", () => {
    const nodes: GraphNode[] = [{ id: "A", label: "A", kind: "group" }];
    return computeLayout(nodes, []).then((layout) => {
      const svg = buildGraphSvg(layout, () => "#2a78d6");
      expect(svg.getAttribute("font-family")).toBeTruthy();
    });
  });

  it("peint les écarts avec une couleur littérale, jamais une variable CSS", async () => {
    for (const direction of ["added", "removed"] as const) {
      const svg = await change(direction);
      expect(svg.outerHTML).not.toContain("var(--");
      const line = svg.querySelector("path[stroke]");
      expect(line?.getAttribute("stroke")).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});


// --- QA : le nom d'un acteur n'était ni mesuré ni tronqué, contrairement à sa
// description. Un nom long débordait de sa boîte (jusqu'à 128 px), recouvrait
// la boîte voisine et se faisait couper par le cadre du dessin -- 82 px perdus
// hors viewBox, illisibles à l'export comme à l'écran.
describe("buildGraphSvg — un nom long tient dans sa boîte", () => {
  const LONG = "Plateforme de règlement-livraison interbancaire et de conservation titres";

  const rendu = async () => {
    const nodes: GraphNode[] = [
      { id: "A", label: LONG, kind: "actor", icon: "app-window" },
      { id: "B", label: "Chandrila", kind: "actor", icon: "app-window" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }];
    return buildGraphSvg(await computeLayout(nodes, edges), () => "#2a78d6");
  };

  it("tronque le nom au lieu de le laisser déborder", async () => {
    const svg = await rendu();
    const name = [...svg.querySelectorAll("text")].find((t) => t.getAttribute("font-size") === "16")!;
    expect(name.textContent!.length).toBeLessThan(LONG.length);
    expect(name.textContent).toMatch(/…$/);
  });

  it("garde le nom entier accessible au hover", async () => {
    const svg = await rendu();
    expect([...svg.querySelectorAll("title")].map((t) => t.textContent)).toContain(LONG);
  });

  it("laisse un nom court intact et sans infobulle", async () => {
    const svg = await rendu();
    const courts = [...svg.querySelectorAll("text")].filter((t) => t.textContent === "Chandrila");
    expect(courts.length).toBe(1);
  });
});

// --- Le tracé suit la donnée, du fournisseur vers le consommateur. Quand
// c'est le consommateur qui appelle, l'initiative se lit sur la POINTE, posée
// au départ du trait : elle sort de la droite du fournisseur, longe le tuyau,
// et sa pointe désigne celui qu'on interroge.
describe("buildGraphSvg — la pointe d'un trait tiré", () => {
  const line = async (pulled: boolean) => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "actor" },
      { id: "B", label: "B", kind: "actor" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, pulled }];
    return buildGraphSvg(await computeLayout(nodes, edges), () => "#2a78d6");
  };

  it("pose la pointe au départ quand le consommateur appelle", async () => {
    const svg = await line(true);
    expect(svg.querySelector("path[marker-start]")).not.toBeNull();
    expect(svg.querySelector("path[marker-end]")).toBeNull();
  });

  it("la laisse à l'arrivée quand le fournisseur pousse", async () => {
    const svg = await line(false);
    expect(svg.querySelector("path[marker-end]")).not.toBeNull();
    expect(svg.querySelector("path[marker-start]")).toBeNull();
  });
});

// --- Un schéma doit se décrire lui-même (C4, règle n°1). Collé dans un
// ticket, un PNG ne disait ni son classeur, ni son palier, ni sa lecture.
describe("buildGraphSvg — le cartouche", () => {
  const context = {
    title: "Platform detail", reading: "architecture", milestone: "v2",
    source: "carto.xlsx", date: "2026-08-22", composants: 2, flows: 1, technologies: 1,
  };
  const estate = async () =>
    computeLayout(
      [{ id: "A", label: "A", kind: "group" }, { id: "B", label: "B", kind: "group" }],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }]
    );

  it("pose titre et description en enfants DIRECTS de <svg>, référencés par aria-labelledby", async () => {
    const svg = buildGraphSvg(await estate(), () => "#111", context);
    expect(svg.getAttribute("role")).toBe("img");
    const ids = (svg.getAttribute("aria-labelledby") ?? "").split(" ");
    expect(ids).toHaveLength(2);
    for (const id of ids) {
      const target = [...svg.children].find((c) => c.getAttribute("id") === id);
      expect(target, `#${id} doit être un enfant direct de <svg>`).toBeDefined();
    }
    expect(svg.querySelector(":scope > title")?.textContent).toBe("Platform detail — architecture reading, milestone v2");
  });

  it("écrit le cartouche sur le dessin, au-dessus du contenu", async () => {
    const svg = buildGraphSvg(await estate(), () => "#111", context);
    const texts = [...svg.querySelectorAll(".fx-titleblock text")].map((t) => t.textContent);
    expect(texts[0]).toContain("milestone v2");
    expect(texts[1]).toContain("carto.xlsx");
  });

  // Sans contexte, rien : un cartouche vide affirmerait moins que rien.
  it("n'ajoute ni rôle ni cartouche quand aucun contexte n'est fourni", async () => {
    const svg = buildGraphSvg(await estate(), () => "#111");
    expect(svg.getAttribute("role")).toBeNull();
    expect(svg.querySelector(".fx-titleblock")).toBeNull();
    expect(svg.querySelector(":scope > title")).toBeNull();
  });

  // La bande du cartouche doit être RÉSERVÉE : posée par-dessus, elle
  // recouvrirait la première rangée de boîtes.
  it("réserve sa bande dans le viewBox plutôt que de se poser par-dessus", async () => {
    const layout = await estate();
    const sans = buildGraphSvg(layout, () => "#111");
    const avec = buildGraphSvg(layout, () => "#111", context);
    const haut = (s: SVGSVGElement) => Number(s.getAttribute("viewBox")!.split(" ")[1]);
    expect(haut(avec)).toBeLessThan(haut(sans));
  });
});

// --- §2.5 : les huit teintes de la palette échouent à 4,5:1 comme encre, et
// écrire en couleur rendait le schéma illisible en niveaux de gris. Le rappel
// visuel passe par un disque, comme la matrix le fait déjà.
describe("buildGraphSvg — l'encre n'est pas la couleur du trait", () => {
  const estate = async (technology: string, label: string) =>
    computeLayout(
      [{ id: "A", label: "A", kind: "group" }, { id: "B", label: "B", kind: "group" }],
      [{ from: "A", to: "B", technology, count: 1, label, attenuated: false }]
    );

  it("écrit le libellé en encre et pose un disque de la couleur de la technologie", async () => {
    const svg = buildGraphSvg(await estate("HTTP", "HTTP"), () => "#eda100");
    for (const t of svg.querySelectorAll(".fx-labels text")) {
      expect(ratioDeContraste(t.getAttribute("fill")!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
    }
    expect(svg.querySelector(".fx-labels circle")?.getAttribute("fill")).toBe("#eda100");
  });

  // La lecture fonctionnelle vide `technologie` : un disque n'aurait rien à
  // rappeler, et il volerait la place du texte.
  it("ne pose pas de disque quand aucune technologie n'est nommée", async () => {
    const svg = buildGraphSvg(await estate("", "Policy events 1.0"), () => "#111111");
    expect(svg.querySelector(".fx-labels circle")).toBeNull();
  });

  // Le disque prend de la place : elle doit être réservée AVANT le placement,
  // sans quoi l'étiquette déborde de la boîte qu'ELK lui a gardée.
  it("réserve la place du disque dans la taille de la pastille", () => {
    expect(taillePastille("HTTP ×3", "HTTP").width).toBeGreaterThan(taillePastille("HTTP ×3", "").width);
  });
});

// --- QA : l'infobulle ne se posait qu'à partir de DEUX noms. Sur le classeur
// d'exemple, 23 arêtes sur 24 n'en portaient donc aucune, et le nom de
// l'échange n'était lisible nulle part.
describe("buildGraphSvg — l'infobulle des arêtes", () => {
  const estate = async (names: string[]) =>
    computeLayout(
      [{ id: "A", label: "A", kind: "group" }, { id: "B", label: "B", kind: "group" }],
      [{ from: "A", to: "B", technology: "HTTP", count: names.length, label: "HTTP", attenuated: false, names }]
    );

  it("pose l'infobulle même quand l'arête ne porte qu'un seul échange", async () => {
    const svg = buildGraphSvg(await estate(["Policy events 1.0"]), () => "#111");
    expect([...svg.querySelectorAll(".fx-edges title")].map((t) => t.textContent)).toContain("Policy events 1.0");
  });

  it("liste tous les noms d'un trait fusionné, un par ligne", async () => {
    const svg = buildGraphSvg(await estate(["A 1.0", "B 2.0"]), () => "#111");
    expect(svg.querySelector(".fx-edges title")?.textContent).toBe("A 1.0\nB 2.0");
  });

  // Une arête sans nom -- une vue agrégée qui ne les transporte pas -- ne doit
  // pas produire une infobulle vide, qui s'ouvrirait sur rien.
  it("ne pose rien quand l'arête ne porte aucun nom", async () => {
    const svg = buildGraphSvg(await estate([]), () => "#111");
    expect(svg.querySelector(".fx-edges title")).toBeNull();
  });
});

// --- §2.6 : une seule forme de nœud dans tout l'outil. Nature, agrégat et
// retrait ne se lisaient qu'à la couleur -- donc pas du tout à l'impression
// ni pour un daltonien (WCAG 1.4.1).
describe("buildGraphSvg — la forme redit ce que la couleur dit", () => {
  const estate = async (a: Partial<GraphNode>, b: Partial<GraphNode> = {}, e: Partial<GraphEdge> = {}) =>
    computeLayout(
      [{ id: "A", label: "A", kind: "actor", ...a }, { id: "B", label: "B", kind: "actor", ...b }],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, ...e }]
    );

  it("coupe le coin d'un acteur technique", async () => {
    const svg = buildGraphSvg(await estate({ technical: true }), () => "#111");
    expect(svg.querySelectorAll(".fx-nodes path.fx-cut-corner")).toHaveLength(1);
  });

  it("laisse la boîte rectangulaire pour un acteur métier", async () => {
    const svg = buildGraphSvg(await estate({}), () => "#111");
    expect(svg.querySelector(".fx-nodes path.fx-cut-corner")).toBeNull();
  });

  it("empile la boîte d'un nœud qui replie plusieurs acteurs", async () => {
    const svg = buildGraphSvg(await estate({ agrégat: 4 }), () => "#111");
    expect(svg.querySelectorAll(".fx-nodes .fx-stack rect").length).toBeGreaterThan(1);
  });

  // Un groupe d'un seul acteur ne cache rien : l'empiler affirmerait le
  // contraire.
  it("n'empile pas un groupe d'un seul acteur", async () => {
    const svg = buildGraphSvg(await estate({ agrégat: 1 }), () => "#111");
    expect(svg.querySelector(".fx-nodes .fx-stack")).toBeNull();
  });

  it("met en pointillé le trait d'un retrait", async () => {
    const svg = buildGraphSvg(await estate({}, {}, { change: "removed" }), () => "#111");
    expect(svg.querySelector(".fx-edges path")?.getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("laisse le trait d'un ajout plein", async () => {
    const svg = buildGraphSvg(await estate({}, {}, { change: "added" }), () => "#111");
    expect(svg.querySelector(".fx-edges path")?.getAttribute("stroke-dasharray")).toBeNull();
  });
});

// --- §2.9 : le SVG portait ses dimensions en dur, donc débordait de sa zone --
// 47 % visible sur le classeur d'exemple -- sans aucun moyen de le ramener.
describe("buildGraphSvg — la taille du schéma", () => {
  const estate = async () =>
    computeLayout(
      [{ id: "A", label: "A", kind: "group" }, { id: "B", label: "B", kind: "group" }],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false }]
    );

  // Le viewBox pilote le CADRAGE, width/height la taille d'affichage. Les
  // deux, et cohérents : étirer le SVG à la largeur de la fenêtre ramenait
  // l'échelle à 0,5x sur le classeur d'exemple, donc la légende à 5 px.
  it("pose un viewBox ET les dimensions du dessin, accordés", async () => {
    const svg = buildGraphSvg(await estate(), () => "#111");
    const [, , l, h] = svg.getAttribute("viewBox")!.split(/\s+/);
    expect(svg.getAttribute("width")).toBe(l);
    expect(svg.getAttribute("height")).toBe(h);
  });

  // Le FICHIER doit dire sa taille : sans width ni height, un .svg s'ouvre à
  // une dimension arbitraire dans Word ou PowerPoint.
  it("repose les dimensions dans le fichier exporté, depuis le viewBox", async () => {
    const svg = buildGraphSvg(await estate(), () => "#111");
    const [, , l, h] = svg.getAttribute("viewBox")!.split(/\s+/);
    const text = serializeSvg(svg, "#ffffff");
    expect(text).toContain(`width="${l}"`);
    expect(text).toContain(`height="${h}"`);
  });
});


// --- Ce qui distingue un flux poussé d'un flux tiré, c'est la FORME de la
// pointe, pas sa position : la position seule aurait demandé de savoir quel
// bout du trait est le fournisseur, ce que le dessin ne dit pas.
describe("buildGraphSvg — deux formes de pointe", () => {
  const estate = async (pulled: boolean) =>
    computeLayout(
      [{ id: "F", label: "F", kind: "actor" }, { id: "C", label: "C", kind: "actor" }],
      [{ from: "F", to: "C", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, pulled }]
    );
  const pointeDe = (svg: SVGSVGElement, attribut: string) => {
    const url = svg.querySelector(`.fx-edges [${attribut}]`)!.getAttribute(attribut)!;
    return svg.querySelector(`#${url.slice(5, -1)} path`)!;
  };

  it("remplit la pointe d'un flux poussé", async () => {
    const svg = buildGraphSvg(await estate(false), () => "#1f5fae");
    const head = pointeDe(svg, "marker-end");
    expect(head.getAttribute("fill")).toBe("#1f5fae");
    expect(head.getAttribute("stroke")).toBeNull();
  });

  // Une SILHOUETTE différente, pas seulement un remplissage : un dard évidé et
  // un dard plein se confondent à petite taille et à l'impression.
  it("dessine un V ouvert pour un flux tiré", async () => {
    const svg = buildGraphSvg(await estate(true), () => "#1f5fae");
    const head = pointeDe(svg, "marker-start");
    expect(head.getAttribute("fill")).toBe("none");
    expect(head.getAttribute("stroke")).toBe("#1f5fae");
    // Ouvert : le tracé ne se referme pas.
    expect(head.getAttribute("d")).not.toContain("Z");
  });

  it("garde les deux pointes dans la même boîte englobante, pour que le recul du trait ne change pas", async () => {
    const plein = pointeDe(buildGraphSvg(await estate(false), () => "#1f5fae"), "marker-end");
    const creux = pointeDe(buildGraphSvg(await estate(true), () => "#1f5fae"), "marker-start");
    const extremeX = (d: string) => Math.max(...(d.match(/[\d.]+(?=,)/g) ?? []).map(Number));
    expect(extremeX(creux.getAttribute("d")!)).toBe(extremeX(plein.getAttribute("d")!));
  });

  // Les deux marqueurs portent des identifiants distincts : partagés, la
  // seconde définition écraserait la première et les deux flux sortiraient de
  // la même forme.
  it("déclare deux marqueurs distincts quand les deux sens coexistent", async () => {
    const layout = await computeLayout(
      [{ id: "F", label: "F", kind: "actor" }, { id: "C", label: "C", kind: "actor" }, { id: "D", label: "D", kind: "actor" }],
      [
        { from: "F", to: "C", technology: "HTTP", count: 1, label: "a", attenuated: false, pulled: false },
        { from: "F", to: "D", technology: "HTTP", count: 1, label: "b", attenuated: false, pulled: true },
      ]
    );
    const svg = buildGraphSvg(layout, () => "#1f5fae");
    const ids = [...svg.querySelectorAll("defs marker")].map((m) => m.getAttribute("id"));
    expect(new Set(ids).size).toBe(ids.length);
    // Les deux formes coexistent pour la MÊME couleur : partagées, la seconde
    // définition écraserait la première.
    expect(ids.some((i) => /^arrow-\d+-1f5fae$/.test(i!))).toBe(true);
    expect(ids.some((i) => /^arrow-hollow-\d+-1f5fae$/.test(i!))).toBe(true);
  });

  // La pointe déborde du bout du trait : sans raccourcissement, l'échantillon
  // de légende empiétait sur le texte de sa propre entrée.
  it("garde l'échantillon fléché à l'intérieur de sa colonne", async () => {
    const svg = buildGraphSvg(await estate(true), () => "#1f5fae");
    const texts = [...svg.querySelectorAll(".fx-legend text")];
    const gauche = Math.min(...texts.map((t) => Number(t.getAttribute("x"))));
    for (const l of svg.querySelectorAll(".fx-legend line[marker-end]")) {
      expect(Number(l.getAttribute("x2"))).toBeLessThanOrEqual(gauche);
    }
    for (const l of svg.querySelectorAll(".fx-legend line[marker-start]")) {
      expect(Number(l.getAttribute("x1")) - 12).toBeGreaterThanOrEqual(
        Math.min(...[...svg.querySelectorAll(".fx-legend rect")].map((r) => Number(r.getAttribute("x"))))
      );
    }
  });
});

// --- QA : ELK sort d'une boîte par un stub perpendiculaire à la face, parfois
// de 5 px, puis tourne. Une pointe de 12 px y dépassait le coude et se
// retrouvait plantée sur le segment suivant, de côté -- le trait semblait
// arriver par le flanc de la flèche. 14 arêtes sur 24 du classeur d'exemple.
describe("buildGraphSvg — la pointe tient dans le segment qui la porte", () => {
  const avecApproche = (longueur: number): LayoutResult => ({
    width: 400,
    height: 200,
    nodes: [
      { id: "A", label: "A", kind: "actor", x: 40, y: 100, width: 80, height: 40 },
      { id: "B", label: "B", kind: "actor", x: 300, y: 20, width: 80, height: 40 },
    ],
    edges: [
      {
        from: "A",
        to: "B",
        technology: "HTTP",
        count: 1,
        label: "HTTP",
        attenuated: false,
        // Un long trajet, puis un coude, puis le stub d'approche.
        points: [{ x: 80, y: 100 }, { x: 260, y: 100 }, { x: 260, y: 40 }, { x: 260 + longueur, y: 40 }],
      },
    ],
  });

  const tailleDeLaPointe = (longueur: number): number => {
    const svg = buildGraphSvg(avecApproche(longueur), () => "#1f5fae");
    const url = svg.querySelector(".fx-edges [marker-end]")!.getAttribute("marker-end")!;
    return Number(svg.querySelector(`#${url.slice(5, -1)}`)!.getAttribute("markerWidth"));
  };

  it("garde la pleine taille quand l'approche est assez longue", () => {
    expect(tailleDeLaPointe(40)).toBe(12);
  });

  // Le cas du classeur réel : un stub de 5 px.
  it("rétrécit la pointe sur une approche courte", () => {
    expect(tailleDeLaPointe(5)).toBeLessThan(12);
  });

  // Elle doit TENIR : sinon elle dépasse le coude, ce qui est le défaut même.
  it("ne pose jamais une pointe plus longue que son approche", () => {
    for (const longueur of [4, 5, 8, 10, 13, 16, 20, 40]) {
      expect(tailleDeLaPointe(longueur), `approche de ${longueur} px`).toBeLessThanOrEqual(Math.max(5, longueur));
    }
  });
});

// --- §A3 : la graisse du trait est la variable de Bertin faite pour l'ORDRE.
// Elle est volontairement uniforme ailleurs -- faire varier l'épaisseur avec le
// NOMBRE de flux écrasait les voisins -- mais ce raisonnement valait pour un
// volume, pas pour un ordre.
describe("buildGraphSvg — la graisse suit la criticité", () => {
  const estate = async (criticality?: string) =>
    computeLayout(
      [{ id: "A", label: "A", kind: "actor" }, { id: "B", label: "B", kind: "actor" }],
      [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, criticality }]
    );
  const graisse = (svg: SVGSVGElement) => Number(svg.querySelector(".fx-edges path")!.getAttribute("stroke-width"));

  it("épaissit le trait critique quand le réglage est actif", async () => {
    expect(graisse(buildGraphSvg(await estate("1 - Critical"), () => "#111", null, { weightByCriticality: true }))).toBeGreaterThan(2);
  });

  it("amincit le trait standard", async () => {
    expect(graisse(buildGraphSvg(await estate("3 - Standard"), () => "#111", null, { weightByCriticality: true }))).toBeLessThan(2);
  });

  // Désactivé, rien ne bouge : la graisse sert ailleurs à ne RIEN dire, et les
  // deux usages ne se mélangent pas.
  it("garde une graisse uniforme quand le réglage est inactif", async () => {
    expect(graisse(buildGraphSvg(await estate("1 - Critical"), () => "#111"))).toBe(2);
  });

  // Une criticité non renseignée ne doit pas produire un trait invisible.
  it("garde la graisse par défaut sur une criticité absente", async () => {
    expect(graisse(buildGraphSvg(await estate(undefined), () => "#111", null, { weightByCriticality: true }))).toBe(2);
  });

  it("annonce les graisses employées dans la légende", async () => {
    const svg = buildGraphSvg(await estate("1 - Critical"), () => "#111", null, { weightByCriticality: true });
    const texts = [...svg.querySelectorAll(".fx-legend text")].map((t) => t.textContent);
    expect(texts).toContain("criticality: 1 - Critical");
    expect(texts).not.toContain("criticality: 3 - Standard");
  });
});
