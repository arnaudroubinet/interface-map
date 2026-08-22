import { el } from "../shared/dom";
import type { Ecarts, Difference } from "../aggregation/changes";

// Ce qui a bougé entre deux paliers. Trois blocs, un par nature d'objet, et
// dans chacun les arrivées puis les départs -- l'ordre dans lequel on raconte
// un changement.
function block(title: string, difference: Difference): HTMLElement {
  const total = difference.ajoutes.length + difference.retires.length;
  const section = el("details", { class: "changes-block", open: "" });
  section.appendChild(el("summary", {}, [`${title} (${total})`]));

  if (total === 0) {
    section.appendChild(el("p", { class: "no-flow" }, ["Nothing changed."]));
    return section;
  }

  for (const [classe, signe, values] of [
    ["change-added", "+", difference.ajoutes],
    ["change-removed", "−", difference.retires],
  ] as const) {
    if (values.length === 0) continue;
    const list = el("ul", { class: classe });
    for (const value of values) {
      list.appendChild(el("li", {}, [`${signe} ${value}`]));
    }
    section.appendChild(list);
  }
  return section;
}

export function buildEcartsReport(changes: Ecarts, avant: string, apres: string): HTMLElement {
  const racine = el("div", { class: "changes" });
  racine.appendChild(
    el("p", { class: "changes-header" }, [`What changes between milestone ${avant} and milestone ${apres}.`])
  );
  racine.appendChild(block("Actors", changes.actors));
  racine.appendChild(block("Interfaces", changes.interfaces));
  racine.appendChild(block("Consumptions", changes.consumptions));
  return racine;
}

// Le schéma se titre : il dit de lui-même ce qu'il montre grâce aux soldes
// signés, mais rien n'indiquerait sans cela QUELS paliers il compare ni à
// quelle échelle il est dessiné.
export function buildEcartsTitreSchema(avant: string, apres: string): HTMLElement {
  return el("h2", { class: "changes-diagram-title" }, [
    `What moves between ${avant} and ${apres} — platform detail`,
  ]);
}
