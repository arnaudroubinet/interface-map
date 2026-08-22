import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { radius } from "./impact";
import type { FlowInstance } from "./core";

// A fournit B, B fournit C, D fournit A. Le sens de la DÉPENDANCE va donc de
// B vers A : B a besoin de A.
const lien = (provider: string, consumer: string): FlowInstance =>
  ({ provider, consumer, interfaceName: "F", version: "", flowType: "HTTP", direction: "provider-to-consumer",
     attenuated: false, iface: base.iface(), consumption: base.consumption() }) as FlowInstance;

const estate = [lien("A", "B"), lien("B", "C"), lien("D", "A")];

describe("rayon", () => {
  it("compte le départ à zéro saut", () => {
    expect(radius(estate, "A", "downstream").get("A")).toBe(0);
  });

  // « Si A tombe, qui est touché ? » B en dépend, et C dépend de B.
  it("suit l'aval transitivement, en comptant les sauts", () => {
    expect([...radius(estate, "A", "downstream").entries()].sort()).toEqual([["A", 0], ["B", 1], ["C", 2]]);
  });

  // « De quoi A dépend-il ? » De D, et de rien d'autre.
  it("suit l'amont dans l'autre sens", () => {
    expect([...radius(estate, "A", "upstream").entries()].sort()).toEqual([["A", 0], ["D", 1]]);
  });

  it("ne garde que les voisins immédiats en direct, des deux côtés", () => {
    expect([...radius(estate, "A", "direct").keys()].sort()).toEqual(["A", "B", "D"]);
  });

  // Un cycle ne doit pas boucler : le classeur d'exemple en contient un, à
  // quatre composants, signalé par les contrôles.
  it("termine sur un cycle", () => {
    const loop = [lien("A", "B"), lien("B", "A")];
    expect(radius(loop, "A", "downstream").get("B")).toBe(1);
  });

  // La distance doit être la PLUS COURTE : un parcours en profondeur donnerait
  // 2 sauts là où il y en a 1, dès qu'un chemin long arrive avant le court.
  it("rend la distance la plus courte quand deux chemins mènent au même", () => {
    const diamond = [lien("A", "B"), lien("A", "C"), lien("B", "D"), lien("C", "D"), lien("D", "E")];
    const r = radius(diamond, "A", "downstream");
    expect(r.get("D")).toBe(2);
    expect(r.get("E")).toBe(3);
  });

  // Un acteur qui ne touche rien n'a que lui-même dans son rayon.
  it("rend le seul départ pour un acteur isolé", () => {
    expect([...radius(estate, "Isolé", "downstream").keys()]).toEqual(["Isolé"]);
  });
});
