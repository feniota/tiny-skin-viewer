# Publishing

tiny-skin-viewer is published simultaneously to both JSR and NPM.

## NPM

NPM packaging is performed by [the official SvelteKit packaging toolchain](https://svelte.dev/docs/kit/packaging). It compiles TypeScript code but leaves `.svelte` files unchanged.

## JSR

JSR is different from NPM. In our case:

- npmjs.com does not parse or check your code, but JSR does. This means we cannot `import … from "./component.svelte"` — JSR expects every `import`/`export … from` target to be a valid ES module, and a `.svelte` file is not one.
- Node.js supports [conditional exports](https://nodejs.org/api/packages.html#conditional-exports) to "provide a way to map to different paths depending on certain conditions". Svelte packages typically use a `svelte` condition (pointing to raw `.svelte` source) and omit the `default` condition, so Node won't resolve the import without a Svelte compiler. JSR, however, does not support conditional exports.

To bridge these differences, we use three strategies:

1. **Pre-compile the Svelte component to JS** — alongside `svelte-package` output, we invoke [`svelte/compiler`](https://svelte.dev/docs/svelte/svelte-compiler) to emit `dist/SkinViewer.svelte.js`, then rewrite `"./shader"` → `"./shader.js"` so the import graph stays pure JS.
2. **Separate JSR entry point** — `src/jsr.ts` is raw TypeScript that does not import `.svelte` files. It re-exports the pre-compiled JS module instead.
3. **Move types to a standalone `.d.ts`** — `svelte-package` copies `.d.ts` to `dist/` verbatim (no compilation), so `import type { … } from "./types.d.ts"` works in both the `.svelte` source and the JSR entry. Previously, `SkinViewerProps` was defined in `index.ts`, which imported a `.svelte` file — that caused JSR publish to fail.

So finally here's how to publish new versions.

_(Only for demonstrations. Actual publish should be performed by CI.)_

```bash
# Before publishing please ensure you've bumped the version number

# Install build dependencies
deno i

# Build .js and .d.ts from TypeScript codes
# using SvelteKit toolkit
deno task package # <- NPM ready

# Publish to NPM
# > npm publish

# Build JS module from the .svelte component
deno task compile-component # <- JSR ready

# Publish to JSR
# > deno publish
```

All of these operations are handled by CI. Trigger a publish by pushing a `git tag`, or click the "Run workflow" button on the [GitHub Actions page](https://github.com/feniota/tiny-skin-viewer/actions/workflows/publish.yml).
