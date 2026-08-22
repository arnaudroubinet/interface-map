import { describe, it, expect } from "vitest";
import { entreesDeLegende } from "../render/legende";
import type { PlanchePlacée } from "./drawio-export";
import { construireDrawio } from "./drawio-export";
import { computeLayout, type LayoutResult } from "../layout/graph-layout";
import { buildGraphSvg } from "../render/svg-builder";
import type { GraphNode, GraphEdge } from "../aggregation/core";

function layout(o: Partial<LayoutResult> = {}): LayoutResult {
  return {
    nodes: [
      { id: "A", label: "A", kind: "acteur", sousTitre: "Application", description: "Un texte", x: 0, y: 0, width: 240, height: 120 },
      { id: "B", label: "B", kind: "acteur", externe: true, x: 400, y: 0, width: 240, height: 120 },
    ],
    edges: [
      { from: "A", to: "B", technologie: "HTTP", count: 1, label: "F", atténué: false, points: [{ x: 240, y: 60 }, { x: 400, y: 60 }] },
    ],
    width: 640,
    height: 120,
    ...o,
  };
}

const couleur = () => "#336699";

const planche = (l: LayoutResult, titre = "v") => [{ titre, layout: l }];

// Le libellé d'une boîte est du HTML rangé dans un attribut XML : c'est en
// relisant le fichier comme draw.io le relit qu'on voit ce qu'il affichera.
function boite(xml: string, id: string): Element {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.querySelector(`UserObject[id="${id}"]`)!;
}

const valeurDe = (xml: string, id: string) => boite(xml, id).getAttribute("label")!;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function geometrie(xml: string, id: string): Rect {
  const g = boite(xml, id).querySelector("mxGeometry")!;
  const nombre = (a: string) => Number(g.getAttribute(a));
  return { x: nombre("x"), y: nombre("y"), width: nombre("width"), height: nombre("height") };
}

// Ce que draw.io dessinera dans la PAGE : la géométrie d'un enfant se lit dans
// le repère de son cadre, il faut donc remonter la chaîne des parents pour
// retrouver le rectangle que l'œil verra.
function rectAbsolu(xml: string, id: string): Rect {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const rect = geometrie(xml, id);
  let courant = doc.querySelector(`UserObject[id="${id}"]`);
  while (courant) {
    const parentId = courant.querySelector("mxCell")!.getAttribute("parent")!;
    courant = doc.querySelector(`UserObject[id="${parentId}"]`);
    if (!courant) break;
    const g = courant.querySelector("mxGeometry")!;
    rect.x += Number(g.getAttribute("x"));
    rect.y += Number(g.getAttribute("y"));
  }
  return rect;
}

const memeRect = (a: Rect, b: Rect) =>
  ["x", "y", "width", "height"].every((c) => Math.abs(a[c as keyof Rect] - b[c as keyof Rect]) < 1e-6);

describe("construireDrawio", () => {
  // Un fichier que l'analyseur refuse, draw.io le refuse aussi : ce contrôle
  // passe avant tout ce que le fichier peut bien contenir.
  it("produces XML a parser accepts", () => {
    const l = layout();
    l.nodes[0].label = "A & <B>";
    l.nodes[0].description = 'Avec "guillemets" & signes';
    const doc = new DOMParser().parseFromString(construireDrawio(planche(l, "Group & co"), couleur), "application/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
  });

  it("produces a drawio file holding one diagram", () => {
    const xml = construireDrawio(planche(layout(), "Group to group"), couleur);
    expect(xml).toContain("<mxfile");
    expect(xml).toContain('<diagram name="Group to group"');
    expect(xml).toContain("<mxGraphModel");
  });

  // Le placement est déjà calculé pour l'écran : le refaire dans draw.io
  // donnerait une autre planche que celle qu'on vient de regarder.
  it("keeps the geometry the diagram was laid out with", () => {
    const xml = construireDrawio(planche(layout()), couleur);
    // Le placement donne le CENTRE de B en (400, 0) ; draw.io lit un coin
    // haut-gauche, soit (400 - 240/2, 0 - 120/2).
    expect(geometrie(xml, "p0_B")).toEqual({ x: 280, y: -60, width: 240, height: 120 });
  });

  it("carries the name, the type and the description into the box", () => {
    const valeur = valeurDe(construireDrawio(planche(layout()), couleur), "p0_A");
    expect(valeur).toContain("<b>A</b>");
    expect(valeur).toContain("[Application]");
    expect(valeur).toContain("Un texte");
  });

  it("colours an edge with the colour its technology has on screen", () => {
    const xml = construireDrawio(planche(layout()), couleur);
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
    expect(valeurDe(construireDrawio(planche(l), couleur), "p0_A")).toContain("A &amp; &lt;B&gt;");
  });

  it("gives every board its own tab", () => {
    const xml = construireDrawio(
      [
        { titre: "Group to group", layout: layout() },
        { titre: "HTTP", layout: layout() },
        { titre: "Tatooine", layout: layout() },
      ],
      couleur
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
    const xml = construireDrawio(
      [
        { titre: "Un", layout: layout() },
        { titre: "Deux", layout: layout() },
      ],
      couleur
    );
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const ids = [...doc.querySelectorAll("mxCell, UserObject")]
      .map((c) => c.getAttribute("id"))
      .filter(Boolean);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // Ce que la boîte ne peut pas montrer, draw.io sait le garder à côté : une
  // infobulle au survol, et les colonnes du classeur dans « Modifier les
  // données ».
  it("carries what the box cannot show as shape data", () => {
    const b = boite(construireDrawio(planche(layout()), couleur), "p0_A");
    expect(b.getAttribute("tooltip")).toBe("Un texte");
    expect(b.getAttribute("type")).toBe("Application");
  });

  // Soixante onglets ne se parcourent pas à la main : cliquer un acteur doit
  // ouvrir la planche qui le détaille.
  it("links a box to the board that details it", () => {
    const xml = construireDrawio(
      [
        { titre: "Group to group", layout: layout() },
        { titre: "B (actor)", acteur: "B", layout: layout() },
      ],
      couleur
    );
    expect(boite(xml, "p0_B").getAttribute("link")).toBe("data:page/id,page_1");
    // Sur sa propre planche, la boîte ne renvoie pas vers elle-même.
    expect(boite(xml, "p1_B").getAttribute("link")).toBeNull();
  });

  // Un type de flux et un acteur peuvent porter le même nom : le lien vise la
  // planche qui déclare l'acteur, quel que soit l'ordre des onglets -- s'en
  // remettre à l'ordre d'insertion, c'est n'avoir raison que par hasard.
  it("links a box to the actor board, never to the flow type tab of the same name", () => {
    const xml = construireDrawio(
      [
        { titre: "B (actor)", acteur: "B", layout: layout() },
        { titre: "B (technology)", layout: layout() },
      ],
      couleur
    );
    expect(boite(xml, "p1_B").getAttribute("link")).toBe("data:page/id,page_0");
  });

  // La frontière de plateforme est un cadre qui contient ses boîtes : draw.io
  // place un enfant relativement au COIN HAUT-GAUCHE de son parent, pas dans
  // la page. Un écart de centre à centre ne serait un décalage juste que si le
  // cadre et la boîte avaient la même taille -- ils ne l'ont jamais.
  it("places a boxed child relative to the frame that holds it", () => {
    const l = layout({
      nodes: [
        { id: "F", label: "Platform", kind: "frontiere", x: 100, y: 50, width: 500, height: 300 },
        { id: "A", label: "A", kind: "acteur", parent: "F", x: 130, y: 90, width: 240, height: 120 },
      ],
      edges: [],
    });
    const xml = construireDrawio(planche(l), couleur);
    // Coin du cadre : (100 - 250, 50 - 150) = (-150, -100). Coin de A :
    // (130 - 120, 90 - 60) = (10, 30). D'où le relatif (160, 130).
    const g = geometrie(xml, "p0_A");
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
      { id: "F", label: "Platform", kind: "frontiere" },
      { id: "A", label: "Tatooine", kind: "acteur", parent: "F", sousTitre: "Application" },
      { id: "B", label: "Geonosis", kind: "acteur", parent: "F" },
      { id: "C", label: "Mustafar", kind: "acteur", parent: "F", description: "Un texte un peu plus long" },
      { id: "D", label: "Takodana", kind: "acteur", externe: true },
    ];
    const edges: GraphEdge[] = [
      { from: "A", to: "B", technologie: "HTTP", count: 1, label: "HTTP", atténué: false },
      { from: "B", to: "C", technologie: "SFTP", count: 2, label: "SFTP", atténué: false },
      { from: "C", to: "D", technologie: "HTTP", count: 1, label: "HTTP", atténué: false },
    ];
    const l = await computeLayout(nodes, edges);
    const xml = construireDrawio(planche(l, "Platform detail"), couleur);

    const rectsPeints = [...buildGraphSvg(l, couleur).querySelectorAll("rect")].map((r) => ({
      x: Number(r.getAttribute("x")),
      y: Number(r.getAttribute("y")),
      width: Number(r.getAttribute("width")),
      height: Number(r.getAttribute("height")),
    }));

    for (const n of l.nodes) {
      const déclaré = rectAbsolu(xml, `p0_${n.id}`);
      const peint = { x: n.x - n.width / 2, y: n.y - n.height / 2, width: n.width, height: n.height };
      expect(
        rectsPeints.some((r) => memeRect(r, déclaré)),
        `${n.label} : draw.io ${JSON.stringify(déclaré)}, écran ${JSON.stringify(peint)}`
      ).toBe(true);
    }
  });
});

// --- Le tracé suit la donnée, la pointe dit l'initiative : draw.io doit
// raconter la même chose que le schéma à l'écran, sans quoi le fichier ouvert
// dans l'outil de dessin contredirait celui d'où il sort.
describe("export draw.io — un trait tiré", () => {
  const xml = async (tire: boolean) => {
    const nodes: GraphNode[] = [
      { id: "A", label: "A", kind: "acteur" },
      { id: "B", label: "B", kind: "acteur" },
    ];
    const edges: GraphEdge[] = [{ from: "A", to: "B", technologie: "HTTP", count: 1, label: "HTTP", atténué: false, tire }];
    const layout = await computeLayout(nodes, edges);
    return construireDrawio([{ titre: "T", layout }], () => "#2a78d6");
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
  const planche = (): PlanchePlacée => ({
    titre: "Platform detail",
    contexte: {
      titre: "Platform detail", lecture: "architecture", palier: "v2",
      source: "carto.xlsx", date: "2026-08-22", composants: 2, flux: 1, technologies: 1,
    },
    layout: {
      width: 400, height: 200,
      nodes: [
        { id: "A", label: "A", kind: "acteur", x: 60, y: 60, width: 80, height: 40 },
        { id: "B", label: "B", kind: "acteur", externe: true, x: 300, y: 60, width: 80, height: 40 },
      ],
      edges: [{ from: "A", to: "B", technologie: "HTTP", count: 1, label: "HTTP", atténué: false, points: [{ x: 100, y: 60 }, { x: 260, y: 60 }] }],
    },
  });

  it("pose le titre de la planche sur la page", () => {
    expect(construireDrawio([planche()], () => "#111")).toContain("Platform detail — architecture reading, milestone v2");
  });

  it("reprend la MÊME légende que le SVG, entrée pour entrée", () => {
    const p = planche();
    const xml = construireDrawio([p], () => "#111");
    for (const e of entreesDeLegende(p.layout.edges, p.layout.nodes, () => "#111")) {
      expect(xml, `entrée « ${e.texte} » absente`).toContain(e.texte);
    }
  });

  // La légende ne doit pas se poser SUR le dessin : c'est un bloc à côté,
  // comme dans le SVG.
  it("pose la légende sous la boîte englobante des nœuds", () => {
    const xml = construireDrawio([planche()], () => "#111");
    const y = Number(/id="p0_legende_0"[\s\S]*?y="(-?\d+)"/.exec(xml)![1]);
    expect(y).toBeGreaterThan(80);
  });

  // Sans contexte, pas de cartouche inventé : le titre de la planche suffit.
  it("se contente du titre de la planche quand aucun contexte n'est fourni", () => {
    const sans = { ...planche(), contexte: undefined };
    const xml = construireDrawio([sans], () => "#111");
    expect(xml).toContain("Platform detail");
    expect(xml).not.toContain("milestone");
  });
});
