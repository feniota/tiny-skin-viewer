/**
 * compile-component.ts — Compile SkinViewer.svelte to SkinViewer.js
 *
 * Uses the Svelte 5 compiler API to produce a JS module that can be
 * validated by JSR and consumed outside Vite/SvelteKit.
 *
 * Usage:  deno run -A scripts/compile-component.ts
 */

const source = await Deno.readTextFile("src/lib/SkinViewer.svelte");

const { compile } = await import("npm:svelte/compiler");
const result = compile(source, {
  filename: "src/lib/SkinViewer.svelte",
  generate: "client",
  css: "injected",
});

const js = `// Auto-generated from SkinViewer.svelte — do not edit directly
// Rebuild: deno run -A scripts/compile-component.ts
// @ts-no-check:

${result.js.code}
`;

await Deno.writeTextFile("src/lib/SkinViewer.js", js);
console.log("✅  src/lib/SkinViewer.js  (%d bytes)", result.js.code.length);
