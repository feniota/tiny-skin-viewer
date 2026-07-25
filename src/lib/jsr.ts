/**
 * Entry point for JSR (@feniota/tiny-skin-viewer).
 *
 * JSR cannot validate `.svelte` files, so this entry exports types and
 * documentation only.  Import the actual component from the npm package:
 *
 * ```svelte
 * <script>
 *   import { SkinViewer } from "tiny-skin-viewer";
 * </script>
 * ```
 *
 * @module
 */

import type { Component } from "svelte";

/** Properties accepted by the {@link SkinViewerProps} component. */
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
   * @default 1
   */
  scale?: number;

  /**
   * Rotation-reset trigger.
   *
   * This should be a Svelte 5 `$state` value.  Whenever it changes, an
   * internal `$effect` listener resets the model's rotation angles.
   *
   * @default 0
   */
  resetId?: number;
}

/**
 * Svelte 5 component that renders an animated Minecraft player skin.
 *
 * All rendering — model transform, limb animation, skin sampling, scale —
 * runs in a single WGSL shader.  The CPU only feeds 5 floats per frame.
 *
 * ```svelte
 * <script>
 *   import { SkinViewer } from "tiny-skin-viewer";
 * </script>
 *
 * <SkinViewer skinUrl="/steve.png" scale={1.5} />
 * ```
 */
export declare const SkinViewer: Component<SkinViewerProps>;
