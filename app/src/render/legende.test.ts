import { describe, it, expect } from "vitest";
import { entreesDeLegende } from "./legende";
import type { LayoutNode } from "../layout/graph-layout";

const noeud = (o: Partial<LayoutNode> = {}): LayoutNode =>
  ({ id: "A", label: "A", kind: "acteur", externe: false, x: 0, y: 0, width: 240, height: 120, ...o }) as LayoutNode;

describe("entreesDeLegende", () => {
  it("énumère une entrée par technologie dessinée, dans l'ordre alphabétique", () => {
    const entrées = entreesDeLegende(
      [{ technologie: "SFTP" }, { technologie: "HTTP" }, { technologie: "HTTP" }],
      [noeud()],
      () => "#111111"
    );
    expect(entrées.map((e) => e.texte)).toEqual(["HTTP", "SFTP"]);
  });

  // Le mode fonctionnel vide `technologie` sur toutes ses arêtes : une entrée
  // sans nom annoncerait un code couleur introuvable sur le dessin.
  it("ignore une technologie vide", () => {
    expect(entreesDeLegende([{ technologie: "" }], [noeud()], () => "#111111")).toEqual([]);
  });

  // Un trait marqué d'un écart ne porte plus la couleur de sa technologie.
  it("annonce les écarts et tait les technologies quand le schéma est un écart", () => {
    const entrées = entreesDeLegende(
      [{ technologie: "HTTP", ecart: "ajout" }, { technologie: "SFTP", ecart: "retrait" }],
      [noeud()],
      () => "#111111"
    );
    expect(entrées.map((e) => e.texte)).toEqual(["+n : flows added", "−n : flows removed"]);
  });

  // Les deux périmètres ne s'annoncent que si les deux sont dessinés : sur une
  // planche entièrement interne, « External » n'apprendrait rien.
  it("n'annonce les périmètres que lorsque les deux sont présents", () => {
    const mixte = entreesDeLegende([{ technologie: "HTTP" }], [noeud(), noeud({ id: "B", externe: true })], () => "#111111");
    expect(mixte.map((e) => e.texte)).toContain("Platform");
    expect(mixte.map((e) => e.texte)).toContain("External");
    const interne = entreesDeLegende([{ technologie: "HTTP" }], [noeud()], () => "#111111");
    expect(interne.map((e) => e.texte)).not.toContain("External");
  });

  // La frontière de plateforme est un repère de fond, pas un acteur : la
  // compter parmi les périmètres ferait apparaître « External » toute seule.
  it("ne compte pas la frontière parmi les nœuds", () => {
    const entrées = entreesDeLegende([{ technologie: "HTTP" }], [noeud({ kind: "frontiere" }), noeud()], () => "#111111");
    expect(entrées.map((e) => e.texte)).not.toContain("External");
  });
});
