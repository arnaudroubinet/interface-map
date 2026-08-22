import type { IntegrityReport } from "../integrity/checks";

const SVG_NS = "http://www.w3.org/2000/svg";

// Icônes Lucide (https://lucide.dev, licence ISC) : « check » pour une section
// saine, « octagon-x » pour une alerte -- l'octogone est le panneau stop, il se
// distingue de la coche sans dépendre de la seule couleur.
const PATHS: Record<string, string[]> = {
  check: ["M20 6 9 17l-5-5"],
  stop: [
    "M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z",
    "m15 9-6 6",
    "m9 9 6 6",
  ],
  info: ["M12 16v-4", "M12 8h.01"],
  // « list-checks » : une liste à cocher, pas un panneau d'alerte. Une action
  // n'est pas un défaut du fichier, c'est du travail qui attend quelqu'un.
  action: ["M13 5h8", "M13 12h8", "M13 19h8", "m3 17 2 2 4-4", "m3 7 2 2 4-4"],
  // « triangle-alert » : l'avertissement se distingue de l'octogone d'erreur
  // par sa forme autant que par sa couleur.
  alert: [
    "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3",
    "M12 9v4",
    "M12 17h.01",
  ],
};

function icon(name: keyof typeof PATHS): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", "section-icon");
  if (name === "info") {
    const circle = document.createElementNS(SVG_NS, "circle");
    circle.setAttribute("cx", "12");
    circle.setAttribute("cy", "12");
    circle.setAttribute("r", "10");
    svg.appendChild(circle);
  }
  for (const d of PATHS[name]) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.appendChild(path);
  }
  return svg;
}

// Ce qu'une section signale quand elle n'est pas vide : une faute qui invalide
// les schémas, une saisie à trancher, ou une simple information.
type Severity = "error" | "action" | "warning" | "info";

const CSS_CLASS: Record<Severity, string> = {
  error: "section-alert",
  action: "section-action",
  warning: "section-warning",
  info: "section-info",
};
const ICON: Record<Severity, keyof typeof PATHS> = {
  error: "stop",
  action: "action",
  warning: "alert",
  info: "info",
};

// Une section sans rien à signaler est repliée : elle n'appelle aucune action,
// et la déplier ne montrerait qu'un « Rien à signaler ». Les sections qui
// portent quelque chose s'ouvrent d'office.
function buildSection(
  cssClass: string,
  title: string,
  description: string,
  items: string[],
  severity: Severity
): HTMLElement {
  const empty = items.length === 0;
  const section = document.createElement("details");
  section.className = `${cssClass} ${empty ? "section-ok" : CSS_CLASS[severity]}`;
  if (!empty) section.open = true;

  const summary = document.createElement("summary");
  summary.appendChild(icon(empty ? "check" : ICON[severity]));
  const label = document.createElement("span");
  label.textContent = `${title} (${items.length})`;
  summary.appendChild(label);
  section.appendChild(summary);

  const desc = document.createElement("p");
  desc.textContent = description;
  section.appendChild(desc);

  if (empty) {
    const nothing = document.createElement("p");
    nothing.className = "nothing-to-report";
    nothing.textContent = "Nothing to report.";
    section.appendChild(nothing);
  } else {
    const list = document.createElement("ul");
    for (const item of items) {
      const li = document.createElement("li");
      li.textContent = item;
      list.appendChild(li);
    }
    section.appendChild(list);
  }

  return section;
}

// Ordre de lecture : ce qui appelle une correction d'abord, ce qui n'appelle
// rien à la fin. Une section vide passe donc derrière toutes les autres, quelle
// que soit sa nature -- elle ne porte plus qu'une coche.
// Les actions passent avant les avertissements : elles s'adressent au lecteur,
// là où un avertissement ne fait que constater une saisie incomplète.
const RANK: Record<Severity, number> = { error: 0, action: 1, warning: 2, info: 3 };
const EMPTY_RANK = 4;

export interface ReportSection {
  cssClass: string;
  title: string;
  description: string;
  items: string[];
  severity: Severity;
}

// Le rapport à plat, dans son ordre de lecture. L'écran et le fichier Markdown
// le lisent tous deux d'ici : deux personnes regardant le même rapport, l'une à
// l'écran et l'autre dans un ticket, doivent y trouver les mêmes sections dans
// le même ordre.
export function sectionsDuRapport(report: IntegrityReport): ReportSection[] {
  const sections: ReportSection[] = [
    ...report.families.map((f) => ({
      cssClass: "block-anomalies",
      title: f.title,
      description: f.description,
      items: f.anomalies.map((a) => a.message),
      severity: "error" as Severity,
    })),
    // Un bloc informatif ne porte jamais de faute : au pire une décision en
    // attente (action) ou une saisie incomplète (avertissement).
    ...report.infoBlocks.map((b) => ({
      cssClass: "block-info",
      title: b.title,
      description: b.description,
      items: b.items,
      severity: b.level,
    })),
  ];

  const rank = (s: ReportSection) => (s.items.length === 0 ? EMPTY_RANK : RANK[s.severity]);
  // Tri stable : à rang égal, les sections gardent l'ordre où les contrôles
  // les ont produites.
  return [...sections].sort((a, b) => rank(a) - rank(b));
}

export function buildIntegrityReport(report: IntegrityReport): HTMLElement {
  const container = document.createElement("div");
  container.className = "integrity-report";

  for (const s of sectionsDuRapport(report)) {
    container.appendChild(buildSection(s.cssClass, s.title, s.description, s.items, s.severity));
  }

  return container;
}
