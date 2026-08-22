// Déclaration pour les imports « ?raw » : le contenu du fichier importé comme
// simple chaîne, au lieu d'être interprété comme du code. Vitest (Vite) le
// gère nativement ; esbuild le gère via le plugin de esbuild.build.mjs.
declare module "*?raw" {
  const content: string;
  export default content;
}
