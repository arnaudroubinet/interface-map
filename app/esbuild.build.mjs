import * as esbuild from "esbuild";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { readFile } from "node:fs/promises";

mkdirSync("dist", { recursive: true });

// Vitest (Vite) sait nativement importer un fichier « ?raw » comme une simple
// chaîne ; esbuild non, d'où ce plugin qui reproduit le même comportement.
// C'est ce qui permet d'inliner le worker GWT d'elkjs (voir graph-layout.ts)
// sans en faire un fichier séparé, seule option compatible avec le livrable
// en un seul .html.
const rawImportPlugin = {
  name: "raw-import",
  setup(build) {
    build.onResolve({ filter: /\?raw$/ }, async (args) => {
      const résolu = await build.resolve(args.path.replace(/\?raw$/, ""), {
        resolveDir: args.resolveDir,
        kind: args.kind,
      });
      if (résolu.errors.length > 0) return { errors: résolu.errors };
      return { path: résolu.path, namespace: "raw-import" };
    });
    build.onLoad({ filter: /.*/, namespace: "raw-import" }, async (args) => ({
      contents: await readFile(args.path, "utf8"),
      loader: "text",
    }));
  },
};

const result = await esbuild.build({
  entryPoints: ["src/main.ts"],
  bundle: true,
  format: "iife",
  target: "es2020",
  plugins: [rawImportPlugin],
  // Le moteur de placement (elkjs) est du Java compilé en JS : brut, il pèse
  // à lui seul 3 Mo. Minifié, tout le livrable tient en 1,8 Mo. Le code source
  // reste lisible dans le dépôt, seule la page distribuée est compactée.
  minify: true,
  write: false,
  logLevel: "info",
});

const js = result.outputFiles[0].text;
const template = readFileSync("index.html", "utf8");
const html = template.replace("/*__SCRIPT__*/", () => js);
writeFileSync("dist/interface-map.html", html);
console.log("Built dist/interface-map.html");
