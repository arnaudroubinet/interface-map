import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { rayon } from "./impact";
import type { FlowInstance } from "./core";

// A fournit B, B fournit C, D fournit A. Le sens de la DÉPENDANCE va donc de
// B vers A : B a besoin de A.
const lien = (exposant: string, consommateur: string): FlowInstance =>
  ({ exposant, consommateur, interfaceNom: "F", version: "", typeDeFlux: "HTTP", sens: "exposant-consommateur",
     atténué: false, iface: base.iface(), conso: base.conso() }) as FlowInstance;

const parc = [lien("A", "B"), lien("B", "C"), lien("D", "A")];

describe("rayon", () => {
  it("compte le départ à zéro saut", () => {
    expect(rayon(parc, "A", "aval").get("A")).toBe(0);
  });

  // « Si A tombe, qui est touché ? » B en dépend, et C dépend de B.
  it("suit l'aval transitivement, en comptant les sauts", () => {
    expect([...rayon(parc, "A", "aval").entries()].sort()).toEqual([["A", 0], ["B", 1], ["C", 2]]);
  });

  // « De quoi A dépend-il ? » De D, et de rien d'autre.
  it("suit l'amont dans l'autre sens", () => {
    expect([...rayon(parc, "A", "amont").entries()].sort()).toEqual([["A", 0], ["D", 1]]);
  });

  it("ne garde que les voisins immédiats en direct, des deux côtés", () => {
    expect([...rayon(parc, "A", "direct").keys()].sort()).toEqual(["A", "B", "D"]);
  });

  // Un cycle ne doit pas boucler : le classeur d'exemple en contient un, à
  // quatre composants, signalé par les contrôles.
  it("termine sur un cycle", () => {
    const boucle = [lien("A", "B"), lien("B", "A")];
    expect(rayon(boucle, "A", "aval").get("B")).toBe(1);
  });

  // La distance doit être la PLUS COURTE : un parcours en profondeur donnerait
  // 2 sauts là où il y en a 1, dès qu'un chemin long arrive avant le court.
  it("rend la distance la plus courte quand deux chemins mènent au même", () => {
    const losange = [lien("A", "B"), lien("A", "C"), lien("B", "D"), lien("C", "D"), lien("D", "E")];
    const r = rayon(losange, "A", "aval");
    expect(r.get("D")).toBe(2);
    expect(r.get("E")).toBe(3);
  });

  // Un acteur qui ne touche rien n'a que lui-même dans son rayon.
  it("rend le seul départ pour un acteur isolé", () => {
    expect([...rayon(parc, "Isolé", "aval").keys()]).toEqual(["Isolé"]);
  });
});
