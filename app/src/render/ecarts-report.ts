import { el } from "../shared/dom";
import type { Ecarts, Difference } from "../aggregation/ecarts";

// Ce qui a bougé entre deux paliers. Trois blocs, un par nature d'objet, et
// dans chacun les arrivées puis les départs -- l'ordre dans lequel on raconte
// un changement.
function bloc(titre: string, difference: Difference): HTMLElement {
  const total = difference.ajoutes.length + difference.retires.length;
  const section = el("details", { class: "ecarts-bloc", open: "" });
  section.appendChild(el("summary", {}, [`${titre} (${total})`]));

  if (total === 0) {
    section.appendChild(el("p", { class: "aucun-flux" }, ["Nothing changed."]));
    return section;
  }

  for (const [classe, signe, valeurs] of [
    ["ecart-ajout", "+", difference.ajoutes],
    ["ecart-retrait", "−", difference.retires],
  ] as const) {
    if (valeurs.length === 0) continue;
    const liste = el("ul", { class: classe });
    for (const valeur of valeurs) {
      liste.appendChild(el("li", {}, [`${signe} ${valeur}`]));
    }
    section.appendChild(liste);
  }
  return section;
}

export function buildEcartsReport(ecarts: Ecarts, avant: string, apres: string): HTMLElement {
  const racine = el("div", { class: "ecarts" });
  racine.appendChild(
    el("p", { class: "ecarts-entete" }, [`What changes between milestone ${avant} and milestone ${apres}.`])
  );
  racine.appendChild(bloc("Actors", ecarts.acteurs));
  racine.appendChild(bloc("Interfaces", ecarts.interfaces));
  racine.appendChild(bloc("Consumptions", ecarts.consommations));
  return racine;
}

// Le schéma se titre : il dit de lui-même ce qu'il montre grâce aux soldes
// signés, mais rien n'indiquerait sans cela QUELS paliers il compare ni à
// quelle échelle il est dessiné.
export function buildEcartsTitreSchema(avant: string, apres: string): HTMLElement {
  return el("h2", { class: "ecarts-titre-schema" }, [
    `What moves between ${avant} and ${apres} — platform detail`,
  ]);
}
