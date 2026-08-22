import { el } from "../shared/dom";
import type { Changes, Difference } from "../aggregation/changes";

// What moved between two milestones. Three blocks, one per kind of object, and
// within each the arrivals then the departures -- the order in which a change
// is told.
function block(title: string, difference: Difference): HTMLElement {
  const total = difference.ajoutes.length + difference.retires.length;
  const section = el("details", { class: "changes-block", open: "" });
  section.appendChild(el("summary", {}, [`${title} (${total})`]));

  if (total === 0) {
    section.appendChild(el("p", { class: "no-flow" }, ["Nothing changed."]));
    return section;
  }

  for (const [cssClass, sign, values] of [
    ["change-added", "+", difference.ajoutes],
    ["change-removed", "−", difference.retires],
  ] as const) {
    if (values.length === 0) continue;
    const list = el("ul", { class: cssClass });
    for (const value of values) {
      list.appendChild(el("li", {}, [`${sign} ${value}`]));
    }
    section.appendChild(list);
  }
  return section;
}

export function buildEcartsReport(changes: Changes, before: string, after: string): HTMLElement {
  const root = el("div", { class: "changes" });
  root.appendChild(
    el("p", { class: "changes-header" }, [`What changes between milestone ${before} and milestone ${after}.`])
  );
  root.appendChild(block("Actors", changes.actors));
  root.appendChild(block("Interfaces", changes.interfaces));
  root.appendChild(block("Consumptions", changes.consumptions));
  return root;
}

// The diagram titles itself: it says what it shows on its own thanks to the
// signed balances, but nothing would otherwise say WHICH milestones it
// compares, nor at what scale it is drawn.
export function buildChangesDiagramTitle(before: string, after: string): HTMLElement {
  return el("h2", { class: "changes-diagram-title" }, [
    `What moves between ${before} and ${after} — platform detail`,
  ]);
}
