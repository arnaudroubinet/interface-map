import { describe, it, expect } from "vitest";
import { legendEntries } from "../render/legend";
import type { PlacedBoard } from "./drawio-export";
import { buildDrawio } from "./drawio-export";
import { computeLayout, type LayoutResult } from "../layout/graph-layout";
import { buildGraphSvg } from "../render/svg-builder";
import type { GraphNode, GraphEdge } from "../aggregation/core";

function layout(o: Partial<LayoutResult> = {}): LayoutResult {
  return {
    nodes: [
      { id: "A", label: "A", kind: "actor", subtitle: "Application", description: "Un texte", x: 0, y: 0, width: 240, height: 120 },
      { id: "B", label: "B", kind: "actor", external: true, x: 400, y: 0, width: 240, height: 120 },
    ],
    edges: [
      { from: "A", to: "B", technology: "HTTP", count: 1, label: "F", attenuated: false, points: [{ x: 240, y: 60 }, { x: 400, y: 60 }] },
    ],
    width: 640,
    height: 120,
    ...o,
  };
}

const colour = () => "#336699";

const board = (l: LayoutResult, title = "v") => [{ title, layout: l }];

// Le libellé d'une boîte est du HTML rangé dans un attribut XML : c'est en
// relisant le fichier comme draw.io le relit qu'on voit ce qu'il affichera.
function box(xml: string, id: string): Element {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.querySelector(`UserObject[id="${id}"]`)!;
}

const valueOf = (xml: string, id: string) => box(xml, id).getAttribute("label")!;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function geometry(xml: string, id: string): Rect {
  const g = box(xml, id).querySelector("mxGeometry")!;
  const number = (a: string) => Number(g.getAttribute(a));
  return { x: number("x"), y: number("y"), width: number("width"), height: number("height") };
}

// Ce que draw.io dessinera dans la PAGE : la géométrie d'un enfant se lit dans
// le repère de son cadre, il faut donc remonter la chaîne des parents pour
// retrouver le rectangle que l'œil verra.
function absoluteRect(xml: string, id: string): Rect {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const rect = geometry(xml, id);
  let current = doc.querySelector(`UserObject[id="${id}"]`);
  while (current) {
    const parentId = current.querySelector("mxCell")!.getAttribute("parent")!;
    current = doc.querySelector(`UserObject[id="${parentId}"]`);
    if (!current) break;
    const g = current.querySelector("mxGeometry")!;
    rect.x += Number(g.getAttribute("x"));
    rect.y += Number(g.getAttribute("y"));
  }
  return rect;
}

const sameRect = (a: Rect, b: Rect) =>
  ["x", "y", "width", "height"].every((c) => Math.abs(a[c as keyof Rect] - b[c as keyof Rect]) < 1e-6);

describe("construireDrawio", () => {
  // Un fichier que l'analyseur refuse, draw.io le refuse aussi : ce contrôle
  // passe avant tout ce que le fichier peut bien contenir.
  it("produces XML a parser accepts", () => {
    const l = layout();
    l.nodes[0].label = "A & <B>";
    l.nodes[0].description = 'Avec "guillemets" & signes';
    const doc = new DOMParser().parseFromString(buildDrawio(board(l, "Group & co"), colour), "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
  });

  it("produces a drawio file holding one diagram", () => {
    const xml = buildDrawio(board(layout(), "Group to group"), colour);
    expect(xml).toContain("<mxfile");
    expect(xml).toContain('<diagram name="Group to group"');
    expect(xml).toContain("<mxGraphModel");
  });

  // Le placement est déjà calculé pour l'écran : le refaire dans draw.io
  // donnerait une autre planche que celle qu'on vient de regarder.
  it("keeps the geometry the diagram was laid out with", () => {
    const xml = buildDrawio(board(layout()), colour);
    // Le placement donne le CENTRE de B en (400, 0) ; draw.io lit un coin
    // haut-gauche, soit (400 - 240/2, 0 - 120/2).
    expect(geometry(xml, "p0_B")).toEqual({ x: 280, y: -60, width: 240, height: 120 });
  });

  it("carries the name, the type and the description into the box", () => {
    const value = valueOf(buildDrawio(board(layout()), colour), "p0_A");
    expect(value).toContain("<b>A</b>");
    expect(value).toContain("[Application]");
    expect(value).toContain("Un texte");
  });

  it("colours an edge with the colour its technology has on screen", () => {
    const xml = buildDrawio(board(layout()), colour);
    expect(xml).toContain("strokeColor=#336699");
    expect(xml).toMatch(/source="[^"]*A"/);
    expect(xml).toMatch(/target="[^"]*B"/);
  });

  // Le nom traverse deux couches : l'attribut XML, puis le HTML que draw.io en
  // tire. Un seul échappement et « <B> » y deviendrait une balise.
  it("keeps a name that looks like markup readable as text", () => {
    const l = layout();
    l.nodes[0].label = "A & <B>";
    // Ce que draw.io lit dans l'attribut est du HTML : le nom y est encore
    // échappé une fois, et s'affichera donc tel qu'il a été saisi.
    expect(valueOf(buildDrawio(board(l), colour), "p0_A")).toContain("A &amp; &lt;B&gt;");
  });

  it("gives every board its own tab", () => {
    const xml = buildDrawio(
      [
        { title: "Group to group", layout: layout() },
        { title: "HTTP", layout: layout() },
        { title: "Tatooine", layout: layout() },
      ],
      colour
    );
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect([...doc.querySelectorAll("diagram")].map((d) => d.getAttribute("name"))).toEqual([
      "Group to group",
      "HTTP",
      "Tatooine",
    ]);
  });

  // Deux planches citent presque toujours le même acteur. Des identifiants
  // partagés et draw.io rattacherait les traits de l'une aux boîtes de l'autre.
  it("keeps the cells of one board out of the next", () => {
    const xml = buildDrawio(
      [
        { title: "Un", layout: layout() },
        { title: "Deux", layout: layout() },
      ],
      colour
    );
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const ids = [...doc.querySelectorAll("mxCell, UserObject")]
      .map((c) => c.getAttribute("id"))
      .filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Ce que la boîte ne peut pas montrer, draw.io sait le garder à côté : une
  // infobulle au hover, et les colonnes du classeur dans « Modifier les
  // données ».
  it("carries what the box cannot show as shape data", () => {
    const b = box(buildDrawio(board(layout()), colour), "p0_A");
    expect(b.getAttribute("tooltip")).toBe("Un texte");
    expect(b.getAttribute("type")).toBe("Application");
  });

  // Soixante onglets ne se parcourent pas à la main : cliquer un acteur doit
  // ouvrir la planche qui le détaille.
  it("links a box to the board that details it", () => {
    const xml = buildDrawio(
      [
        { title: "Group to group", layout: layout() },
        { title: "B (actor)", actor: "B", layout: layout() },
      ],
      colour
    );
    expect(box(xml, "p0_B").getAttribute("link")).toBe("data:page/id,page_1");
    // Sur sa propre planche, la boîte ne renvoie pas vers elle-même.
    expect(box(xml, "p1_B").getAttribute("link")).toBeNull();
  });

  // Un type de flux et un acteur peuvent porter le même nom : le lien vise la
  // planche qui déclare l'acteur, quel que soit l'ordre des onglets -- s'en
  // remettre à l'ordre d'insertion, c'est n'avoir raison que par hasard.
  it("links a box to the actor board, never to the flow type tab of the same name", () => {
    const xml = buildDrawio(
      [
        { title: "B (actor)", actor: "B", layout: layout() },
        { title: "B (technology)", layout: layout() },
      ],
      colour
    );
    expect(box(xml, "p1_B").getAttribute("link")).toBe("data:page/id,page_0");
  });

  // La frontière de plateforme est un cadre qui contient ses boîtes : draw.io
  // place un enfant relativement au COIN HAUT-GAUCHE de son parent, pas dans
  // la page. Un écart de centre à centre ne serait un décalage juste que si le
  // cadre et la boîte avaient la même taille -- ils ne l'ont jamais.
  it("places a boxed child relative to the frame that holds it", () => {
    const l = layout({
      nodes: [
        { id: "F", label: "Platform", kind: "boundary", x: 100, y: 50, width: 500, height: 300 },
        { id: "A", label: "A", kind: "actor", parent: "F", x: 130, y: 90, width: 240, height: 120 },
      ],
      edges: [],
    });
    const xml = buildDrawio(board(l), colour);
    // Coin du cadre : (100 - 250, 50 - 150) = (-150, -100). Coin de A :
    // (130 - 120, 90 - 60) = (10, 30). D'où le relatif (160, 130).
    const g = geometry(xml, "p0_A");
    expect(g).toEqual({ x: 160, y: 130, width: 240, height: 120 });
    // A tient tout entier dans F sur l'écran : ses coordonnées relatives sont
    // donc positives et sa boîte reste dans l'étendue du cadre.
    expect(g.x).toBeGreaterThanOrEqual(0);
    expect(g.y).toBeGreaterThanOrEqual(0);
    expect(g.x + g.width).toBeLessThanOrEqual(500);
    expect(g.y + g.height).toBeLessThanOrEqual(300);
  });

  // Deux moteurs dessinent le même placement : l'écran (SVG) et le fichier
  // draw.io. Ils ont divergé une fois d'une demi-boîte sans que rien ne le
  // dise ; ce contrôle les tient sur le même rectangle, dans le même repère.
  it("declares the same rectangles the SVG paints", async () => {
    const nodes: GraphNode[] = [
      { id: "F", label: "Platform", kind: "boundary" },
      { id: "A", label: "Tatooine", kind: "actor", parent: "F", subtitle: "Application" },
      { id: "B", label: "Geonosis", kind: "actor", parent: "F" },
      { id: "C", label: "Mustafar", kind: "actor", parent: "F", description: "Un texte un peu plus long" },
      { id: "D", label: "Takodana", kind: "actor", external: true },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
      { from: "B", to: "C", technology: "SFTP", count: 2, label: "SFTP", attenuated: false },
      { from: "C", to: "D", technology: "HTTP", count: 1, label: "HTTP", attenuated: false },
    ];
    const l = await computeLayout(nodes, edges);
    const xml = buildDrawio(board(l, "Platform detail"), colour);

    const paintedRects = [...buildGraphSvg(l, colour).querySelectorAll("rect")].map((r) => ({
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      width: Number(r.getAttribute("width")),
      height: Number(r.getAttribute("height")),
    }));

    for (const n of l.nodes) {
      const declared = absoluteRect(xml, `p0_${n.id}`);
      const painted = { x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height };
      expect(
        paintedRects.some((r) => sameRect(r, declared)),
        `${n.label} : draw.io ${JSON.stringify(declared)}, écran ${JSON.stringify(painted)}`
      ).toBe(true);
    }
  });
});

// --- Le tracé suit la donnée, la pointe dit l'initiative : draw.io doit
// raconter la même chose que le schéma à l'écran, sans quoi le fichier ouvert
// dans l'outil de dessin contredirait celui d'où il sort.
describe("export draw.io — un trait tiré", () => {
  const xml = async (pulled: boolean) => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "actor" },
      { id: "B", label: "B", kind: "actor" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, pulled }];
    const layout = await computeLayout(nodes, edges);
    return buildDrawio([{ title: "T", layout }], () => "#2a78d6");
  };

  it("retourne la pointe sans retourner le trait", async () => {
    const doc = await xml(true);
    expect(doc).toContain("startArrow=block");
    expect(doc).toContain("endArrow=none");
    // le trait part toujours du fournisseur
    expect(doc).toMatch(/source="[^"]*A"[^>]*target="[^"]*B"/);
  });

  it("laisse la pointe à l'arrivée quand le fournisseur pousse", async () => {
    const doc = await xml(false);
    expect(doc).toContain("endArrow=block");
    expect(doc).not.toContain("startArrow=block");
  });
});

// --- §2.14 : 23 pages sans légende ni titre, dans le format justement destiné
// à circuler.
describe("construireDrawio — chaque page se décrit", () => {
  const board = (): PlacedBoard => ({
    title: "Platform detail",
    context: {
      title: "Platform detail", reading: "architecture", milestone: "v2",
      source: "carto.xlsx", date: "2026-08-22", components: 2, flows: 1, technologies: 1,
    },
    layout: {
      width: 400, height: 200,
      nodes: [
        { id: "A", label: "A", kind: "actor", x: 60, y: 60, width: 80, height: 40 },
        { id: "B", label: "B", kind: "actor", external: true, x: 300, y: 60, width: 80, height: 40 },
      ],
      edges: [{ from: "A", to: "B", technology: "HTTP", count: 1, label: "HTTP", attenuated: false, points: [{ x: 100, y: 60 }, { x: 260, y: 60 }] }],
    },
  });

  it("pose le titre de la planche sur la page", () => {
    expect(buildDrawio([board()], () => "#111")).toContain("Platform detail — architecture reading, milestone v2");
  });

  it("reprend la MÊME légende que le SVG, entrée pour entrée", () => {
    const p = board();
    const xml = buildDrawio([p], () => "#111");
    for (const e of legendEntries(p.layout.edges, p.layout.nodes, () => "#111")) {
      expect(xml, `input « ${e.text} » absente`).toContain(e.text);
    }
  });

  // La légende ne doit pas se poser SUR le dessin : c'est un bloc à côté,
  // comme dans le SVG.
  it("pose la légende sous la boîte englobante des nœuds", () => {
    const xml = buildDrawio([board()], () => "#111");
    const y = Number(/id="p0_legende_0"[\s\S]*?y="(-?\d+)"/.exec(xml)![1]);
    expect(y).toBeGreaterThan(80);
  });

  // Sans contexte, pas de cartouche inventé : le titre de la planche suffit.
  it("se contente du titre de la planche quand aucun contexte n'est fourni", () => {
    const sans = { ...board(), context: undefined };
    const xml = buildDrawio([sans], () => "#111");
    expect(xml).toContain("Platform detail");
    expect(xml).not.toContain("milestone");
  });
});
