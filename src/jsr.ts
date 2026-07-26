/**
 * JSR entry point for `@feniota/tiny-skin-viewer`.
 *
 * Re-exports a pre-compiled JavaScript module so that JSR can validate
 * the entire module graph without needing a Svelte plugin.
 *
 * @module
 */

/* @ts-types="../dist/SkinViewer.svelte.d.ts" */
export { default as SkinViewer } from "../dist/SkinViewer.svelte.js";
export type { SkinViewerProps } from "../dist/types.d.ts";
