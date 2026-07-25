/**
 * Entry point for JSR (@feniota/tiny-skin-viewer).
 *
 * Exports a pre-compiled Svelte 5 component so Vite/esbuild can resolve
 * the entire module graph without needing a Svelte plugin.
 *
 * @module
 */

// deno-lint-ignore no-sloppy-imports
export { default as SkinViewer } from "./SkinViewer.client.js";
export type { SkinViewerProps } from "./SkinViewer.client.js";
