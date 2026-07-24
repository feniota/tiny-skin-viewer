// ── Entry point for JSR & npm ──────────────────────────────────
//
// SkinViewer is a Svelte 5 component that renders an animated Minecraft
// player skin using WebGPU.  All vertex transform, limb animation, and
// texture sampling runs in a single WGSL shader — the CPU only feeds
// 5 floats per frame (time, rotation, isSlim, scale).
//
// Svelte-aware bundlers (Vite, SvelteKit) can use the `svelte` export
// condition to get the raw `.svelte` source for optimal compilation.
// This default export provides a pre-compiled wrapper so Deno and JSR
// can validate the module graph without needing a Svelte plugin.

// deno-lint-ignore no-sloppy-imports
export { default as SkinViewer } from "./SkinViewer.js";

/** Properties accepted by the {@link SkinViewer} component. */
export interface SkinViewerProps {
  /**
   * Minecraft skin texture URL.
   *
   * Points to a 64×64 PNG image.  The texture is uploaded to the GPU
   * as an `rgba8unorm` texture with nearest-neighbour sampling.
   *
   * @default "/steve.png"
   */
  skinUrl?: string;

  /**
   * Arm thickness of the targeted texture.
   *
   * - `true` = **Slim** (Alex, 3 px wide arms)
   * - `false` = **Classic** (Steve, 4 px wide arms)
   *
   * When `true` the shader multiplies the arm width by 0.75.
   *
   * @default false
   */
  isSlim?: boolean;

  /**
   * Uniform model scale factor.
   *
   * The larger this value, the bigger the 3D model appears in the viewport.
   *
   * @default 1
   */
  scale?: number;

  /**
   * Rotation-reset trigger.
   *
   * This should be a Svelte 5 `$state` value.  Whenever it changes, an
   * internal `$effect` listener resets the model's horizontal and vertical
   * rotation to their initial angles.
   *
   * @default 0
   */
  resetId?: number;
}
