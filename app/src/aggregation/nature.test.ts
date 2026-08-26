import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { isTechnicalActor, isRelayActor, isStorageActor, businessActors } from "./nature";
import type { ParsedModel, Actor, ActorType } from "../parsing/model";

function actor(name: string, actorType: string): Actor {
  return base.actor({ name, actorType });
}

function type(t: string, nature: string): ActorType {
  return { type: t, icon: "", nature, sheet: "ActorTypes", row: 0 };
}

function model(actors: Actor[], actorTypes: ActorType[]): ParsedModel {
  return base.template({ actors, actorTypes });
}

// Two technical roles, and they behave in opposite ways. A middleware is
// CROSSED: the flows through it are joined end to end and it is expected to
// republish. A storage is TERMINAL: the data stops there, which is not an
// omission -- an S3 bucket republishes nothing, and there is nothing to report.
describe("actors' nature", () => {
  const bus = model([actor("Bus", "Middleware")], [type("Middleware", "Middleware")]);
  const store = model([actor("Vault", "Object storage")], [type("Object storage", "Storage")]);
  const app = model([actor("Tatooine", "Application")], [type("Application", "Business")]);

  it("sees a middleware as plumbing that is crossed", () => {
    expect(isRelayActor(bus, "Bus")).toBe(true);
    expect(isTechnicalActor(bus, "Bus")).toBe(true);
    expect(isStorageActor(bus, "Bus")).toBe(false);
  });

  // The whole point of the distinction: a storage is technical, so it is drawn
  // as plumbing and may republish -- but it is never folded, and never asked to
  // relay.
  it("sees a storage as plumbing that is not crossed", () => {
    expect(isRelayActor(store, "Vault")).toBe(false);
    expect(isTechnicalActor(store, "Vault")).toBe(true);
    expect(isStorageActor(store, "Vault")).toBe(true);
  });

  it("treats a type declared Business as business", () => {
    expect(isTechnicalActor(app, "Tatooine")).toBe(false);
    expect(isRelayActor(app, "Tatooine")).toBe(false);
  });

  // Hiding on an empty column would amount to hiding data without saying so:
  // the default leans towards the side that shows everything.
  it("treats a type whose nature is not filled in as business", () => {
    const m = model([actor("Tatooine", "Application")], [type("Application", "")]);
    expect(isTechnicalActor(m, "Tatooine")).toBe(false);
  });

  it("treats an actor whose type is not declared as business", () => {
    const m = model([actor("Inconnu", "Fantôme")], [type("Application", "Middleware")]);
    expect(isTechnicalActor(m, "Inconnu")).toBe(false);
  });

  it("recognises the nature up to accents and case", () => {
    const m = model([actor("Bus", "middleware")], [type("Middleware", "MIDDLEWARE")]);
    expect(isRelayActor(m, "Bus")).toBe(true);
  });

  // "Technical" is what a middleware was called before the two roles were told
  // apart. A referential in circulation still says it, and that file carries no
  // version to tell anyone it is stale.
  it("still reads the word a middleware used to be called", () => {
    const m = model([actor("Bus", "Middleware")], [type("Middleware", "Technical")]);
    expect(isRelayActor(m, "Bus")).toBe(true);
    expect(isTechnicalActor(m, "Bus")).toBe(true);
  });

  it("returns only the business actors", () => {
    const m = model(
      [actor("Tatooine", "Application"), actor("Bus", "Middleware"), actor("Vault", "Object storage")],
      [type("Application", "Business"), type("Middleware", "Middleware"), type("Object storage", "Storage")]
    );
    expect(businessActors(m).map((a) => a.name)).toEqual(["Tatooine"]);
  });
});
