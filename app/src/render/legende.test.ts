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

describe("entreesDeLegende — la notation, pas seulement la couleur", () => {
  // La convention de pointe est l'invention de l'outil : le trait suit la
  // donnée, la pointe dit qui appelle. Non annoncée, elle se lit comme une
  // erreur de sens de flèche.
  it("explique la pointe dès qu'un flux tiré est dessiné", () => {
    const textes = entreesDeLegende(
      [{ technologie: "HTTP", fleche: true, tire: true }, { technologie: "Kafka", fleche: true, tire: false }],
      [noeud()],
      () => "#111111"
    ).map((e) => e.texte);
    expect(textes).toContain("provider pushes — head at the consumer");
    expect(textes).toContain("consumer pulls — head at the provider");
  });

  // Un tronc fusionné ne porte pas de pointe : l'annoncer expliquerait un
  // signe absent du dessin.
  it("n'explique aucune pointe quand aucun trait n'en porte", () => {
    const textes = entreesDeLegende([{ technologie: "HTTP", fleche: false, tire: true }], [noeud()], () => "#111111").map((e) => e.texte);
    expect(textes.some((t) => t.includes("head at"))).toBe(false);
  });

  // Là où toutes les pointes vont au consommateur, elles se lisent comme le
  // sens de la donnée : rien à expliquer. C'est aussi le cas de la lecture
  // fonctionnelle, qui pose ce sens faute de mieux -- y annoncer « provider
  // pushes » affirmerait ce que le schéma ne sait pas.
  it("n'explique aucune pointe quand aucun flux n'est tiré", () => {
    const textes = entreesDeLegende([{ technologie: "Kafka", fleche: true, tire: false }], [noeud()], () => "#111111").map((e) => e.texte);
    expect(textes.some((t) => t.includes("head at"))).toBe(false);
  });

  // Le pointillé dit qu'un maillon transforme le contenu. C'est une
  // affirmation forte -- le lien dit que l'information circule, pas qu'elle
  // arrive intacte -- et elle était muette.
  it("explique le pointillé dès qu'un flux est atténué", () => {
    const textes = entreesDeLegende([{ technologie: "HTTP", atténué: true }], [noeud()], () => "#111111").map((e) => e.texte);
    expect(textes).toContain("decision: Transform — content changes on the way");
  });

  it("n'explique pas le pointillé quand aucun flux ne l'est", () => {
    const textes = entreesDeLegende([{ technologie: "HTTP" }], [noeud()], () => "#111111").map((e) => e.texte);
    expect(textes.some((t) => t.includes("Transform"))).toBe(false);
  });

  // L'ordre de lecture : ce qui explique la FORME d'abord, ce qui explique la
  // COULEUR ensuite. La notation se lit avant le code couleur.
  it("place la notation avant les technologies", () => {
    const textes = entreesDeLegende([{ technologie: "HTTP", fleche: true, tire: true }], [noeud()], () => "#111111").map((e) => e.texte);
    const notation = textes.findIndex((t) => t.includes("head at"));
    expect(notation).toBeGreaterThanOrEqual(0);
    expect(textes.indexOf("HTTP")).toBeGreaterThan(notation);
  });

  // Un schéma d'écart n'a pas de pointe à expliquer : ses traits ne portent
  // plus ni technologie ni sens, seulement un ajout ou un retrait.
  it("n'explique pas la pointe sur un schéma d'écart", () => {
    const textes = entreesDeLegende([{ technologie: "HTTP", ecart: "ajout", fleche: true, tire: true }], [noeud()], () => "#111111").map((e) => e.texte);
    expect(textes.some((t) => t.includes("head at"))).toBe(false);
  });
});
