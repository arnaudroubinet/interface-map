import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { estActeurTechnique, acteursMetier } from "./nature";
import type { ParsedModel, Acteur, TypeActeur } from "../parsing/model";
import { VERSION_MODELE } from "../parsing/build-model";

function acteur(nom: string, typeActeur: string): Acteur {
  return base.acteur({ nom, typeActeur });
}

function type(t: string, nature: string): TypeActeur {
  return { type: t, icone: "", nature, feuille: "ActorTypes", ligne: 0 };
}

function model(acteurs: Acteur[], typesActeur: TypeActeur[]): ParsedModel {
  return base.modele({ acteurs, typesActeur });
}

describe("nature des acteurs", () => {
  it("reconnaît un acteur dont le type est déclaré technique", () => {
    const m = model([acteur("Bus", "Middleware")], [type("Middleware", "Technical")]);
    expect(estActeurTechnique(m, "Bus")).toBe(true);
  });

  it("tient pour métier un type déclaré Business", () => {
    const m = model([acteur("Tatooine", "Application")], [type("Application", "Business")]);
    expect(estActeurTechnique(m, "Tatooine")).toBe(false);
  });

  // Masquer sur une colonne vide reviendrait à cacher de la donnée sans le
  // dire : le défaut penche du côté qui montre tout.
  it("tient pour métier un type dont la nature n'est pas renseignée", () => {
    const m = model([acteur("Tatooine", "Application")], [type("Application", "")]);
    expect(estActeurTechnique(m, "Tatooine")).toBe(false);
  });

  it("tient pour métier un acteur dont le type n'est pas déclaré", () => {
    const m = model([acteur("Inconnu", "Fantôme")], [type("Application", "Technical")]);
    expect(estActeurTechnique(m, "Inconnu")).toBe(false);
  });

  it("reconnaît la nature aux accents et à la casse près", () => {
    const m = model([acteur("Bus", "middleware")], [type("Middleware", "TECHNICAL")]);
    expect(estActeurTechnique(m, "Bus")).toBe(true);
  });

  it("rend les seuls acteurs métier", () => {
    const m = model(
      [acteur("Tatooine", "Application"), acteur("Bus", "Middleware")],
      [type("Application", "Business"), type("Middleware", "Technical")]
    );
    expect(acteursMetier(m).map((a) => a.nom)).toEqual(["Tatooine"]);
  });
});
