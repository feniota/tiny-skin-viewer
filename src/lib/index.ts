/**
 * NPM entry point for `tiny-skin-viewer`.
 *
 * Re-exports the {@link SkinViewer} component from the raw `.svelte` source
 * for bundlers that understand the `svelte` export condition.
 *
 * @module
 */

export { default as SkinViewer } from "./SkinViewer.svelte";
export type { SkinViewerProps } from "./types.d.ts";
