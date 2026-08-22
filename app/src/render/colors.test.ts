import { describe, it, expect } from "vitest";
import * as base from "../testing/fixtures";
import { colorForTechnologies, couleursDuModele, PALETTE } from "./colors";
import { ratioDeContraste } from "./contrast";
import type { ParsedModel, InterfaceCatalogue, TypeFlux } from "../parsing/model";
import { VERSION_MODELE } from "../parsing/build-model";

function typeFlux(type: string): TypeFlux {
  return base.typeFlux({ type });
}

function iface(flowName: string, flowType: string): InterfaceCatalogue {
  return base.iface({ flowName, flowType });
}

// La feuille FlowTypes est un RÉFÉRENTIEL : le gabarit livré en compte seize,
// dont une équipe n'en emploie qu'une poignée. Indexer la palette sur ce
// référentiel faisait boucler huit teintes sur seize entrées, donc donnait la
// même couleur à deux technologies pourtant dessinées côte à côte -- légende
// comprise.
describe("couleursDuModele", () => {
  const model = (types: string[], used: string[]): ParsedModel => ({
    actors: [], groups: [], groupesAbsents: false, typesActeur: [], milestones: [],
    flowTypes: types.map(typeFlux),
    interfaces: used.map((t, i) => iface(`F${i}`, t)),
    consumptions: [], fxSheetNames: [], colonnesOptionnellesAbsentes: [],
    versionModele: VERSION_MODELE, fichierModifie: null,
  });

  const SEIZE = ["Kafka", "SFTP", "HTTP", "File", "SMTP", "JMS", "LDAP", "NTP",
    "Manual", "SQL", "Syslog", "gRPC", "Proprietary", "Screen entry", "Screen lookup", "Object storage (S3)"];

  it("donne une couleur distincte à chaque technologie réellement dessinée", () => {
    const colours = couleursDuModele(model(SEIZE, ["HTTP", "Kafka", "File", "SFTP", "SMTP"]));
    const distinctes = new Set([...colours.values()]);
    expect(distinctes.size).toBe(5);
  });

  it("ne boucle sur la palette qu'au-delà de ses huit teintes", () => {
    const neuf = SEIZE.slice(0, 9);
    const colours = couleursDuModele(model(SEIZE, neuf));
    expect(new Set([...colours.values()]).size).toBe(8);
  });

  it("garde la même couleur pour une technologie d'une vue à l'autre", () => {
    // Le classeur, pas la planche : une vue qui n'en montre qu'une partie ne
    // doit pas redistribuer les teintes.
    const m = model(SEIZE, ["HTTP", "Kafka", "File", "SFTP", "SMTP"]);
    expect(couleursDuModele(m).get("SFTP")).toBe(couleursDuModele(m).get("SFTP"));
  });
});

describe("colorForTechnologies", () => {
  it("reste stable quel que soit l'ordre reçu", () => {
    const a = colorForTechnologies(["Kafka", "HTTP"]);
    const b = colorForTechnologies(["HTTP", "Kafka"]);
    expect(a.get("Kafka")).toBe(b.get("Kafka"));
  });
});

// --- Le référentiel externe portera la couleur de chaque technologie, en
// hexadécimal. Elle cesse donc d'être dérivée d'un rang -- ce qui la faisait
// changer dès qu'on ajoutait une technologie avant les autres dans l'alphabet
// -- pour devenir une donnée. La palette ne sert plus qu'à celles qui n'en
// déclarent aucune.
describe("couleursDuModele — couleur déclarée par le référentiel", () => {
  const estate = (types: [string, string][], used: string[]): ParsedModel => ({
    actors: [], groups: [], groupesAbsents: false, typesActeur: [], milestones: [],
    flowTypes: types.map(([type, colour]) => ({ ...typeFlux(type), colour })),
    interfaces: used.map((t, i) => iface(`F${i}`, t)),
    consumptions: [], fxSheetNames: [], colonnesOptionnellesAbsentes: [],
    versionModele: VERSION_MODELE, fichierModifie: null,
  });

  it("respecte la couleur déclarée", () => {
    const c = couleursDuModele(estate([["HTTP", "#123456"], ["Kafka", ""]], ["HTTP", "Kafka"]));
    expect(c.get("HTTP")).toBe("#123456");
  });

  // Teinte assez foncée pour traverser le garde-fou de contraste intacte :
  // ce test porte sur l'ÉCRITURE acceptée, pas sur la correction de clarté.
  it("accepte l'hexadécimal sans dièse et le normalise", () => {
    expect(couleursDuModele(estate([["HTTP", "1F5FAE"]], ["HTTP"])).get("HTTP")).toBe("#1f5fae");
  });

  it("ignore une valeur qui n'est pas une couleur", () => {
    const c = couleursDuModele(estate([["HTTP", "bleu ciel"]], ["HTTP"]));
    expect(c.get("HTTP")).toMatch(/^#[0-9a-f]{6}$/);
    expect(c.get("HTTP")).not.toBe("bleu ciel");
  });

  // Le point qui justifie tout : une technologie déclarée garde sa teinte quoi
  // qu'on ajoute autour, alors que le rang alphabétique la décalait.
  it("ne bouge plus quand une technologie s'ajoute avant elle dans l'alphabet", () => {
    const types: [string, string][] = [["HTTP", "#123456"], ["Kafka", "#654321"]];
    const avant = couleursDuModele(estate(types, ["HTTP", "Kafka"]));
    const after = couleursDuModele(estate([...types, ["Batch", "#0f0f0f"]], ["HTTP", "Kafka", "Batch"]));
    expect(after.get("HTTP")).toBe(avant.get("HTTP"));
    expect(after.get("Kafka")).toBe(avant.get("Kafka"));
  });

  // Une teinte déjà prise par une déclaration ne doit pas être redistribuée à
  // une voisine : deux traits identiques resteraient indiscernables.
  it("n'attribue pas à une autre une teinte déjà déclarée", () => {
    const c = couleursDuModele(estate([["HTTP", "#2a78d6"], ["Kafka", ""], ["File", ""]], ["HTTP", "Kafka", "File"]));
    expect(new Set([...c.values()]).size).toBe(3);
  });
});

// --- Une technologie DOIT être déclarée au référentiel : c'est la règle du
// projet. Une technologie employée sans y figurer n'est de toute façon pas
// dessinée -- son sens de représentation est inconnu --, mais elle prenait
// quand même une teinte, et décalait donc celles des technologies dessinées.
// Sur un classeur réel, trois technologies dessinées se partageaient les
// 1re, 3e et 4e teintes parce que deux inconnues s'étaient glissées entre.
describe("couleursDuModele — une technologie non déclarée ne prend pas de teinte", () => {
  const estate = (declared: string[], used: string[]): ParsedModel => ({
    actors: [], groups: [], groupesAbsents: false, typesActeur: [], milestones: [],
    flowTypes: declared.map((t) => typeFlux(t)),
    interfaces: used.map((t, i) => iface(`F${i}`, t)),
    consumptions: [], fxSheetNames: [], colonnesOptionnellesAbsentes: [],
    versionModele: VERSION_MODELE, fichierModifie: null,
  });

  it("ignore une technologie absente du référentiel", () => {
    const c = couleursDuModele(estate(["HTTP", "Kafka"], ["HTTP", "Kafka", "Inconnue"]));
    expect([...c.keys()].sort()).toEqual(["HTTP", "Kafka"]);
  });

  it("ne laisse pas une inconnue décaler les teintes des autres", () => {
    const sans = couleursDuModele(estate(["HTTP", "Kafka"], ["HTTP", "Kafka"]));
    const avec = couleursDuModele(estate(["HTTP", "Kafka"], ["HTTP", "Kafka", "Batch"]));
    expect(avec.get("HTTP")).toBe(sans.get("HTTP"));
    expect(avec.get("Kafka")).toBe(sans.get("Kafka"));
  });
});

// --- QA : la palette de repli n'avait jamais été jugée comme ENCRE. Cinq
// teintes sur huit passaient sous 3:1 comme trait, huit sur huit sous 4,5:1
// comme texte -- et le libellé d'arête s'écrit dans cette couleur.
describe("la palette de repli est lisible", () => {
  it("place chaque teinte au-dessus de 4,5:1 sur blanc", () => {
    for (const c of PALETTE) expect(ratioDeContraste(c, "#ffffff"), c).toBeGreaterThanOrEqual(4.5);
  });

  // Huit teintes qui passent le contraste mais se ressemblent ne valent rien :
  // la légende les distingue par le nom, le dessin par la teinte.
  it("garde les teintes distinctes les unes des autres", () => {
    expect(new Set(PALETTE).size).toBe(PALETTE.length);
  });
});

// --- Le référentiel peut imposer n'importe quelle teinte. Un jaune clair
// déclaré au classeur produisait un trait invisible, sans un mot.
describe("couleursDuModele — garde-fou de contraste", () => {
  const estate = (colour: string) => ({
    interfaces: [{ flowType: "HTTP" }],
    flowTypes: [{ type: "HTTP", colour }],
  });

  it("assombrit une couleur déclarée illisible plutôt que de la dessiner telle quelle", () => {
    expect(ratioDeContraste(couleursDuModele(estate("#ffee00")).get("HTTP")!, "#ffffff")).toBeGreaterThanOrEqual(3);
  });

  it("respecte telle quelle une couleur déclarée qui passe le seuil", () => {
    expect(couleursDuModele(estate("#1f5fae")).get("HTTP")).toBe("#1f5fae");
  });
});
