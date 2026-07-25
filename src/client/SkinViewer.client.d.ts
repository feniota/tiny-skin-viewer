import type { Component } from "svelte";

/** Properties accepted by the {@link SkinViewer} component. */
interface SkinViewerProps {
  /** Minecraft skin texture URL (default: "/Template_classic.png") */
  skinUrl?: string;
  /** true = Slim (Alex, 3 px), false = Classic (Steve, 4 px) (default: false) */
  isSlim?: boolean;
  /** Uniform model scale factor (default: 1) */
  scale?: number;
  /** Rotation-reset trigger (Svelte 5 `$state`, default: 0) */
  resetId?: number;
  /** CSS class forwarded to the inner `<canvas>` (default: "") */
  class?: string;
  /** Canvas width in CSS pixels (default: 800) */
  width?: number;
  /** Canvas height in CSS pixels (default: 600) */
  height?: number;
}

/** Svelte 5 component that renders an animated Minecraft player skin. */
declare const SkinViewer: Component<SkinViewerProps>;
export default SkinViewer;
export type { SkinViewerProps };
