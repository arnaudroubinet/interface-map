import type { LayoutResult, LayoutNode, LayoutEdge } from "../layout/graph-layout";
import { sousLibellé } from "../layout/graph-layout";

// Toutes les planches, dans un fichier qu'on peut rouvrir et retoucher : une
// par onglet, comme draw.io présente ses pages. C'est le pendant modifiable des
// exports d'image, au placement près -- celui qu'ELK a calculé, repris tel
// quel. Le refaire dans draw.io donnerait d'autres planches que celles qu'on
// regardait.

const XML: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };
const échapper = (v: string) => v.replace(/[&<>"]/g, (c) => XML[c]);

// Le gabarit C4 de draw.io, celui-là même dont le placement reprend les cotes :
// nom en gras, type entre crochets, description en dessous.
//
// Un libellé est du HTML transporté dans un attribut XML : le texte du classeur
// y passe donc DEUX échappements, un pour le HTML que draw.io rendra, un pour
// l'attribut qui le porte. N'en faire qu'un produit un fichier qu'aucun
// analyseur XML n'ouvre -- draw.io compris.
function contenu(n: LayoutNode): string {
  const morceaux = [`<b>${échapper(n.label)}</b>`];
  if (n.sousTitre) morceaux.push(`[${échapper(n.sousTitre)}]`);
  if (n.description) morceaux.push(`<br/>${échapper(n.description)}`);
  return morceaux.join("<div></div>");
}

const REMPLISSAGE: Record<string, { fond: string; trait: string; texte: string }> = {
  frontiere: { fond: "none", trait: "#7f8c9a", texte: "#14181f" },
  externe: { fond: "#8d9aa8", trait: "#6b7684", texte: "#ffffff" },
  normal: { fond: "#2a6fbb", trait: "#1c4f88", texte: "#ffffff" },
};

function styleNoeud(n: LayoutNode): string {
  const clé = n.kind === "frontiere" ? "frontiere" : n.externe ? "externe" : "normal";
  const c = REMPLISSAGE[clé];
  const cadre = n.kind === "frontiere";
  return [
    "rounded=1",
    "arcSize=8",
    "whiteSpace=wrap",
    "html=1",
    `fillColor=${c.fond}`,
    `strokeColor=${c.trait}`,
    `fontColor=${c.texte}`,
    cadre ? "dashed=1;verticalAlign=top;align=left;spacingLeft=10;spacingTop=6" : "verticalAlign=middle;align=center",
  ].join(";");
}

function libelléArête(e: LayoutEdge): string {
  const sous = sousLibellé(e.label, e.technologie);
  return sous ? `${échapper(e.label)}<div></div>${échapper(sous)}` : échapper(e.label ?? "");
}

export interface PlanchePlacée {
  titre: string;
  // L'acteur que la planche détaille, quand elle en détaille un : c'est vers
  // elle que pointe la boîte de cet acteur, où qu'elle apparaisse.
  acteur?: string;
  layout: LayoutResult;
}

// Un onglet par planche : le fichier porte tout ce que l'outil sait dessiner,
// et draw.io les présente comme il présente ses pages. Rouvrir le classeur pour
// en tirer une seule vue reviendrait à refaire le travail à chaque fois.
export function construireDrawio(
  planches: PlanchePlacée[],
  couleurTechnologie: (technologie: string) => string
): string {
  // La planche d'un acteur se déclare comme telle : c'est ce qui permet,
  // depuis n'importe quelle boîte, d'ouvrir la page qui détaille cet acteur.
  // Chercher par le titre viserait aussi bien l'onglet du type de flux
  // homonyme -- « HTTP » nomme aussi bien une technologie qu'un acteur.
  const pageParActeur = new Map(
    planches.flatMap((p, i) => (p.acteur ? [[p.acteur, `page_${i}`] as [string, string]] : []))
  );
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mxfile host="carte-des-interfaces">',
    ...planches.flatMap((p, i) => diagramme(p, i, couleurTechnologie, pageParActeur)),
    "</mxfile>",
    "",
  ].join("\n");
}

function diagramme(
  { titre, layout }: PlanchePlacée,
  index: number,
  couleurTechnologie: (technologie: string) => string,
  pageParActeur: Map<string, string>
): string[] {
  const parId = new Map(layout.nodes.map((n) => [n.id, n]));
  const cellules: string[] = [];
  // Les identifiants sont uniques dans le FICHIER, pas dans la page : deux
  // planches citent presque toujours le même acteur, et draw.io rattacherait
  // alors les traits de l'une aux boîtes de l'autre.
  const cellule = (id: string) => `p${index}_${échapper(id)}`;

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
    const page = pageParActeur.get(n.label);
    const attributs = [
      `id="${cellule(n.id)}"`,
      `label="${échapper(contenu(n))}"`,
      n.description ? `tooltip="${échapper(n.description)}"` : "",
      // Cliquer une boîte ouvre la planche de cet acteur, quand elle existe :
      // soixante onglets ne se parcourent pas à la main.
      page && page !== `page_${index}` ? `link="data:page/id,${page}"` : "",
      n.sousTitre ? `type="${échapper(n.sousTitre)}"` : "",
      n.externe ? 'perimeter="External"' : "",
    ].filter(Boolean);
    cellules.push(
      `        <UserObject ${attributs.join(" ")}>`,
      `          <mxCell style="${styleNoeud(n)}" vertex="1" parent="${parent ? cellule(parent.id) : cellule("1")}">`,
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
      `strokeColor=${couleurTechnologie(e.technologie)}`,
      "strokeWidth=2",
      e.atténué ? "dashed=1" : "dashed=0",
      // Le trait va toujours du fournisseur au consommateur -- c'est le sens de
      // la donnée. La pointe, elle, désigne celui qui est sollicité : à
      // l'arrivée quand le fournisseur pousse, au départ quand le consommateur
      // appelle. Retourner le trait à la place ferait remonter la donnée, et
      // draw.io raconterait autre chose que le schéma d'où il sort.
      ...(e.tire
        ? ["startArrow=block", "startFill=1", "endArrow=none"]
        : ["endArrow=block", "endFill=1", "startArrow=none"]),
    ].join(";");
    cellules.push(
      `        <mxCell id="${cellule(`e${i}`)}" value="${échapper(
        libelléArête(e)
      )}" style="${style}" edge="1" parent="${cellule("1")}" source="${cellule(e.from)}" target="${cellule(e.to)}">`,
      '          <mxGeometry relative="1" as="geometry" />',
      "        </mxCell>"
    );
  });

  return [
    `  <diagram name="${échapper(titre)}" id="page_${index}">`,
    // tooltips et fold ne sont pas décoratifs : sans eux draw.io n'affiche pas
    // les infobulles et ne replie pas la frontière de plateforme.
    `    <mxGraphModel dx="${Math.round(layout.width)}" dy="${Math.round(
      layout.height
    )}" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="1169" pageHeight="826" math="0" shadow="0">`,
    "      <root>",
    `        <mxCell id="${cellule("0")}" />`,
    `        <mxCell id="${cellule("1")}" parent="${cellule("0")}" />`,
    ...cellules,
    "      </root>",
    "    </mxGraphModel>",
    "  </diagram>",
  ];
}
