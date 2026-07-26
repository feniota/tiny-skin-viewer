import { compile } from "svelte/compiler";

const svelte_src = await Deno.readTextFile("src/lib/SkinViewer.svelte");

const r = compile(svelte_src, {
  name: "SkinViewer",
  filename: "SkinViewer.svelte",
  generate: "client",
  css: "injected",
});

const src = r.js.code.replace(`"./shader"`, `"./shader.js"`);

await Deno.writeTextFile("dist/SkinViewer.js", src);

console.log("Compiled", r.js.code.length, "bytes");
