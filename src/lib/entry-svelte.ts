/**
 * Svelte-aware entry point for `@feniota/tiny-skin-viewer`.
 *
 * Re-exports the raw `.svelte` component so that Svelte-aware bundlers
 * (Vite, SvelteKit, and any tool using the `svelte` export condition)
 * can compile the component themselves with the consumer's Svelte config.
 *
 * This file is **not** used by JSR — see `./index.ts` for the default
 * entry point that works across all runtimes.
 *
 * @module
 */

export { default as SkinViewer } from "./SkinViewer.svelte";
