// Declaration for "?raw" imports: the imported file's content as a plain
// string, instead of being interpreted as code. Vitest (Vite) handles it
// natively; esbuild handles it through the plugin in esbuild.build.mjs.
declare module "*?raw" {
  const content: string;
  export default content;
}
