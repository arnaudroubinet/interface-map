import type { IntegrityReport } from "../integrity/checks";

const SVG_NS = "http://www.w3.org/2000/svg";

// Lucide icons (https://lucide.dev, ISC licence): "check" for a sound section,
// "octagon-x" for an alert -- the octagon is the stop sign, and it tells itself
// apart from the tick without depending on colour alone.
const PATHS: Record<string, string[]> = {
  check: ["M20 6 9 17l-5-5"],
  stop: [
    "M2.586 16.726A2 2 0 0 1 2 15.312V8.688a2 2 0 0 1 .586-1.414l4.688-4.688A2 2 0 0 1 8.688 2h6.624a2 2 0 0 1 1.414.586l4.688 4.688A2 2 0 0 1 22 8.688v6.624a2 2 0 0 1-.586 1.414l-4.688 4.688a2 2 0 0 1-1.414.586H8.688a2 2 0 0 1-1.414-.586z",
    "m15 9-6 6",
    "m9 9 6 6",
  ],
  info: ["M12 16v-4", "M12 8h.01"],
  // "list-checks": a checklist, not a warning sign. An action is not a defect
  // in the file, it is work waiting for someone.
  action: ["M13 5h8", "M13 12h8", "M13 19h8", "m3 17 2 2 4-4", "m3 7 2 2 4-4"],
  // "triangle-alert": a warning tells itself apart from the error octagon by
  // its shape as much as by its colour.
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

// What a section reports when it is not empty: a fault that invalidates the
// diagrams, an entry to be decided, or plain information.
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

// A section with nothing to report is collapsed: it calls for no action, and
// unfolding it would show nothing but a "Nothing to report". Sections that
// carry something open by default.
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

// Reading order: what calls for a correction first, what calls for nothing at
// the end. An empty section therefore goes behind all the others, whatever its
// nature -- it carries nothing but a tick.
// Actions come before warnings: they address the reader, where a warning
// merely records an incomplete entry.
const RANK: Record<Severity, number> = { error: 0, action: 1, warning: 2, info: 3 };
const EMPTY_RANK = 4;

export interface ReportSection {
  cssClass: string;
  title: string;
  description: string;
  items: string[];
  severity: Severity;
}

// The report flattened, in its reading order. Both the screen and the Markdown
// file read it from here: two people looking at the same report, one on screen
// and the other in a ticket, must find the same sections there in the same
// order.
export function reportSections(report: IntegrityReport): ReportSection[] {
  const sections: ReportSection[] = [
    ...report.families.map((f) => ({
      cssClass: "block-anomalies",
      title: f.title,
      description: f.description,
      items: f.anomalies.map((a) => a.message),
      severity: "error" as Severity,
    })),
    // An informational block never carries a fault: at worst a pending decision
    // (action) or an incomplete entry (warning).
    ...report.infoBlocks.map((b) => ({
      cssClass: "block-info",
      title: b.title,
      description: b.description,
      items: b.items,
      severity: b.level,
    })),
  ];

  const rank = (s: ReportSection) => (s.items.length === 0 ? EMPTY_RANK : RANK[s.severity]);
  // Stable sort: at equal rank, sections keep the order the checks produced
  // them in.
  return [...sections].sort((a, b) => rank(a) - rank(b));
}

export function buildIntegrityReport(report: IntegrityReport): HTMLElement {
  const container = document.createElement("div");
  container.className = "integrity-report";

  // A workbook with anomalies opens HERE rather than on a diagram, and nothing
  // said so: the reader wondered where the drawings had gone. The diagrams are
  // one click away in the rail, and drawn all the same -- the report comes
  // first because a drawing of a workbook that breaks the rules looks right and
  // says wrong.
  if (report.totalAnomalies > 0) {
    const lead = document.createElement("p");
    lead.className = "integrity-lead";
    lead.textContent =
      "This workbook breaks some rules, so it opened on its report: a diagram of it would look right and say wrong. The views in the rail are drawn all the same.";
    container.appendChild(lead);
  }

  for (const s of reportSections(report)) {
    container.appendChild(buildSection(s.cssClass, s.title, s.description, s.items, s.severity));
  }

  return container;
}
