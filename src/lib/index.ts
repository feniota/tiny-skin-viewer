export { default as SkinViewer } from "./SkinViewer.svelte";

export interface SkinViewerProps {
  skinUrl?: string;
  isSlim?: boolean;
  scale?: number;
  resetId?: number;
  class?: string;
  width?: number;
  height?: number;
}
