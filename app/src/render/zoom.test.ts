import { describe, it, expect } from "vitest";
import { zoomer, deplacer, type Cadre } from "./zoom";

const initial: Cadre = { x: 0, y: 0, width: 100, height: 100 };

describe("zoomer", () => {
  it("réduit le cadre quand on zoome, l'agrandit quand on dézoome", () => {
    expect(zoomer(initial, 2, { x: 50, y: 50 }, initial).width).toBeCloseTo(50);
    expect(zoomer(initial, 0.5, { x: 50, y: 50 }, initial).width).toBeCloseTo(200);
  });

  // Le point sous le curseur ne doit pas bouger : c'est ce qui distingue un
  // zoom utilisable d'un zoom qui perd son lecteur.
  it("garde le point d'ancrage immobile", () => {
    const ancre = { x: 25, y: 75 };
    const après = zoomer(initial, 2, ancre, initial);
    expect(après.x).toBeCloseTo(12.5);
    expect(après.y).toBeCloseTo(37.5);
    // Formulé autrement : la position RELATIVE de l'ancre dans le cadre est la
    // même avant et après. C'est la propriété qui compte, les deux nombres
    // ci-dessus n'en sont qu'une lecture.
    expect((ancre.x - après.x) / après.width).toBeCloseTo((ancre.x - initial.x) / initial.width);
    expect((ancre.y - après.y) / après.height).toBeCloseTo((ancre.y - initial.y) / initial.height);
  });

  it("conserve le rapport de forme", () => {
    const large = { x: 0, y: 0, width: 200, height: 100 };
    const après = zoomer(large, 1.7, { x: 10, y: 10 }, large);
    expect(après.width / après.height).toBeCloseTo(2);
  });

  // Sans bornes, quelques coups de molette suffisent à sortir du dessin.
  it("borne le zoom avant en deçà de 8x", () => {
    let c = initial;
    for (let i = 0; i < 40; i += 1) c = zoomer(c, 2, { x: 50, y: 50 }, initial);
    expect(c.width).toBeGreaterThanOrEqual(100 / 8 - 0.001);
  });

  it("borne le dézoom au-delà de 0,2x", () => {
    let c = initial;
    for (let i = 0; i < 40; i += 1) c = zoomer(c, 0.5, { x: 50, y: 50 }, initial);
    expect(c.width).toBeLessThanOrEqual(100 / 0.2 + 0.001);
  });

  // Une fois la borne atteinte, un cran de plus ne doit RIEN faire : sans ça,
  // le cadre continue de glisser vers l'ancre sans changer de taille.
  it("ne déplace plus le cadre une fois la borne atteinte", () => {
    let c = initial;
    for (let i = 0; i < 40; i += 1) c = zoomer(c, 2, { x: 50, y: 50 }, initial);
    expect(zoomer(c, 2, { x: 10, y: 10 }, initial)).toEqual(c);
  });
});

describe("deplacer", () => {
  it("translate le cadre sans le redimensionner", () => {
    expect(deplacer(initial, 7, -3)).toEqual({ x: 7, y: -3, width: 100, height: 100 });
  });
});
