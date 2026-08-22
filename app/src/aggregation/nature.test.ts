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

describe("actors' nature", () => {
  it("recognises an actor whose type is declared technical", () => {
    const m = model([actor("Bus", "Middleware")], [type("Middleware", "Technical")]);
    expect(isTechnicalActor(m, "Bus")).toBe(true);
  });

  it("treats a type declared Business as business", () => {
    const m = model([actor("Tatooine", "Application")], [type("Application", "Business")]);
    expect(isTechnicalActor(m, "Tatooine")).toBe(false);
  });

  // Hiding on an empty column would amount to hiding data without saying so:
  // the default leans towards the side that shows everything.
  it("treats a type whose nature is not filled in as business", () => {
    const m = model([actor("Tatooine", "Application")], [type("Application", "")]);
    expect(isTechnicalActor(m, "Tatooine")).toBe(false);
  });

  it("treats an actor whose type is not declared as business", () => {
    const m = model([actor("Inconnu", "Fantôme")], [type("Application", "Technical")]);
    expect(isTechnicalActor(m, "Inconnu")).toBe(false);
  });

  it("recognises the nature up to accents and case", () => {
    const m = model([actor("Bus", "middleware")], [type("Middleware", "TECHNICAL")]);
    expect(isTechnicalActor(m, "Bus")).toBe(true);
  });

  it("returns only the business actors", () => {
    const m = model(
      [actor("Tatooine", "Application"), actor("Bus", "Middleware")],
      [type("Application", "Business"), type("Middleware", "Technical")]
    );
    expect(businessActors(m).map((a) => a.name)).toEqual(["Tatooine"]);
  });
});
