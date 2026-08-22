import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { isTechnicalActor, businessActors } from "./nature";
import type { ParsedModel, Actor, ActorType } from "../parsing/model";
import { SCHEMA_VERSION } from "../parsing/build-model";

function actor(name: string, actorType: string): Actor {
  return base.actor({ name, actorType });
}

function type(t: string, nature: string): ActorType {
  return { type: t, icon: "", nature, sheet: "ActorTypes", row: 0 };
}

function model(actors: Actor[], actorTypes: ActorType[]): ParsedModel {
  return base.template({ actors, actorTypes });
}

describe("nature des acteurs", () => {
  it("reconnaît un acteur dont le type est déclaré technique", () => {
    const m = model([actor("Bus", "Middleware")], [type("Middleware", "Technical")]);
    expect(isTechnicalActor(m, "Bus")).toBe(true);
  });

  it("tient pour métier un type déclaré Business", () => {
    const m = model([actor("Tatooine", "Application")], [type("Application", "Business")]);
    expect(isTechnicalActor(m, "Tatooine")).toBe(false);
  });

  // Masquer sur une colonne vide reviendrait à cacher de la donnée sans le
  // dire : le défaut penche du côté qui montre tout.
  it("tient pour métier un type dont la nature n'est pas renseignée", () => {
    const m = model([actor("Tatooine", "Application")], [type("Application", "")]);
    expect(isTechnicalActor(m, "Tatooine")).toBe(false);
  });

  it("tient pour métier un acteur dont le type n'est pas déclaré", () => {
    const m = model([actor("Inconnu", "Fantôme")], [type("Application", "Technical")]);
    expect(isTechnicalActor(m, "Inconnu")).toBe(false);
  });

  it("reconnaît la nature aux accents et à la casse près", () => {
    const m = model([actor("Bus", "middleware")], [type("Middleware", "TECHNICAL")]);
    expect(isTechnicalActor(m, "Bus")).toBe(true);
  });

  it("rend les seuls acteurs métier", () => {
    const m = model(
      [actor("Tatooine", "Application"), actor("Bus", "Middleware")],
      [type("Application", "Business"), type("Middleware", "Technical")]
    );
    expect(businessActors(m).map((a) => a.name)).toEqual(["Tatooine"]);
  });
});
