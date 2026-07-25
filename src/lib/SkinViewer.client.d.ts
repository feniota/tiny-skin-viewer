import type { Component, ComponentProps } from "svelte";

interface SkinViewerProps {
  skinUrl?: string;
  isSlim?: boolean;
  scale?: number;
  resetId?: number;
  class?: string;
  width?: number;
  height?: number;
}

declare const SkinViewer: Component<SkinViewerProps>;
export default SkinViewer;
export type { SkinViewerProps };
