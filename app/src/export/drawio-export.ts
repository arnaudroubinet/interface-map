import type { LayoutResult, LayoutNode, LayoutEdge } from "../layout/graph-layout";
import { legendEntries } from "../render/legend";
import { titleBlockText, type DiagramContext } from "../render/title-block";
import { subLabel } from "../layout/graph-layout";

// Toutes les planches, dans un fichier qu'on peut rouvrir et retoucher : une
// par onglet, comme draw.io présente ses pages. C'est le pendant modifiable des
// exports d'image, au placement près -- celui qu'ELK a calculé, repris tel
// quel. Le refaire dans draw.io donnerait d'autres planches que celles qu'on
// regardait.

const XML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const escapeXml = (v: string) => v.replace(/[&<>"]/g, (c) => XML[c]);

// Le gabarit C4 de draw.io, celui-là même dont le placement reprend les cotes :
// nom en gras, type entre crochets, description en dessous.
//
// Un libellé est du HTML transporté dans un attribut XML : le texte du classeur
// y passe donc DEUX échappements, un pour le HTML que draw.io rendra, un pour
// l'attribut qui le porte. N'en faire qu'un produit un fichier qu'aucun
// analyseur XML n'ouvre -- draw.io compris.
function content(n: LayoutNode): string {
  const pieces = [`<b>${escapeXml(n.label)}</b>`];
  if (n.subtitle) pieces.push(`[${escapeXml(n.subtitle)}]`);
  if (n.description) pieces.push(`<br/>${escapeXml(n.description)}`);
  return pieces.join("<div></div>");
}

const FILL: Record<string, { fill: string; line: string; text: string }> = {
  boundary: { fill: "none", line: "#7f8c9a", text: "#14181f" },
  external: { fill: "#8d9aa8", line: "#6b7684", text: "#ffffff" },
  normal: { fill: "#2a6fbb", line: "#1c4f88", text: "#ffffff" },
};

function nodeStyle(n: LayoutNode): string {
  const key = n.kind === "boundary" ? "boundary" : n.external ? "external" : "normal";
  const c = FILL[key];
  const frame = n.kind === "boundary";
  return [
    "rounded=1",
    "arcSize=8",
    "whiteSpace=wrap",
    "html=1",
    `fillColor=${c.fill}`,
    `strokeColor=${c.line}`,
    `fontColor=${c.text}`,
    frame ? "dashed=1;verticalAlign=top;align=left;spacingLeft=10;spacingTop=6" : "verticalAlign=middle;align=center",
  ].join(";");
}

function edgeLabelMode(e: LayoutEdge): string {
  const sous = subLabel(e.label, e.technology);
  return sous ? `${escapeXml(e.label)}<div></div>${escapeXml(sous)}` : escapeXml(e.label ?? "");
}

export interface PlacedBoard {
  title: string;
  // Ce que la page dit d'elle-même : le même bloc que le cartouche du SVG.
  // draw.io est le format DESTINÉ À CIRCULER, et ses pages partaient sans.
  context?: DiagramContext;
  // L'acteur que la planche détaille, quand elle en détaille un : c'est vers
  // elle que pointe la boîte de cet acteur, où qu'elle apparaisse.
  actor?: string;
  layout: LayoutResult;
}

// Un onglet par planche : le fichier porte tout ce que l'outil sait dessiner,
// et draw.io les présente comme il présente ses pages. Rouvrir le classeur pour
// en tirer une seule vue reviendrait à refaire le travail à chaque fois.
export function buildDrawio(
  boards: PlacedBoard[],
  technologyColour: (technology: string) => string
): string {
  // La planche d'un acteur se déclare comme telle : c'est ce qui permet,
  // depuis n'importe quelle boîte, d'ouvrir la page qui détaille cet acteur.
  // Chercher par le titre viserait aussi bien l'onglet du type de flux
  // homonyme -- « HTTP » nomme aussi bien une technologie qu'un acteur.
  const byActorPage = new Map(
    boards.flatMap((p, i) => (p.actor ? [[p.actor, `page_${i}`] as [string, string]] : []))
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mxfile host="carte-des-interfaces">',
    ...boards.flatMap((p, i) => diagram(p, i, technologyColour, byActorPage)),
    "</mxfile>",
    "",
  ].join("\n");
}

// Le cartouche et la légende, en cellules draw.io. Les entrées viennent de la
// même fonction que celles du SVG : deux légendes divergentes pour un même
// schéma sont précisément ce qu'on veut rendre impossible.
function explanatoryBlocks(
  { title, context, layout }: PlacedBoard,
  cellule: (id: string) => string,
  technologyColour: (technology: string) => string
): string[] {
  const xs = layout.nodes.flatMap((n) => [n.x - n.width / 2, n.x + n.width / 2]);
  const ys = layout.nodes.flatMap((n) => [n.y - n.height / 2, n.y + n.height / 2]);
  if (xs.length === 0) return [];
  const gauche = Math.min(...xs);
  const bas = Math.max(...ys);
  const cells: string[] = [];

  const text = (id: string, value: string, x: number, y: number, l: number, h: number, style: string) =>
    cells.push(
      `        <mxCell id="${cellule(id)}" value="${escapeXml(value)}" style="${style}" vertex="1" parent="${cellule("1")}">`,
      `          <mxGeometry x="${Math.round(x)}" y="${Math.round(y)}" width="${l}" height="${h}" as="geometry" />`,
      "        </mxCell>"
    );

  const yCartouche = Math.min(...ys) - 64;
  const header = context ? titleBlockText(context) : { title, subtitle: "" };
  text("cartouche_t", header.title, gauche, yCartouche, 720, 24, "text;html=1;align=left;verticalAlign=middle;fontSize=16;fontStyle=1");
  if (header.subtitle) {
    text("cartouche_s", header.subtitle, gauche, yCartouche + 24, 720, 20, "text;html=1;align=left;verticalAlign=middle;fontSize=11;fontColor=#5b6472");
  }

  const inputs = legendEntries(layout.edges, layout.nodes, technologyColour);
  inputs.forEach((input, i) => {
    const y = bas + 48 + i * 22;
    const e = input.sample;
    if (e.shape === "line") {
      const style = [
        "html=1",
        `strokeColor=${e.colour}`,
        "strokeWidth=2",
        e.dashed ? "dashed=1" : "dashed=0",
        e.head === "start" ? "startArrow=block;startFill=0;endArrow=none" : "endArrow=block;endFill=1;startArrow=none",
      ].join(";");
      cells.push(
        `        <mxCell id="${cellule(`legende_${i}`)}" style="${style}" edge="1" parent="${cellule("1")}">`,
        `          <mxGeometry relative="1" as="geometry"><mxPoint x="${Math.round(gauche)}" y="${Math.round(y)}" as="sourcePoint" /><mxPoint x="${Math.round(gauche + 34)}" y="${Math.round(y)}" as="targetPoint" /></mxGeometry>`,
        "        </mxCell>"
      );
    } else {
      text(
        `legende_${i}`,
        "",
        gauche,
        y - 6,
        34,
        12,
        `rounded=0;html=1;fillColor=${e.fill};strokeColor=${e.stroke}${e.dashed ? ";dashed=1" : ""}`
      );
    }
    text(`legende_t_${i}`, input.text, gauche + 42, y - 10, 320, 20, "text;html=1;align=left;verticalAlign=middle;fontSize=11");
  });

  return cells;
}

function diagram(
  board: PlacedBoard,
  index: number,
  technologyColour: (technology: string) => string,
  byActorPage: Map<string, string>
): string[] {
  const { title, layout } = board;
  const parId = new Map(layout.nodes.map((n) => [n.id, n]));
  const cells: string[] = [];
  // Les identifiants sont uniques dans le FICHIER, pas dans la page : deux
  // planches citent presque toujours le même acteur, et draw.io rattacherait
  // alors les traits de l'une aux boîtes de l'autre.
  const cellule = (id: string) => `p${index}_${escapeXml(id)}`;

  for (const n of layout.nodes) {
    // Seul point du fichier où les deux conventions se rencontrent, et il a
    // déjà coûté un défaut livré : le placement donne le CENTRE d'une boîte
    // (voir graph-layout), draw.io lit un COIN haut-gauche. Sans la conversion,
    // chaque boîte glisse d'une demi-boîte.
    // Et draw.io place un enfant DANS son cadre : son coin se lit depuis le
    // coin du cadre. L'écart de centre à centre ne dirait la même chose que si
    // le cadre et la boîte avaient la même taille -- ils ne l'ont jamais.
    const parent = n.parent ? parId.get(n.parent) : undefined;
    const x = n.x - n.width / 2 - (parent ? parent.x - parent.width / 2 : 0);
    const y = n.y - n.height / 2 - (parent ? parent.y - parent.height / 2 : 0);
    // Un UserObject plutôt qu'un mxCell nu : c'est lui qui porte l'infobulle,
    // le lien et les données de forme, que draw.io montre dans « Modifier les
    // données ». Un mxCell ne sait porter qu'un libellé.
    const page = byActorPage.get(n.label);
    const attributs = [
      `id="${cellule(n.id)}"`,
      `label="${escapeXml(content(n))}"`,
      n.description ? `tooltip="${escapeXml(n.description)}"` : "",
      // Cliquer une boîte ouvre la planche de cet acteur, quand elle existe :
      // soixante onglets ne se parcourent pas à la main.
      page && page !== `page_${index}` ? `link="data:page/id,${page}"` : "",
      n.subtitle ? `type="${escapeXml(n.subtitle)}"` : "",
      n.external ? 'perimeter="External"' : "",
    ].filter(Boolean);
    cells.push(
      `        <UserObject ${attributs.join(" ")}>`,
      `          <mxCell style="${nodeStyle(n)}" vertex="1" parent="${parent ? cellule(parent.id) : cellule("1")}">`,
      `            <mxGeometry x="${x}" y="${y}" width="${n.width}" height="${n.height}" as="geometry" />`,
      "          </mxCell>",
      "        </UserObject>"
    );
  }

  layout.edges.forEach((e, i) => {
    const style = [
      "edgeStyle=orthogonalEdgeStyle",
      "rounded=1",
      "html=1",
      `strokeColor=${technologyColour(e.technology)}`,
      "strokeWidth=2",
      e.attenuated ? "dashed=1" : "dashed=0",
      // Le trait va toujours du fournisseur au consommateur -- c'est le sens de
      // la donnée. La pointe, elle, désigne celui qui est sollicité : à
      // l'arrivée quand le fournisseur pousse, au départ quand le consommateur
      // appelle. Retourner le trait à la place ferait remonter la donnée, et
      // draw.io raconterait autre chose que le schéma d'où il sort.
      ...(e.pulled
        ? ["startArrow=block", "startFill=1", "endArrow=none"]
        : ["endArrow=block", "endFill=1", "startArrow=none"]),
    ].join(";");
    cells.push(
      `        <mxCell id="${cellule(`e${i}`)}" value="${escapeXml(
        edgeLabelMode(e)
      )}" style="${style}" edge="1" parent="${cellule("1")}" source="${cellule(e.from)}" target="${cellule(e.to)}">`,
      '          <mxGeometry relative="1" as="geometry" />',
      "        </mxCell>"
    );
  });

  return [
    `  <diagram name="${escapeXml(title)}" id="page_${index}">`,
    // tooltips et fold ne sont pas décoratifs : sans eux draw.io n'affiche pas
    // les infobulles et ne replie pas la frontière de plateforme.
    `    <mxGraphModel dx="${Math.round(layout.width)}" dy="${Math.round(
      layout.height
    )}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0">`,
    "      <root>",
    `        <mxCell id="${cellule("0")}" />`,
    `        <mxCell id="${cellule("1")}" parent="${cellule("0")}" />`,
    ...cells,
    ...explanatoryBlocks(board, cellule, technologyColour),
    "      </root>",
    "    </mxGraphModel>",
    "  </diagram>",
  ];
}
