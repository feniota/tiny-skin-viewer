// Type declarations for the compiled SkinViewer.svelte.js.
// Placed alongside SkinViewer.js so Deno type-checking passes.

interface SkinViewerProps {
  skinUrl?: string;
  isSlim?: boolean;
  scale?: number;
  resetId?: number;
}

declare const SkinViewer: import("svelte").Component<SkinViewerProps>;

export default SkinViewer;
