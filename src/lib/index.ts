// ── Entry point for JSR & npm ──────────────────────────────────
//
// SkinViewer is a Svelte 5 component.  Svelte-aware bundlers
// (Vite, SvelteKit) should use the `svelte` export condition to
// get the raw `.svelte` source (via `SkinViewer.svelte`).
// This default export uses a pre-compiled wrapper so Deno/JSR
// can validate the module graph without needing a Svelte plugin.

// deno-lint-ignore no-sloppy-imports
export { default as SkinViewer } from "./SkinViewer.js";

/** Properties for the SkinViewer component */
export interface SkinViewerProps {
  /**
   * Minecraft skin texture URL.
   *
   * - Default: "/steve.png"
   */
  skinUrl?: string;
  /**
   * Arm thickness of the targeted texture.
   *
   * - true = Slim (3px)
   * - false = Classic (4px)
   */
  isSlim?: boolean;
  /**
   * Model scale factor. The larger this, the bigger the 3D model appears.
   *
   * - Default: 1
   */
  scale?: number;
  /**
   * Rotation reset triggerer.
   *
   * This should be a Svelte 5 $state. Once it changes, an internal $effect
   * listener would reset the rotation angle of the model.
   */
  resetId?: number;
}
