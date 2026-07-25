/**
 * Pre-compiled Svelte 5 component wrapper.
 *
 * Re-exports the {@link SkinViewer} component from the raw `.svelte` source
 * for bundlers that understand the `svelte` export condition.
 *
 * @module
 */

export { default as SkinViewer } from "./SkinViewer.svelte";

/** Properties accepted by the {@link SkinViewer} component. */
export interface SkinViewerProps {
  /**
   * Minecraft skin texture URL.
   *
   * Points to a 64×64 PNG image loaded at runtime and uploaded to the
   * GPU as an `rgba8unorm` texture.
   *
   * @default "/Template_classic.png"
   */
  skinUrl?: string;

  /**
   * Arm thickness of the targeted texture.
   *
   * - `true` = **Slim** (Alex / 3 px wide arms)
   * - `false` = **Classic** (Steve / 4 px wide arms)
   *
   * @default false
   */
  isSlim?: boolean;

  /**
   * Cape texture URL.
   *
   * When set, a cape plane is rendered behind the body.  Standard
   * Minecraft cape textures are 64×32 px.  Leave `undefined` (the
   * default) to disable cape rendering.
   *
   * @default undefined
   */
  capeUrl?: string;

  /**
   * External animation time in seconds.
   *
   * When provided, drives all animations from this value instead of the
   * internal requestAnimationFrame clock.  Useful for pausing, seeking,
   * or syncing with external timelines.  Leave `undefined` for auto.
   *
   * @default undefined
   */
  time?: number;

  /**
   * Uniform model scale factor.
   *
   * @default 1
   */
  scale?: number;

  /**
   * Rotation-reset trigger.
   *
   * Pass a Svelte 5 `$state` value; whenever it changes an internal
   * `$effect` listener resets the orbital camera back to its defaults.
   *
   * @default 0
   */
  resetId?: number;

  /**
   * CSS class forwarded to the inner `<canvas>` element.
   *
   * Useful for sizing, background, or cursor styling.
   *
   * @default ""
   */
  class?: string;

  /**
   * Canvas width in CSS pixels.
   *
   * @default 800
   */
  width?: number;

  /**
   * Canvas height in CSS pixels.
   *
   * @default 600
   */
  height?: number;
}
