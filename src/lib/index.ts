export { default as SkinViewer } from "./SkinViewer.svelte";

export interface SkinViewerProps {
  skinUrl?: string;
  isSlim?: boolean;
  scale?: number;
  resetId?: number;
}
