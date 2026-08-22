import { describe, it, expect } from "vitest";
import { breakTheLine } from "./geometry";

// La géométrie se vérifie sur des nombres, sans monter un SVG : c'est
// justement ce que sa sortie du constructeur SVG rend possible.

// --- QA : la pointe se pose sur le DERNIER morceau visible du tracé. Quand le
// libellé recouvrait l'arrivée, la coupure allait jusqu'au bout du segment, le
// reste était jeté, et le dernier morceau devenait celui d'AVANT le libellé :
// la flèche s'arrêtait à son étiquette au lieu de la boîte visée -- 51 px trop
// tôt, sur 2 des 18 traits de la vue « plateforme détaillée ».
describe("interrompreLeTrace", () => {
  const lastPoint = (pieces: { x: number; y: number }[][]) => {
    const dernier = pieces[pieces.length - 1];
    return dernier[dernier.length - 1];
  };

  it("garde un reste après un libellé qui recouvre l'arrivée", () => {
    const trace = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    const labelOnArrival = { x0: 150, y0: -10, x1: 210, y1: 10 };
    const pieces = breakTheLine(trace, [labelOnArrival]);
    expect(pieces.length).toBeGreaterThan(0);
    expect(lastPoint(pieces).x).toBeCloseTo(200, 5);
  });

  it("coupe toujours au milieu quand le libellé est au milieu", () => {
    const trace = [{ x: 0, y: 0 }, { x: 200, y: 0 }];
    const pieces = breakTheLine(trace, [{ x0: 90, y0: -10, x1: 110, y1: 10 }]);
    expect(pieces).toHaveLength(2);
    expect(lastPoint(pieces).x).toBeCloseTo(200, 5);
  });
});
