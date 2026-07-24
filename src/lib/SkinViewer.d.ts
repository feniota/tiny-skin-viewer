/**
 * Type declarations for the compiled `SkinViewer.js`.
 *
 * Placed alongside the compiled JS module so Deno/JSR can infer the
 * component's type without slow type-inference on the Svelte-generated code.
 *
 * @module
 */

import type { Component } from "svelte";

interface _SkinViewerProps {
  skinUrl?: string;
  isSlim?: boolean;
  scale?: number;
  resetId?: number;
}

/** Svelte 5 component that renders an animated Minecraft player skin. */
declare const SkinViewer: Component<_SkinViewerProps>;

export default SkinViewer;
